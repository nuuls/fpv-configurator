import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  decodeVtxBand,
  decodeVtxConfig,
  decodeVtxPowerLevel,
  encodeSetVtxConfig,
  encodeVtxBand,
  encodeVtxPowerLevel,
  planVtxWrites,
  type VtxBand,
  type VtxDraft,
  type VtxPowerLevel,
  type VtxSnapshot,
} from './model'

/** The table is read entry by entry: one request per band and per power level (at most 16). */
export async function readVtxSnapshot(client: MspClient): Promise<VtxSnapshot> {
  const config = decodeVtxConfig(await client.request(MSP.VTX_CONFIG))
  const bands: VtxBand[] = []
  const powerLevels: VtxPowerLevel[] = []
  if (config.tableAvailable) {
    for (let band = 1; band <= config.bands; band++) {
      const entry = decodeVtxBand(await client.request(MSP.VTXTABLE_BAND, Uint8Array.of(band))).band
      bands.push({ ...entry, frequencies: entry.frequencies.slice(0, config.channels) })
    }
    for (let level = 1; level <= config.powerLevels; level++) {
      powerLevels.push(
        decodeVtxPowerLevel(await client.request(MSP.VTXTABLE_POWERLEVEL, Uint8Array.of(level)))
          .level,
      )
    }
  }
  return { config, table: { bands, powerLevels } }
}

/**
 * No reboot: the firmware rebuilds its in-memory table right after the EEPROM write. The config message goes
 * first because it sets the table's size — bands and power levels beyond it are rejected.
 */
export async function saveVtx(
  client: MspClient,
  snapshot: VtxSnapshot,
  draft: VtxDraft,
): Promise<void> {
  const writes = planVtxWrites(snapshot, draft)
  await client.request(MSP.SET_VTX_CONFIG, encodeSetVtxConfig(writes.config))
  for (const [i, level] of writes.powerLevels.entries()) {
    await client.request(MSP.SET_VTXTABLE_POWERLEVEL, encodeVtxPowerLevel(i + 1, level))
  }
  for (const [i, band] of writes.bands.entries()) {
    await client.request(MSP.SET_VTXTABLE_BAND, encodeVtxBand(i + 1, band))
  }
  await saveToEeprom(client)
}
