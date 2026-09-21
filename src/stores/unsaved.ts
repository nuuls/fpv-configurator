import { create } from 'zustand'
import { confirm } from './confirm'

interface UnsavedState {
  /** Route paths of tabs with edits that haven't been saved to the FC. */
  dirtyPaths: string[]
  setDirty: (path: string, dirty: boolean) => void
}

export const useUnsavedStore = create<UnsavedState>()((set) => ({
  dirtyPaths: [],
  setDirty: (path, dirty) =>
    set((s) => {
      if (s.dirtyPaths.includes(path) === dirty) return s
      return { dirtyPaths: dirty ? [...s.dirtyPaths, path] : s.dirtyPaths.filter((p) => p !== path) }
    }),
}))

/** SPEC §5 "Unsaved changes": ask before throwing edits away. Resolves true when it's OK to go on. */
export async function confirmDiscardChanges(): Promise<boolean> {
  if (useUnsavedStore.getState().dirtyPaths.length === 0) return true
  return confirm({
    title: 'Discard changes?',
    description: "You have changes that haven't been saved to the flight controller.",
    confirmLabel: 'Discard',
    destructive: true,
  })
}
