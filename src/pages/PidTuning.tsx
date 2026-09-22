import { useEffect, useState } from 'react'
import { ButtonGroup } from '@/components/ButtonGroup'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import type { MspClient } from '@/lib/msp/client'
import { previewPids, readTuningSnapshot, saveTuning } from '@/lib/tuning/io'
import {
  hasHiddenTuning,
  readTuning,
  SLIDER_STEP,
  sliderBounds,
  SMOOTHING_PRESETS,
  smoothingWrites,
  TPA_BREAKPOINT,
  TPA_MODE,
  TPA_MODE_OPTIONS,
  TPA_RATE,
  tpaThrottlePercent,
  type AxisPids,
  type SmoothingPreset,
  type TpaSettings,
  type TuningDraft,
  type TuningSnapshot,
} from '@/lib/tuning/model'
import { cn } from '@/lib/utils'

const PATH = '/pid-tuning'

const SLIDERS = [
  {
    key: 'damping',
    label: 'Damping',
    hint: 'D gains. Higher resists overshoot and bounce-back, but makes motors hotter and noisier.',
  },
  {
    key: 'pitch',
    label: 'Pitch gains',
    hint: 'A second master multiplier for the pitch axis only. Raise if pitch feels looser than roll.',
  },
  {
    key: 'master',
    label: 'Master multiplier',
    hint: 'Scales all gains together. Raise for a heavy or low-powered quad, lower if it oscillates.',
  },
] as const

