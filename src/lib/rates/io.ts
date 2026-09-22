import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { buildRcTuning, type RatesDraft, type RatesSnapshot } from './model'

export async function readRatesSnapshot(client: MspClient): Promise<RatesSnapshot> {
  return { raw: [...(await client.request(MSP.RC_TUNING))] }
}

/** Applies to the FC's current rate profile. Takes effect immediately, no reboot. */
export async function saveRates(
  client: MspClient,
  snapshot: RatesSnapshot,
  draft: RatesDraft,
): Promise<void> {
  await client.request(MSP.SET_RC_TUNING, buildRcTuning(snapshot, draft))
  await saveToEeprom(client)
}
