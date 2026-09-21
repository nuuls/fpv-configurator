import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { decodeBoardAlignment, encodeBoardAlignment, type BoardAlignment } from './model'

export async function readBoardAlignment(client: MspClient): Promise<BoardAlignment> {
  return decodeBoardAlignment(await client.request(MSP.BOARD_ALIGNMENT_CONFIG))
}

export async function saveBoardAlignment(client: MspClient, alignment: BoardAlignment): Promise<void> {
  await client.request(MSP.SET_BOARD_ALIGNMENT_CONFIG, encodeBoardAlignment(alignment))
  await saveToEeprom(client)
}
