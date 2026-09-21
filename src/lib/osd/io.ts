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
  VIDEO_SYSTEM,
  type OsdDraft,
  type OsdSnapshot,
} from './model'

export async function readOsdSnapshot(client: MspClient): Promise<OsdSnapshot> {
  const config = decodeOsdConfig(await client.request(MSP.OSD_CONFIG))
  // Only HD displays have a canvas size of their own; SD is fixed by the video system.
  const reported =
    config.videoSystem === VIDEO_SYSTEM.HD ? decodeOsdCanvas(await client.request(MSP.OSD_CANVAS)) : { cols: 0, rows: 0 }
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
