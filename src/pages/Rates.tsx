import { useState } from 'react'
import { Notice, LoadingState } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { RateCurveChart } from '@/components/RateCurveChart'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import type { MspClient } from '@/lib/msp/client'
import { readRatesSnapshot, saveRates } from '@/lib/rates/io'
import {
  applySync,
  AXES,
  curveSeries,
  defaultRates,
  detectSync,
  editAxis,
  fieldName,
  followerAxes,
  rateLimits,
  RATE_FIELDS,
  RATES_TYPES,
  ratesTypeName,
  readRates,
  shown,
  validateRates,
  type RatesSnapshot,
  type SyncMode,
} from '@/lib/rates/model'

const PATH = '/rates'
const SYNC_LABELS: Record<SyncMode, string> = {
  all: 'Sync all axes',
  'roll-pitch': 'Sync pitch and roll',
  off: 'Sync disabled',
}

/** Spec: docs/tabs/rates.md */
export function RatesPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readRatesSnapshot)
  return (
    <>
      <PageHeader
        title="Rates"
        description="How fast the quad rotates for a given stick movement."
      />
      {client && snapshot ? (
        <Editor client={client} snapshot={snapshot} reload={reload} />
      ) : (
        <LoadingState error={error} />
      )}
    </>
  )
}

function Editor({
  client,
  snapshot,
  reload,
}: {
  client: MspClient
  snapshot: RatesSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readRates)
  const { saving, error, save } = useSave(reload)
  // Sync is a way of editing, not a setting on the FC: start with whatever the current values allow.
  const [sync, setSync] = useState<SyncMode>(() => detectSync(readRates(snapshot).axes))
  useUnsavedChanges(PATH, dirty)

  const fcType = readRates(snapshot).type
  const spec = RATES_TYPES[draft.type]
  const followers = followerAxes(sync)

  const changeType = (type: number) => {
    // Numbers mean something different in every rate type, so every switch starts from that type's defaults.
    const defaults = defaultRates(type)
    setSync(defaults ? 'all' : detectSync(readRates(snapshot).axes))
    setDraft(defaults ?? readRates(snapshot))
  }

  const changeSync = (next: SyncMode) => {
    setSync(next)
    setDraft({ ...draft, axes: applySync(draft.axes, next) })
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rates</CardTitle>
            {spec && <CardDescription>{spec.help}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                Rate type
                <NativeSelect
                  value={draft.type}
                  onChange={(e) => changeType(Number(e.target.value))}
                >
                  {Object.entries(RATES_TYPES).map(([type, { name }]) => (
                    <NativeSelectOption key={type} value={type}>
                      {name}
                    </NativeSelectOption>
                  ))}
                  {!RATES_TYPES[fcType] && (
                    <NativeSelectOption value={fcType}>
                      {ratesTypeName(fcType)} (not supported)
                    </NativeSelectOption>
                  )}
                </NativeSelect>
              </label>
              <label className="flex items-center gap-3 text-sm font-medium">
                Axes
                <NativeSelect
                  value={sync}
                  disabled={!spec}
                  onChange={(e) => changeSync(e.target.value as SyncMode)}
                >
                  {(Object.keys(SYNC_LABELS) as SyncMode[]).map((mode) => (
                    <NativeSelectOption key={mode} value={mode}>
                      {SYNC_LABELS[mode]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            </div>

            {spec ? (
              <table className="w-full border-separate border-spacing-x-2 border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th />
                    {RATE_FIELDS.map((field) => (
                      <th key={field} scope="col" className="font-normal">
                        {spec.fields[field].label}
                        {spec.fields[field].unit && ` (${spec.fields[field].unit})`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {AXES.map((axisName, axis) => (
                    <tr key={axisName}>
                      <th scope="row" className="pr-2 text-left font-medium">
                        {axisName}
                      </th>
                      {RATE_FIELDS.map((field) => {
                        const fieldSpec = spec.fields[field]
                        return (
                          <td key={field}>
                            <NumberInput
                              aria-label={fieldName(fieldSpec, axis)}
                              min={shown(fieldSpec, fieldSpec.min)}
                              max={shown(fieldSpec, fieldSpec.max)}
                              step={shown(fieldSpec, fieldSpec.step)}
                              disabled={followers.includes(axis)}
                              value={shown(fieldSpec, draft.axes[axis]?.[field] ?? 0)}
                              onValueChange={(value) =>
                                setDraft({
                                  ...draft,
                                  axes: editAxis(
                                    draft.axes,
                                    sync,
                                    axis,
                                    field,
                                    Math.round(value * 10 ** fieldSpec.decimals),
                                  ),
                                })
                              }
                              className="dark:bg-input/30 h-9 w-full min-w-20 rounded-md border bg-transparent px-3 tabular-nums disabled:opacity-50"
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Notice>
                This quad uses a rate type this app doesn&apos;t know ({ratesTypeName(fcType)}).
                Pick another rate type to switch — that starts from the new type&apos;s default
                rates, because the numbers of different rate types aren&apos;t comparable.
              </Notice>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate curve</CardTitle>
          </CardHeader>
          <CardContent>
            {spec ? (
              <RateCurveChart series={curveSeries(draft, rateLimits(snapshot))} />
            ) : (
              <p className="text-muted-foreground text-sm">Not available for this rate type.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={validateRates(draft)[0]}
        reboot={false}
        onRevert={() => {
          revert()
          setSync(detectSync(readRates(snapshot).axes))
        }}
        onSave={() =>
          void save(async () => {
            await saveRates(client, snapshot, draft)
            return false
          })
        }
      />
    </>
  )
}
