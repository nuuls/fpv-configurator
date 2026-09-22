import { Plus, Trash2 } from 'lucide-react'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readModesSnapshot, readRcChannels, saveModes } from '@/lib/modes/io'
import {
  auxChannelCount,
  FIRST_AUX_CHANNEL,
  isRangeActive,
  MODE_BOXES,
  PWM_MAX,
  PWM_MIN,
  PWM_STEP,
  readModes,
  unmanagedSlotCount,
  validateModes,
  type ModeRange,
  type ModesSnapshot,
} from '@/lib/modes/model'
import type { MspClient } from '@/lib/msp/client'

const PATH = '/modes'
const NEW_RANGE: ModeRange = { auxChannel: 0, start: 1700, end: 2100 }
const NO_CHANNELS: number[] = []

/** Spec: docs/tabs/modes.md */
export function ModesPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readModesSnapshot)
  return (
    <>
      <PageHeader title="Modes" description="Choose which switch position turns each mode on." />
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
  snapshot: ModesSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readModes)
  const { saving, error, save } = useSave(reload)
  const channels = useMspPoll(readRcChannels, 100) ?? NO_CHANNELS
  useUnsavedChanges(PATH, dirty)

  const problems = validateModes(snapshot, draft)
  const others = unmanagedSlotCount(snapshot)
  const auxCount = auxChannelCount(channels)

  const setRanges = (boxId: number, ranges: ModeRange[]) =>
    setDraft(draft.map((mode) => (mode.boxId === boxId ? { ...mode, ranges } : mode)))

  return (
    <>
      <div className="flex flex-col gap-4">
        {draft.map(({ boxId, ranges }) => {
          const box = MODE_BOXES.find((b) => b.id === boxId)
          if (!box) return null
          const active = ranges.some((range) => isRangeActive(range, channels))

          return (
            <Card key={boxId} className={active ? 'border-primary' : undefined}>
              <CardContent className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div className="w-44 shrink-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {box.label}
                    {active && <Badge>Active</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{box.hint}</p>
                </div>

                <div className="flex min-w-72 flex-1 flex-col gap-4">
                  {ranges.map((range, index) => {
                    const name = `${box.label} range ${index + 1}`
                    const update = (patch: Partial<ModeRange>) =>
                      setRanges(
                        boxId,
                        ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                      )
                    const live = channels[FIRST_AUX_CHANNEL + range.auxChannel]

                    return (
                      <div key={index} className="flex items-center gap-3">
                        <NativeSelect
                          aria-label={`${name} channel`}
                          value={range.auxChannel}
                          onChange={(e) => update({ auxChannel: Number(e.target.value) })}
                        >
                          {Array.from(
                            { length: Math.max(auxCount, range.auxChannel + 1) },
                            (_, aux) => (
                              <NativeSelectOption key={aux} value={aux}>
                                AUX {aux + 1}
                              </NativeSelectOption>
                            ),
                          )}
                        </NativeSelect>

                        <div className="relative flex-1 py-3">
                          <Slider
                            aria-label={name}
                            min={PWM_MIN}
                            max={PWM_MAX}
                            step={PWM_STEP}
                            minStepsBetweenThumbs={1}
                            value={[range.start, range.end]}
                            onValueChange={([start, end]) => {
                              if (start !== undefined && end !== undefined) update({ start, end })
                            }}
                          />
                          {live !== undefined && (
                            <div
                              title={`AUX ${range.auxChannel + 1}: ${live}`}
                              className="bg-foreground pointer-events-none absolute top-0 h-full w-0.5"
                              style={{
                                left: `${((Math.min(PWM_MAX, Math.max(PWM_MIN, live)) - PWM_MIN) / (PWM_MAX - PWM_MIN)) * 100}%`,
                              }}
                            />
                          )}
                        </div>

                        <span className="w-24 text-right font-mono text-sm tabular-nums">
                          {range.start} – {range.end}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${name}`}
                          onClick={() =>
                            setRanges(
                              boxId,
                              ranges.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )
                  })}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    aria-label={`Add ${box.label} range`}
                    onClick={() => setRanges(boxId, [...ranges, NEW_RANGE])}
                  >
                    <Plus />
                    Add range
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {others > 0 && (
        <Notice>
          {others} other mode {others === 1 ? 'range is' : 'ranges are'} set up on this flight
          controller (not shown here). {others === 1 ? 'It is' : 'They are'} left untouched.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={problems[0]}
        reboot={false}
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveModes(client, snapshot, draft)
            return false
          })
        }
      />
    </>
  )
}
