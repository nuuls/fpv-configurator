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
  withBlock,
  type EscDraft,
  type EscReport,
  type ReadableEsc,
} from './model'

/** The FC still speaks 4-way instead of MSP; only a power cycle gets it back. */
export class PassthroughStuckError extends Error {
  override name = 'PassthroughStuckError'
  constructor() {
    super('The flight controller did not leave the ESC passthrough. Unplug it, plug it back in and connect again.')
  }
}

/**
 * `esc4wayInit` pulls the signal wires high; a running ESC only jumps into its bootloader once it has noticed
 * that, which takes a few hundred ms — longer while it plays a startup tune. The FC gives up on a bootloader
 * that doesn't answer within ~50 ms, so wait first and retry with pauses (timing as in ESC Configurator).
 */
const ESC_BOOT_DELAY_MS = 1200
const INIT_ATTEMPTS = 5
const INIT_RETRY_DELAY_MS = 250
const EXIT_ATTEMPTS = 2

export interface ReadEscsOptions {
  /** Response timeout of a 4-way request. */
  timeoutMs?: number
  /** Replaces the real waiting in tests. */
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Sleep = (ms: number) => Promise<void>

/**
 * A session on the FC's BLHeli 4-way passthrough. Takes over the MSP link while it runs (other requests wait)
 * and always hands it back with cmd_InterfaceExit, after which the FC re-enables its motor outputs.
 */
function passthrough<T>(
  client: MspClient,
  options: ReadEscsOptions,
  session: (fourWay: FourWayClient, count: number, sleep: Sleep) => Promise<T>,
): Promise<T> {
  const sleep = options.sleep ?? realSleep
  return client.exclusive(async (link) => {
    // No payload = MSP_PASSTHROUGH_ESC_4WAY. The reply is the ESC count — and the last MSP frame until the exit.
    const count = (await link.request(MSP.SET_PASSTHROUGH))[0] ?? 0
    const fourWay = new FourWayClient(link, options.timeoutMs)
    try {
      if (count > 0) await sleep(ESC_BOOT_DELAY_MS)
      return await session(fourWay, count, sleep)
    } finally {
      try {
        await leavePassthrough(fourWay)
      } finally {
        fourWay.dispose()
      }
    }
  })
}

/** Reads every ESC; one report per motor output, in motor order. Never writes to an ESC. */
export function readEscs(
  client: MspClient,
  onProgress?: (index: number, count: number) => void,
  options: ReadEscsOptions = {},
): Promise<EscReport[]> {
  return passthrough(client, options, async (fourWay, count, sleep) => {
    const reports: EscReport[] = []
    for (let index = 0; index < count; index++) {
      onProgress?.(index, count)
      reports.push(await readEsc(fourWay, index, sleep))
    }
    return reports
  })
}

/** Writing the settings of one ESC failed; `message` names the ESC and says what to do. */
export class EscWriteError extends Error {
  override name = 'EscWriteError'
}

/**
 * Writes the changed settings blocks of `draft` to their ESCs and resolves with the reports as they are now.
 * Only the settings block is ever erased and written, and only after the ESC still holds exactly what
 * `reports` say (so every byte this app doesn't edit goes back as it was); what was written is read back
 * and compared. ESCs whose block didn't change — or already holds the draft, after a failed attempt — are
 * left alone. Stops at the first ESC that fails.
 */
export function writeEscs(client: MspClient, reports: EscReport[], draft: EscDraft, options: ReadEscsOptions = {}): Promise<EscReport[]> {
  return passthrough(client, options, async (fourWay, _count, sleep) => {
    const written = [...reports]
    for (const [index, report] of reports.entries()) {
      const block = draft[index]
      if (report.status !== 'ok' || !report.editable || !block) continue
      const next = Uint8Array.from(block)
      if (sameBytes(next, report.block)) continue
      written[index] = await writeEsc(fourWay, index, report, next, sleep)
    }
    return written
  })
}

async function writeEsc(fourWay: FourWayClient, index: number, esc: ReadableEsc, block: Uint8Array, sleep: Sleep): Promise<ReadableEsc> {
  const fail = (what: string) => new EscWriteError(`ESC ${index + 1}: ${what}`)
  const { plan } = esc
  if (block.length !== esc.block.length) throw fail('the new settings are not the size of the ones that were read.')
  try {
    const info = decodeDeviceInfo(await connect(fourWay, index, sleep))
    try {
      const found = readPlan(info)
      if (!found || found.mcu !== plan.mcu || found.settingsAddress !== plan.settingsAddress) {
        throw fail('this is not the ESC that was read. Read the ESCs again.')
      }
      const read = async () => (await fourWay.request(FOURWAY_CMD.DEVICE_READ, [block.length], plan.settingsAddress)).params
      const current = await read()
      if (sameBytes(current, block)) return withBlock(esc, current)
      if (!sameBytes(current, esc.block)) throw fail('its settings changed since they were read. Read the ESCs again.')

      // SiLabs flash only takes a write after an erase; the AM32 bootloader erases the page by itself.
      if (plan.erasePage !== null) await fourWay.request(FOURWAY_CMD.DEVICE_PAGE_ERASE, [plan.erasePage])
      await fourWay.request(FOURWAY_CMD.DEVICE_WRITE, block, plan.settingsAddress)
      const readBack = await read()
      if (!sameBytes(readBack, block)) throw fail('the settings it reads back are not the ones that were written. Read the ESCs again and check them.')
      return withBlock(esc, readBack)
    } finally {
      await fourWay.request(FOURWAY_CMD.DEVICE_RESET, [index]).catch(ignoreAckError)
    }
  } catch (cause) {
    if (!(cause instanceof FourWayAckError)) throw cause
    throw fail('no answer, or it refused the settings. Check the battery, then read the ESCs again.')
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
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
async function readEsc(fourWay: FourWayClient, index: number, sleep: Sleep): Promise<EscReport> {
  try {
    const info = decodeDeviceInfo(await connect(fourWay, index, sleep))
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

async function connect(fourWay: FourWayClient, index: number, sleep: Sleep): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await fourWay.request(FOURWAY_CMD.DEVICE_INIT_FLASH, [index])).params
    } catch (cause) {
      if (!(cause instanceof FourWayAckError) || attempt >= INIT_ATTEMPTS) throw cause
    }
    await sleep(INIT_RETRY_DELAY_MS)
  }
}

function ignoreAckError(cause: unknown): null {
  if (cause instanceof FourWayAckError) return null
  throw cause
}
