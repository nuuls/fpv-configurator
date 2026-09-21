import { Emitter, type Transport, type Unsubscribe } from './types'

const DEFAULT_BAUD_RATE = 115200
const LAST_USED_KEY = 'fpv-configurator.lastSerialPort'

/** What Web Serial tells us about a USB device. Boards of the same type are indistinguishable. */
export interface UsbPortId {
  usbVendorId: number
  usbProductId: number
}

const isSameDevice = (info: SerialPortInfo, wanted: SerialPortInfo) =>
  info.usbVendorId === wanted.usbVendorId && info.usbProductId === wanted.usbProductId

/** The port to connect to without asking: the only one that looks like the last used device. Null if none or several do. */
export function matchLastUsed<P extends { getInfo(): SerialPortInfo }>(ports: P[], lastUsed: UsbPortId | null): P | null {
  if (!lastUsed) return null
  const matches = ports.filter((port) => isSameDevice(port.getInfo(), lastUsed))
  return matches.length === 1 ? (matches[0] ?? null) : null
}

function readLastUsed(): UsbPortId | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(LAST_USED_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return null
    const { usbVendorId, usbProductId } = stored as Record<string, unknown>
    return typeof usbVendorId === 'number' && typeof usbProductId === 'number' ? { usbVendorId, usbProductId } : null
  } catch {
    return null // storage blocked or garbage in it: just ask
  }
}

/** Transport over the Web Serial API (Chromium-based browsers only, secure context required). */
export class WebSerialTransport implements Transport {
  readonly label: string

  private readonly port: SerialPort
  private readonly baudRate: number
  private readonly data = new Emitter<Uint8Array>()
  private readonly closed = new Emitter<void>()

  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoopDone: Promise<void> = Promise.resolve()
  private state: 'new' | 'open' | 'closed' = 'new'

  constructor(port: SerialPort, baudRate: number = DEFAULT_BAUD_RATE) {
    this.port = port
    this.baudRate = baudRate
    this.label = describePort(port)
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator
  }

  /** Shows the browser's port picker. Must be called from a user gesture. Rejects with NotFoundError if cancelled. */
  static async request(baudRate?: number): Promise<WebSerialTransport> {
    if (!WebSerialTransport.isSupported()) throw new Error('Web Serial is not supported in this browser')
    const port = await navigator.serial.requestPort()
    return new WebSerialTransport(port, baudRate)
  }

  /**
   * The last used FC, if the browser still has permission for it and it is plugged in (`getPorts()` only lists
   * those) — lets Connect skip the picker. Null when there is nothing remembered or it would be a guess.
   */
  static async findLastUsed(baudRate?: number): Promise<WebSerialTransport | null> {
    if (!WebSerialTransport.isSupported()) return null
    const match = matchLastUsed(await navigator.serial.getPorts(), readLastUsed())
    return match ? new WebSerialTransport(match, baudRate) : null
  }

  static forgetLastUsed(): void {
    try {
      localStorage.removeItem(LAST_USED_KEY)
    } catch {
      // storage blocked: nothing was remembered either
    }
  }

  /** Call once the device turned out to be a flight controller. */
  rememberAsLastUsed(): void {
    const { usbVendorId, usbProductId } = this.port.getInfo()
    if (usbVendorId === undefined || usbProductId === undefined) return
    try {
      localStorage.setItem(LAST_USED_KEY, JSON.stringify({ usbVendorId, usbProductId }))
    } catch {
      // storage blocked: the picker shows again next time
    }
  }

  /**
   * After a reboot the FC re-enumerates on USB and shows up as a new SerialPort object. The
   * browser remembers the permission, so it can be found again without showing the picker.
   * Returns null while the device isn't back yet.
   */
  static async findGranted(previous: WebSerialTransport, baudRate?: number): Promise<WebSerialTransport | null> {
    const wanted = previous.port.getInfo()
    const ports = await navigator.serial.getPorts()
    const match = ports.find((port) => isSameDevice(port.getInfo(), wanted))
    return match ? new WebSerialTransport(match, baudRate) : null
  }

  async open(): Promise<void> {
    if (this.state !== 'new') throw new Error('Transport already used')
    await this.port.open({ baudRate: this.baudRate })
    this.state = 'open'
    this.writer = this.port.writable?.getWriter() ?? null
    this.port.addEventListener('disconnect', this.handleDisconnect)
    this.readLoopDone = this.readLoop()
  }

  async close(): Promise<void> {
    if (this.state !== 'open') return
    this.state = 'closed'
    this.port.removeEventListener('disconnect', this.handleDisconnect)
    try {
      await this.reader?.cancel()
      await this.readLoopDone
      this.writer?.releaseLock()
      this.writer = null
      await this.port.close()
    } catch {
      // The device may already be gone; nothing useful to do.
    } finally {
      this.closed.emit()
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.state !== 'open' || !this.writer) throw new Error('Transport is not open')
    await this.writer.write(data)
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    return this.data.on(listener)
  }

  onClose(listener: () => void): Unsubscribe {
    return this.closed.on(listener)
  }

  private readonly handleDisconnect = (): void => {
    void this.close()
  }

  private async readLoop(): Promise<void> {
    // The outer loop recovers from non-fatal read errors (framing, overrun, ...): the stream
    // errors, but `port.readable` is replaced with a fresh one.
    while (this.state === 'open' && this.port.readable) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) this.data.emit(value)
        }
      } catch {
        // Fall through to retry or exit.
      } finally {
        reader.releaseLock()
        this.reader = null
      }
    }
    // Stream ended without us asking: the device went away.
    if (this.state === 'open') void this.close()
  }
}

function describePort(port: SerialPort): string {
  const { usbVendorId, usbProductId } = port.getInfo()
  if (usbVendorId === undefined || usbProductId === undefined) return 'Serial port'
  const hex = (n: number) => n.toString(16).padStart(4, '0')
  return `USB ${hex(usbVendorId)}:${hex(usbProductId)}`
}
