/** PID loop frequency and pre-flight checklist on the Setup tab — docs/tabs/setup.md. Layouts: Betaflight 2026.6 msp.c. */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'
import { FEATURE } from '@/lib/msp/messages'

/** `pid_process_denom` inside MSP_ADVANCED_CONFIG (90): the PID loop runs at gyro rate / denom. */
const ADVANCED_CONFIG_PID_DENOM_OFFSET = 1
/** Slowest PID loop the app offers. Anything slower is only shown while it is what the FC has. */
const MIN_PID_LOOP_HZ = 3000

/** `small_angle` inside MSP_ARMING_CONFIG (61): the quad only arms when tilted less than this. 180 = any angle. */
const ARMING_CONFIG_SMALL_ANGLE_OFFSET = 2
export const ARM_ANGLE_ANY = 180
/** `beeper_off_flags` (u32, the first field of MSP_BEEPER_CONFIG): `1 << (beeperMode_e - 1)`, a set bit mutes that beep. */
export const BEEPER_OFF = {
  RX_LOST: 1 << 1,
  RX_SET: 1 << 9,
} as const
const BEEPER_OFF_REQUIRED = BEEPER_OFF.RX_LOST | BEEPER_OFF.RX_SET

export interface SetupSnapshot {
  /** Raw MSP_ADVANCED_CONFIG payload; written back with only the PID denominator changed. */
  advancedConfig: number[]
  /** Raw MSP_ARMING_CONFIG payload; written back with only `small_angle` changed. */
  armingConfig: number[]
  /** Raw MSP_BEEPER_CONFIG payload, written back with only two off-flags cleared. null: firmware built without beeper. */
  beeperConfig: number[] | null
  /** MSP_FEATURE_CONFIG mask. */
  features: number
  /** `useDshotTelemetry` from MSP_MOTOR_CONFIG; edited on the Motors tab. */
  bidirDshot: boolean
  hasAccelerometer: boolean
  /** From the configuration problems in MSP_BOARD_INFO; calibrating happens on the Orientation tab. */
  accCalibrated: boolean
}

export interface SetupDraft {
  pidDenom: number
  /** null: the firmware doesn't report it. */
  armAngle: number | null
  /** null: no beeper config. */
  beeperOffFlags: number | null
  airmode: boolean
}

export function readSetup(snapshot: SetupSnapshot): SetupDraft {
  const beeper = snapshot.beeperConfig
  return {
    pidDenom: snapshot.advancedConfig[ADVANCED_CONFIG_PID_DENOM_OFFSET] ?? 1,
    armAngle: snapshot.armingConfig[ARMING_CONFIG_SMALL_ANGLE_OFFSET] ?? null,
    beeperOffFlags: beeper && beeper.length >= 4 ? new ByteReader(Uint8Array.from(beeper)).u32() : null,
    airmode: (snapshot.features & FEATURE.AIRMODE) !== 0,
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
        : { ...draft, beeperOffFlags: (draft.beeperOffFlags & ~BEEPER_OFF_REQUIRED) >>> 0 }
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
    [flags & BEEPER_OFF.RX_SET ? 'RX set' : null, flags & BEEPER_OFF.RX_LOST ? 'RX loss' : null].filter((m) => m !== null)
  const armAngleOk = (d: SetupDraft) => d.armAngle === ARM_ANGLE_ANY
  const beeperOk = (d: SetupDraft) => d.beeperOffFlags !== null && muted(d.beeperOffFlags).length === 0
  const here = (ok: (d: SetupDraft) => boolean, available: boolean) => ({
    ok: ok(draft),
    pending: ok(draft) && !ok(saved),
    fix: !ok(draft) && available ? ('here' as const) : null,
  })

  return [
    {
      id: 'bidirDshot',
      label: 'Bidirectional DShot is enabled',
      detail: snapshot.bidirDshot ? 'On' : 'Off',
      ok: snapshot.bidirDshot,
      pending: false,
      fix: snapshot.bidirDshot ? null : { path: '/motors', tab: 'Motors' },
    },
    {
      id: 'accCalibrated',
      label: 'Accelerometer is calibrated',
      detail: !snapshot.hasAccelerometer ? 'No accelerometer' : snapshot.accCalibrated ? 'Calibrated' : 'Not calibrated',
      ok: snapshot.hasAccelerometer && snapshot.accCalibrated,
      pending: false,
      fix: snapshot.accCalibrated || !snapshot.hasAccelerometer ? null : { path: '/orientation', tab: 'Orientation' },
    },
    {
      id: 'armAngle',
      label: `Arm angle is ${ARM_ANGLE_ANY}°`,
      detail: draft.armAngle === null ? 'Not reported' : `${draft.armAngle}°`,
      ...here(armAngleOk, draft.armAngle !== null),
    },
    {
      id: 'beeper',
      label: 'Beeper sounds on RX set and RX loss',
      detail:
        draft.beeperOffFlags === null
          ? 'No beeper support'
          : beeperOk(draft)
            ? 'On'
            : `Off for ${muted(draft.beeperOffFlags).join(' and ')}`,
      ...here(beeperOk, draft.beeperOffFlags !== null),
    },
    {
      id: 'airmode',
      label: 'Airmode is on',
      detail: draft.airmode ? 'On' : 'Off',
      ...here((d) => d.airmode, true),
    },
  ]
}

// ---- MSP_SET_ARMING_CONFIG (62) / MSP_SET_BEEPER_CONFIG (185): read-modify-write ----

export function encodeSetArmingConfig(snapshot: SetupSnapshot, armAngle: number): Uint8Array {
  const payload = Uint8Array.from(snapshot.armingConfig)
  payload[ARMING_CONFIG_SMALL_ANGLE_OFFSET] = armAngle
  return payload
}

export function encodeSetBeeperConfig(beeperConfig: number[], offFlags: number): Uint8Array {
  // beeper_off_flags:u32, then dshotBeaconTone:u8 and dshotBeaconOffFlags:u32, which stay as they are
  return Uint8Array.of(...new ByteWriter().u32(offFlags).toBytes(), ...beeperConfig.slice(4))
}

/** Feature mask with only the airmode bit changed. */
export function withAirmode(features: number, airmode: boolean): number {
  return (airmode ? features | FEATURE.AIRMODE : features & ~FEATURE.AIRMODE) >>> 0
}
