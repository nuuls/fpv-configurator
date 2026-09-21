import type { ExclusiveLink, MspClient } from '@/lib/msp/client'
import { parseDiff, type DiffReport } from './model'

/**
 * Betaflight 2026.6 runs CLI commands on an MSP port without the interactive CLI (`msp_serial.c`, `cliProcess`):
 * STX on an idle port starts it and is echoed, command lines are neither echoed nor answered with a prompt, and
 * ETX — echoed as well — ends it. Unlike `#` + `exit` this neither reboots nor leaves the CLI arming flag behind.
 * The FC ignores the STX while armed.
 */
const STX = 0x02
const ETX = 0x03
/** `defaults`: print the default above every line that differs. The ETX waits in the FC's buffer until it is done. */
const COMMAND = 'diff all defaults\n'

export class CliUnavailableError extends Error {
  override name = 'CliUnavailableError'
  constructor() {
    super('The flight controller did not start its command line. It refuses to while it is armed.')
  }
}

export class CliTimeoutError extends Error {
  override name = 'CliTimeoutError'
  constructor() {
    super('The flight controller stopped answering in the middle of the diff.')
  }
}

export interface ReadDiffOptions {
  /** How long the FC gets to answer the STX. */
  enterTimeoutMs?: number
  /** The longest pause in the output before giving up. */
  idleTimeoutMs?: number
}

/**
 * Asks the FC's CLI what differs from the defaults of its firmware and board (every profile). Takes over the MSP
 * link while it runs — other requests wait — and changes nothing on the FC.
 */
export function readDiff(client: MspClient, options: ReadDiffOptions = {}): Promise<DiffReport> {
  return client.exclusive(async (link) => {
    try {
      const output = await runCommand(link, options.enterTimeoutMs ?? 1000, options.idleTimeoutMs ?? 3000)
      return parseDiff(new TextDecoder().decode(output))
    } catch (cause) {
      // Whatever went wrong, don't leave the port in CLI mode. An idle MSP port ignores the byte.
      await link.write(Uint8Array.of(ETX)).catch(() => {})
      throw cause
    }
  })
}

/** Resolves with the bytes between the FC's STX and ETX. */
function runCommand(link: ExclusiveLink, enterTimeoutMs: number, idleTimeoutMs: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const output: number[] = []
    let entered = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (error?: unknown) => {
      clearTimeout(timer)
      stopListening()
      if (error === undefined) resolve(Uint8Array.from(output))
      else reject(error instanceof Error ? error : new Error(String(error)))
    }
    const expectBytesWithin = (ms: number, error: Error) => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(error), ms)
    }

    const stopListening = link.onData((chunk) => {
      for (const byte of chunk) {
        if (!entered) {
          if (byte !== STX) continue // the tail of an MSP response
          entered = true
          const command = new TextEncoder().encode(COMMAND)
          link.write(Uint8Array.of(...command, ETX)).catch(finish)
        } else if (byte === ETX) {
          finish()
          return
        } else {
          output.push(byte)
        }
      }
      if (entered) expectBytesWithin(idleTimeoutMs, new CliTimeoutError())
    })

    expectBytesWithin(enterTimeoutMs, new CliUnavailableError())
    link.write(Uint8Array.of(STX)).catch(finish)
  })
}
