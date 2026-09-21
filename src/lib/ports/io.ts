import {
  readFeatures,
  readSerialConfig,
  readSerialRxProvider,
  saveToEeprom,
  writeFeatures,
  writeSerialConfig,
  writeSetting,
} from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import type { PortsSnapshot, PortsWritePlan } from './model'

export async function readPortsSnapshot(client: MspClient): Promise<PortsSnapshot> {
  const ports = await readSerialConfig(client)
  const features = await readFeatures(client)
  const serialRxProvider = await readSerialRxProvider(client)
  return { ports, features, serialRxProvider }
}

/**
 * Writes the plan and persists it. Throws on the first failing step — in that case nothing has been
 * written to EEPROM, so a reboot restores the previous config. The caller reboots afterwards.
 */
export async function applyPortsPlan(client: MspClient, plan: PortsWritePlan): Promise<void> {
  await writeSerialConfig(client, plan.ports)
  await writeFeatures(client, plan.features)
  for (const { name, value } of plan.settings) await writeSetting(client, name, value)
  await saveToEeprom(client)
}
