import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TONES = {
  info: 'border bg-muted/50 text-muted-foreground',
  warning: 'border-primary/40 bg-primary/10 text-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof TONES
  children: ReactNode
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('mt-4 rounded-md border p-3 text-sm', TONES[tone])}
    >
      {children}
    </p>
  )
}

/** Standard body for a tab that is still reading (or failed to read) its config. */
export function LoadingState({ error }: { error: string | null }) {
  return error ? (
    <Notice tone="error">{error}</Notice>
  ) : (
    <p className="text-muted-foreground text-sm">Reading…</p>
  )
}
