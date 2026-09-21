import { useEffect, useState } from 'react'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { describeError } from '@/hooks/useFcSnapshot'
import { readDiff } from '@/lib/diff/io'
import { countDifferences, tuningOnly, type DiffEntry, type DiffReport, type DiffSection } from '@/lib/diff/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'
import { useConnectionStore } from '@/stores/connection'

type ReadState = { phase: 'reading' } | { phase: 'done'; report: DiffReport } | { phase: 'failed'; message: string }

/** Spec: docs/tabs/diff.md */
export function DiffPage() {
  const client = useConnectionStore((s) => s.client)
  const [generation, setGeneration] = useState(0)
  // Tagged with the read it belongs to, so a reconnect or "Read again" starts from scratch.
  const [result, setResult] = useState<{ client: MspClient; generation: number; state: ReadState } | null>(null)
  const state: ReadState = result && result.client === client && result.generation === generation ? result.state : { phase: 'reading' }

  useEffect(() => {
    if (!client) return
    let cancelled = false
    const finish = (next: ReadState) => !cancelled && setResult({ client, generation, state: next })
    readDiff(client).then(
      (report) => finish({ phase: 'done', report }),
      (cause: unknown) => finish({ phase: 'failed', message: `Could not read the diff: ${describeError(cause)}` }),
    )
    return () => {
      cancelled = true
    }
  }, [client, generation])

  return (
    <>
      <PageHeader
        title="Diff Checker"
        description="Every tuning setting — PIDs, rates, filters — that is not at its Betaflight default, as the flight controller itself reports it. Nothing is changed."
      />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 text-sm">
          <Button disabled={!client || state.phase === 'reading'} onClick={() => setGeneration((g) => g + 1)}>
            {state.phase === 'reading' ? 'Reading…' : 'Read again'}
          </Button>
          {state.phase === 'done' && <CopyButton text={state.report.text} />}
          <p className="text-muted-foreground" aria-live="polite">
            {state.phase === 'reading' && 'Asking the flight controller for its diff…'}
            {state.phase === 'done' && summary(state.report)}
          </p>
        </CardContent>
      </Card>

      {state.phase === 'failed' && <Notice tone="error">{state.message}</Notice>}
      {state.phase === 'done' && <DiffReportView report={tuningOnly(state.report)} />}
    </>
  )
}

function summary(report: DiffReport): string {
  const count = countDifferences(tuningOnly(report))
  const hidden = countDifferences(report) - count
  const differences = count === 1 ? '1 tuning difference' : `${count} tuning differences`
  return [differences, hidden > 0 && `${hidden} other hidden`, report.board, report.firmware].filter(Boolean).join(' · ')
}

function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }
  return (
    <Button variant="outline" onClick={() => void copy()}>
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copying failed' : 'Copy full diff'}
    </Button>
  )
}

/** The two sides of a difference, coloured as `git diff` does: what it was (the default) and what it is now. */
const SIDES = {
  default: { marker: '-', label: 'default', line: 'bg-destructive/10', gutter: 'text-destructive', value: 'bg-destructive/25' },
  current: { marker: '+', label: 'current', line: 'bg-success/10', gutter: 'text-success', value: 'bg-success/25' },
} as const

function DiffReportView({ report }: { report: DiffReport }) {
  return (
    <>
      {report.errors.map((error, index) => (
        <Notice key={index} tone="error">
          The flight controller reported: {error}
        </Notice>
      ))}
      {report.sections.length === 0 && report.errors.length === 0 && (
        <Notice>No tuning differences — PIDs, rates and filters are at their defaults.</Notice>
      )}
      {report.sections.length > 0 && (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>
            <span className={cn('mr-1.5 rounded-sm px-1.5', SIDES.default.value, SIDES.default.gutter)}>-</span>Betaflight default
          </span>
          <span>
            <span className={cn('mr-1.5 rounded-sm px-1.5', SIDES.current.value, SIDES.current.gutter)}>+</span>this flight controller
          </span>
        </p>
      )}
      <div className="mt-2 grid gap-4">
        {report.sections.map((section, index) => (
          <SectionDiff key={index} section={section} />
        ))}
      </div>
    </>
  )
}

/** A section reads like a file in `git diff`: its CLI heading, then a `-` default and a `+` current line per difference. */
function SectionDiff({ section }: { section: DiffSection }) {
  const count = section.entries.filter((entry) => entry.kind === 'setting' || !entry.isDefault).length
  return (
    <section role="group" aria-label={section.title} className="overflow-hidden rounded-lg border bg-card font-mono text-sm">
      <header className="flex items-baseline justify-between gap-4 border-b bg-muted/50 px-3 py-2">
        <h2 className="font-medium">{section.title}</h2>
        <span className="font-sans text-xs text-muted-foreground">{count === 1 ? '1 difference' : `${count} differences`}</span>
      </header>
      <ul>
        {section.entries.map((entry, index) => (
          <EntryLines key={index} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

function EntryLines({ entry }: { entry: DiffEntry }) {
  if (entry.kind === 'setting') {
    const command = `set ${entry.name} = `
    return (
      <>
        {entry.defaultValue !== null && <DiffLine side="default" command={command} value={entry.defaultValue} />}
        <DiffLine side="current" command={command} value={entry.value} />
      </>
    )
  }
  // Commands other than `set` (feature, serial, aux, …) stay the lines the CLI printed.
  return <DiffLine side={entry.isDefault ? 'default' : 'current'} command={entry.line} />
}

/** `value` is what differs between the two lines of a setting; it gets the stronger highlight. */
function DiffLine({ side, command, value }: { side: keyof typeof SIDES; command: string; value?: string }) {
  const style = SIDES[side]
  return (
    <li className={cn('flex px-3 py-0.5', style.line)}>
      <span aria-hidden className={cn('w-5 shrink-0 select-none', style.gutter)}>
        {style.marker}
      </span>
      <span className="sr-only">{style.label}: </span>
      <code className="min-w-0 break-all whitespace-pre-wrap">
        {command}
        {value !== undefined && <span className={cn('rounded-sm px-0.5', style.value)}>{value}</span>}
      </code>
    </li>
  )
}
