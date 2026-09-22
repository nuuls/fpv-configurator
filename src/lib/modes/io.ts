import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  decodeBoxIds,
  decodeModeRanges,
  decodeRc,
  encodeSetModeRange,
  planModeWrites,
  type ModesDraft,
  type ModesSnapshot,
} from './model'

export async function readModesSnapshot(client: MspClient): Promise<ModesSnapshot> {
  const slots = decodeModeRanges(await client.request(MSP.MODE_RANGES))
  const boxIds = decodeBoxIds(await client.request(MSP.BOXIDS))
  return { slots, boxIds }
}

export async function readRcChannels(client: MspClient): Promise<number[]> {
  return decodeRc(await client.request(MSP.RC))
}

export async function saveModes(
  client: MspClient,
  snapshot: ModesSnapshot,
  draft: ModesDraft,
): Promise<void> {
  for (const { index, slot } of planModeWrites(snapshot, draft)) {
    await client.request(MSP.SET_MODE_RANGE, encodeSetModeRange(index, slot))
  }
  await saveToEeprom(client)
}
