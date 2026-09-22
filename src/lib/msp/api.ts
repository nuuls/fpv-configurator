/** High-level typed reads: request + decode. This is what stores, hooks and pages should call. */
import type { MspClient } from './client'
import { MSP } from './codes'
import {
  decodeFeatureMask,
  decodeSerialConfig,
  decodeSerialRxProvider,
  encodeCliSettingWrite,
  encodeFeatureMask,
  encodeReboot,
  REBOOT_MODE,
  encodeSerialConfig,
  type SerialPortConfig,
  decodeAnalog,
  decodeApiVersion,
  decodeAttitude,
  decodeBoardInfo,
  decodeFcVariant,
  decodeFcVersion,
  decodeStatus,
  type Analog,
  type ApiVersion,
  type Attitude,
  type BoardInfo,
  type FcVersion,
  type Status,
} from './messages'

export interface FcInfo {
  apiVersion: ApiVersion
  /** "BTFL" for Betaflight. */
  variant: string
  version: FcVersion
  board: BoardInfo
}

/** Identification handshake performed right after connecting. */
export async function readFcInfo(client: MspClient): Promise<FcInfo> {
  const apiVersion = decodeApiVersion(await client.request(MSP.API_VERSION))
  const variant = decodeFcVariant(await client.request(MSP.FC_VARIANT))
  const version = decodeFcVersion(await client.request(MSP.FC_VERSION))
  const board = decodeBoardInfo(await client.request(MSP.BOARD_INFO))
  return { apiVersion, variant, version, board }
}

export async function readStatus(client: MspClient): Promise<Status> {
  return decodeStatus(await client.request(MSP.STATUS))
}

export async function readAttitude(client: MspClient): Promise<Attitude> {
  return decodeAttitude(await client.request(MSP.ATTITUDE))
}

export async function readAnalog(client: MspClient): Promise<Analog> {
  return decodeAnalog(await client.request(MSP.ANALOG))
}

export async function readSerialConfig(client: MspClient): Promise<SerialPortConfig[]> {
  return decodeSerialConfig(await client.request(MSP.COMMON_SERIAL_CONFIG))
}

export async function writeSerialConfig(
  client: MspClient,
  ports: SerialPortConfig[],
): Promise<void> {
  await client.request(MSP.COMMON_SET_SERIAL_CONFIG, encodeSerialConfig(ports))
}

export async function readFeatures(client: MspClient): Promise<number> {
  return decodeFeatureMask(await client.request(MSP.FEATURE_CONFIG))
}

export async function writeFeatures(client: MspClient, mask: number): Promise<void> {
  await client.request(MSP.SET_FEATURE_CONFIG, encodeFeatureMask(mask))
}

export async function readSerialRxProvider(client: MspClient): Promise<number> {
  return decodeSerialRxProvider(await client.request(MSP.RX_CONFIG))
}

/** Sets a CLI variable by name, like `set name = value` in the CLI. Rejects if the FC refuses it. */
export async function writeSetting(client: MspClient, name: string, value: string): Promise<void> {
  await client.request(MSP.CLI_SETTING, encodeCliSettingWrite(name, value))
}

/** Persists the running config. Without this, everything written is lost on reboot. */
export async function saveToEeprom(client: MspClient): Promise<void> {
  await client.request(MSP.EEPROM_WRITE, undefined, { timeoutMs: 5000 })
}

/** Asks the FC to reboot. The connection drops right after; use the connection store's `reboot()`. */
export async function sendReboot(client: MspClient): Promise<void> {
  await client.request(MSP.REBOOT, encodeReboot())
}

/**
 * Reboots the FC into USB mass-storage mode so its logs show up as a drive. It stays in that mode
 * (no MSP) until it is power-cycled. Rejects if the storage isn't ready.
 */
export async function sendRebootToMassStorage(client: MspClient): Promise<void> {
  const response = await client.request(MSP.REBOOT, encodeReboot(REBOOT_MODE.MASS_STORAGE))
  if (response[1] !== 1) throw new Error('The log storage is not ready')
}
