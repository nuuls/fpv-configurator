import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AttitudeIndicator } from '@/components/AttitudeIndicator'
import { Notice } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDraft } from '@/hooks/useDraft'
import { useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useMspPoll } from '@/hooks/useMspPoll'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatApiVersion, formatFirmware } from '@/lib/format'
import { readAnalog, readAttitude, readStatus } from '@/lib/msp/api'
import { readSetupSnapshot, saveSetup } from '@/lib/setup/io'
import {
  applyFix,
  formatLoopRate,
  pidLoopOptions,
  preflightChecks,
  readSetup,
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
  const attitude = useMspPoll(readAttitude, 50)
  const analog = useMspPoll(readAnalog, 250)
  const status = useMspPoll(readStatus, 500)
  const { client, snapshot, error: readError, reload } = useFcSnapshot(readSetupSnapshot)
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error: saveError, save } = useSave(reload)
  useUnsavedChanges(PATH, dirty)

  if (!fcInfo) return null

  const loopOptions = snapshot ? pidLoopOptions(fcInfo.board.gyroSampleRateHz, readSetup(snapshot).pidDenom) : []
  const checks = snapshot && draft ? preflightChecks(snapshot, draft) : null
  const sensors = status ? SENSOR_NAMES.filter((_, bit) => status.sensors & (1 << bit)) : []

  return (
    <>
      <PageHeader title="Setup" description="Flight controller identity and live telemetry." />

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
            <CardTitle>Attitude</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <AttitudeIndicator roll={attitude?.roll ?? 0} pitch={attitude?.pitch ?? 0} />
            <Rows>
              <Row label="Roll" value={attitude ? `${attitude.roll.toFixed(1)}°` : '—'} />
              <Row label="Pitch" value={attitude ? `${attitude.pitch.toFixed(1)}°` : '—'} />
              <Row label="Heading" value={attitude ? `${attitude.yaw}°` : '—'} />
            </Rows>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Battery</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows>
              <Row label="Voltage" value={analog ? `${analog.voltage.toFixed(2)} V` : '—'} />
              <Row label="Current" value={analog ? `${analog.amperage.toFixed(2)} A` : '—'} />
              <Row label="Consumed" value={analog ? `${analog.mAhDrawn} mAh` : '—'} />
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
