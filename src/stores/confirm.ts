import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description: string
  confirmLabel: string
  /** Styles the confirm button as destructive. */
  destructive?: boolean
}

interface ConfirmState {
  /** The dialog currently shown by <ConfirmDialogHost />, if any. */
  current: (ConfirmOptions & { resolve: (confirmed: boolean) => void }) | null
  settle: (confirmed: boolean) => void
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  current: null,
  settle: (confirmed) => {
    get().current?.resolve(confirmed)
    set({ current: null })
  },
}))

/** Asks the user to confirm something. Usable from anywhere (components, stores, plain functions). */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().settle(false) // a newer question replaces an unanswered one
    useConfirmStore.setState({ current: { ...options, resolve } })
  })
}
