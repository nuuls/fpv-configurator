import { useState } from 'react'

export interface Draft<D> {
  draft: D
  setDraft: (next: D) => void
  dirty: boolean
  revert: () => void
}

/**
 * Local, editable copy of what was read from the FC (SPEC §5 "Saving"). Resets whenever a new
 * snapshot arrives. `toDraft` must be pure; drafts are compared structurally (JSON).
 */
export function useDraft<S, D>(snapshot: S, toDraft: (snapshot: S) => D): Draft<D> {
  const [state, setState] = useState(() => ({ snapshot, draft: toDraft(snapshot) }))

  // Derived-state reset during render: a new snapshot discards the old draft.
  let current = state
  if (state.snapshot !== snapshot) {
    current = { snapshot, draft: toDraft(snapshot) }
    setState(current)
  }

  const original = toDraft(snapshot)
  return {
    draft: current.draft,
    setDraft: (draft) => setState({ snapshot, draft }),
    dirty: JSON.stringify(original) !== JSON.stringify(current.draft),
    revert: () => setState({ snapshot, draft: original }),
  }
}
