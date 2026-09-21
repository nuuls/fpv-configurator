import { saveToEeprom } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { encodeSetAdvancedConfig, type SetupDraft, type SetupSnapshot } from './model'

export async function readSetupSnapshot(client: MspClient): Promise<SetupSnapshot> {
  return { advancedConfig: [...(await client.request(MSP.ADVANCED_CONFIG))] }
}

export async function saveSetup(client: MspClient, snapshot: SetupSnapshot, draft: SetupDraft): Promise<void> {
  await client.request(MSP.SET_ADVANCED_CONFIG, encodeSetAdvancedConfig(snapshot, draft))
  await saveToEeprom(client)
}
