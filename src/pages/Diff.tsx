import { useEffect, useState } from 'react'
import { DiffArrow as Arrow, DiffValue } from '@/components/DiffValue'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/hooks/useFcSnapshot'
import { readDiff } from '@/lib/diff/io'
import { countDifferences, tuningOnly, type DiffEntry, type DiffReport, type DiffSection } from '@/lib/diff/model'
import type { MspClient } from '@/lib/msp/client'
import { useConnectionStore } from '@/stores/connection'

type ReadState = { phase: 'reading' } | { phase: 'done'; report: DiffReport } | { phase: 'failed'; message: string }

/** Spec: docs/tabs/diff.md */
export function DiffPage() {
  const client = useConnectionStore((s) => s.client)
  const [generation, setGeneration] = useState(0)
  // Tagged with the read it belongs to, so a reconnect or "Read again" starts from scratch.
  const [result, setResult] = useState<{ client: MspClient; generation: number; state: ReadState } | null>(null)
  const state: ReadState = result && result.client === client && result.generation === generation ? result.state : { phase: 'reading' }
  // The setup part of the diff, which the tab leaves out unless asked.
  const [showHidden, setShowHidden] = useState(false)

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
          <div className="flex items-center gap-2">
            <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
            <label htmlFor="show-hidden">Show hidden differences</label>
          </div>
          <p className="text-muted-foreground" aria-live="polite">
            {state.phase === 'reading' && 'Asking the flight controller for its diff…'}
            {state.phase === 'done' && summary(state.report, showHidden)}
          </p>
        </CardContent>
      </Card>

      {state.phase === 'failed' && <Notice tone="error">{state.message}</Notice>}
      {state.phase === 'done' && <DiffReportView report={showHidden ? state.report : tuningOnly(state.report)} all={showHidden} />}
    </>
  )
}

function summary(report: DiffReport, showHidden: boolean): string {
  const count = countDifferences(tuningOnly(report))
  const hidden = countDifferences(report) - count
  const differences = count === 1 ? '1 tuning difference' : `${count} tuning differences`
  return [differences, hidden > 0 && `${hidden} other ${showHidden ? 'shown' : 'hidden'}`, report.board, report.firmware].filter(Boolean).join(' · ')
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

/** Coloured as `git diff` does: the default is what it was, the FC's value what it is now. */
function Value({ side, children }: { side: 'default' | 'current'; children: string }) {
  return <DiffValue side={side === 'default' ? 'before' : 'after'}>{children}</DiffValue>
}

function DiffReportView({ report, all }: { report: DiffReport; all: boolean }) {
  return (
    <>
      {report.errors.map((error, index) => (
        <Notice key={index} tone="error">
          The flight controller reported: {error}
        </Notice>
      ))}
      {report.sections.length === 0 && report.errors.length === 0 && (
        <Notice>
          {all ? 'No differences — every setting is at its default.' : 'No tuning differences — PIDs, rates and filters are at their defaults.'}
        </Notice>
      )}
      {report.sections.length > 0 && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          <Value side="default">Betaflight default</Value>
          <Arrow />
          <Value side="current">this flight controller</Value>
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

/** A section reads like a file in `git diff`: its CLI heading, then one line per difference. */
function SectionDiff({ section }: { section: DiffSection }) {
  const count = section.entries.filter((entry) => entry.kind === 'setting' || !entry.isDefault).length
  return (
    <section role="group" aria-label={section.title} className="overflow-hidden rounded-lg border bg-card font-mono text-sm">
      <header className="flex items-baseline justify-between gap-4 border-b bg-muted/50 px-3 py-2">
        <h2 className="font-medium">{section.title}</h2>
        <span className="font-sans text-xs text-muted-foreground">{count === 1 ? '1 difference' : `${count} differences`}</span>
      </header>
      <ul className="py-1">
        {section.entries.map((entry, index) => (
          <li key={index} className="px-3 py-0.5 hover:bg-muted/50">
            <code className="break-all whitespace-pre-wrap">
              <EntryLine entry={entry} />
            </code>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** `set d_roll = 30 → 34`: the command as the CLI takes it, with the default in front of the value that is set. */
function EntryLine({ entry }: { entry: DiffEntry }) {
  if (entry.kind === 'setting') {
    return (
      <>
        set {entry.name} ={' '}
        {entry.defaultValue !== null && (
          <>
            <Value side="default">{entry.defaultValue}</Value>
            <Arrow />
          </>
        )}
        <Value side="current">{entry.value}</Value>
      </>
    )
  }
  // Commands other than `set` (feature, serial, aux, …) stay the lines the CLI printed.
  return <Value side={entry.isDefault ? 'default' : 'current'}>{entry.line}</Value>
}
