import { create } from 'zustand'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { readFcInfo, sendReboot, sendRebootToMassStorage, type FcInfo } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import type { Transport } from '@/lib/transport/types'
import { WebSerialTransport } from '@/lib/transport/webserial'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'rebooting'
export type ConnectionKind = 'serial' | 'mock'

interface ConnectionState {
  status: ConnectionStatus
  /** Message from the last failed connection attempt, cleared on the next attempt. */
  error: string | null
  /** Non-error information for the welcome screen, e.g. why the FC was disconnected on purpose. */
  notice: string | null
  /** Non-null exactly while `status === 'connected'`. */
  client: MspClient | null
  fcInfo: FcInfo | null
  transportLabel: string | null
  connect: (kind: ConnectionKind) => Promise<void>
  disconnect: () => Promise<void>
  /** Reboots the FC and reconnects to it without user interaction (SPEC §5 "Reboot"). */
  reboot: () => Promise<void>
  /** Restarts the FC as a USB drive and disconnects. Rejects (staying connected) if storage isn't ready. */
  rebootToMassStorage: () => Promise<void>
}

const DISCONNECTED = {
  status: 'disconnected',
  client: null,
  fcInfo: null,
  transportLabel: null,
} as const

const REBOOT_TIMEOUT_MS = 10_000
const REBOOT_RETRY_MS = 250

/** How to get back to the same FC after it rebooted. Resolves null while it isn't back yet. */
type Reopen = () => Promise<Transport | null>

// Kept outside the store: nothing in the UI needs the raw transport.
let active: { transport: Transport; reopen: Reopen } | null = null

interface OpenedTransport {
  transport: Transport
  reopen: Reopen
  /** Called once the FC answered. */
  onConnected?: () => void
  /** Called when opening or identifying the FC failed; returns a hint to append to the error message. */
  onFailed?: () => string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openTransport(kind: ConnectionKind): Promise<OpenedTransport> {
  if (kind === 'mock') {
    const fc = new MockFlightController()
    return { transport: new MockTransport(fc), reopen: async () => new MockTransport(fc) }
  }
  // SPEC §5 "Connect": straight to the last used FC when it's there, the browser's picker otherwise.
  const lastUsed = await WebSerialTransport.findLastUsed()
  const transport = lastUsed ?? (await WebSerialTransport.request())
  return {
    transport,
    reopen: () => WebSerialTransport.findGranted(transport),
    onConnected: () => transport.rememberAsLastUsed(),
    onFailed: () => {
      if (!lastUsed) return ''
      // Don't get stuck on a device that doesn't answer: the next attempt shows the picker again.
      WebSerialTransport.forgetLastUsed()
      return ' (tried the last used flight controller — press Connect again to choose a port)'
    },
  }
}

export const useConnectionStore = create<ConnectionState>()((set, get) => {
  /** Opens + identifies the FC and makes it the active connection. Closes the transport on failure. */
  async function attach(transport: Transport, reopen: Reopen): Promise<void> {
    try {
      await transport.open()
      const client = new MspClient(transport)
      const fcInfo = await readFcInfo(client)

      active = { transport, reopen }
      transport.onClose(() => {
        if (active?.transport !== transport) return
        active = null
        set({ ...DISCONNECTED })
      })
      set({ status: 'connected', client, fcInfo, transportLabel: transport.label })
    } catch (error) {
      await transport.close().catch(() => {})
      throw error
    }
  }

  return {
    ...DISCONNECTED,
    error: null,
    notice: null,

    connect: async (kind) => {
      if (get().status !== 'disconnected') return
      set({ status: 'connecting', error: null, notice: null })
      let opened: OpenedTransport | null = null
      try {
        opened = await openTransport(kind)
        await attach(opened.transport, opened.reopen)
        opened.onConnected?.()
      } catch (error) {
        const hint = opened?.onFailed?.() ?? ''
        set({ ...DISCONNECTED, error: isPickerCancelled(error) ? null : describeError(error) + hint })
      }
    },

    disconnect: async () => {
      // State is reset by the transport's onClose handler.
      await active?.transport.close()
    },

    reboot: async () => {
      const { client, status } = get()
      if (status !== 'connected' || !client || !active) return
      const { transport, reopen } = active

      // Detach first so the expected connection drop isn't treated as a disconnect.
      active = null
      set({ status: 'rebooting', client: null, error: null })
      await sendReboot(client).catch(() => {}) // the FC may reset before it gets to answer
      await transport.close().catch(() => {})

      const deadline = Date.now() + REBOOT_TIMEOUT_MS
      while (Date.now() < deadline) {
        await sleep(REBOOT_RETRY_MS)
        try {
          const next = await reopen()
          if (!next) continue
          await attach(next, reopen)
          return
        } catch {
          // Still booting (port busy, no MSP answer yet): try again.
        }
      }
      set({ ...DISCONNECTED, error: 'The flight controller did not come back after rebooting.' })
    },

    rebootToMassStorage: async () => {
      const { client, status } = get()
      if (status !== 'connected' || !client || !active) return
      const { transport } = active
      await sendRebootToMassStorage(client)
      active = null
      await transport.close().catch(() => {})
      set({
        ...DISCONNECTED,
        notice:
          'The flight controller restarted as a USB drive — copy your logs from it, then unplug and replug it to connect again.',
      })
    },
  }
})

/** The user dismissing the browser's port picker is not an error worth showing. */
function isPickerCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
