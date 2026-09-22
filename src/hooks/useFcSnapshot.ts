import { useCallback, useEffect, useState } from 'react'
import type { MspClient } from '@/lib/msp/client'
import { useConnectionStore } from '@/stores/connection'

export interface FcSnapshot<T> {
  client: MspClient | null
  /** null while loading or after a failed read. */
  snapshot: T | null
  error: string | null
  /** Re-reads from the FC, e.g. after a save that doesn't reboot. */
  reload: () => void
}

/** Reads a tab's config from the FC once per connection. `read` must be a stable (module-level) function. */
export function useFcSnapshot<T>(read: (client: MspClient) => Promise<T>): FcSnapshot<T> {
  const client = useConnectionStore((s) => s.client)
  const [state, setState] = useState<{ snapshot: T | null; error: string | null }>({
    snapshot: null,
    error: null,
  })
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    read(client).then(
      (snapshot) => !cancelled && setState({ snapshot, error: null }),
      (cause: unknown) =>
        !cancelled &&
        setState({
          snapshot: null,
          error: `Could not read from the flight controller: ${describeError(cause)}`,
        }),
    )
    return () => {
      cancelled = true
    }
  }, [client, read, generation])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])
  return { client, ...state, reload }
}

export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
