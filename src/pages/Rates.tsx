import { useState } from 'react'
import { Notice, LoadingState } from '@/components/Notice'
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
  ACTUAL_DEFAULTS,
  applySync,
  AXES,
  curveSeries,
  detectSync,
  editAxis,
  FIELD_LABELS,
  followerAxes,
  LIMITS,
  rateLimits,
  RATES_TYPE_ACTUAL,
  RATES_TYPE_NAMES,
  readRates,
  validateRates,
  type RateField,
  type RatesSnapshot,
  type SyncMode,
} from '@/lib/rates/model'

const PATH = '/rates'
const FIELDS: RateField[] = ['center', 'max', 'expo']
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
      <PageHeader title="Rates" description="How fast the quad rotates for a given stick movement." />
      {client && snapshot ? <Editor client={client} snapshot={snapshot} reload={reload} /> : <LoadingState error={error} />}
    </>
  )
}

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: RatesSnapshot; reload: () => void }) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readRates)
  const { saving, error, save } = useSave(reload)
  // Sync is a way of editing, not a setting on the FC: start with whatever the current values allow.
  const [sync, setSync] = useState<SyncMode>(() => detectSync(readRates(snapshot).axes))
  useUnsavedChanges(PATH, dirty)

  const fcType = readRates(snapshot).type
  const actual = draft.type === RATES_TYPE_ACTUAL
  const followers = followerAxes(sync)

  const changeType = (type: number) => {
    // Numbers mean something different in every rate type, so switching starts from Actual's defaults.
    if (type === RATES_TYPE_ACTUAL && fcType !== RATES_TYPE_ACTUAL) {
      setSync('all')
      setDraft({ type, axes: AXES.map(() => ({ ...ACTUAL_DEFAULTS })) })
    } else setDraft({ ...readRates(snapshot), type })
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
            <CardDescription>
              Center sensitivity is how twitchy the quad feels around mid-stick, max rate is the rotation speed at full
              stick, expo bends the curve between the two.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                Rate type
                <NativeSelect value={draft.type} onChange={(e) => changeType(Number(e.target.value))}>
                  <NativeSelectOption value={RATES_TYPE_ACTUAL}>Actual</NativeSelectOption>
                  {fcType !== RATES_TYPE_ACTUAL && (
                    <NativeSelectOption value={fcType}>
                      {RATES_TYPE_NAMES[fcType] ?? `Type ${fcType}`} (not supported yet)
                    </NativeSelectOption>
                  )}
                </NativeSelect>
              </label>
              <label className="flex items-center gap-3 text-sm font-medium">
                Axes
                <NativeSelect value={sync} disabled={!actual} onChange={(e) => changeSync(e.target.value as SyncMode)}>
                  {(Object.keys(SYNC_LABELS) as SyncMode[]).map((mode) => (
                    <NativeSelectOption key={mode} value={mode}>
                      {SYNC_LABELS[mode]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            </div>

            {actual ? (
              <table className="w-full border-separate border-spacing-x-2 border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th />
                    <th className="font-normal">{FIELD_LABELS.center} (°/s)</th>
                    <th className="font-normal">{FIELD_LABELS.max} (°/s)</th>
                    <th className="font-normal">{FIELD_LABELS.expo}</th>
                  </tr>
                </thead>
                <tbody>
                  {AXES.map((axisName, axis) => (
                    <tr key={axisName}>
                      <th className="pr-2 text-left font-medium">{axisName}</th>
                      {FIELDS.map((field) => {
                        const { min, max, step } = LIMITS[field]
                        const scale = field === 'expo' ? 100 : 1
                        return (
                          <td key={field}>
                            <input
                              type="number"
                              aria-label={`${axisName} ${FIELD_LABELS[field].toLowerCase()}`}
                              min={min / scale}
                              max={max / scale}
                              step={step / scale}
                              disabled={followers.includes(axis)}
                              value={(draft.axes[axis]?.[field] ?? 0) / scale}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  axes: editAxis(draft.axes, sync, axis, field, Math.round(Number(e.target.value) * scale)),
                                })
                              }
                              className="h-9 w-full min-w-20 rounded-md border bg-transparent px-3 tabular-nums disabled:opacity-50 dark:bg-input/30"
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
                This quad uses {RATES_TYPE_NAMES[fcType] ?? 'another'} rates, which this app can&apos;t edit yet. Pick{' '}
                <strong>Actual</strong> to switch — that starts from Betaflight&apos;s default rates (70 / 670 / 0), because
                the numbers of different rate types aren&apos;t comparable.
              </Notice>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate curve</CardTitle>
          </CardHeader>
          <CardContent>
            {actual ? (
              <RateCurveChart series={curveSeries(draft.axes, rateLimits(snapshot))} />
            ) : (
              <p className="text-sm text-muted-foreground">Shown for Actual rates.</p>
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
