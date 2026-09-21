import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { confirmDiscardChanges, useUnsavedStore } from '@/stores/unsaved'

/**
 * Call from a tab page with its route path and whether it has unsaved edits. Marks the tab in the
 * sidebar and asks before navigating away (SPEC §5 "Unsaved changes").
 */
export function useUnsavedChanges(path: string, dirty: boolean): void {
  const setDirty = useUnsavedStore((s) => s.setDirty)

  useEffect(() => {
    setDirty(path, dirty)
    return () => setDirty(path, false)
  }, [path, dirty, setDirty])

  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    void confirmDiscardChanges().then((discard) => (discard ? blocker.proceed() : blocker.reset()))
  }, [blocker])
}
