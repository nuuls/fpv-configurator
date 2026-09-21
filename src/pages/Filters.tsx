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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lowpass filters</CardTitle>
            <CardDescription>Further right filters less: less delay, but more noise reaches the motors.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <FilterSlider
              label="Gyro lowpass 2"
              readout={draft.gyroLpf2 === 0 ? 'Off' : `${(draft.gyroLpf2 / 100).toFixed(1)} · ${gyroLpf2Hz(draft.gyroLpf2)} Hz`}
              hint="PT1 filter on the gyro signal, 500 Hz at 1.0. All the way left switches it off."
              {...GYRO_SLIDER}
              value={draft.gyroLpf2}
              onChange={(gyroLpf2) => setDraft({ ...draft, gyroLpf2 })}
            />
            <FilterSlider
              label="D-term filtering"
              readout={`${(draft.dterm / 100).toFixed(2)} · ${dterm.lpf1MinHz}–${dterm.lpf1MaxHz} Hz + ${dterm.lpf2Hz} Hz`}
              hint="Both D-term lowpass filters. Move left if the motors come down hot, right for less prop wash."
              {...dtermSliderBounds(readFilters(snapshot).dterm)}
              step={DTERM_SLIDER.step}
              value={draft.dterm}
              onChange={(dterm) => setDraft({ ...draft, dterm })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notch filters</CardTitle>
            <CardDescription>The RPM filter removes motor noise; the dynamic notch catches what is left, like frame resonance.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 text-sm">
            <label htmlFor="rpm-min-hz" className="font-medium">
              RPM filter min frequency
            </label>
            <div className="flex items-center gap-3">
              <NumberInput
                id="rpm-min-hz"
                {...RPM_MIN_HZ}
                value={draft.rpmMinHz}
                onValueChange={(rpmMinHz) => setDraft({ ...draft, rpmMinHz })}
                className={NUMBER_CLASS}
              />
              <span className="text-muted-foreground">Hz. Below this motor speed the RPM filter fades out.</span>
            </div>

            <label htmlFor="dyn-notch-count" className="font-medium">
              Dynamic notch count
            </label>
            <div className="flex items-center gap-3">
              <NativeSelect
                id="dyn-notch-count"
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
              <span className="text-muted-foreground">One is enough next to a working RPM filter.</span>
            </div>

            <label htmlFor="dyn-notch-min-hz" className="font-medium">
              Dynamic notch min frequency
            </label>
            <div className="flex items-center gap-3">
              <NumberInput
                id="dyn-notch-min-hz"
                {...DYN_NOTCH_MIN_HZ}
                disabled={notchOff}
                value={draft.dynNotchMinHz}
                onValueChange={(dynNotchMinHz) => setDraft({ ...draft, dynNotchMinHz })}
                className={NUMBER_CLASS}
              />
              <span className="text-muted-foreground">Hz. The lowest noise frequency it follows.</span>
            </div>
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

interface FilterSliderProps {
  label: string
  readout: string
  hint: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

function FilterSlider({ label, readout, hint, value, onChange, ...range }: FilterSliderProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm tabular-nums">{readout}</span>
      </div>
      <Slider
        aria-label={label}
        className="my-3"
        {...range}
        value={[value]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}
