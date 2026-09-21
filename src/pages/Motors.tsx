import { useEffect, useRef, useState } from 'react'
import { CircleCheck, OctagonAlert, RotateCcw, RotateCw, TriangleAlert } from 'lucide-react'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import {
  readMotorsSnapshot,
  readMotorTelemetry,
  saveMotors,
  setArmingDisabled,
  setMotorOutputs,
  stopMotors,
} from '@/lib/motors/io'
import {
  DYN_IDLE_MAX,
  DYN_IDLE_MIN,
  DYN_IDLE_ZONES,
  dynIdleSegments,
  dynIdleZone,
  isDshot,
  MOTOR_PROTOCOL_NAMES,
  MOTOR_STOP,
  MOTOR_TEST_MAX,
  readMotors,
  SELECTABLE_PROTOCOLS,
  spinsClockwise,
  validateMotors,
  type DroneType,
  type IdleZone,
  type MotorsSnapshot,
} from '@/lib/motors/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'

const PATH = '/motors'

/** Betaflight Quad X as seen from above, nose up: 4 front-left, 2 front-right, 3 rear-left, 1 rear-right. */
const QUAD_POSITIONS: { motor: number; className: string }[] = [
  { motor: 4, className: 'left-0 top-0' },
  { motor: 2, className: 'right-0 top-0' },
  { motor: 3, className: 'left-0 bottom-0' },
  { motor: 1, className: 'right-0 bottom-0' },
]

