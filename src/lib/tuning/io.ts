import { saveToEeprom, writeSetting } from '@/lib/msp/api'
import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import {
  buildCalculateRequest,
  buildSimplifiedTuning,
  decodePidfs,
  decodeRcSmoothing,
  decodeTpa,
  smoothingWrites,
  tpaWrites,
  type AxisPids,
  type SliderDraft,
  type TuningDraft,
  type TuningSnapshot,
} from './model'

export async function readTuningSnapshot(client: MspClient): Promise<TuningSnapshot> {
  const simplified = [...(await client.request(MSP.SIMPLIFIED_TUNING))]
  const smoothing = decodeRcSmoothing(await client.request(MSP.RX_CONFIG))
  const tpa = decodeTpa(await client.request(MSP.PID_ADVANCED))
  return { simplified, ...smoothing, tpa }
}

/** Asks the firmware what PIDs the draft sliders would produce, without applying anything. */
export async function previewPids(
  client: MspClient,
  snapshot: TuningSnapshot,
  draft: SliderDraft,
): Promise<AxisPids[]> {
  return decodePidfs(
    await client.request(MSP.CALCULATE_SIMPLIFIED_PID, buildCalculateRequest(snapshot, draft)),
  )
}

/** Resolves true when a reboot is needed for the change to take effect (RC smoothing changes). */
export async function saveTuning(
  client: MspClient,
  snapshot: TuningSnapshot,
  draft: TuningDraft,
): Promise<boolean> {
  await client.request(MSP.SET_SIMPLIFIED_TUNING, buildSimplifiedTuning(snapshot, draft))
  const smoothing = smoothingWrites(snapshot, draft)
  // TPA by name: MSP_SET_PID_ADVANCED carries ~40 unrelated tuning fields. The EEPROM write re-inits the PID loop.
  for (const { name, value } of [...smoothing, ...tpaWrites(snapshot, draft)])
    await writeSetting(client, name, value)
  await saveToEeprom(client)
  return smoothing.length > 0
}