/** Spec: docs/tabs/pid-tuning.md */
export function PidTuningPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readTuningSnapshot)
  return (
    <>
      <PageHeader
        title="PID Tuning"
        description="Three sliders, a stick-feel preset and TPA. The rest is handled for you."
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
  snapshot: TuningSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readTuning)
  const { saving, error, save } = useSave(reload)
  const pids = usePidPreview(client, snapshot, draft)
  useUnsavedChanges(PATH, dirty)

  const needsReboot = smoothingWrites(snapshot, draft).length > 0

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>PID sliders</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {SLIDERS.map(({ key, label, hint }) => (
              <TuningSlider
                key={key}
                label={label}
                readout={(draft[key] / 100).toFixed(2)}
                hint={hint}
                {...sliderBounds(readTuning(snapshot)[key])}
                step={SLIDER_STEP}
                value={draft[key]}
                onChange={(value) => setDraft({ ...draft, [key]: value })}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resulting PIDs</CardTitle>
            <CardDescription>
              Calculated by the flight controller from the sliders. View only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-right font-mono text-sm tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal" />
                  <th className="font-normal">P</th>
                  <th className="font-normal">I</th>
                  <th className="font-normal">D</th>
                  <th className="font-normal">FF</th>
                </tr>
              </thead>
              <tbody>
                {['Roll', 'Pitch', 'Yaw'].map((axis, i) => {
                  const row = pids?.[i]
                  return (
                    <tr key={axis} className="border-t">
                      <th className="py-1.5 text-left font-sans font-medium">{axis}</th>
                      <td>{row?.p ?? '—'}</td>
                      <td>{row?.i ?? '—'}</td>
                      <td>{row?.d ?? '—'}</td>
                      <td>{row?.f ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Stick feel</CardTitle>
          <CardDescription>
            How much the stick signal is smoothed. Betaflight adapts to your radio link&apos;s
            packet rate by itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {(Object.keys(SMOOTHING_PRESETS) as SmoothingPreset[]).map((key) => {
            const preset = SMOOTHING_PRESETS[key]
            const selected = draft.smoothing === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft({ ...draft, smoothing: key })}
                className={cn(
                  'hover:bg-accent focus-visible:ring-ring/50 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-[3px]',
                  selected && 'border-primary bg-primary/10 hover:bg-primary/10',
                )}
              >
                <div className="font-medium">{preset.label}</div>
                <p className="text-muted-foreground mt-1 text-sm">{preset.description}</p>
              </button>
            )
          })}
          {draft.smoothing === 'custom' && (
            <p className="text-muted-foreground text-sm md:col-span-3">
              This quad has custom smoothing settings that match none of the presets. They stay as
              they are unless you pick one.
            </p>
          )}
        </CardContent>
      </Card>

      {draft.tpa && snapshot.tpa && (
        <TpaCard
          tpa={draft.tpa}
          original={snapshot.tpa}
          onChange={(tpa) => setDraft({ ...draft, tpa })}
        />
      )}

      {hasHiddenTuning(snapshot) && (
        <Notice tone="warning">
          This quad uses tuning values this app doesn&apos;t show (other sliders, Dynamic D, or
          manually entered PIDs). Saving resets those to the app&apos;s defaults: other sliders at
          1.0 and Dynamic D off.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        reboot={needsReboot}
        onRevert={revert}
        onSave={() => void save(() => saveTuning(client, snapshot, draft))}
      />
    </>
  )
}

function TuningSlider({
  label,
  readout,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  readout: string
  hint?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm tabular-nums">{readout}</span>
      </div>
      <Slider
        aria-label={label}
        className="my-3"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
    </div>
  )
}

/** What the current TPA settings do, in one sentence. */
function tpaSummary({ mode, rate, breakpoint }: TpaSettings): string {
  if (rate === 0) return 'TPA is off: the gains stay the same at every throttle position.'
  const terms =
    mode === TPA_MODE.D ? 'D is' : mode === TPA_MODE.PD ? 'P and D are' : 'P, D and S are'
  return `${terms} lowered gradually above ${tpaThrottlePercent(breakpoint)} % throttle, down to ${100 - rate} % of normal at full throttle.`
}

function TpaCard({
  tpa,
  original,
  onChange,
}: {
  tpa: TpaSettings
  original: TpaSettings
  onChange: (tpa: TpaSettings) => void
}) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>TPA</CardTitle>
        <CardDescription>
          Throttle PID attenuation: lowers gains at high throttle, where the quad reacts harder and
          oscillates more easily.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Lowers</span>
          <ButtonGroup
            label="TPA mode"
            options={TPA_MODE_OPTIONS}
            value={tpa.mode}
            onChange={(mode) => onChange({ ...tpa, mode })}
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <TuningSlider
            label="TPA rate"
            readout={`${tpa.rate} %`}
            hint="How much the gains are lowered at full throttle. 0 turns TPA off."
            {...sliderBounds(original.rate, TPA_RATE)}
            step={TPA_RATE.step}
            value={tpa.rate}
            onChange={(rate) => onChange({ ...tpa, rate })}
          />
          <TuningSlider
            label="TPA breakpoint"
            readout={`${tpa.breakpoint} µs`}
            hint="Throttle where the lowering starts. Raise it if the quad oscillates only near full throttle."
            {...sliderBounds(original.breakpoint, TPA_BREAKPOINT)}
            step={TPA_BREAKPOINT.step}
            value={tpa.breakpoint}
            onChange={(breakpoint) => onChange({ ...tpa, breakpoint })}
          />
        </div>
        <p className="text-muted-foreground text-sm">{tpaSummary(tpa)}</p>
      </CardContent>
    </Card>
  )
}

/** Asks the FC for the PIDs the draft would produce, a moment after the sliders stop moving. */
function usePidPreview(
  client: MspClient,
  snapshot: TuningSnapshot,
  draft: TuningDraft,
): AxisPids[] | null {
  const [pids, setPids] = useState<AxisPids[] | null>(null)
  const { master, damping, pitch, smoothing } = draft

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      previewPids(client, snapshot, { master, damping, pitch, smoothing }).then(
        (result) => !cancelled && setPids(result),
        () => {}, // keep the last preview; connection problems surface elsewhere
      )
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, snapshot, master, damping, pitch, smoothing])

  return pids
}
