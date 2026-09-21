import { BoardView } from '@/components/BoardView'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readAttitude } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { readBoardAlignment, saveBoardAlignment } from '@/lib/orientation/io'
import { alignmentOptions, type BoardAlignment } from '@/lib/orientation/model'

const PATH = '/orientation'

const AXES = [
  { key: 'yaw', label: 'Yaw', hint: 'rotated flat, clockwise seen from above' },
  { key: 'roll', label: 'Roll', hint: 'tilted sideways — 180° = mounted upside down' },
  { key: 'pitch', label: 'Pitch', hint: 'tilted forwards / backwards' },
] as const

/** Spec: docs/tabs/orientation.md */
export function OrientationPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readBoardAlignment)
  return (
    <>
      <PageHeader title="Orientation" description="How the flight controller is mounted in the frame." />
      {client && snapshot ? <Editor client={client} snapshot={snapshot} reload={reload} /> : <LoadingState error={error} />}
    </>
  )
}

const toDraft = (alignment: BoardAlignment) => alignment

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: BoardAlignment; reload: () => void }) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error, save } = useSave(reload)
  const attitude = useMspPoll(readAttitude, 50)
  useUnsavedChanges(PATH, dirty)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Board rotation</CardTitle>
            <CardDescription>
              Leave everything at 0° if the arrow on the flight controller points forward and the board is the right way
              up.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_auto_1fr] items-center gap-x-4 gap-y-4 text-sm">
            {AXES.map(({ key, label, hint }) => (
              <div key={key} className="contents">
                <label htmlFor={`align-${key}`} className="font-medium">
                  {label}
                </label>
                <NativeSelect
                  id={`align-${key}`}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                >
                  {alignmentOptions(snapshot[key]).map((degrees) => (
                    <NativeSelectOption key={degrees} value={degrees}>
                      {degrees}°
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <span className="text-muted-foreground">{hint}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              The board shows your selection. The frame follows the quad live — after saving, tilt the quad and check
              that the model moves the same way.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <BoardView alignment={draft} attitude={attitude} />
          </CardContent>
        </Card>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        reboot
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveBoardAlignment(client, draft)
            return true
          })
        }
      />
    </>
  )
}
