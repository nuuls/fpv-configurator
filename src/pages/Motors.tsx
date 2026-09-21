import { useEffect, useRef, useState } from 'react'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readMotorsSnapshot, saveMotors, setArmingDisabled, setMotorOutputs, stopMotors } from '@/lib/motors/io'
import {
  isDshot,
  MOTOR_PROTOCOL_NAMES,
  MOTOR_STOP,
  MOTOR_TEST_MAX,
  readMotors,
  SELECTABLE_PROTOCOLS,
  validateMotors,
  type MotorsSnapshot,
} from '@/lib/motors/model'
import type { MspClient } from '@/lib/msp/client'

const PATH = '/motors'

/** Betaflight Quad X numbering as seen from above, nose up: 4 front-left, 2 front-right, 3 rear-left, 1 rear-right. */
const QUAD_LAYOUT = [4, 2, 3, 1]

/** Spec: docs/tabs/motors.md */
export function MotorsPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readMotorsSnapshot)
  return (
    <>
      <PageHeader title="Motors" description="ESC settings and motor testing." />
      {client && snapshot ? <Editor client={client} snapshot={snapshot} reload={reload} /> : <LoadingState error={error} />}
    </>
  )
}

function Editor({ client, snapshot, reload }: { client: MspClient; snapshot: MotorsSnapshot; reload: () => void }) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readMotors)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  const current = readMotors(snapshot).protocol
  const protocols = SELECTABLE_PROTOCOLS.includes(current) ? SELECTABLE_PROTOCOLS : [...SELECTABLE_PROTOCOLS, current]
  const dshot = isDshot(draft.protocol)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ESC &amp; motors</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 text-sm">
            <label htmlFor="esc-protocol" className="font-medium">
              ESC protocol
            </label>
            <NativeSelect
              id="esc-protocol"
              value={draft.protocol}
              onChange={(e) => setDraft({ ...draft, protocol: Number(e.target.value) })}
            >
              {protocols.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {MOTOR_PROTOCOL_NAMES[p] ?? `Protocol ${p}`}
                  {SELECTABLE_PROTOCOLS.includes(p) ? '' : ' (not recommended)'}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="bidir-dshot" className="font-medium">
              Bidirectional DShot
            </label>
            <div className="flex items-center gap-3">
              <Switch
                id="bidir-dshot"
                checked={draft.bidirDshot && dshot}
                disabled={!dshot}
                onCheckedChange={(bidirDshot) => setDraft({ ...draft, bidirDshot })}
              />
              <span className="text-muted-foreground">RPM telemetry for RPM filtering. Needs ESC firmware that supports it.</span>
            </div>

            <label htmlFor="motor-poles" className="font-medium">
              Motor poles
            </label>
            <div className="flex items-center gap-3">
              <input
                id="motor-poles"
                type="number"
                min={4}
                max={40}
                step={2}
                value={draft.poles}
                onChange={(e) => setDraft({ ...draft, poles: Number(e.target.value) })}
                className="h-9 w-20 rounded-md border bg-transparent px-3 dark:bg-input/30"
              />
              <span className="text-muted-foreground">Magnets on the motor bell. 14 for most 5&quot;, 12 for most whoops.</span>
            </div>

            <label htmlFor="props-direction" className="font-medium">
              Prop direction
            </label>
            <NativeSelect
              id="props-direction"
              value={draft.propsOut ? 'out' : 'in'}
              onChange={(e) => setDraft({ ...draft, propsOut: e.target.value === 'out' })}
            >
              <NativeSelectOption value="out">Props out (default)</NativeSelectOption>
              <NativeSelectOption value="in">Props in</NativeSelectOption>
            </NativeSelect>
          </CardContent>
        </Card>

        <MotorTest client={client} motorCount={snapshot.motorCount} blocked={dirty || saving} />
      </div>

      {!(draft.bidirDshot && dshot) && (
        <Notice tone="warning">
          Bidirectional DShot is off, so the flight controller gets no motor RPM and can&apos;t use RPM filtering.{' '}
          {dshot ? 'Turn it on unless your ESC firmware doesn’t support it.' : 'It needs a DShot ESC protocol.'}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        problem={validateMotors(draft)[0]}
        reboot
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveMotors(client, snapshot, draft)
            return true
          })
        }
      />
    </>
  )
}

