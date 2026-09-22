import type { ReactNode } from 'react'
import { Link } from 'react-router'
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
  type FiltersSnapshot,
} from '@/lib/filters/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'

const PATH = '/filters'
const FILTERING_ENDS = ['More filtering', 'Less filtering'] as const
const NOTCH_COUNTS = Array.from({ length: DYN_NOTCH_COUNT_MAX + 1 }, (_, count) => ({
  value: count,
  label: count === 0 ? 'Off' : String(count),
}))
const hzEnds = ({ min, max }: { min: number; max: number }) => [`${min} Hz`, `${max} Hz`] as const

/** Spec: docs/tabs/filters.md */
export function FiltersPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readFiltersSnapshot)
  return (
    <>
      <PageHeader
        title="Filters"
        description="The few filters a quad with RPM filtering needs. Everything else is off."
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
  snapshot: FiltersSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readFilters)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  const pinned = pinnedChanges(snapshot)
  const dterm = dtermCutoffs(draft.dterm)
  const notchOff = draft.dynNotchCount === 0

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lowpass filters</CardTitle>
            <CardDescription>
              Further right filters less: less delay, but more noise reaches the motors.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <FilterSection
              title="Gyro lowpass 2"
              description="PT1 filter on the gyro signal, 500 Hz at 1.0. All the way left switches it off."
              readout={
                draft.gyroLpf2 === 0
                  ? 'Off'
                  : `${(draft.gyroLpf2 / 100).toFixed(1)} · ${gyroLpf2Hz(draft.gyroLpf2)} Hz`
              }
            >
              <FilterSlider
                label="Gyro lowpass 2"
                {...GYRO_SLIDER}
                value={draft.gyroLpf2}
                onChange={(gyroLpf2) => setDraft({ ...draft, gyroLpf2 })}
              />
            </FilterSection>
            <FilterSection
              title="D-term filtering"
              description="Both D-term lowpass filters. Move left if the motors come down hot, right for less prop wash."
              readout={`${(draft.dterm / 100).toFixed(2)} · ${dterm.lpf1MinHz}–${dterm.lpf1MaxHz} Hz + ${dterm.lpf2Hz} Hz`}
            >
              <FilterSlider
                label="D-term filtering"
                {...dtermSliderBounds(readFilters(snapshot).dterm)}
                step={DTERM_SLIDER.step}
                value={draft.dterm}
                onChange={(dterm) => setDraft({ ...draft, dterm })}
              />
            </FilterSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notch filters</CardTitle>
            <CardDescription>
              Narrow filters that cut noise out at the frequencies where it sits.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <FilterSection
              title="RPM filter"
              description="Removes motor noise, following each motor's speed. Below the min frequency it fades out."
              readout={`Min ${draft.rpmMinHz} Hz`}
            >
              <FilterSlider
                label="RPM filter min frequency"
                ends={hzEnds(RPM_MIN_HZ)}
                {...RPM_MIN_HZ}
                value={draft.rpmMinHz}
                onChange={(rpmMinHz) => setDraft({ ...draft, rpmMinHz })}
              />
            </FilterSection>
            <FilterSection
              title="Dynamic notch"
              description="Catches the noise that is left, like frame resonance. One notch is enough next to a working RPM filter."
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                <span className="font-medium">Notch count</span>
                <ButtonGroup
                  label="Dynamic notch count"
                  options={NOTCH_COUNTS}
                  value={draft.dynNotchCount}
                  onChange={(dynNotchCount) => setDraft({ ...draft, dynNotchCount })}
                />
              </div>
              <div className="flex flex-col gap-3">
                <div
                  className={cn(
                    'flex items-baseline justify-between gap-4 text-sm',
                    notchOff && 'opacity-50',
                  )}
                >
                  <span className="font-medium">Min frequency</span>
                  <span className="font-mono tabular-nums">{draft.dynNotchMinHz} Hz</span>
                </div>
                <FilterSlider
                  label="Dynamic notch min frequency"
                  ends={hzEnds(DYN_NOTCH_MIN_HZ)}
                  {...DYN_NOTCH_MIN_HZ}
                  disabled={notchOff}
                  value={draft.dynNotchMinHz}
                  onChange={(dynNotchMinHz) => setDraft({ ...draft, dynNotchMinHz })}
                />
              </div>
            </FilterSection>
          </CardContent>
        </Card>
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

interface FilterSectionProps {
  title: string
  description: string
  /** Slider sections: the value and the cutoffs it results in. */
  readout?: string
  children: ReactNode
}

/** One filter inside a card: its name and what it does, then its controls. */
function FilterSection({ title, description, readout, children }: FilterSectionProps) {
  return (
    <section className="flex flex-col gap-4 py-6 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="font-medium">{title}</h3>
          {readout !== undefined && (
            <span className="font-mono text-sm tabular-nums">{readout}</span>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  )
}

interface FilterSliderProps {
  label: string
  /** What the left and right end of the track mean. */
  ends?: readonly [string, string]
  disabled?: boolean
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

function FilterSlider({
  label,
  ends = FILTERING_ENDS,
  value,
  onChange,
  ...range
}: FilterSliderProps) {
  return (
    <div>
      <Slider
        aria-label={label}
        {...range}
        // an FC value outside the range keeps the thumb on the track; the readout shows the real one
        value={[Math.min(range.max, Math.max(range.min, value))]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
      <div className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  )
}