/** Until drone types exist (SPEC §2), every quad is treated as a 5". */
const DRONE_TYPE: DroneType = 'five-inch'

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

            <span id="dyn-idle-label" className="self-start pt-1 font-medium">
              Dynamic idle
            </span>
            <DynamicIdle
              value={draft.dynIdle}
              enabled={draft.bidirDshot && dshot}
              onChange={(dynIdle) => setDraft({ ...draft, dynIdle })}
            />
          </CardContent>
        </Card>

        <MotorTest client={client} snapshot={snapshot} blocked={dirty || saving} />
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
        problem={validateMotors(draft, snapshot)[0]}
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
function MotorTest({ client, snapshot, blocked }: { client: MspClient; snapshot: MotorsSnapshot; blocked: boolean }) {
  const count = Math.min(Math.max(snapshot.motorCount, 1), 8)
  const telemetry = useMspPoll(readMotorTelemetry, 100)
  const hasRpm = snapshot.bidirDshot
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

  const master = Math.max(...values)
  const motorSlider = (motor: number, vertical: boolean) => (
    <Slider
      aria-label={`Motor ${motor}`}
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={vertical ? 'data-[orientation=vertical]:h-20 data-[orientation=vertical]:min-h-0' : undefined}
      min={MOTOR_STOP}
      max={MOTOR_TEST_MAX}
      step={5}
      disabled={!active}
      value={[values[motor - 1] ?? MOTOR_STOP]}
      onValueChange={([v]) => v !== undefined && apply(values.map((old, i) => (i === motor - 1 ? v : old)))}
    />
  )
  const rpmText = (motor: number) => (hasRpm ? `${telemetry?.[motor - 1]?.rpm ?? 0} rpm` : '— rpm')

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

        {count === 4 ? (
          <div className="relative mx-auto aspect-square w-full max-w-sm">
            {/* frame seen from above, nose up */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full text-muted-foreground" aria-hidden="true">
              <path d="M22 22 78 78M78 22 22 78" stroke="currentColor" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
              <rect x={40} y={38} width={20} height={24} rx={3} fill="var(--card)" stroke="currentColor" strokeWidth={1.5} />
              <path d="m50 41 4 6h-8z" fill="var(--primary)" />
              <text x={50} y={33} textAnchor="middle" fontSize={3.2} letterSpacing={0.4} fill="currentColor">
                FRONT
              </text>
            </svg>

            {QUAD_POSITIONS.map(({ motor, className }) => {
              const spinning = (values[motor - 1] ?? MOTOR_STOP) > MOTOR_STOP && active
              const clockwise = spinsClockwise(motor, snapshot.propsOut)
              const Spin = clockwise ? RotateCw : RotateCcw
              return (
                <div
                  key={motor}
                  className={cn(
                    'absolute flex aspect-square w-[44%] flex-col items-center justify-center gap-1 rounded-full border-2 bg-card',
                    className,
                    spinning ? 'border-destructive' : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    Motor {motor}
                    <span
                      className="flex items-center gap-0.5 text-muted-foreground"
                      title={`Should spin ${clockwise ? 'clockwise' : 'counter-clockwise'} seen from above`}
                    >
                      <Spin className={cn('size-3.5', spinning && 'animate-spin', spinning && !clockwise && '[animation-direction:reverse]')} />
                      {clockwise ? 'CW' : 'CCW'}
                    </span>
                  </div>
                  {motorSlider(motor, true)}
                  <div className="font-mono text-xs tabular-nums">{values[motor - 1] ?? MOTOR_STOP}</div>
                  <div className="font-mono text-xs text-muted-foreground tabular-nums">{rpmText(motor)}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {Array.from({ length: count }, (_, i) => i + 1).map((motor) => (
              <div key={motor}>
                <div className="mb-2 flex justify-between">
                  <span className="font-medium">Motor {motor}</span>
                  <span className="font-mono tabular-nums">
                    {values[motor - 1] ?? MOTOR_STOP} · {rpmText(motor)}
                  </span>
                </div>
                {motorSlider(motor, false)}
              </div>
            ))}
          </div>
        )}
        {!hasRpm && <p className="text-muted-foreground">RPM readout needs bidirectional DShot.</p>}

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

const ZONE_STYLE: Record<IdleZone, { bar: string; text: string; icon: typeof CircleCheck }> = {
  good: { bar: 'bg-success', text: 'text-success', icon: CircleCheck },
  warning: { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlert },
  danger: { bar: 'bg-destructive', text: 'text-destructive', icon: OctagonAlert },
}

/** `dyn_idle_min_rpm` slider with the recommended zones for the drone type painted under the track. */
function DynamicIdle({ value, enabled, onChange }: { value: number; enabled: boolean; onChange: (value: number) => void }) {
  const inRange = value >= DYN_IDLE_MIN && value <= DYN_IDLE_MAX
  const zones = DYN_IDLE_ZONES[DRONE_TYPE]
  const span = DYN_IDLE_MAX - DYN_IDLE_MIN
  const percent = (v: number) => ((Math.min(DYN_IDLE_MAX, Math.max(DYN_IDLE_MIN, v)) - DYN_IDLE_MIN) / span) * 100

  let status: { zone: IdleZone; text: string }
  if (!inRange) status = { zone: 'warning', text: value === 0 ? 'Off — drag the slider to turn dynamic idle on' : `Set to ${value}, outside this slider` }
  else {
    const zone = dynIdleZone(value, DRONE_TYPE)
    const low = value < zones.goodMin
    status = {
      zone,
      text:
        zone === 'good'
          ? `Good for a ${zones.label}`
          : zone === 'warning'
            ? `${low ? 'A bit low' : 'A bit high'} for a ${zones.label} (${zones.goodMin}–${zones.goodMax} recommended)`
            : low
              ? 'Too low: motors can stall in hard moves'
              : 'Too high: the quad floats and motors run hot',
    }
  }
  const { text, icon: Icon } = ZONE_STYLE[status.zone]

  return (
    <div role="group" aria-labelledby="dyn-idle-label" className="flex flex-col gap-2">
      <div className="font-mono tabular-nums">{inRange ? `${value} (${value * 100} rpm)` : 'off'}</div>
      <Slider
        aria-labelledby="dyn-idle-label"
        min={DYN_IDLE_MIN}
        max={DYN_IDLE_MAX}
        step={1}
        disabled={!enabled}
        value={[inRange ? value : DYN_IDLE_MIN]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
      {/* zone band: each value owns the stretch around its tick */}
      <div className="relative mx-2 h-1.5" aria-hidden="true">
        {dynIdleSegments(DRONE_TYPE).map(({ from, to, zone }) => (
          <div
            key={from}
            className={cn('absolute h-full rounded-full', ZONE_STYLE[zone].bar)}
            style={{ left: `${percent(from - 0.5)}%`, right: `${100 - percent(to + 0.5)}%` }}
          />
        ))}
      </div>
      <p className={cn('flex items-center gap-1.5', text)}>
        <Icon className="size-4 shrink-0" />
        <span className="text-foreground">{status.text}</span>
      </p>
      <p className="text-muted-foreground">
        {enabled
          ? 'Lowest RPM the motors are allowed to drop to in flight.'
          : 'Needs bidirectional DShot: the flight controller has to know the motor RPM.'}
      </p>
    </div>
  )
}
