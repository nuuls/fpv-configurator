import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The two sides of a difference, coloured as `git diff` does: what it was and what it is (or will be). */
const SIDES = {
  before: 'bg-destructive/25',
  after: 'bg-success/25',
} as const

/** `<del>` / `<ins>` say which side it is without the colour. */
export function DiffValue({ side, children }: { side: keyof typeof SIDES; children: ReactNode }) {
  const Tag = side === 'before' ? 'del' : 'ins'
  return <Tag className={cn('rounded-sm px-1 no-underline', SIDES[side])}>{children}</Tag>
}

export function DiffArrow() {
  return <span className="text-muted-foreground"> → </span>
}
