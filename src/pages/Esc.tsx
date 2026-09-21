import { useState } from 'react'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { describeError } from '@/hooks/useFcSnapshot'
import { readEscs } from '@/lib/esc/io'
import { combineReports, differingSettings, type EscOverview, type EscReport } from '@/lib/esc/model'
import type { MspClient } from '@/lib/msp/client'
import { useConnectionStore } from '@/stores/connection'

type ReadState =
  | { phase: 'reading'; index: number; count: number }
  | { phase: 'done'; reports: EscReport[] }
  | { phase: 'failed'; message: string }

/** Spec: docs/tabs/esc.md */
export function EscPage() {
  const client = useConnectionStore((s) => s.client)
  // Tagged with the connection it belongs to, so a reconnect starts from scratch.
  const [read, setRead] = useState<{ client: MspClient; state: ReadState } | null>(null)
  const state = read && read.client === client ? read.state : null
  const reading = state?.phase === 'reading'

  const start = async () => {
    if (!client) return
    const update = (next: ReadState) => setRead({ client, state: next })
    update({ phase: 'reading', index: 0, count: 0 })
    try {
      const reports = await readEscs(client, (index, count) => update({ phase: 'reading', index, count }))
      update({ phase: 'done', reports })
    } catch (cause) {
      update({ phase: 'failed', message: `Could not read the ESCs: ${describeError(cause)}` })
    }
  }

  return (
    <>
      <PageHeader title="ESC" description="Firmware and settings of the ESCs, read through the flight controller. Nothing is changed." />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 text-sm">
          <Button disabled={!client || reading} onClick={() => void start()}>
            {reading ? 'Reading…' : state ? 'Read again' : 'Read ESCs'}
          </Button>
          <p className="text-muted-foreground" aria-live="polite">
            {reading
              ? state.count > 0
                ? `Reading ESC ${state.index + 1} of ${state.count}…`
                : 'Waiting for the ESCs to start their bootloader…'
              : 'Plug in the flight battery first — the ESCs need power. Take the props off: the ESCs restart while they are being read.'}
          </p>
        </CardContent>
      </Card>

      {state?.phase === 'failed' && <Notice tone="error">{state.message}</Notice>}
      {state?.phase === 'done' && <EscReportList reports={state.reports} />}
    </>
  )
}

export function EscReportList({ reports }: { reports: EscReport[] }) {
  if (reports.length === 0) {
    return <Notice tone="warning">The flight controller has no ESC outputs to read. Check the motor protocol on the Motors tab.</Notice>
  }
  const overview = combineReports(reports)
  if (overview.view === 'combined') return <CombinedEscCard overview={overview} />

  const differing = differingSettings(reports)
  return (
    <>
      {reports.every((report) => report.status === 'missing') && (
        <Notice tone="warning">No ESC answered. Plug in the flight battery, then read again.</Notice>
      )}
      {overview.reason && <Notice tone="warning">{overview.reason}</Notice>}
      <div className="mt-4 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((report, index) => (
          <EscCard key={index} number={index + 1} report={report} differing={differing[index] ?? new Set()} />
        ))}
      </div>
    </>
  )
}

/** All ESCs are alike: their settings once, and what is set per motor listed by ESC. */
function CombinedEscCard({ overview }: { overview: Extract<EscOverview, { view: 'combined' }> }) {
  return (
    <Card role="group" aria-label="All ESCs" className="mt-4 max-w-xl">
      <CardHeader>
        <CardDescription>All {overview.count} ESCs — same firmware, same settings</CardDescription>
        <CardTitle>
          {overview.firmware} {overview.version}
        </CardTitle>
        <CardDescription>{overview.hardware}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {overview.note && <p className="text-muted-foreground">{overview.note}</p>}
        <dl className="divide-y">
          {overview.settings.map((setting) => (
            <div key={setting.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">{setting.label}</dt>
              <dd className="text-right font-medium">
                {setting.values.length === 1 ? (
                  setting.values[0]
                ) : (
                  <ul>
                    {setting.values.map((value, index) => (
                      <li key={index}>
                        <span className="text-muted-foreground font-normal">ESC {index + 1}</span> {value}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function EscCard({ number, report, differing }: { number: number; report: EscReport; differing: Set<string> }) {
  return (
    <Card role="group" aria-label={`ESC ${number}`}>
      <CardHeader>
        <CardDescription>ESC {number}</CardDescription>
        <CardTitle>
          {report.status === 'ok' ? `${report.firmware} ${report.version}` : report.status === 'missing' ? 'Not responding' : 'Unknown firmware'}
        </CardTitle>
        <CardDescription>{report.status === 'ok' ? report.hardware : report.description}</CardDescription>
      </CardHeader>
      {report.status === 'ok' && (
        <CardContent className="text-sm">
          {report.note && <p className="text-muted-foreground">{report.note}</p>}
          <dl className="divide-y">
            {report.settings.map((setting) => (
              <div key={setting.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <dt className="text-muted-foreground">{setting.label}</dt>
                <dd className="flex items-baseline gap-2 text-right font-medium">
                  {setting.value}
                  {differing.has(setting.key) && (
                    <Badge className="py-0" title="Not the same as on the first ESC with this firmware">
                      differs
                    </Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  )
}
