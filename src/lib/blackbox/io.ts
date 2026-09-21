import { readStatus, saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  decodeBlackboxConfig,
  decodeDataflashSummary,
  decodeSdcardSummary,
  encodeSetBlackboxConfig,
  type BlackboxConfig,
  type BlackboxSnapshot,
  type DataflashSummary,
} from './model'

export async function readDataflashSummary(client: MspClient): Promise<DataflashSummary> {
  return decodeDataflashSummary(await client.request(MSP.DATAFLASH_SUMMARY))
}

export async function readBlackboxSnapshot(client: MspClient): Promise<BlackboxSnapshot> {
  const config = decodeBlackboxConfig(await client.request(MSP.BLACKBOX_CONFIG))
  const flash = await readDataflashSummary(client)
  const sdcard = decodeSdcardSummary(await client.request(MSP.SDCARD_SUMMARY))
  const { cycleTimeUs } = await readStatus(client)
  return { config, flash, sdcard, cycleTimeUs }
}

export async function saveBlackboxConfig(client: MspClient, config: BlackboxConfig): Promise<void> {
  await client.request(MSP.SET_BLACKBOX_CONFIG, encodeSetBlackboxConfig(config))
  await saveToEeprom(client)
}

const ERASE_POLL_MS = 500
const ERASE_TIMEOUT_MS = 120_000

/** Erases the onboard flash and resolves once the chip reports ready again (can take a minute). */
export async function eraseDataflash(client: MspClient, pollMs = ERASE_POLL_MS): Promise<DataflashSummary> {
  await client.request(MSP.DATAFLASH_ERASE)
  const deadline = Date.now() + ERASE_TIMEOUT_MS
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    const summary = await readDataflashSummary(client)
    if (summary.ready) return summary
    if (Date.now() > deadline) throw new Error('Erasing the flash timed out')
  }
}
