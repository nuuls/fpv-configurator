import { useState } from 'react'
import { describeError } from '@/hooks/useFcSnapshot'
import { useConnectionStore } from '@/stores/connection'

/**
 * Runs a tab's save action (SPEC §5 "Saving"). The action writes to the FC + EEPROM and resolves
 * true if the change needs a reboot; otherwise the tab's snapshot is reloaded. On failure the
 * error is kept for display and the user's edits stay untouched.
 */
export function useSave(reload: () => void) {
  const reboot = useConnectionStore((s) => s.reboot)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (action: () => Promise<boolean>) => {
    setSaving(true)
    setError(null)
    try {
      if (await action()) {
        await reboot() // unmounts the page; it reloads from the FC after reconnecting
        return
      }
      reload()
    } catch (cause) {
      setError(`Saving failed: ${describeError(cause)}`)
    }
    setSaving(false)
  }

  return { saving, error, save }
}
