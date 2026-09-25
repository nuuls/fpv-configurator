import { readFeatures, readSerialConfig, saveToEeprom, writeSetting } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { configuredGpsPort } from '@/lib/ports/model'
import {
  canvasFor,
  decodeOsdCanvas,
  decodeOsdConfig,
  encodeSetOsdElement,
  encodeSetOsdTimer,
  planOsdWrites,
  unitsSetting,
  type OsdDraft,
  type OsdSnapshot,
} from './model'

export async function readOsdSnapshot(client: MspClient): Promise<OsdSnapshot> {
  const config = decodeOsdConfig(await client.request(MSP.OSD_CONFIG))
  // The size of the display the FC found at boot — also for SD, where "auto" can mean 16 or 13 rows.
  const reported = decodeOsdCanvas(await client.request(MSP.OSD_CANVAS))
  // The GPS elements are only offered with a GPS — the same check the Ports tab shows as "GPS: Connected".
  const ports = await readSerialConfig(client)
  const gpsConfigured = configuredGpsPort({ ports, features: await readFeatures(client) }) !== null
  return { config, canvas: canvasFor(config.videoSystem, reported), gpsConfigured }
}

/** Writes only what changed, one message per element, and the units. Takes effect immediately, no reboot. */
export async function saveOsd(
  client: MspClient,
  snapshot: OsdSnapshot,
  draft: OsdDraft,
): Promise<void> {
  for (const write of planOsdWrites(snapshot, draft)) {
    const payload =
      'timer' in write
        ? encodeSetOsdTimer(write.timer, write.config)
        : encodeSetOsdElement(write.element, write.position)
    await client.request(MSP.SET_OSD_CONFIG, payload)
  }
  const units = unitsSetting(snapshot, draft)
  if (units) await writeSetting(client, units.name, units.value)
  await saveToEeprom(client)
}
