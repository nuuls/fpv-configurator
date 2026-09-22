import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  ACC_CALIBRATION_MS,
  decodeBoardAlignment,
  encodeBoardAlignment,
  type BoardAlignment,
} from './model'

export async function readBoardAlignment(client: MspClient): Promise<BoardAlignment> {
  return decodeBoardAlignment(await client.request(MSP.BOARD_ALIGNMENT_CONFIG))
}

export async function saveBoardAlignment(
  client: MspClient,
  alignment: BoardAlignment,
): Promise<void> {
  await client.request(MSP.SET_BOARD_ALIGNMENT_CONFIG, encodeBoardAlignment(alignment))
  await saveToEeprom(client)
}

/**
 * Starts the accelerometer calibration and resolves once it is over. The quad has to sit level and still
 * meanwhile. The firmware stores the result in EEPROM by itself (together with the rest of the running
 * config) and ignores the command while armed.
 */
export async function calibrateAccelerometer(
  client: MspClient,
  waitMs = ACC_CALIBRATION_MS,
): Promise<void> {
  await client.request(MSP.ACC_CALIBRATION)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}
