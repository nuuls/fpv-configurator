import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ButtonGroup } from '@/components/ButtonGroup'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readFiltersSnapshot, saveFilters } from '@/lib/filters/io'
import {
  DTERM_SLIDER,
  dtermCutoffs,
  dtermSliderBounds,
  DYN_NOTCH_COUNT_MAX,
  DYN_NOTCH_MIN_HZ,
  GYRO_SLIDER,
  gyroLpf2Hz,
  pinnedChanges,
  readFilters,
  RPM_MIN_HZ,
  validateFilters,
  YAW_LOWPASS_HZ,
  type FiltersSnapshot,
} from '@/lib/filters/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'

const PATH = '/filters'
const NOTCH_COUNTS = Array.from({ length: DYN_NOTCH_COUNT_MAX + 1 }, (_, count) => ({
  value: count,
  label: count === 0 ? 'Off' : String(count),
}))
const hz = (value: number) => `${value} Hz`
/** Slider multiplier in percent as the firmware's slider position. */
const position = (percent: number, digits: number) => (percent / 100).toFixed(digits)
/** Track ends of a frequency slider; a lower end of 0 switches the filter off. */
const hzEnds = ({ min, max }: { min: number; max: number }) =>
  [min === 0 ? 'Off' : hz(min), hz(max)] as const

/** Spec: docs/tabs/filters.md */
export function FiltersPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readFiltersSnapshot)
  return (
    <>
      <PageHeader title="Filters" />
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
  snapshot: FiltersSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readFilters)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  const pinned = pinnedChanges(snapshot)
  const dterm = dtermCutoffs(draft.dterm)
  const dtermBounds = dtermSliderBounds(readFilters(snapshot).dterm)
  const notchOff = draft.dynNotchCount === 0

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <FilterCard
          title="Gyro lowpass 2"
          readout={draft.gyroLpf2 === 0 ? 'Off' : hz(gyroLpf2Hz(draft.gyroLpf2))}
        >
          <FilterSlider
            label="Gyro lowpass 2"
            ends={['Off', position(GYRO_SLIDER.max, 1)]}
            {...GYRO_SLIDER}
            value={draft.gyroLpf2}
            onChange={(gyroLpf2) => setDraft({ ...draft, gyroLpf2 })}
          />
        </FilterCard>

        <FilterCard title="RPM filter" caption="min frequency" readout={hz(draft.rpmMinHz)}>
          <FilterSlider
            label="RPM filter min frequency"
            ends={hzEnds(RPM_MIN_HZ)}
            {...RPM_MIN_HZ}
            value={draft.rpmMinHz}
            onChange={(rpmMinHz) => setDraft({ ...draft, rpmMinHz })}
          />
        </FilterCard>

        <FilterCard
          title="Dynamic notch"
          caption="min frequency"
          readout={hz(draft.dynNotchMinHz)}
          dimmed={notchOff}
          aside={
            <ButtonGroup
              label="Dynamic notch count"
              options={NOTCH_COUNTS}
              value={draft.dynNotchCount}
              onChange={(dynNotchCount) => setDraft({ ...draft, dynNotchCount })}
            />
          }
        >
          <FilterSlider
            label="Dynamic notch min frequency"
            ends={hzEnds(DYN_NOTCH_MIN_HZ)}
            {...DYN_NOTCH_MIN_HZ}
            disabled={notchOff}
            value={draft.dynNotchMinHz}
            onChange={(dynNotchMinHz) => setDraft({ ...draft, dynNotchMinHz })}
          />
        </FilterCard>

        <FilterCard
          title="D-term filtering"
          readout={position(draft.dterm, 2)}
          detail={`${dterm.lpf1MinHz}–${dterm.lpf1MaxHz} / ${hz(dterm.lpf2Hz)}`}
        >
          <FilterSlider
            label="D-term filtering"
            ends={[position(dtermBounds.min, 1), position(dtermBounds.max, 1)]}
            {...dtermBounds}
            step={DTERM_SLIDER.step}
            value={draft.dterm}
            onChange={(dterm) => setDraft({ ...draft, dterm })}
          />
        </FilterCard>

        <FilterCard
          title="Yaw lowpass"
          readout={draft.yawLowpassHz === 0 ? 'Off' : hz(draft.yawLowpassHz)}
        >
          <FilterSlider
            label="Yaw lowpass"
            ends={hzEnds(YAW_LOWPASS_HZ)}
            {...YAW_LOWPASS_HZ}
            value={draft.yawLowpassHz}
            onChange={(yawLowpassHz) => setDraft({ ...draft, yawLowpassHz })}
          />
        </FilterCard>
      </div>

      {!snapshot.bidirDshot && (
        <Notice tone="warning">
          Bidirectional DShot is off, so the RPM filter isn&apos;t running — and these filter
          settings rely on it. Turn it on in the{' '}
          <Link to="/motors" className="underline">
            Motors
          </Link>{' '}
          tab before flying with them.
        </Notice>
      )}
      {pinned.length > 0 && (
        <Notice tone="warning">
          This quad uses filter settings this app doesn&apos;t show. Saving changes them:{' '}
          {pinned.join('; ')}.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={validateFilters(draft)[0]}
        reboot={false}
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveFilters(client, snapshot, draft)
            return false
          })
        }
      />
    </>
  )
}

interface FilterCardProps {
  title: string
  /** What the readout is, when the title alone doesn't say ("min frequency"). */
  caption?: string
  /** The resulting cutoff, or the slider position when `detail` has the cutoffs — the one thing to look at. */
  readout: string
  /** Right-aligned next to the readout: the cutoffs a slider position results in. */
  detail?: string
  /** Extra control on the title row (the notch count). */
  aside?: ReactNode
  /** Filter switched off elsewhere: the readout and control stay visible but fade. */
  dimmed?: boolean
  children: ReactNode
}

/** One filter: its name, the resulting value in large type, then its slider. */
function FilterCard({ title, caption, readout, detail, aside, dimmed, children }: FilterCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h3 className="font-medium">
            {title}
            {caption && <span className="text-muted-foreground font-normal"> · {caption}</span>}
          </h3>
          {aside}
        </div>
        <div
          className={cn(
            'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-mono text-3xl font-semibold tabular-nums xl:text-4xl',
            dimmed && 'opacity-50',
          )}
        >
          <span data-slot="readout">{readout}</span>
          {detail && (
            <span data-slot="readout" className="ml-auto text-right">
              {detail}
            </span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

interface FilterSliderProps {
  label: string
  /** What the left and right end of the track mean. */
  ends: readonly [string, string]
  disabled?: boolean
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

function FilterSlider({ label, ends, value, onChange, ...range }: FilterSliderProps) {
  return (
    <div className="flex flex-col gap-3">
      <Slider
        aria-label={label}
        className="[&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-track][data-orientation=horizontal]]:h-2.5"
        {...range}
        // an FC value outside the range keeps the thumb on the track; the readout shows the real one
        value={[Math.min(range.max, Math.max(range.min, value))]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  )
}
