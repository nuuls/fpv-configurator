import { decodeMotorConfig } from '@/lib/motors/model'
import { readFeatures, readStatus, saveToEeprom, writeFeatures } from '@/lib/msp/api'
import { MspErrorResponse, type MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { CONFIGURATION_PROBLEM, decodeBoardInfo } from '@/lib/msp/messages'
import {
  encodeSetAdvancedConfig,
  encodeSetArmingConfig,
  encodeSetBeeperConfig,
  readSetup,
  withAirmode,
  type SetupDraft,
  type SetupSnapshot,
} from './model'

export async function readSetupSnapshot(client: MspClient): Promise<SetupSnapshot> {
  const advancedConfig = [...(await client.request(MSP.ADVANCED_CONFIG))]
  const armingConfig = [...(await client.request(MSP.ARMING_CONFIG))]
  const features = await readFeatures(client)
  const { bidirDshot } = decodeMotorConfig(await client.request(MSP.MOTOR_CONFIG))
  // Not the board info from connect: the accelerometer may have been calibrated since.
  const board = decodeBoardInfo(await client.request(MSP.BOARD_INFO))
  const status = await readStatus(client)
  return {
    advancedConfig,
    armingConfig,
    beeperConfig: await readBeeperConfig(client),
    features,
    bidirDshot,
    hasAccelerometer: (status.sensors & 1) !== 0,
    accCalibrated: (board.configurationProblems & CONFIGURATION_PROBLEM.ACC_NEEDS_CALIBRATION) === 0,
  }
}

/** MSP_BEEPER_CONFIG only exists in firmware built with USE_BEEPER; without it the FC answers with an error. */
async function readBeeperConfig(client: MspClient): Promise<number[] | null> {
  try {
    return [...(await client.request(MSP.BEEPER_CONFIG))]
  } catch (cause) {
    if (cause instanceof MspErrorResponse) return null
    throw cause
  }
}

/** Writes only the messages whose setting changed, then saves. */
export async function saveSetup(client: MspClient, snapshot: SetupSnapshot, draft: SetupDraft): Promise<void> {
  const saved = readSetup(snapshot)
  if (draft.pidDenom !== saved.pidDenom)
    await client.request(MSP.SET_ADVANCED_CONFIG, encodeSetAdvancedConfig(snapshot, draft))
  if (draft.armAngle !== null && draft.armAngle !== saved.armAngle)
    await client.request(MSP.SET_ARMING_CONFIG, encodeSetArmingConfig(snapshot, draft.armAngle))
  const beeperChanged =
    draft.beeperOffFlags !== saved.beeperOffFlags || draft.dshotBeaconOffFlags !== saved.dshotBeaconOffFlags
  if (snapshot.beeperConfig && draft.beeperOffFlags !== null && beeperChanged)
    await client.request(MSP.SET_BEEPER_CONFIG, encodeSetBeeperConfig(snapshot.beeperConfig, draft))
  if (draft.airmode !== saved.airmode) await writeFeatures(client, withAirmode(snapshot.features, draft.airmode))
  await saveToEeprom(client)
}
