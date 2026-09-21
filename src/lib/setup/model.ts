/** PID loop frequency on the Setup tab — docs/tabs/setup.md. Layouts: Betaflight 2026.6 msp.c. */

/** `pid_process_denom` inside MSP_ADVANCED_CONFIG (90): the PID loop runs at gyro rate / denom. */
const ADVANCED_CONFIG_PID_DENOM_OFFSET = 1
/** Slowest PID loop the app offers. Anything slower is only shown while it is what the FC has. */
const MIN_PID_LOOP_HZ = 3000

export interface SetupSnapshot {
  /** Raw MSP_ADVANCED_CONFIG payload; written back with only the PID denominator changed. */
  advancedConfig: number[]
}

export interface SetupDraft {
  pidDenom: number
}

export function readSetup(snapshot: SetupSnapshot): SetupDraft {
  return { pidDenom: snapshot.advancedConfig[ADVANCED_CONFIG_PID_DENOM_OFFSET] ?? 1 }
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
