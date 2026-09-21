import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { Emitter, type Transport, type Unsubscribe } from './types'

/** In-memory transport wired to a simulated flight controller. Works in any browser and in tests. */
export class MockTransport implements Transport {
  readonly label = 'Mock FC'

  private readonly fc: MockFlightController
  private readonly latencyMs: number
  private readonly data = new Emitter<Uint8Array>()
  private readonly closed = new Emitter<void>()
  private isOpen = false

  constructor(fc: MockFlightController = new MockFlightController(), latencyMs = 2) {
    this.fc = fc
    this.latencyMs = latencyMs
  }

  async open(): Promise<void> {
    this.isOpen = true
    // A rebooting FC drops off the bus, just like USB re-enumeration on real hardware.
    this.fc.onReboot = () => void this.close()
  }

  async close(): Promise<void> {
    if (!this.isOpen) return
    this.isOpen = false
    this.fc.onReboot = null
    this.closed.emit()
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new Error('Transport is not open')
    for (const response of this.fc.receive(data)) {
      setTimeout(() => {
        if (this.isOpen) this.data.emit(response)
      }, this.latencyMs)
    }
  }

  onData(listener: (chunk: Uint8Array) => void): Unsubscribe {
    return this.data.on(listener)
  }

  onClose(listener: () => void): Unsubscribe {
    return this.closed.on(listener)
  }
}
