/**
 * PID loop frequency, pre-flight checklist and the settings changed outside this app, on the Setup tab —
 * docs/tabs/setup.md. Layouts: Betaflight 2026.6 msp.c.
 */
import {
  canReset,
  changeKey,
  parseFlag,
  resetCommands,
  type DiffEntry,
  type DiffReport,
} from '@/lib/diff/model'
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'
import { FEATURE } from '@/lib/msp/messages'

/** `pid_process_denom` inside MSP_ADVANCED_CONFIG (90): the PID loop runs at gyro rate / denom. */
const ADVANCED_CONFIG_PID_DENOM_OFFSET = 1
/** Slowest PID loop the app offers. Anything slower is only shown while it is what the FC has. */
const MIN_PID_LOOP_HZ = 3000

/** `small_angle` inside MSP_ARMING_CONFIG (61): the quad only arms when tilted less than this. 180 = any angle. */
const ARMING_CONFIG_SMALL_ANGLE_OFFSET = 2
export const ARM_ANGLE_ANY = 180
/**
 * `beeper_off_flags` (u32, the first field of MSP_BEEPER_CONFIG): `1 << (beeperMode_e - 1)`, a set bit mutes that beep.
 * `dshotBeaconOffFlags` (u32 at byte 5, after the beacon tone) uses the same bits; the ESC beacon only knows these two.
 */
export const BEEPER_OFF = {
  RX_LOST: 1 << 1,
  RX_SET: 1 << 9,
} as const
const BEEPER_OFF_REQUIRED = BEEPER_OFF.RX_LOST | BEEPER_OFF.RX_SET
const BEEPER_CONFIG_DSHOT_BEACON_OFF_FLAGS_OFFSET = 5

export interface SetupSnapshot {
  /** Raw MSP_ADVANCED_CONFIG payload; written back with only the PID denominator changed. */
  advancedConfig: number[]
  /** Raw MSP_ARMING_CONFIG payload; written back with only `small_angle` changed. */
  armingConfig: number[]
  /** Raw MSP_BEEPER_CONFIG payload, written back with only the RX off-flags cleared. null: firmware built without beeper. */
  beeperConfig: number[] | null
  /** MSP_FEATURE_CONFIG mask. */
  features: number
  /** `useDshotTelemetry` from MSP_MOTOR_CONFIG; edited on the Motors tab. */
  bidirDshot: boolean
  hasAccelerometer: boolean
  /** From the configuration problems in MSP_BOARD_INFO; calibrating happens on the Orientation tab. */
  accCalibrated: boolean
  /** `diff all defaults` without what this app manages (`externalOnly`). null: the CLI couldn't be read. */
  external: DiffReport | null
  /** Why `external` is null. */
  externalError: string | null
}

export interface SetupDraft {
  pidDenom: number
  /** null: the firmware doesn't report it. */
  armAngle: number | null
  /** null: no beeper config. */
  beeperOffFlags: number | null
  /** null: no beeper config, or one that ends before the DShot beacon. */
  dshotBeaconOffFlags: number | null
  airmode: boolean
  /** `changeKey`s of the external changes to put back to their defaults on save. */
  resets: string[]
}

export function readSetup(snapshot: SetupSnapshot): SetupDraft {
  const beeper = new ByteReader(Uint8Array.from(snapshot.beeperConfig ?? []))
  const beeperOffFlags = beeper.remaining >= 4 ? beeper.u32() : null
  if (beeper.remaining >= 1) beeper.u8() // dshotBeaconTone
  return {
    pidDenom: snapshot.advancedConfig[ADVANCED_CONFIG_PID_DENOM_OFFSET] ?? 1,
    armAngle: snapshot.armingConfig[ARMING_CONFIG_SMALL_ANGLE_OFFSET] ?? null,
    beeperOffFlags,
    dshotBeaconOffFlags: beeperOffFlags !== null && beeper.remaining >= 4 ? beeper.u32() : null,
    airmode: (snapshot.features & FEATURE.AIRMODE) !== 0,
    resets: [],
  }
}

export interface PidLoopOption {
  denom: number
  hz: number
}

/**
 * The gyro rate and half of it, slowest first: 4 / 8 kHz on an 8 kHz gyro, only 3.2 kHz on a BMI270.
 * `currentDenom` (what the FC has) is always included so an unusual value can be shown and kept.
 */
export function pidLoopOptions(gyroHz: number, currentDenom: number): PidLoopOption[] {
  if (gyroHz <= 0) return []
  const denoms = [2, 1].filter((denom) => gyroHz / denom >= MIN_PID_LOOP_HZ)
  if (currentDenom >= 1 && !denoms.includes(currentDenom)) denoms.push(currentDenom)
  return denoms.sort((a, b) => b - a).map((denom) => ({ denom, hz: gyroHz / denom }))
}

