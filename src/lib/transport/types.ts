export type Unsubscribe = () => void

/** A raw byte pipe to a flight controller. Implementations: Web Serial, mock. */
export interface Transport {
  /** Human-readable name for the UI, e.g. "USB 0483:5740" or "Mock FC". */
  readonly label: string
  open(): Promise<void>
  /** Idempotent. Always results in exactly one `onClose` notification. */
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  onData(listener: (chunk: Uint8Array) => void): Unsubscribe
  /** Fires once, whether closed by us or because the device went away. */
  onClose(listener: () => void): Unsubscribe
}

/** Minimal typed event emitter used by transports. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>()

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value)
  }
}
