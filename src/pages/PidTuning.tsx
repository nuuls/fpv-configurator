import { useEffect, useState } from 'react'
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
  type AxisPids,
  type SmoothingPreset,
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
      <PageHeader title="PID Tuning" description="Three sliders and a stick-feel preset. The rest is handled for you." />
      {client && snapshot ? <Editor client={client} snapshot={snapshot} reload={reload} /> : <LoadingState error={error} />}
    </>
  )
}

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: TuningSnapshot; reload: () => void }) {
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
              <div key={key}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="font-mono text-sm tabular-nums">{(draft[key] / 100).toFixed(2)}</span>
                </div>
                <Slider
                  aria-label={label}
                  className="my-3"
                  {...sliderBounds(readTuning(snapshot)[key])}
                  step={SLIDER_STEP}
                  value={[draft[key]]}
                  onValueChange={([value]) => value !== undefined && setDraft({ ...draft, [key]: value })}
                />
                <p className="text-sm text-muted-foreground">{hint}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resulting PIDs</CardTitle>
            <CardDescription>Calculated by the flight controller from the sliders. View only.</CardDescription>
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
            How much the stick signal is smoothed. Betaflight adapts to your radio link&apos;s packet rate by itself.
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
                  'rounded-lg border p-4 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  selected && 'border-primary bg-primary/10 hover:bg-primary/10',
                )}
              >
                <div className="font-medium">{preset.label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
              </button>
            )
          })}
          {draft.smoothing === 'custom' && (
            <p className="text-sm text-muted-foreground md:col-span-3">
              This quad has custom smoothing settings that match none of the presets. They stay as they are unless you
              pick one.
            </p>
          )}
        </CardContent>
      </Card>

      {hasHiddenTuning(snapshot) && (
        <Notice tone="warning">
          This quad uses tuning values this app doesn&apos;t show (other sliders, Dynamic D, or manually entered PIDs).
          Saving resets those to the app&apos;s defaults: other sliders at 1.0 and Dynamic D off.
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

/** Asks the FC for the PIDs the draft would produce, a moment after the sliders stop moving. */
function usePidPreview(client: MspClient, snapshot: TuningSnapshot, draft: TuningDraft): AxisPids[] | null {
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