/** "8 kHz", "3.2 kHz", "6.7 kHz" */
export function formatLoopRate(hz: number): string {
  return `${Number((hz / 1000).toFixed(1))} kHz`
}

// ---- MSP_ADVANCED_CONFIG (90) / SET (91): read-modify-write, only pid_process_denom changes ----

export function encodeSetAdvancedConfig(snapshot: SetupSnapshot, draft: SetupDraft): Uint8Array {
  const payload = Uint8Array.from(snapshot.advancedConfig)
  payload[ADVANCED_CONFIG_PID_DENOM_OFFSET] = draft.pidDenom
  return payload
}

// ---- Pre-flight checklist ----

export type CheckId = 'bidirDshot' | 'accCalibrated' | 'armAngle' | 'beeper' | 'airmode'

export interface PreflightCheck {
  id: CheckId
  /** States what the check found: "Airmode is on" when it passes, "Airmode is off" when it fails. */
  label: string
  /** What the draft has, e.g. "25°". */
  detail: string
  ok: boolean
  /** Passes only because of an unsaved fix. */
  pending: boolean
  /** Failing checks only: fixed right here (`applyFix`), on another tab, or not at all. */
  fix: 'here' | { path: string; tab: string } | null
}

/** Draft with the one setting behind a check set to what the check asks for. */
export function applyFix(draft: SetupDraft, id: CheckId): SetupDraft {
  switch (id) {
    case 'armAngle':
      return draft.armAngle === null ? draft : { ...draft, armAngle: ARM_ANGLE_ANY }
    case 'beeper':
      return draft.beeperOffFlags === null
        ? draft
        : {
            ...draft,
            beeperOffFlags: (draft.beeperOffFlags & ~BEEPER_OFF_REQUIRED) >>> 0,
            dshotBeaconOffFlags:
              draft.dshotBeaconOffFlags === null
                ? null
                : (draft.dshotBeaconOffFlags & ~BEEPER_OFF_REQUIRED) >>> 0,
          }
    case 'airmode':
      return { ...draft, airmode: true }
    default:
      return draft // fixed on another tab
  }
}

/** SPEC §2 "Setup": the five settings to verify before the first flight, evaluated on the draft. */
export function preflightChecks(snapshot: SetupSnapshot, draft: SetupDraft): PreflightCheck[] {
  const saved = readSetup(snapshot)
  const muted = (flags: number) =>
    [
      flags & BEEPER_OFF.RX_SET ? 'RX set' : null,
      flags & BEEPER_OFF.RX_LOST ? 'RX loss' : null,
    ].filter((m) => m !== null)
  const armAngleOk = (d: SetupDraft) => d.armAngle === ARM_ANGLE_ANY
  const beeperMuted = (d: SetupDraft) =>
    [
      { name: 'Beeper', off: muted(d.beeperOffFlags ?? 0) },
      { name: 'DShot beacon', off: muted(d.dshotBeaconOffFlags ?? 0) },
    ].filter(({ off }) => off.length > 0)
  const beeperOk = (d: SetupDraft) => d.beeperOffFlags !== null && beeperMuted(d).length === 0
  const accOk = snapshot.hasAccelerometer && snapshot.accCalibrated
  const here = (ok: (d: SetupDraft) => boolean, available: boolean) => ({
    ok: ok(draft),
    pending: ok(draft) && !ok(saved),
    fix: !ok(draft) && available ? ('here' as const) : null,
  })

  return [
    {
      id: 'bidirDshot',
      label: snapshot.bidirDshot
        ? 'Bidirectional DShot is enabled'
        : 'Bidirectional DShot is not enabled',
      detail: snapshot.bidirDshot ? 'On' : 'Off',
      ok: snapshot.bidirDshot,
      pending: false,
      fix: snapshot.bidirDshot ? null : { path: '/motors', tab: 'Motors' },
    },
    {
      id: 'accCalibrated',
      label: accOk ? 'Accelerometer is calibrated' : 'Accelerometer is not calibrated',
      detail: !snapshot.hasAccelerometer
        ? 'No accelerometer'
        : snapshot.accCalibrated
          ? 'Calibrated'
          : 'Not calibrated',
      ok: accOk,
      pending: false,
      fix:
        snapshot.accCalibrated || !snapshot.hasAccelerometer
          ? null
          : { path: '/orientation', tab: 'Orientation' },
    },
    {
      id: 'armAngle',
      label: armAngleOk(draft)
        ? `Arm angle is ${ARM_ANGLE_ANY}°`
        : `Arm angle is not ${ARM_ANGLE_ANY}°`,
      detail: draft.armAngle === null ? 'Not reported' : `${draft.armAngle}°`,
      ...here(armAngleOk, draft.armAngle !== null),
    },
    {
      id: 'beeper',
      label: beeperOk(draft)
        ? 'Beeper and DShot beacon sound on RX set and RX loss'
        : 'Beeper or DShot beacon is silent on RX set or RX loss',
      detail:
        draft.beeperOffFlags === null
          ? 'No beeper support'
          : beeperOk(draft)
            ? 'On'
            : beeperMuted(draft)
                .map(({ name, off }) => `${name} off for ${off.join(' and ')}`)
                .join(' · '),
      ...here(beeperOk, draft.beeperOffFlags !== null),
    },
    {
      id: 'airmode',
      label: draft.airmode ? 'Airmode is on' : 'Airmode is off',
      detail: draft.airmode ? 'On' : 'Off',
      ...here((d) => d.airmode, true),
    },
  ]
}

