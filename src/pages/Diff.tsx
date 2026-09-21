import { useEffect, useState } from 'react'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { describeError } from '@/hooks/useFcSnapshot'
import { readDiff } from '@/lib/diff/io'
import { countDifferences, type DiffEntry, type DiffReport, type DiffSection } from '@/lib/diff/model'
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
        description="Every setting that is not at its Betaflight default, as the flight controller itself reports it. Nothing is changed."
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
      {state.phase === 'done' && <DiffReportView report={state.report} />}
    </>
  )
}

function summary(report: DiffReport): string {
  const count = countDifferences(report)
  const differences = count === 1 ? '1 difference' : `${count} differences`
  return [differences, report.board, report.firmware].filter(Boolean).join(' · ')
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
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copying failed' : 'Copy as text'}
    </Button>
  )
}

function DiffReportView({ report }: { report: DiffReport }) {
  return (
    <>
      {report.errors.map((error, index) => (
        <Notice key={index} tone="error">
          The flight controller reported: {error}
        </Notice>
      ))}
      {report.sections.length === 0 && report.errors.length === 0 && (
        <Notice>No differences — every setting is at its default.</Notice>
      )}
      <div className="mt-4 grid gap-4">
        {report.sections.map((section, index) => (
          <SectionCard key={index} section={section} />
        ))}
      </div>
    </>
  )
}

function SectionCard({ section }: { section: DiffSection }) {
  return (
    <Card role="group" aria-label={section.title}>
      <CardHeader>
        <CardTitle className="font-mono text-base">{section.title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto text-sm">
        <table className="w-full font-mono">
          {section.entries.some((entry) => entry.kind === 'setting') && (
            <thead className="font-sans text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-4 font-normal">Setting</th>
                <th className="py-1.5 pr-4 font-normal">Current</th>
                <th className="py-1.5 font-normal">Default</th>
              </tr>
            </thead>
          )}
          <tbody className="divide-y">
            {section.entries.map((entry, index) => (
              <EntryRow key={index} entry={entry} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function EntryRow({ entry }: { entry: DiffEntry }) {
  if (entry.kind === 'setting') {
    return (
      <tr>
        <td className="py-1.5 pr-4">{entry.name}</td>
        <td className="py-1.5 pr-4 font-medium">{entry.value}</td>
        <td className="py-1.5 text-muted-foreground">{entry.defaultValue ?? '—'}</td>
      </tr>
    )
  }
  // Commands other than `set` (feature, serial, aux, …) stay the lines the CLI printed, defaults included.
  return (
    <tr className={entry.isDefault ? 'text-muted-foreground' : undefined}>
      <td colSpan={3} className="py-1.5">
        <span className={entry.isDefault ? undefined : 'font-medium'}>{entry.line}</span>
        {entry.isDefault && (
          <Badge variant="outline" className="ml-2 py-0 font-sans">
            default
          </Badge>
        )}
      </td>
    </tr>
  )
}
