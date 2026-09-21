import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Notice, LoadingState } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
  DYN_NOTCH_COUNT_RECOMMENDED,
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

const PATH = '/filters'
const NUMBER_CLASS = 'h-9 w-24 rounded-md border bg-transparent px-3 disabled:opacity-50 dark:bg-input/30'

/** Spec: docs/tabs/filters.md */
export function FiltersPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readFiltersSnapshot)
  return (
    <>
      <PageHeader title="Filters" description="The few filters a quad with RPM filtering needs. Everything else is off." />
      {client && snapshot ? <Editor client={client} snapshot={snapshot} reload={reload} /> : <LoadingState error={error} />}
    </>
  )
}

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: FiltersSnapshot; reload: () => void }) {
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
            <CardDescription>Further right filters less: less delay, but more noise reaches the motors.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <FilterSection
              title="Gyro lowpass 2"
              description="PT1 filter on the gyro signal, 500 Hz at 1.0. All the way left switches it off."
              readout={draft.gyroLpf2 === 0 ? 'Off' : `${(draft.gyroLpf2 / 100).toFixed(1)} · ${gyroLpf2Hz(draft.gyroLpf2)} Hz`}
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
            <CardDescription>Narrow filters that cut noise out at the frequencies where it sits.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            <FilterSection title="RPM filter" description="Removes motor noise, following each motor's speed.">
              <Field id="rpm-min-hz" label="Min frequency" hint="Below this motor speed the RPM filter fades out.">
                <NumberInput
                  id="rpm-min-hz"
                  aria-label="RPM filter min frequency"
                  {...RPM_MIN_HZ}
                  value={draft.rpmMinHz}
                  onValueChange={(rpmMinHz) => setDraft({ ...draft, rpmMinHz })}
                  className={NUMBER_CLASS}
                />
                <span className="text-muted-foreground">Hz</span>
              </Field>
            </FilterSection>
            <FilterSection title="Dynamic notch" description="Catches the noise that is left, like frame resonance.">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="dyn-notch-count" label="Notch count" hint="One is enough next to a working RPM filter.">
                  <NativeSelect
                    id="dyn-notch-count"
                    aria-label="Dynamic notch count"
                    value={draft.dynNotchCount}
                    onChange={(e) => setDraft({ ...draft, dynNotchCount: Number(e.target.value) })}
                  >
                    {Array.from({ length: DYN_NOTCH_COUNT_MAX + 1 }, (_, count) => (
                      <NativeSelectOption key={count} value={count}>
                        {count === 0 ? 'Off' : count}
                        {count === DYN_NOTCH_COUNT_RECOMMENDED ? ' (recommended)' : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="dyn-notch-min-hz" label="Min frequency" hint="The lowest noise frequency it follows.">
                  <NumberInput
                    id="dyn-notch-min-hz"
                    aria-label="Dynamic notch min frequency"
                    {...DYN_NOTCH_MIN_HZ}
                    disabled={notchOff}
                    value={draft.dynNotchMinHz}
                    onValueChange={(dynNotchMinHz) => setDraft({ ...draft, dynNotchMinHz })}
                    className={NUMBER_CLASS}
                  />
                  <span className="text-muted-foreground">Hz</span>
                </Field>
              </div>
            </FilterSection>
          </CardContent>
        </Card>
      </div>

      {!snapshot.bidirDshot && (
        <Notice tone="warning">
          Bidirectional DShot is off, so the RPM filter isn&apos;t running — and these filter settings rely on it. Turn
          it on in the{' '}
          <Link to="/motors" className="underline">
            Motors
          </Link>{' '}
          tab before flying with them.
        </Notice>
      )}
      {pinned.length > 0 && (
        <Notice tone="warning">
          This quad uses filter settings this app doesn&apos;t show. Saving changes them: {pinned.join('; ')}.
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
          {readout !== undefined && <span className="font-mono text-sm tabular-nums">{readout}</span>}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">{children}</div>
      <p className="text-muted-foreground">{hint}</p>
    </div>
  )
}

interface FilterSliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

function FilterSlider({ label, value, onChange, ...range }: FilterSliderProps) {
  return (
    <div>
      <Slider
        aria-label={label}
        {...range}
        value={[value]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>More filtering</span>
        <span>Less filtering</span>
      </div>
    </div>
  )
}