/**
 * Spins motors from the browser. Safety: locked until the user confirms props are off, arming from
 * the radio is blocked meanwhile, throttle is capped, and everything stops when the switch goes
 * off, the tab is left, or the page is closed.
 */
function MotorTest({ client, motorCount, blocked }: { client: MspClient; motorCount: number; blocked: boolean }) {
  const count = Math.min(Math.max(motorCount, 1), 8)
  const [enabled, setEnabled] = useState(false)
  const [values, setValues] = useState<number[]>(() => new Array<number>(count).fill(MOTOR_STOP))
  const [error, setError] = useState<string | null>(null)
  // Unsaved edits lock the test. Switch it off for good, so it never re-arms itself when unlocked.
  if (enabled && blocked) {
    setEnabled(false)
    setValues(new Array<number>(count).fill(MOTOR_STOP))
  }
  const active = enabled && !blocked

  // Sends the latest values; while a write is in flight newer values just replace the pending ones.
  const pending = useRef<number[] | null>(null)
  const sending = useRef(false)
  const send = (next: number[]) => {
    pending.current = next
    if (sending.current) return
    sending.current = true
    void (async () => {
      try {
        while (pending.current) {
          const batch = pending.current
          pending.current = null
          await setMotorOutputs(client, batch)
        }
      } catch {
        setError('Lost contact with the flight controller while testing — unplug the battery.')
        setEnabled(false)
      } finally {
        sending.current = false
      }
    })()
  }

  useEffect(() => {
    if (!active) return
    const stopNow = () => void stopMotors(client).catch(() => {})
    void setArmingDisabled(client, true).catch(() => {})
    window.addEventListener('pagehide', stopNow)
    return () => {
      window.removeEventListener('pagehide', stopNow)
      pending.current = null
      stopNow()
      void setArmingDisabled(client, false).catch(() => {})
    }
  }, [active, client])

  const apply = (next: number[]) => {
    setValues(next)
    if (active) send(next)
  }

  const toggle = (on: boolean) => {
    setError(null)
    setValues(new Array<number>(count).fill(MOTOR_STOP))
    setEnabled(on)
  }

  const order = count === 4 ? QUAD_LAYOUT : Array.from({ length: count }, (_, i) => i + 1)
  const master = Math.max(...values)

  return (
    <Card className={active ? 'border-destructive' : undefined}>
      <CardHeader>
        <CardTitle>Motor test</CardTitle>
        <CardDescription>Check that each motor spins, and in the right direction. Needs a battery plugged in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <Switch id="motor-test-enable" checked={active} disabled={blocked} onCheckedChange={toggle} />
          <label htmlFor="motor-test-enable" className="font-medium">
            I have removed all propellers — enable motor control
          </label>
        </div>
        {blocked && <p className="text-muted-foreground">Save or revert your changes before testing motors.</p>}

        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {order.map((motor) => (
            <div key={motor}>
              <div className="mb-2 flex justify-between">
                <span className="font-medium">Motor {motor}</span>
                <span className="font-mono tabular-nums">{values[motor - 1] ?? MOTOR_STOP}</span>
              </div>
              <Slider
                aria-label={`Motor ${motor}`}
                min={MOTOR_STOP}
                max={MOTOR_TEST_MAX}
                step={5}
                disabled={!active}
                value={[values[motor - 1] ?? MOTOR_STOP]}
                onValueChange={([v]) => v !== undefined && apply(values.map((old, i) => (i === motor - 1 ? v : old)))}
              />
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex justify-between">
            <span className="font-medium">All motors</span>
            <span className="font-mono tabular-nums">{master}</span>
          </div>
          <Slider
            aria-label="All motors"
            min={MOTOR_STOP}
            max={MOTOR_TEST_MAX}
            step={5}
            disabled={!active}
            value={[master]}
            onValueChange={([v]) => v !== undefined && apply(values.map(() => v))}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </CardContent>
    </Card>
  )
}
