import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, CircleCheck, OctagonAlert, RotateCw, TriangleAlert } from 'lucide-react'
import { Notice, LoadingState } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
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
  setMotorDirection,
  setMotorOutputs,
  stopMotors,
} from '@/lib/motors/io'
import {
  DIRECTION_CHECK,
  directionCheckValue,
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
  remappedMotors,
  SELECTABLE_PROTOCOLS,
  spinsClockwise,
  swapMotorOutputs,
  validateMotors,
  type DroneType,
  type IdleZone,
  type MotorsSnapshot,
} from '@/lib/motors/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'

const PATH = '/motors'

/**
 * Betaflight Quad X as seen from above, nose up: 4 front-left, 2 front-right, 3 rear-left, 1 rear-right.
 * The number badge sits on the disc's outer corner, the direction icon beside it and the swap icon below/above it.
 */
const QUAD_POSITIONS: {
  motor: number
  className: string
  badge: string
  direction: string
  swap: string
}[] = [
  {
    motor: 4,
    className: 'left-0 top-0',
    badge: 'left-[8%] top-[8%]',
    direction: 'right-[8%] top-[8%]',
    swap: 'left-[8%] bottom-[8%]',
  },
  {
    motor: 2,
    className: 'right-0 top-0',
    badge: 'right-[8%] top-[8%]',
    direction: 'left-[8%] top-[8%]',
    swap: 'right-[8%] bottom-[8%]',
  },
  {
    motor: 3,
    className: 'left-0 bottom-0',
    badge: 'left-[8%] bottom-[8%]',
    direction: 'right-[8%] bottom-[8%]',
    swap: 'left-[8%] top-[8%]',
  },
  {
    motor: 1,
    className: 'right-0 bottom-0',
    badge: 'right-[8%] bottom-[8%]',
    direction: 'left-[8%] bottom-[8%]',
    swap: 'right-[8%] top-[8%]',
  },
]

/** Until drone types exist (SPEC §2), every quad is treated as a 5". */
const DRONE_TYPE: DroneType = 'five-inch'