// ---- Changed outside this app ----

/** One line of the "Changed outside this app" list: a difference no tab of this app manages. */
export interface ExternalChange {
  /** CLI section: `master`, `profile 1`, `led`, … */
  section: string
  /** `changeKey` of a change the app can put back; null for the others (the craft name, `resource`, `led`, …). */
  key: string | null
  /** Names the row: a setting's name, otherwise the command line. */
  label: string
  /** `set name = value` → the name; `feature TELEMETRY` → `feature`; any other command → the whole line. */
  name: string
  /** The setting's value, or the flag (`-TELEMETRY`); null for other commands (the line says it all). */
  value: string | null
  /** What the reset would put back: the setting's default, the opposite flag. */
  defaultValue: string | null
  /** Marked for reset in the draft. */
  reset: boolean
}

export function externalChanges(snapshot: SetupSnapshot, draft: SetupDraft): ExternalChange[] {
  const report = snapshot.external
  if (!report) return []
  const changes: ExternalChange[] = []
  for (const section of report.sections) {
    for (const entry of section.entries) {
      const key = canReset(report, section, entry) ? changeKey(section, entry) : null
      changes.push({
        section: section.title,
        key,
        ...describe(entry),
        reset: key !== null && draft.resets.includes(key),
      })
    }
  }
  return changes
}

function describe(
  entry: DiffEntry,
): Pick<ExternalChange, 'label' | 'name' | 'value' | 'defaultValue'> {
  if (entry.kind === 'setting')
    return {
      label: entry.name,
      name: entry.name,
      value: entry.value,
      defaultValue: entry.defaultValue,
    }
  const flag = parseFlag(entry.line)
  if (flag)
    return { label: entry.line, name: flag.command, value: flag.flag, defaultValue: flag.opposite }
  return { label: entry.line, name: entry.line, value: null, defaultValue: null }
}

/** Draft with this external change marked for reset (or not). */
export function withReset(draft: SetupDraft, key: string, reset: boolean): SetupDraft {
  if (draft.resets.includes(key) === reset) return draft
  return {
    ...draft,
    resets: reset ? [...draft.resets, key] : draft.resets.filter((k) => k !== key),
  }
}

/** Draft with every resettable external change marked. */
export function withAllResets(snapshot: SetupSnapshot, draft: SetupDraft): SetupDraft {
  const keys = externalChanges(snapshot, draft).flatMap((change) =>
    change.key === null ? [] : [change.key],
  )
  return { ...draft, resets: keys }
}

/** The CLI lines that carry out the draft's resets; empty when there are none. */
export function resetScript(snapshot: SetupSnapshot, draft: SetupDraft): string[] {
  return snapshot.external && draft.resets.length > 0
    ? resetCommands(snapshot.external, new Set(draft.resets))
    : []
}

// ---- MSP_SET_ARMING_CONFIG (62) / MSP_SET_BEEPER_CONFIG (185): read-modify-write ----

export function encodeSetArmingConfig(snapshot: SetupSnapshot, armAngle: number): Uint8Array {
  const payload = Uint8Array.from(snapshot.armingConfig)
  payload[ARMING_CONFIG_SMALL_ANGLE_OFFSET] = armAngle
  return payload
}

export function encodeSetBeeperConfig(beeperConfig: number[], draft: SetupDraft): Uint8Array {
  // beeper_off_flags:u32, dshotBeaconTone:u8 (stays as it is), dshotBeaconOffFlags:u32
  const payload = Uint8Array.from(beeperConfig)
  if (draft.beeperOffFlags !== null)
    payload.set(new ByteWriter().u32(draft.beeperOffFlags).toBytes())
  if (draft.dshotBeaconOffFlags !== null)
    payload.set(
      new ByteWriter().u32(draft.dshotBeaconOffFlags).toBytes(),
      BEEPER_CONFIG_DSHOT_BEACON_OFF_FLAGS_OFFSET,
    )
  return payload
}

/** Feature mask with only the airmode bit changed. */
export function withAirmode(features: number, airmode: boolean): number {
  return (airmode ? features | FEATURE.AIRMODE : features & ~FEATURE.AIRMODE) >>> 0
}
