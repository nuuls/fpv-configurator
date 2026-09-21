import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { decodeMotorConfig } from '@/lib/motors/model'
import { buildFilterConfig, buildFilterSliders, type FiltersDraft, type FiltersSnapshot } from './model'

export async function readFiltersSnapshot(client: MspClient): Promise<FiltersSnapshot> {
  const filterConfig = [...(await client.request(MSP.FILTER_CONFIG))]
  const simplified = [...(await client.request(MSP.SIMPLIFIED_TUNING))]
  const { bidirDshot } = decodeMotorConfig(await client.request(MSP.MOTOR_CONFIG))
  return { filterConfig, simplified, bidirDshot }
}

/** No reboot needed: MSP_SET_FILTER_CONFIG re-initialises the running filters, so it goes last. */
export async function saveFilters(client: MspClient, snapshot: FiltersSnapshot, draft: FiltersDraft): Promise<void> {
  await client.request(MSP.SET_SIMPLIFIED_TUNING, buildFilterSliders(snapshot, draft))
  await client.request(MSP.SET_FILTER_CONFIG, buildFilterConfig(snapshot, draft))
  await saveToEeprom(client)
}
