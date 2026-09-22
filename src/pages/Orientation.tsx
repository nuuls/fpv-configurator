import { useState } from 'react'
import { BoardView } from '@/components/BoardView'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDraft } from '@/hooks/useDraft'
import { describeError, useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readAttitude, readStatus } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import {
  calibrateAccelerometer,
  readBoardAlignment,
  saveBoardAlignment,
} from '@/lib/orientation/io'
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
      <PageHeader
        title="Orientation"
        description="How the flight controller is mounted in the frame."
      />
      {client && snapshot ? (
        <Editor client={client} snapshot={snapshot} reload={reload} />
      ) : (
        <LoadingState error={error} />
      )}
    </>
  )
}

const toDraft = (alignment: BoardAlignment) => alignment

function Editor({
  client,
  snapshot,
  reload,
}: {
  client: MspClient
  snapshot: BoardAlignment
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error, save } = useSave(reload)
  const attitude = useMspPoll(readAttitude, 40)
  useUnsavedChanges(PATH, dirty)

  // Without a compass the FC's heading starts at an arbitrary value: show yaw relative to where the quad
  // pointed when the tab was opened (or when "Reset heading" was pressed), nose away from the viewer.
  const [headingZero, setHeadingZero] = useState<number | null>(null)
  if (headingZero === null && attitude) setHeadingZero(attitude.yaw)
  const relative = attitude && { ...attitude, yaw: attitude.yaw - (headingZero ?? attitude.yaw) }

  const status = useMspPoll(readStatus, 1000)
  const hasAccelerometer = status === null || (status.sensors & 1) !== 0
  const [calibration, setCalibration] = useState<'idle' | 'running' | 'done'>('idle')
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const calibrate = async () => {
    setCalibration('running')
    setCalibrationError(null)
    try {
      await calibrateAccelerometer(client)
      setCalibration('done')
    } catch (cause) {
      setCalibrationError(`Calibration failed: ${describeError(cause)}`)
      setCalibration('idle')
    }
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Board rotation</CardTitle>
            <CardDescription>
              Leave everything at 0° if the arrow on the flight controller points forward and the
              board is the right way up.
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
              The arrow and the orange props are the front of the quad. The board shows your
              selection — the small grey mark is where the arrow printed on it points. The quad
              follows your real one live — after saving, tilt and turn it and check that the model
              moves the same way.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <BoardView alignment={draft} attitude={relative} />
            <div className="flex w-full items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground font-mono tabular-nums">
                {attitude
                  ? `roll ${attitude.roll.toFixed(0)}°  pitch ${attitude.pitch.toFixed(0)}°  heading ${attitude.yaw.toFixed(0)}°`
                  : 'waiting for attitude…'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!attitude}
                onClick={() => setHeadingZero(attitude?.yaw ?? null)}
              >
                Reset heading
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Accelerometer</CardTitle>
          <CardDescription>
            Needed for a level horizon and Angle mode. Put the quad on a level surface, don&apos;t
            touch it, then calibrate. Do this after the board rotation is saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 text-sm">
          <Button
            variant="outline"
            disabled={dirty || saving || calibration === 'running' || !hasAccelerometer}
            onClick={() => void calibrate()}
          >
            {calibration === 'running' ? 'Calibrating…' : 'Calibrate accelerometer'}
          </Button>
          <span className="text-muted-foreground" aria-live="polite">
            {!hasAccelerometer
              ? 'No accelerometer detected.'
              : dirty
                ? 'Save the board rotation first.'
                : calibration === 'running'
                  ? 'Keep the quad still…'
                  : calibration === 'done'
                    ? 'Calibration finished and saved.'
                    : ''}
          </span>
        </CardContent>
      </Card>

      {calibrationError && <Notice tone="error">{calibrationError}</Notice>}
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
