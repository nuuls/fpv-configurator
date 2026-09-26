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
  DRONE_TYPE_INFO,
  DRONE_TYPES,
  SWAP_RESTART_MS,
  DYN_IDLE_SCALES,
  isDshot,
  MOTOR_PROTOCOL_NAMES,
  MOTOR_STOP,
  MOTOR_TEST_MAX,
  fcMotorIndexes,
  idleSegments,
  idleZone,
  formatMotorIdle,
  MOTOR_IDLE_MAX,
  MOTOR_IDLE_MIN,
  MOTOR_IDLE_STEP,
  MOTOR_IDLE_ZONES,
  motorSettingsChanged,
  readMotors,
  remappedMotors,
  SELECTABLE_PROTOCOLS,
  spinsClockwise,
  swapMotorOutputs,
  toFcOutputs,
  validateMotors,
  type DroneType,
  type IdleZone,
  type IdleZones,
  type MotorsSnapshot,
} from '@/lib/motors/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'
import { useDroneTypeStore } from '@/stores/droneType'

const PATH = '/motors'

/**
 * Betaflight Quad X as seen from above, nose up: 4 front-left, 2 front-right, 3 rear-left, 1 rear-right.
 * The number badge sits on the disc's outer corner; the two action buttons are a row inside the disc.
 */
const QUAD_POSITIONS: { motor: number; className: string; badge: string }[] = [
  { motor: 4, className: 'left-0 top-0', badge: 'left-[7%] top-[7%]' },
  { motor: 2, className: 'right-0 top-0', badge: 'right-[7%] top-[7%]' },
  { motor: 3, className: 'left-0 bottom-0', badge: 'left-[7%] bottom-[7%]' },
  { motor: 1, className: 'right-0 bottom-0', badge: 'right-[7%] bottom-[7%]' },
]

