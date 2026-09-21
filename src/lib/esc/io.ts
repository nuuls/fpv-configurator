import type { MspClient } from '@/lib/msp/client'
import { MSP } from '@/lib/msp/codes'
import { FOURWAY_CMD, FourWayAckError, FourWayClient } from './fourway'
import {
  CODE_PROBE_LENGTH,
  decodeDeviceInfo,
  describeEsc,
  describeUnsupported,
  FILE_NAME_LENGTH,
  needsCodeProbe,
  readPlan,
  type EscReport,
} from './model'

/** The FC still speaks 4-way instead of MSP; only a power cycle gets it back. */
export class PassthroughStuckError extends Error {
  override name = 'PassthroughStuckError'
  constructor() {
    super('The flight controller did not leave the ESC passthrough. Unplug it, plug it back in and connect again.')
  }
}

const INIT_ATTEMPTS = 2
const EXIT_ATTEMPTS = 2

/**
 * Reads every ESC through the FC's BLHeli 4-way passthrough; one report per motor output, in motor order.
 * Takes over the MSP link while it runs (other requests wait) and always hands it back with
 * cmd_InterfaceExit, after which the FC re-enables its motor outputs. Never writes to an ESC.
 */
export function readEscs(
  client: MspClient,
  onProgress?: (index: number, count: number) => void,
  timeoutMs?: number,
): Promise<EscReport[]> {
  return client.exclusive(async (link) => {
    // No payload = MSP_PASSTHROUGH_ESC_4WAY. The reply is the ESC count — and the last MSP frame until the exit.
    const count = (await link.request(MSP.SET_PASSTHROUGH))[0] ?? 0
    const fourWay = new FourWayClient(link, timeoutMs)
    try {
      const reports: EscReport[] = []
      for (let index = 0; index < count; index++) {
        onProgress?.(index, count)
        reports.push(await readEsc(fourWay, index))
      }
      return reports
    } finally {
      try {
        await leavePassthrough(fourWay)
      } finally {
        fourWay.dispose()
      }
    }
  })
}

async function leavePassthrough(fourWay: FourWayClient): Promise<void> {
  for (let attempt = 1; attempt <= EXIT_ATTEMPTS; attempt++) {
    try {
      await fourWay.request(FOURWAY_CMD.INTERFACE_EXIT)
      return
    } catch {
      // try again, then give up
    }
  }
  throw new PassthroughStuckError()
}

/** Timeouts (the FC itself stopped answering) propagate; an ESC that doesn't answer becomes a 'missing' report. */
async function readEsc(fourWay: FourWayClient, index: number): Promise<EscReport> {
  try {
    const info = decodeDeviceInfo(await connect(fourWay, index))
    try {
      const plan = readPlan(info)
      if (!plan) return describeUnsupported(info)

      const read = async (address: number, length: number) =>
        (await fourWay.request(FOURWAY_CMD.DEVICE_READ, [length], address)).params
      const settings = await read(plan.settingsAddress, plan.settingsLength)
      // Old AM32 builds have no file name there, and their bootloader may refuse the address.
      const fileName =
        plan.fileNameAddress === null ? null : await read(plan.fileNameAddress, FILE_NAME_LENGTH).catch(ignoreAckError)
      const codeProbe =
        plan.codeProbeAddress !== null && needsCodeProbe(settings)
          ? await read(plan.codeProbeAddress, CODE_PROBE_LENGTH).catch(ignoreAckError)
          : null
      return describeEsc({ info, plan, settings, fileName, codeProbe })
    } finally {
      // The ESC sits in its bootloader now: start its firmware again.
      await fourWay.request(FOURWAY_CMD.DEVICE_RESET, [index]).catch(ignoreAckError)
    }
  } catch (cause) {
    if (!(cause instanceof FourWayAckError)) throw cause
    return { status: 'missing', description: 'No answer from this ESC. Check the battery and the motor signal wire.' }
  }
}

async function connect(fourWay: FourWayClient, index: number): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await fourWay.request(FOURWAY_CMD.DEVICE_INIT_FLASH, [index])).params
    } catch (cause) {
      if (!(cause instanceof FourWayAckError) || attempt >= INIT_ATTEMPTS) throw cause
    }
  }
}

function ignoreAckError(cause: unknown): null {
  if (cause instanceof FourWayAckError) return null
  throw cause
}
