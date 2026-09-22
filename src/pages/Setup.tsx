import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { DiffArrow, DiffValue } from '@/components/DiffValue'
import { Notice } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatApiVersion, formatFirmware } from '@/lib/format'
import { readStatus } from '@/lib/msp/api'
import { readSetupSnapshot, saveSetup } from '@/lib/setup/io'
import {
  applyFix,
  externalChanges,
  formatLoopRate,
  pidLoopOptions,
  preflightChecks,
  readSetup,
  withAllResets,
  withReset,
  type ExternalChange,
  type PreflightCheck,
  type SetupSnapshot,
} from '@/lib/setup/model'
import { cn } from '@/lib/utils'
import { useConnectionStore } from '@/stores/connection'

const PATH = '/setup'

const SENSOR_NAMES = ['Accelerometer', 'Barometer', 'Magnetometer', 'GPS', 'Rangefinder', 'Gyro']

// The live readouts don't depend on the snapshot, so the draft starts out empty instead of the page waiting for it.
const toDraft = (snapshot: SetupSnapshot | null) => snapshot && readSetup(snapshot)

/** Spec: docs/tabs/setup.md */
export function SetupPage() {
  const fcInfo = useConnectionStore((s) => s.fcInfo)
  const status = useMspPoll(readStatus, 500)
  const { client, snapshot, error: readError, reload } = useFcSnapshot(readSetupSnapshot)
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error: saveError, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  if (!fcInfo) return null

  const loopOptions = snapshot ? pidLoopOptions(fcInfo.board.gyroSampleRateHz, readSetup(snapshot).pidDenom) : []
  const checks = snapshot && draft ? preflightChecks(snapshot, draft) : null
  const external = snapshot && draft ? externalChanges(snapshot, draft) : null
  const sensors = status ? SENSOR_NAMES.filter((_, bit) => status.sensors & (1 << bit)) : []

  return (
    <>
      <PageHeader
        title="Setup"
        description="Flight controller identity, system status, pre-flight checklist and what was changed outside this app."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Flight controller</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows>
              <Row label="Firmware" value={formatFirmware(fcInfo)} />
              <Row label="MSP API" value={formatApiVersion(fcInfo)} />
              <Row label="Board" value={fcInfo.board.boardName || fcInfo.board.identifier} />
              <Row label="Target" value={fcInfo.board.targetName || '—'} />
              <Row label="Manufacturer" value={fcInfo.board.manufacturerId || '—'} />
            </Rows>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows>
              <Row
                label="PID loop frequency"
                value={
                  draft && loopOptions.length > 0 ? (
                    <div role="group" aria-label="PID loop frequency" className="inline-flex font-sans">
                      {loopOptions.map(({ denom, hz }) => (
                        <Button
                          key={denom}
                          size="sm"
                          variant={draft.pidDenom === denom ? 'default' : 'outline'}
                          aria-pressed={draft.pidDenom === denom}
                          className="rounded-none first:rounded-l-md last:rounded-r-md not-first:-ml-px"
                          onClick={() => setDraft({ ...draft, pidDenom: denom })}
                        >
                          {formatLoopRate(hz)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )
                }
              />
              <Row label="Cycle time" value={status ? `${status.cycleTimeUs} µs` : '—'} />
              <Row label="CPU load" value={status ? `${status.cpuLoad} %` : '—'} />
              <Row label="PID profile" value={status ? String(status.pidProfile + 1) : '—'} />
              <Row label="Sensors" value={status ? sensors.join(', ') || 'None' : '—'} />
            </Rows>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pre-flight checklist</CardTitle>
          </CardHeader>
          <CardContent>
            {checks && draft ? (
              <>
                <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
                  {checklistSummary(checks)}
                </p>
                <ul aria-label="Pre-flight checklist" className="divide-y text-sm">
                  {checks.map((check) => (
                    <CheckRow key={check.id} check={check} onFix={() => setDraft(applyFix(draft, check.id))} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{readError ? '—' : 'Reading…'}</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <CardTitle>Changed outside this app</CardTitle>
              <CardDescription>
                Settings that are not at their Betaflight default and that no tab of this app manages — changed in Betaflight Configurator
                or the CLI. Reset puts the default back.
              </CardDescription>
            </div>
            {external && snapshot && draft && external.some((change) => change.key !== null) && (
              <Button
                size="sm"
                variant="outline"
                disabled={external.every((change) => change.key === null || change.reset)}
                onClick={() => setDraft(withAllResets(snapshot, draft))}
              >
                Reset all
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {external && snapshot && draft ? (
              <>
                <p className="text-muted-foreground mb-2 text-sm" aria-live="polite">
                  {externalSummary(snapshot, external)}
                </p>
                {external.length > 0 && (
                  <ul aria-label="Changed outside this app" className="divide-y text-sm">
                    {external.map((change) => (
                      <ExternalRow
                        key={`${change.section}: ${change.label}`}
                        change={change}
                        onReset={(reset) => change.key !== null && setDraft(withReset(draft, change.key, reset))}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">{readError ? '—' : 'Reading…'}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {(readError ?? saveError) && <Notice tone="error">{readError ?? saveError}</Notice>}
      {client && snapshot && draft && (
        <SaveBar
          dirty={dirty}
          saving={saving}
          reboot
          onRevert={revert}
          onSave={() =>
            void save(async () => {
              await saveSetup(client, snapshot, draft)
              return true
            })
          }
        />
      )}
    </>
  )
}

function checklistSummary(checks: PreflightCheck[]): string {
  const failing = checks.filter((check) => !check.ok).length
  if (failing > 0) return `${failing} of ${checks.length} settings need attention.`
  return checks.some((check) => check.pending) ? 'All set once the fixes are saved.' : 'All set.'
}

function CheckRow({ check, onFix }: { check: PreflightCheck; onFix: () => void }) {
  const Icon = check.ok ? CircleCheck : TriangleAlert
  return (
    <li aria-label={check.label} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <Icon
        aria-hidden
        className={cn('size-4 shrink-0', !check.ok ? 'text-warning' : check.pending ? 'text-primary' : 'text-success')}
      />
      <span>{check.label}</span>
      <span className="ml-auto font-mono text-muted-foreground tabular-nums">
        {check.detail}
        {check.pending && ' · not saved yet'}
      </span>
      {check.fix === 'here' ? (
        <Button size="sm" variant="outline" onClick={onFix}>
          Fix
        </Button>
      ) : (
        check.fix && (
          <Button size="sm" variant="outline" asChild>
            <Link to={check.fix.path}>Open {check.fix.tab}</Link>
          </Button>
        )
      )}
    </li>
  )
}

function externalSummary(snapshot: SetupSnapshot, changes: ExternalChange[]): string {
  if (snapshot.externalError) return `Could not read the flight controller's diff: ${snapshot.externalError}`
  if (changes.length === 0) return 'Nothing was changed outside this app.'
  const count = changes.length === 1 ? '1 change' : `${changes.length} changes`
  const resets = changes.filter((change) => change.reset).length
  return `${count} made outside this app.${resets > 0 ? ` ${resets} to reset once saved.` : ''}`
}

/**
 * `crashflip_motor_percent  0 → 50 [Reset]`, coloured like the Diff Checker: the default is what it was, the FC's
 * value what it is. Marked for reset the sides swap — the value is what it was, the default what it will be.
 */
function ExternalRow({ change, onReset }: { change: ExternalChange; onReset: (reset: boolean) => void }) {
  return (
    <li aria-label={change.label} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      {change.section !== change.name && <span className="text-muted-foreground font-mono text-xs">{change.section}</span>}
      <code className="break-all">{change.name}</code>
      {change.value !== null && (
        <code className="ml-auto break-all">
          {change.reset ? (
            <>
              <DiffValue side="before">{change.value}</DiffValue>
              <DiffArrow />
              <DiffValue side="after">{change.defaultValue}</DiffValue>
              <span className="text-muted-foreground"> · not saved yet</span>
            </>
          ) : (
            <>
              {change.defaultValue !== null && (
                <>
                  <DiffValue side="before">{change.defaultValue}</DiffValue>
                  <DiffArrow />
                </>
              )}
              <DiffValue side="after">{change.value}</DiffValue>
            </>
          )}
        </code>
      )}
      {change.key !== null ? (
        <Button size="sm" variant="outline" className={change.value === null ? 'ml-auto' : ''} onClick={() => onReset(!change.reset)}>
          {change.reset ? 'Keep' : 'Reset'}
        </Button>
      ) : (
        <span className="text-muted-foreground ml-auto text-xs">Only in Betaflight Configurator</span>
      )}
    </li>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">{children}</dl>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="self-center text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
  )
}