/** Spec: docs/tabs/motors.md */
export function MotorsPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readMotorsSnapshot)
  return (
    <>
      <PageHeader title="Motors" description="ESC settings and motor testing." />
      <DroneTypePicker />
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
  const droneType = useDroneTypeStore((s) => s.droneType)

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
              droneType={droneType}
              value={draft.dynIdle}
              enabled={draft.bidirDshot && dshot}
              onChange={(dynIdle) => setDraft({ ...draft, dynIdle })}
            />

            <span id="motor-idle-label" className="self-start pt-1 font-medium">
              Motor idle
            </span>
            <MotorIdle
              droneType={droneType}
              value={draft.motorIdle}
              dynamicIdleOn={draft.bidirDshot && dshot && draft.dynIdle > 0}
              onChange={(motorIdle) => setDraft({ ...draft, motorIdle })}
            />
          </CardContent>
        </Card>

        <MotorTest
          client={client}
          snapshot={snapshot}
          blocked={motorSettingsChanged(draft, snapshot) || saving}
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
  // A swap while motors turn restarts them (the cue that it happened); sliders and icons wait meanwhile.
  const [restarting, setRestarting] = useState(false)
  const paused = flipping !== null || restarting
  const [note, setNote] = useState<string | null>(null)
  // Swapping: the motor whose icon was clicked, waiting for the other one.
  const [pickFrom, setPickFrom] = useState<number | null>(null)
  // Where each shown motor lives on the FC while the pending order isn't saved yet.
  const indexes = fcMotorIndexes(snapshot.outputOrder, outputOrder, count)
  // Unsaved settings lock the test. Switch it off for good, so it never re-arms itself when unlocked.
  if (enabled && blocked) {
    setEnabled(false)
    setValues(new Array<number>(count).fill(MOTOR_STOP))
    setNote(null)
  }
  const active = enabled && !blocked

  // Sends the latest values; while a write is in flight newer values just replace the pending ones.
  // Translated to FC slots right here, so a swap during an in-flight write can't route them with a stale order.
  const pending = useRef<number[] | null>(null)
  const sending = useRef(false)
  const send = (next: number[]) => {
    pending.current = toFcOutputs(next, indexes)
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
   * Meant to be clicked while the motor turns under a finger: the ESC only takes the command once the
   * motor is stopped, so all motors pause for a moment, the command goes out, and the sliders' values
   * are sent again — the motor comes back turning the other way. The sliders themselves don't move.
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
    try {
      await setMotorOutputs(client, stopped)
      await sleep(DIRECTION_CHECK.stopMs)
      if (!alive()) return
      await setMotorDirection(client, (indexes[motor - 1] ?? motor - 1) + 1, toReversed)
      setReversed(reversed.map((r, i) => (i === motor - 1 ? toReversed : r)))
      setNote(
        `Motor ${motor} set to ${toReversed ? 'reversed' : 'normal'}. Still the wrong way? Click again.`,
      )
      await sleep(DIRECTION_CHECK.settleMs)
      if (!alive()) return
      await setMotorOutputs(client, toFcOutputs(values, indexes))
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
    // The two motors trade labels, not outputs: their slider values and what was sent to their ESCs go
    // along, so nothing changes physically until the sliders move again.
    const trade = <T,>(list: T[]) => {
      const next = [...list]
      const a = next[pickFrom - 1]
      const b = next[motor - 1]
      if (a !== undefined && b !== undefined) {
        next[pickFrom - 1] = b
        next[motor - 1] = a
      }
      return next
    }
    const next = trade(values)
    setValues(next)
    setReversed(trade(reversed))
    onSwap(pickFrom, motor)
    setPickFrom(null)
    if (active && next.some((v) => v > MOTOR_STOP))
      void restart(
        next,
        fcMotorIndexes(snapshot.outputOrder, swapMotorOutputs(outputOrder, pickFrom, motor), count),
      )
  }

  /** Stops the motors for a moment and spins them back up under the new order — the feedback for a swap. */
  const restart = async (next: number[], nextIndexes: number[]) => {
    const token = session.current
    const alive = () => token === session.current
    setRestarting(true)
    pending.current = null
    try {
      await stopMotors(client)
      await sleep(SWAP_RESTART_MS)
      if (!alive()) return
      await setMotorOutputs(client, toFcOutputs(next, nextIndexes))
    } catch {
      if (!alive()) return
      setError('Lost contact with the flight controller while testing — unplug the battery.')
      setEnabled(false)
    } finally {
      if (alive()) setRestarting(false)
    }
  }

  const tools = (motor: number) => (
    <div className="relative z-20 flex gap-2">
      <Button
        variant="secondary"
        size="icon"
        aria-label={`Flip direction of motor ${motor}`}
        title="Flip the spin direction (the ESC stores it)"
        disabled={!active || !dshot || paused || pickFrom !== null}
        onClick={() => void flip(motor)}
        className={MOTOR_ICON_BUTTON}
      >
        <RotateCw className={flipping === motor ? 'animate-spin' : undefined} />
      </Button>
      <Button
        variant={pickFrom === null || pickFrom === motor ? 'secondary' : 'default'}
        size="icon"
        aria-label={
          pickFrom === null
            ? `Swap motor ${motor}`
            : pickFrom === motor
              ? `Cancel swapping motor ${motor}`
              : `Swap with motor ${motor}`
        }
        aria-pressed={pickFrom === motor}
        title={
          pickFrom === null
            ? 'Swap outputs with another motor: click, then the other motor'
            : pickFrom === motor
              ? 'Cancel'
              : `Swap with motor ${motor}`
        }
        disabled={swapDisabled || paused}
        onClick={() => pick(motor)}
        className={MOTOR_ICON_BUTTON}
      >
        <ArrowLeftRight />
      </Button>
    </div>
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
          ? 'data-[orientation=vertical]:h-16 data-[orientation=vertical]:min-h-0'
          : undefined
      }
      min={MOTOR_STOP}
      max={MOTOR_TEST_MAX}
      step={5}
      disabled={!active || paused}
      value={[values[motor - 1] ?? MOTOR_STOP]}
      onValueChange={([v]) =>
        v !== undefined && apply(values.map((old, i) => (i === motor - 1 ? v : old)))
      }
    />
  )
  const rpm = (motor: number) => telemetry?.[indexes[motor - 1] ?? motor - 1]?.rpm ?? 0
  const rpmText = (motor: number) => (hasRpm ? `${rpm(motor)} rpm` : '— rpm')

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
          <div className="relative mx-auto aspect-square w-full max-w-md">
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

            {QUAD_POSITIONS.map(({ motor, className, badge }) => {
              const output = values[motor - 1] ?? MOTOR_STOP
              // while a flip runs the FC has been told to stop everything; the sliders keep their values
              const spinning = output > MOTOR_STOP && active && !paused
              const clockwise = spinsClockwise(motor, snapshot.propsOut)
              return (
                <div
                  key={motor}
                  title={`Motor ${motor} · output ${output}`}
                  className={cn(
                    'absolute flex aspect-square w-[42%] flex-col items-center justify-center gap-1.5',
                    className,
                  )}
                >
                  <SpinRing motor={motor} clockwise={clockwise} spinning={spinning} />
                  <span
                    className={cn(
                      'absolute flex size-6 items-center justify-center rounded-full text-sm font-semibold',
                      badge,
                      spinning ? 'bg-destructive text-white' : 'bg-muted text-foreground',
                    )}
                  >
                    {motor}
                  </span>
                  {target(motor, 'absolute inset-[4%] rounded-full')}
                  {motorSlider(motor, true)}
                  <div className="relative font-mono text-xs tabular-nums">
                    {hasRpm ? `${rpm(motor)} rpm` : output}
                  </div>
                  {tools(motor)}
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
            {remapUnsaved &&
              ' — used here already; Save & Reboot to apply it on the flight controller.'}
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
            disabled={!active || paused}
            value={[master]}
            onValueChange={([v]) => v !== undefined && apply(values.map(() => v))}
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </CardContent>
    </Card>
  )
}

const MOTOR_ICON_BUTTON = 'size-8 rounded-full [&_svg]:size-4'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const ZONE_STYLE: Record<IdleZone, { bar: string; text: string; icon: typeof CircleCheck }> = {
  good: { bar: 'bg-success', text: 'text-success', icon: CircleCheck },
  warning: { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlert },
  danger: { bar: 'bg-destructive', text: 'text-destructive', icon: OctagonAlert },
}

/**
 * Which drone type the recommended ranges are for. Only changes what the sliders show and recommend; nothing is
 * written to the FC.
 */
function DroneTypePicker() {
  const droneType = useDroneTypeStore((s) => s.droneType)
  const setDroneType = useDroneTypeStore((s) => s.setDroneType)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span id="drone-type-label" className="font-medium">
        Recommendations for
      </span>
      <div
        role="group"
        aria-labelledby="drone-type-label"
        className="bg-background inline-flex rounded-md border shadow-xs"
      >
        {DRONE_TYPES.map((type) => (
          <Button
            key={type}
            size="sm"
            variant={type === droneType ? 'default' : 'ghost'}
            aria-pressed={type === droneType}
            title={DRONE_TYPE_INFO[type].description}
            className="rounded-none first:rounded-l-md last:rounded-r-md"
            onClick={() => setDroneType(type)}
          >
            {DRONE_TYPE_INFO[type].label}
          </Button>
        ))}
      </div>
      <span className="text-muted-foreground">{DRONE_TYPE_INFO[droneType].description}</span>
    </div>
  )
}

/** `dyn_idle_min_rpm` slider with the recommended zones for the drone type painted under the track. */
function DynamicIdle({
  droneType,
  value,
  enabled,
  onChange,
}: {
  droneType: DroneType
  value: number
  enabled: boolean
  onChange: (value: number) => void
}) {
  const scale = DYN_IDLE_SCALES[droneType]
  return (
    <IdleSlider
      labelId="dyn-idle-label"
      min={scale.min}
      max={scale.max}
      step={1}
      value={value}
      enabled={enabled}
      onChange={onChange}
      zones={scale}
      typeName={DRONE_TYPE_INFO[droneType].name}
      format={(v) => `${v} (${v * 100} rpm)`}
      outOfRange={value === 0 ? 'off' : String(value)}
      outOfRangeText={
        value === 0
          ? 'Off — drag the slider to turn dynamic idle on'
          : `Set to ${value}, outside this slider`
      }
      recommended={`${scale.goodMin}–${scale.goodMax}`}
      tooLow="Too low: motors can stall in hard moves"
      tooHigh="Too high: the quad floats and motors run hot"
      hint={
        enabled
          ? 'Lowest RPM the motors are allowed to drop to in flight.'
          : 'Needs bidirectional DShot: the flight controller has to know the motor RPM.'
      }
    />
  )
}

/**
 * `motor_idle` slider (0.01 % units, shown in %) with the recommended zones painted under the track. With dynamic
 * idle on, the firmware drops the static idle floor and uses `motor_idle` only as the most dynamic idle may add
 * between arming and the first throttle-up (`dynIdleStartIncrease` in mixer_init.c).
 */
function MotorIdle({
  droneType,
  value,
  dynamicIdleOn,
  onChange,
}: {
  droneType: DroneType
  value: number
  dynamicIdleOn: boolean
  onChange: (value: number) => void
}) {
  const zones = MOTOR_IDLE_ZONES
  return (
    <IdleSlider
      labelId="motor-idle-label"
      min={MOTOR_IDLE_MIN}
      max={MOTOR_IDLE_MAX}
      step={MOTOR_IDLE_STEP}
      value={value}
      enabled
      onChange={onChange}
      zones={zones}
      typeName={DRONE_TYPE_INFO[droneType].name}
      format={formatMotorIdle}
      outOfRange={formatMotorIdle(value)}
      outOfRangeText={`Set to ${formatMotorIdle(value)}, outside this slider`}
      recommended={`${zones.goodMin / 100}–${zones.goodMax / 100} %`}
      tooLow={
        dynamicIdleOn
          ? 'Too low: motors may not start reliably after arming'
          : 'Too low: motors can desync or stall'
      }
      tooHigh={
        dynamicIdleOn
          ? 'Too high: motors spin hard on the ground after arming'
          : 'Too high: the quad floats and is hard to bring down'
      }
      hint={
        dynamicIdleOn
          ? 'Dynamic idle is on: this is the most it may add from arming until the first throttle-up, so it sets how the motors start. In flight dynamic idle keeps the minimum RPM instead.'
          : 'How fast the motors spin at zero throttle while armed, in % of full throttle.'
      }
    />
  )
}

/** A slider whose track carries good / warning / danger zones, with the zone as icon + text underneath. */
function IdleSlider({
  labelId,
  min,
  max,
  step,
  value,
  enabled,
  onChange,
  zones,
  typeName,
  format,
  outOfRange,
  outOfRangeText,
  recommended,
  tooLow,
  tooHigh,
  hint,
}: {
  labelId: string
  min: number
  max: number
  step: number
  value: number
  enabled: boolean
  onChange: (value: number) => void
  zones: IdleZones
  /** Drone type as used in "Good for a …". */
  typeName: string
  format: (value: number) => string
  /** Readout and status for an FC value the slider can't show. */
  outOfRange: string
  outOfRangeText: string
  /** The good range, for the warning text. */
  recommended: string
  tooLow: string
  tooHigh: string
  hint: string
}) {
  const inRange = value >= min && value <= max
  const percent = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100

  let status: { zone: IdleZone; text: string }
  if (!inRange) status = { zone: 'warning', text: outOfRangeText }
  else {
    const zone = idleZone(value, zones)
    const low = value < zones.goodMin
    status = {
      zone,
      text:
        zone === 'good'
          ? `Good for a ${typeName}`
          : zone === 'warning'
            ? `${low ? 'A bit low' : 'A bit high'} for a ${typeName} (${recommended} recommended)`
            : low
              ? tooLow
              : tooHigh,
    }
  }
  const { text, icon: Icon } = ZONE_STYLE[status.zone]

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <div className="font-mono tabular-nums">{inRange ? format(value) : outOfRange}</div>
      <Slider
        aria-labelledby={labelId}
        min={min}
        max={max}
        step={step}
        disabled={!enabled}
        value={[inRange ? value : min]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
      {/* zone band: each value owns the stretch around its tick */}
      <div className="relative mx-2 h-1.5" aria-hidden="true">
        {idleSegments(min, max, step, zones).map(({ from, to, zone }) => (
          <div
            key={from}
            className={cn('absolute h-full rounded-full', ZONE_STYLE[zone].bar)}
            style={{
              left: `${percent(from - step / 2)}%`,
              right: `${100 - percent(to + step / 2)}%`,
            }}
          />
        ))}
      </div>
      <p className={cn('flex items-center gap-1.5', text)}>
        <Icon className="size-4 shrink-0" />
        <span className="text-foreground">{status.text}</span>
      </p>
      <p className="text-muted-foreground">{hint}</p>
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
