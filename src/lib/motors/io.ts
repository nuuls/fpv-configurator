import { saveToEeprom, writeSetting } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  decodeDynIdle,
  decodeMixerConfig,
  decodeMotorTelemetry,
  decodeMotorConfig,
  encodeArmingDisabled,
  encodeMixerConfig,
  encodeSetAdvancedConfig,
  encodeSetMotor,
  encodeSetMotorConfig,
  MOTOR_STOP,
  type MotorsDraft,
  type MotorTelemetry,
  type MotorsSnapshot,
} from './model'

export async function readMotorsSnapshot(client: MspClient): Promise<MotorsSnapshot> {
  const advancedConfig = [...(await client.request(MSP.ADVANCED_CONFIG))]
  const motorConfig = decodeMotorConfig(await client.request(MSP.MOTOR_CONFIG))
  const mixer = decodeMixerConfig(await client.request(MSP.MIXER_CONFIG))
  const dynIdle = decodeDynIdle(await client.request(MSP.PID_ADVANCED))
  return { advancedConfig, ...motorConfig, ...mixer, dynIdle }
}

export async function saveMotors(client: MspClient, snapshot: MotorsSnapshot, draft: MotorsDraft): Promise<void> {
  await client.request(MSP.SET_ADVANCED_CONFIG, encodeSetAdvancedConfig(snapshot, draft))
  await client.request(MSP.SET_MOTOR_CONFIG, encodeSetMotorConfig(snapshot, draft))
  await client.request(MSP.SET_MIXER_CONFIG, encodeMixerConfig(snapshot.mixerMode, draft.propsOut))
  // Written by name: the matching MSP message (SET_PID_ADVANCED) carries ~40 unrelated tuning fields.
  if (draft.dynIdle !== snapshot.dynIdle) await writeSetting(client, 'dyn_idle_min_rpm', String(draft.dynIdle))
  await saveToEeprom(client)
}

/** Blocks arming from the radio while the motors are being driven from here (and releases it again). */
export async function setArmingDisabled(client: MspClient, disabled: boolean): Promise<void> {
  await client.request(MSP.SET_ARMING_DISABLED, encodeArmingDisabled(disabled))
}

/** Test values per motor, 1000 (stop) – 2000. Only has an effect while the FC is disarmed. */
export async function setMotorOutputs(client: MspClient, values: number[]): Promise<void> {
  await client.request(MSP.SET_MOTOR, encodeSetMotor(values))
}

export async function stopMotors(client: MspClient): Promise<void> {
  await setMotorOutputs(client, new Array<number>(8).fill(MOTOR_STOP))
}

/** Per-motor RPM as reported by the ESCs. All zero unless bidirectional DShot (or an ESC sensor) is active. */
export async function readMotorTelemetry(client: MspClient): Promise<MotorTelemetry[]> {
  return decodeMotorTelemetry(await client.request(MSP.MOTOR_TELEMETRY))
}
