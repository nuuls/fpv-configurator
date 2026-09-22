import { useEffect, useState } from 'react'
import type { MspClient } from '@/lib/msp/client'
import { useConnectionStore } from '@/stores/connection'

/**
 * Polls the flight controller while connected and the component is mounted.
 * Returns the latest value, or null before the first response / while disconnected.
 *
 * `read` must be a stable function (module-level, e.g. `readAttitude` from `lib/msp/api`).
 * Polls never overlap: the next read is scheduled `intervalMs` after the previous one settles.
 */
export function useMspPoll<T>(
  read: (client: MspClient) => Promise<T>,
  intervalMs: number,
): T | null {
  const client = useConnectionStore((s) => s.client)
  const [result, setResult] = useState<{ client: MspClient; value: T } | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const value = await read(client)
        if (!cancelled) setResult({ client, value })
      } catch {
        // Timeouts and disconnects are surfaced by the connection store; keep the last value.
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs)
    }
    void tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, read, intervalMs])

  // Ignore values that belong to a previous connection.
  return result && result.client === client ? result.value : null
}
