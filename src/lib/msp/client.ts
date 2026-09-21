import type { Transport, Unsubscribe } from '@/lib/transport/types'
import { encodeRequest, MspParser, type MspFrame } from './codec'

export class MspTimeoutError extends Error {
  override name = 'MspTimeoutError'
  constructor(code: number, timeoutMs: number) {
    super(`MSP ${code}: no response within ${timeoutMs} ms`)
  }
}

/** The FC answered with an error frame ('!') — usually an unsupported command. */
export class MspErrorResponse extends Error {
  override name = 'MspErrorResponse'
  constructor(code: number) {
    super(`MSP ${code}: flight controller returned an error`)
  }
}

export class MspDisconnectedError extends Error {
  override name = 'MspDisconnectedError'
  constructor() {
    super('MSP: transport closed')
  }
}

interface PendingRequest {
  code: number
  resolve: (payload: Uint8Array) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The serial link while an `exclusive` session owns it, e.g. for the ESC passthrough where the FC stops
 * speaking MSP for a while.
 */
export interface ExclusiveLink {
  /** An MSP request that skips the queue — the session already is the queue's current entry. */
  request(code: number, payload?: Uint8Array, options?: MspClientOptions): Promise<Uint8Array>
  write(data: Uint8Array): Promise<void>
  /** From now until the session ends, incoming bytes go to `listener` instead of the MSP parser. */
  onData(listener: (chunk: Uint8Array) => void): Unsubscribe
}

export interface MspClientOptions {
  /** Response timeout. Default 1000 ms; can be overridden per request (e.g. EEPROM writes are slow). */
  timeoutMs?: number
}

/**
 * Request/response MSP client over any Transport.
 *
 * Requests are serialized: one in flight at a time, in call order. That matches how flight
 * controllers process MSP and makes response matching unambiguous.
 */
export class MspClient {
  private readonly transport: Transport
  private readonly timeoutMs: number
  private readonly parser: MspParser
  private readonly unsubscribe: Unsubscribe[]

  private queue: Promise<unknown> = Promise.resolve()
  private pending: PendingRequest | null = null
  private rawListener: ((chunk: Uint8Array) => void) | null = null
  private closed = false

  constructor(transport: Transport, options: MspClientOptions = {}) {
    this.transport = transport
    this.timeoutMs = options.timeoutMs ?? 1000
    this.parser = new MspParser((frame) => this.handleFrame(frame))
    this.unsubscribe = [
      transport.onData((chunk) => (this.rawListener ? this.rawListener(chunk) : this.parser.push(chunk))),
      transport.onClose(() => this.dispose()),
    ]
  }

  /** Sends a request and resolves with the raw response payload. Decode it with `messages.ts`. */
  request(code: number, payload?: Uint8Array, options: MspClientOptions = {}): Promise<Uint8Array> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const run = this.queue.then(() => this.send(code, payload, timeoutMs))
    this.queue = run.catch(() => {})
    return run
  }

  /**
   * Runs `session` with the link to itself: it starts once the requests queued before it are done, and
   * requests made meanwhile wait until it settles. MSP parsing resumes from a clean state afterwards.
   */
  exclusive<T>(session: (link: ExclusiveLink) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.closed) throw new MspDisconnectedError()
      try {
        return await session({
          request: (code, payload, options = {}) => this.send(code, payload, options.timeoutMs ?? this.timeoutMs),
          write: (data) => this.transport.write(data),
          onData: (listener) => {
            this.rawListener = listener
            return () => {
              if (this.rawListener === listener) this.rawListener = null
            }
          },
        })
      } finally {
        this.rawListener = null
        this.parser.reset()
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  /** Stops listening and rejects outstanding requests. Does not close the transport. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const off of this.unsubscribe) off()
    this.settle()?.reject(new MspDisconnectedError())
  }

  private send(code: number, payload: Uint8Array | undefined, timeoutMs: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(new MspDisconnectedError())

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle()?.reject(new MspTimeoutError(code, timeoutMs))
        // A late response must not be mistaken for the answer to the next request's bytes.
        this.parser.reset()
      }, timeoutMs)
      this.pending = { code, resolve, reject, timer }

      this.transport.write(encodeRequest(code, payload)).catch((error: unknown) => {
        this.settle()?.reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private handleFrame(frame: MspFrame): void {
    if (frame.direction === 'request') return
    if (!this.pending || this.pending.code !== frame.code) return // stale or unsolicited

    const pending = this.settle()!
    if (frame.direction === 'error') pending.reject(new MspErrorResponse(frame.code))
    else pending.resolve(frame.payload)
  }

  /** Clears and returns the in-flight request so it can be resolved/rejected exactly once. */
  private settle(): PendingRequest | null {
    const pending = this.pending
    if (!pending) return null
    clearTimeout(pending.timer)
    this.pending = null
    return pending
  }
}
