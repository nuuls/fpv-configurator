import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Notice, LoadingState } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import type { MspClient } from '@/lib/msp/client'
import { readVtxSnapshot, saveVtx } from '@/lib/vtx/io'
import {
  applyTable,
  channelCount,
  channelName,
  newBand,
  readVtx,
  removeBand,
  removePowerLevel,
  validateVtx,
  VTX_BAND_NAME_LENGTH,
  VTX_DEVICE_NAMES,
  VTX_LOW_POWER_DISARM,
  VTX_MAX_BANDS,
  VTX_MAX_FREQUENCY,
  VTX_MAX_POWER_LEVELS,
  VTX_POWER_LABEL_LENGTH,
  type VtxBand,
  type VtxConfig,
  type VtxPowerLevel,
  type VtxSnapshot,
} from '@/lib/vtx/model'
import { findPreset, presetsOf, VTX_MANUFACTURERS, type VtxPreset } from '@/lib/vtx/presets'

const PATH = '/vtx'
const FIELD =
  'h-9 rounded-md border bg-transparent px-2 tabular-nums disabled:opacity-50 dark:bg-input/30'

/** Spec: docs/tabs/vtx.md */
export function VtxPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readVtxSnapshot)
  return (
    <>
      <PageHeader
        title="Analog VTX"
        description="Video transmitter channel and power, and the table that defines them."
      />
      {client && snapshot ? (
        snapshot.config.tableAvailable ? (
          <Editor client={client} snapshot={snapshot} reload={reload} />
        ) : (
          <Notice tone="warning">
            This firmware was built without VTX table support, so there is nothing to set up here.
          </Notice>
        )
      ) : (
        <LoadingState error={error} />
      )}
    </>
  )
}

function deviceStatus(config: VtxConfig): string {
  const name = VTX_DEVICE_NAMES[config.deviceType]
  if (!name)
    return 'No VTX detected — pick its type and port on the Ports tab. The table can be set up without it.'
  return `${name} VTX ${config.deviceReady ? 'connected' : 'configured, but not answering'}.`
}