/** Spec: docs/tabs/motors.md */
export function MotorsPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readMotorsSnapshot)
  return (
    <>
      <PageHeader title="Motors" description="ESC settings and motor testing." />
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
  snapshot: MotorsSnapshot
  reload: () => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, readMotors)
  const { saving, error, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  const current = readMotors(snapshot).protocol
  const protocols = SELECTABLE_PROTOCOLS.includes(current)
    ? SELECTABLE_PROTOCOLS
    : [...SELECTABLE_PROTOCOLS, current]
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
              <span className="text-muted-foreground">
                RPM telemetry for RPM filtering. Needs ESC firmware that supports it.
              </span>
            </div>

            <label htmlFor="motor-poles" className="font-medium">
              Motor poles
            </label>
            <div className="flex items-center gap-3">
              <NumberInput
                id="motor-poles"
                min={4}
                max={40}
                step={2}
                value={draft.poles}
                onValueChange={(poles) => setDraft({ ...draft, poles })}
                className="dark:bg-input/30 h-9 w-20 rounded-md border bg-transparent px-3"
              />
              <span className="text-muted-foreground">
                Magnets on the motor bell. 14 for most 5&quot;, 12 for most whoops.
              </span>
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

        <MotorTest
          client={client}
          snapshot={snapshot}
          blocked={dirty || saving}
          dshot={isDshot(current)}
          outputOrder={draft.outputOrder}
          swapDisabled={saving}
          onSwap={(a, b) =>
            setDraft({ ...draft, outputOrder: swapMotorOutputs(draft.outputOrder, a, b) })
          }
        />
      </div>

      {!(draft.bidirDshot && dshot) && (
        <Notice tone="warning">
          Bidirectional DShot is off, so the flight controller gets no motor RPM and can&apos;t use
          RPM filtering.{' '}
          {dshot
            ? 'Turn it on unless your ESC firmware doesn’t support it.'
            : 'It needs a DShot ESC protocol.'}
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
 *
 * Each motor also carries two small icons: flip its spin direction (a DShot command the ESC stores,
 * no reboot; the motor is spun afterwards to show the result) and swap its output with another
 * motor's (click the icon, then the other motor — an edit of `motor_output_reordering`, Save & Reboot).
 */
function MotorTest({
  client,
  snapshot,
  blocked,
  dshot,
  outputOrder,
  swapDisabled,
  onSwap,
}: {
  client: MspClient
  snapshot: MotorsSnapshot
  blocked: boolean
  /** The FC runs a DShot protocol, so its ESCs take direction commands. */
  dshot: boolean
  /** The draft's `motor_output_reordering`. */
  outputOrder: number[]
  swapDisabled: boolean
  onSwap: (motor: number, other: number) => void
}) {
  const count = Math.min(Math.max(snapshot.motorCount, 1), 8)
  const telemetry = useMspPoll(readMotorTelemetry, 100)
  const hasRpm = snapshot.bidirDshot
  const [enabled, setEnabled] = useState(false)
  const [values, setValues] = useState<number[]>(() => new Array<number>(count).fill(MOTOR_STOP))
  const [error, setError] = useState<string | null>(null)
  // Direction flips: the ESC never tells which way it is set, so this only knows what was sent here.
  const [reversed, setReversed] = useState<boolean[]>(() => new Array<boolean>(count).fill(false))
  const [flipping, setFlipping] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Swapping: the motor whose icon was clicked, waiting for the other one.
  const [pickFrom, setPickFrom] = useState<number | null>(null)
  // Unsaved edits lock the test. Switch it off for good, so it never re-arms itself when unlocked.
  if (enabled && blocked) {
    setEnabled(false)
    setValues(new Array<number>(count).fill(MOTOR_STOP))
    setNote(null)
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

  // Bumped whenever the test ends, so a flip in progress stops touching the motors.
  const session = useRef(0)
  useEffect(() => {
    if (!active) return
    const stopNow = () => void stopMotors(client).catch(() => {})
    void setArmingDisabled(client, true).catch(() => {})
    window.addEventListener('pagehide', stopNow)
    return () => {
      window.removeEventListener('pagehide', stopNow)
      pending.current = null
      session.current++
      stopNow()
      void setArmingDisabled(client, false).catch(() => {})
    }
  }, [active, client])

  useEffect(() => {
    if (pickFrom === null) return
    const cancel = (event: KeyboardEvent) => event.key === 'Escape' && setPickFrom(null)
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [pickFrom])

  const apply = (next: number[]) => {
    setValues(next)
    if (active) send(next)
  }

  const toggle = (on: boolean) => {
    setError(null)
    setNote(null)
    setFlipping(null)
    setValues(new Array<number>(count).fill(MOTOR_STOP))
    setEnabled(on)
  }

  /**
   * Like the Betaflight Configurator's direction wizard: stop, give the ESC time to notice (it drops
   * commands while the motor turns), send the command, then spin the motor so the new direction shows.
   */
  const flip = async (motor: number) => {
    const token = session.current
    const alive = () => token === session.current
    const toReversed = !(reversed[motor - 1] ?? false)
    const stopped = new Array<number>(count).fill(MOTOR_STOP)
    setError(null)
    setNote(null)
    setFlipping(motor)
    pending.current = null
    setValues(stopped)
    try {
      await setMotorOutputs(client, stopped)
      await sleep(DIRECTION_CHECK.stopMs)
      if (!alive()) return
      await setMotorDirection(client, motor, toReversed)
      setReversed(reversed.map((r, i) => (i === motor - 1 ? toReversed : r)))
      setNote(
        `Motor ${motor} set to ${toReversed ? 'reversed' : 'normal'} — spinning it to check. Still the wrong way? Click again.`,
      )
      await sleep(DIRECTION_CHECK.settleMs)
      if (!alive()) return
      const checkValue = directionCheckValue(snapshot)
      const spinning = stopped.map((v, i) => (i === motor - 1 ? checkValue : v))
      setValues(spinning)
      await setMotorOutputs(client, spinning)
      await sleep(DIRECTION_CHECK.spinMs)
      if (!alive()) return
      setValues(stopped)
      await setMotorOutputs(client, stopped)
    } catch {
      if (!alive()) return
      setError('Lost contact with the flight controller while testing — unplug the battery.')
      setEnabled(false)
    } finally {
      if (alive()) setFlipping(null)
    }
  }

  const pick = (motor: number) => {
    if (pickFrom === null || pickFrom === motor) {
      setPickFrom(pickFrom === motor ? null : motor)
      return
    }
    onSwap(pickFrom, motor)
    setPickFrom(null)
  }

  const tools = (motor: number, placement?: { direction: string; swap: string }) => (
    <>
      <Button
        variant="secondary"
        size="icon"
        aria-label={`Flip direction of motor ${motor}`}
        title="Flip the spin direction (the ESC stores it)"
        disabled={!active || !dshot || flipping !== null || pickFrom !== null}
        onClick={() => void flip(motor)}
        className={cn(MOTOR_ICON_BUTTON, placement && cn('absolute', placement.direction))}
      >
        <RotateCw className={flipping === motor ? 'animate-spin' : undefined} />
      </Button>
      <Button
        variant={pickFrom === motor ? 'default' : 'secondary'}
        size="icon"
        aria-label={pickFrom === motor ? `Cancel swapping motor ${motor}` : `Swap motor ${motor}`}
        aria-pressed={pickFrom === motor}
        title="Swap outputs with another motor: click, then the other motor"
        disabled={swapDisabled || flipping !== null || (pickFrom !== null && pickFrom !== motor)}
        onClick={() => pick(motor)}
        className={cn(MOTOR_ICON_BUTTON, placement && cn('absolute', placement.swap))}
      >
        <ArrowLeftRight />
      </Button>
    </>
  )
  /** In pick mode the other motors become targets. */
  const target = (motor: number, className: string) =>
    pickFrom !== null &&
    pickFrom !== motor && (
      <button
        type="button"
        aria-label={`Swap with motor ${motor}`}
        onClick={() => pick(motor)}
        className={cn(
          'ring-primary bg-primary/15 hover:bg-primary/25 focus-visible:ring-ring z-10 cursor-pointer ring-2 outline-none',
          className,
        )}
      />
    )
  const remapped = remappedMotors(outputOrder, count)
  const remapUnsaved = outputOrder.some((output, i) => output !== snapshot.outputOrder[i])

  const master = Math.max(...values)
  const motorSlider = (motor: number, vertical: boolean) => (
    <Slider
      aria-label={`Motor ${motor}`}
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={
        vertical
          ? 'data-[orientation=vertical]:h-20 data-[orientation=vertical]:min-h-0'
          : undefined
      }
      min={MOTOR_STOP}
      max={MOTOR_TEST_MAX}
      step={5}
      disabled={!active || flipping !== null}
      value={[values[motor - 1] ?? MOTOR_STOP]}
      onValueChange={([v]) =>
        v !== undefined && apply(values.map((old, i) => (i === motor - 1 ? v : old)))
      }
    />
  )
  const rpmText = (motor: number) => (hasRpm ? `${telemetry?.[motor - 1]?.rpm ?? 0} rpm` : '— rpm')

  return (
    <Card className={active ? 'border-destructive' : undefined}>
      <CardHeader>
        <CardTitle>Motor test</CardTitle>
        <CardDescription>
          Check that each motor spins, and in the right direction. Needs a battery plugged in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="border-destructive/40 bg-destructive/10 flex items-center gap-3 rounded-md border p-3">
          <Switch
            id="motor-test-enable"
            checked={active}
            disabled={blocked}
            onCheckedChange={toggle}
          />
          <label htmlFor="motor-test-enable" className="font-medium">
            I have removed all propellers — enable motor control
          </label>
        </div>
        {blocked && (
          <p className="text-muted-foreground">
            Save or revert your changes before testing motors.
          </p>
        )}

        {count === 4 ? (
          <div className="relative mx-auto aspect-square w-full max-w-sm">
            {/* frame seen from above; the arrow on the body points to the front */}
            <svg
              viewBox="0 0 100 100"
              className="text-muted-foreground absolute inset-0 size-full"
              aria-hidden="true"
            >
              <path
                d="M20 20 80 80M80 20 20 80"
                stroke="currentColor"
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.45}
              />
              <rect
                x={41}
                y={37}
                width={18}
                height={26}
                rx={3}
                fill="var(--card)"
                stroke="currentColor"
                strokeWidth={1.5}
              />
              <path d="m50 40 5 8h-3v9h-4v-9h-3z" fill="var(--primary)" />
            </svg>

            {QUAD_POSITIONS.map(({ motor, className, badge, direction, swap }) => {
              const output = values[motor - 1] ?? MOTOR_STOP
              const spinning = output > MOTOR_STOP && active
              const clockwise = spinsClockwise(motor, snapshot.propsOut)
              return (
                <div
                  key={motor}
                  title={`Motor ${motor} · output ${output}`}
                  className={cn(
                    'absolute flex aspect-square w-[40%] flex-col items-center justify-center gap-1.5',
                    className,
                  )}
                >
                  <SpinRing motor={motor} clockwise={clockwise} spinning={spinning} />
                  <span
                    className={cn(
                      'absolute flex size-5 items-center justify-center rounded-full text-xs font-semibold',
                      badge,
                      spinning ? 'bg-destructive text-white' : 'bg-muted text-foreground',
                    )}
                  >
                    {motor}
                  </span>
                  {tools(motor, { direction, swap })}
                  {target(motor, 'absolute inset-[4%] rounded-full')}
                  {motorSlider(motor, true)}
                  <div className="relative font-mono text-xs tabular-nums">
                    {hasRpm ? `${telemetry?.[motor - 1]?.rpm ?? 0} rpm` : output}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {Array.from({ length: count }, (_, i) => i + 1).map((motor) => (
              <div key={motor} className="relative">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium">Motor {motor}</span>
                  {tools(motor)}
                  <span className="ml-auto font-mono tabular-nums">
                    {values[motor - 1] ?? MOTOR_STOP} · {rpmText(motor)}
                  </span>
                </div>
                {motorSlider(motor, false)}
                {target(motor, 'absolute -inset-2 rounded-md')}
              </div>
            ))}
          </div>
        )}
        {!hasRpm && <p className="text-muted-foreground">RPM readout needs bidirectional DShot.</p>}
        {!dshot && (
          <p className="text-muted-foreground">
            Changing a motor&apos;s direction needs a DShot ESC protocol.
          </p>
        )}
        {pickFrom !== null && (
          <p className="text-muted-foreground">
            Click the motor to swap with motor {pickFrom}. Esc cancels.
          </p>
        )}
        {remapped.length > 0 && (
          <p className="text-muted-foreground">
            {remapped
              .map(({ motor, output }) => `Motor ${motor} drives ESC output ${output}`)
              .join(' · ')}
            {remapUnsaved && ' — Save & Reboot to apply.'}
          </p>
        )}
        {note && <p className="text-muted-foreground">{note}</p>}

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
            disabled={!active || flipping !== null}
            value={[master]}
            onValueChange={([v]) => v !== undefined && apply(values.map(() => v))}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </CardContent>
    </Card>
  )
}

const MOTOR_ICON_BUTTON = 'size-6 rounded-full [&_svg]:size-3.5'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const ZONE_STYLE: Record<IdleZone, { bar: string; text: string; icon: typeof CircleCheck }> = {
  good: { bar: 'bg-success', text: 'text-success', icon: CircleCheck },
  warning: { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlert },
  danger: { bar: 'bg-destructive', text: 'text-destructive', icon: OctagonAlert },
}

/** `dyn_idle_min_rpm` slider with the recommended zones for the drone type painted under the track. */
function DynamicIdle({
  value,
  enabled,
  onChange,
}: {
  value: number
  enabled: boolean
  onChange: (value: number) => void
}) {
  const inRange = value >= DYN_IDLE_MIN && value <= DYN_IDLE_MAX
  const zones = DYN_IDLE_ZONES[DRONE_TYPE]
  const span = DYN_IDLE_MAX - DYN_IDLE_MIN
  const percent = (v: number) =>
    ((Math.min(DYN_IDLE_MAX, Math.max(DYN_IDLE_MIN, v)) - DYN_IDLE_MIN) / span) * 100

  let status: { zone: IdleZone; text: string }
  if (!inRange)
    status = {
      zone: 'warning',
      text:
        value === 0
          ? 'Off — drag the slider to turn dynamic idle on'
          : `Set to ${value}, outside this slider`,
    }
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
      <div className="font-mono tabular-nums">
        {inRange ? `${value} (${value * 100} rpm)` : 'off'}
      </div>
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

/** Two arrows at `degrees` apart on a circle of radius R around (50, 50), pointing clockwise. */
const RING_RADIUS = 46
const RING_ARCS = [-150, 30].map((startDegrees) => {
  const point = (degrees: number, radius = RING_RADIUS) => {
    const a = (degrees * Math.PI) / 180
    return [50 + radius * Math.cos(a), 50 + radius * Math.sin(a)] as const
  }
  const endDegrees = startDegrees + 95
  const [sx, sy] = point(startDegrees)
  const [ex, ey] = point(endDegrees)
  // arrowhead: tip a little further along the circle, base straddling the rim
  const [tx, ty] = point(endDegrees + 9)
  const [ax, ay] = point(endDegrees, RING_RADIUS - 4.5)
  const [bx, by] = point(endDegrees, RING_RADIUS + 4.5)
  return {
    arc: `M${sx} ${sy}A${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${ex} ${ey}`,
    head: `${tx},${ty} ${ax},${ay} ${bx},${by}`,
  }
})

/**
 * The prop disc. Its rim carries the arrows for the direction the motor should spin (seen from above)
 * and turns that way while the motor is driven — no labels needed.
 */
function SpinRing({
  motor,
  clockwise,
  spinning,
}: {
  motor: number
  clockwise: boolean
  spinning: boolean
}) {
  return (
    <svg
      role="img"
      aria-label={`Motor ${motor} spins ${clockwise ? 'clockwise' : 'counter-clockwise'}`}
      viewBox="0 0 100 100"
      className={cn(
        'absolute inset-0 size-full',
        spinning ? 'text-destructive' : 'text-muted-foreground',
        spinning && 'animate-spin [animation-duration:1.2s]',
        spinning && !clockwise && '[animation-direction:reverse]',
      )}
    >
      <circle
        cx={50}
        cy={50}
        r={RING_RADIUS}
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth={2}
      />
      {/* drawn clockwise; mirrored for counter-clockwise motors */}
      <g transform={clockwise ? undefined : 'translate(100 0) scale(-1 1)'}>
        {RING_ARCS.map(({ arc, head }) => (
          <g key={arc}>
            <path d={arc} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
            <polygon points={head} fill="currentColor" />
          </g>
        ))}
      </g>
    </svg>
  )
}
