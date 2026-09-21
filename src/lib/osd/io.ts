import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  canvasFor,
  decodeOsdCanvas,
  decodeOsdConfig,
  encodeSetOsdElement,
  encodeSetOsdTimer,
  planOsdWrites,
  type OsdDraft,
  type OsdSnapshot,
} from './model'

export async function readOsdSnapshot(client: MspClient): Promise<OsdSnapshot> {
  const config = decodeOsdConfig(await client.request(MSP.OSD_CONFIG))
  // The size of the display the FC found at boot — also for SD, where "auto" can mean 16 or 13 rows.
  const reported = decodeOsdCanvas(await client.request(MSP.OSD_CANVAS))
  return { config, canvas: canvasFor(config.videoSystem, reported) }
}

/** Writes only what changed, one message per element. Takes effect immediately, no reboot. */
export async function saveOsd(client: MspClient, snapshot: OsdSnapshot, draft: OsdDraft): Promise<void> {
  for (const write of planOsdWrites(snapshot, draft)) {
    const payload =
      'timer' in write ? encodeSetOsdTimer(write.timer, write.config) : encodeSetOsdElement(write.element, write.position)
    await client.request(MSP.SET_OSD_CONFIG, payload)
  }
  await saveToEeprom(client)
}