function Editor({
  client,
  snapshot,
  reload,
}: {
  client: MspClient
  snapshot: VtxSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readVtx)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  // Picking a preset is a way of editing, not a setting on the FC.
  const [manufacturer, setManufacturer] = useState('')
  const [presetId, setPresetId] = useState('')
  const [loaded, setLoaded] = useState<VtxPreset | null>(null)
  const preset = findPreset(presetId)

  const { table } = draft
  const selectedBand = table.bands[draft.band - 1]
  const setBands = (bands: VtxBand[]) => setDraft({ ...draft, table: { ...table, bands } })
  const setPowerLevels = (powerLevels: VtxPowerLevel[]) =>
    setDraft({ ...draft, table: { ...table, powerLevels } })
  const editBand = (index: number, patch: Partial<VtxBand>) =>
    setBands(table.bands.map((band, i) => (i === index ? { ...band, ...patch } : band)))
  const editPowerLevel = (index: number, patch: Partial<VtxPowerLevel>) =>
    setPowerLevels(
      table.powerLevels.map((level, i) => (i === index ? { ...level, ...patch } : level)),
    )

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Channel and power</CardTitle>
            <CardDescription>{deviceStatus(snapshot.config)}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-4 text-sm">
            <label htmlFor="vtx-band" className="font-medium">
              Band
            </label>
            <NativeSelect
              id="vtx-band"
              value={draft.band}
              disabled={table.bands.length === 0}
              onChange={(e) => setDraft({ ...draft, band: Number(e.target.value) })}
            >
              {!selectedBand && (
                <NativeSelectOption value={draft.band}>
                  {table.bands.length === 0
                    ? '—'
                    : draft.band === 0
                      ? `Fixed frequency (${snapshot.config.frequency} MHz)`
                      : `Band ${draft.band} (not in the table)`}
                </NativeSelectOption>
              )}
              {table.bands.map((band, i) => (
                <NativeSelectOption key={i} value={i + 1}>
                  {band.name || `Band ${i + 1}`} ({band.letter || '?'})
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="vtx-channel" className="font-medium">
              Channel
            </label>
            <NativeSelect
              id="vtx-channel"
              value={draft.channel}
              disabled={!selectedBand}
              onChange={(e) => setDraft({ ...draft, channel: Number(e.target.value) })}
            >
              {!selectedBand?.frequencies[draft.channel - 1] && (
                <NativeSelectOption value={draft.channel}>—</NativeSelectOption>
              )}
              {selectedBand?.frequencies.map((frequency, i) => (
                <NativeSelectOption key={i} value={i + 1} disabled={frequency === 0}>
                  {channelName(table, draft.band, i + 1)} —{' '}
                  {frequency === 0 ? 'not available' : `${frequency} MHz`}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="vtx-power" className="font-medium">
              Power
            </label>
            <NativeSelect
              id="vtx-power"
              value={draft.power}
              disabled={table.powerLevels.length === 0}
              onChange={(e) => setDraft({ ...draft, power: Number(e.target.value) })}
            >
              {!table.powerLevels[draft.power - 1] && (
                <NativeSelectOption value={draft.power}>—</NativeSelectOption>
              )}
              {table.powerLevels.map((level, i) => (
                <NativeSelectOption key={i} value={i + 1}>
                  {level.label || `Level ${i + 1}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="vtx-low-power-disarm" className="self-start pt-2 font-medium">
              Low power disarm
            </label>
            <div className="flex flex-col gap-1.5">
              <NativeSelect
                id="vtx-low-power-disarm"
                value={draft.lowPowerDisarm}
                onChange={(e) => setDraft({ ...draft, lowPowerDisarm: Number(e.target.value) })}
              >
                {!VTX_LOW_POWER_DISARM.some((option) => option.value === draft.lowPowerDisarm) && (
                  <NativeSelectOption value={draft.lowPowerDisarm}>
                    Unknown ({draft.lowPowerDisarm})
                  </NativeSelectOption>
                )}
                {VTX_LOW_POWER_DISARM.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-muted-foreground">
                Transmits at the lowest power level while disarmed, except after a failsafe.
              </p>
            </div>

            {table.bands.length === 0 && (
              <p className="text-muted-foreground col-span-2">
                The VTX table is empty. Load a preset or add bands below first.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>VTX table preset</CardTitle>
            <CardDescription>
              Fills the table below with the bands and power levels of your VTX. You can still
              change it before saving. Check which frequencies and power levels are legal where you
              fly.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-4 text-sm">
            <label htmlFor="vtx-manufacturer" className="font-medium">
              Manufacturer
            </label>
            <NativeSelect
              id="vtx-manufacturer"
              value={manufacturer}
              onChange={(e) => {
                setManufacturer(e.target.value)
                setPresetId(presetsOf(e.target.value)[0]?.id ?? '')
              }}
            >
              <NativeSelectOption value="">Choose…</NativeSelectOption>
              {VTX_MANUFACTURERS.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="vtx-model" className="font-medium">
              VTX
            </label>
            <NativeSelect
              id="vtx-model"
              value={presetId}
              disabled={!manufacturer}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {!manufacturer && <NativeSelectOption value="">—</NativeSelectOption>}
              {presetsOf(manufacturer).map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name} ({p.protocol})
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <div className="col-span-2 flex flex-wrap items-center gap-4">
              <Button
                variant="outline"
                disabled={!preset || saving}
                onClick={() => {
                  if (!preset) return
                  setDraft(applyTable(draft, preset.table))
                  setLoaded(preset)
                }}
              >
                Load preset
              </Button>
              <span className="text-muted-foreground" aria-live="polite">
                {loaded &&
                  `Loaded ${loaded.manufacturer} ${loaded.name}. Its power values are made for ${loaded.protocol} — the VTX type on the Ports tab has to match.`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>VTX table</CardTitle>
          <CardDescription>
            Frequencies in MHz, 0 = channel not available. Tick &quot;Factory&quot; when the VTX
            knows the band itself and is told band and channel; otherwise it is told the frequency.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 text-sm">
          <div className="flex flex-col gap-3 overflow-x-auto">
            {table.bands.length > 0 && (
              <table className="w-full border-separate border-spacing-x-1.5 border-spacing-y-1.5">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="font-normal">Band</th>
                    <th className="font-normal">Letter</th>
                    <th className="font-normal">Factory</th>
                    {Array.from({ length: channelCount(table) }, (_, channel) => (
                      <th key={channel} className="font-normal">
                        CH{channel + 1}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {table.bands.map((band, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          aria-label={`Band ${i + 1} name`}
                          value={band.name}
                          maxLength={VTX_BAND_NAME_LENGTH}
                          onChange={(e) => editBand(i, { name: e.target.value.toUpperCase() })}
                          className={`${FIELD} w-28`}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Band ${i + 1} letter`}
                          value={band.letter}
                          maxLength={1}
                          onChange={(e) => editBand(i, { letter: e.target.value.toUpperCase() })}
                          className={`${FIELD} w-12 text-center`}
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`Band ${i + 1} factory`}
                          checked={band.isFactory}
                          onChange={(e) => editBand(i, { isFactory: e.target.checked })}
                          className="accent-primary size-4"
                        />
                      </td>
                      {band.frequencies.map((frequency, channel) => (
                        <td key={channel}>
                          <NumberInput
                            aria-label={`Band ${i + 1} channel ${channel + 1}`}
                            min={0}
                            max={VTX_MAX_FREQUENCY}
                            value={frequency}
                            onValueChange={(value) =>
                              editBand(i, {
                                frequencies: band.frequencies.map((f, c) =>
                                  c === channel ? value : f,
                                ),
                              })
                            }
                            className={`${FIELD} w-full min-w-18`}
                          />
                        </td>
                      ))}
                      <td>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove band ${i + 1}`}
                          onClick={() => setDraft(removeBand(draft, i))}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={table.bands.length >= VTX_MAX_BANDS}
              onClick={() => setBands([...table.bands, newBand(table)])}
            >
              <Plus />
              Add band
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="font-medium">Power levels</h3>
              <p className="text-muted-foreground">
                The value is what the VTX is sent: a level number starting at 0 (SmartAudio 2.0),
                dBm (SmartAudio 2.1) or mW (Tramp). The label is what you see here and in the OSD.
              </p>
            </div>
            {table.powerLevels.length > 0 && (
              <div className="grid w-fit grid-cols-[auto_auto_auto_auto] items-center gap-x-3 gap-y-1.5">
                <span />
                <span className="text-muted-foreground">Label</span>
                <span className="text-muted-foreground">Value</span>
                <span />
                {table.powerLevels.map((level, i) => (
                  <div key={i} className="contents">
                    <span className="font-medium">{i + 1}</span>
                    <input
                      aria-label={`Power level ${i + 1} label`}
                      value={level.label}
                      maxLength={VTX_POWER_LABEL_LENGTH}
                      onChange={(e) => editPowerLevel(i, { label: e.target.value.toUpperCase() })}
                      className={`${FIELD} w-20`}
                    />
                    <NumberInput
                      aria-label={`Power level ${i + 1} value`}
                      min={0}
                      max={0xffff}
                      value={level.value}
                      onValueChange={(value) => editPowerLevel(i, { value })}
                      className={`${FIELD} w-24`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove power level ${i + 1}`}
                      onClick={() => setDraft(removePowerLevel(draft, i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={table.powerLevels.length >= VTX_MAX_POWER_LEVELS}
              onClick={() => setPowerLevels([...table.powerLevels, { value: 0, label: '' }])}
            >
              <Plus />
              Add power level
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={validateVtx(draft)[0]}
        reboot={false}
        onRevert={() => {
          revert()
          setLoaded(null)
        }}
        onSave={() =>
          void save(async () => {
            await saveVtx(client, snapshot, draft)
            return false
          })
        }
      />
    </>
  )
}
