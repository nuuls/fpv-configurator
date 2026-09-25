import { CircleCheck, TriangleAlert } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Notice } from '@/components/Notice'
import { NumberInput } from '@/components/NumberInput'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useDraft } from '@/hooks/useDraft'
import { describeError } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { readEscs, writeEscs } from '@/lib/esc/io'
import {
  alignGroup,
  changedEscs,
  combineReports,
  differingSettings,
  draftRaw,
  editableGroups,
  numberToRaw,
  offDefault,
  rawToNumber,
  recommendedZone,
  resetToDefaults,
  setDraftRaw,
  toEscDraft,
  unevenSettings,
  type EscControl,
  type EscDraft,
  type EscGroup,
  type EscOverview,
  type EscReport,
  type EscSetting,
  type EscSettingDef,
  type RecommendedZone,
} from '@/lib/esc/model'
import type { MspClient } from '@/lib/msp/client'
import { cn } from '@/lib/utils'
import { confirm } from '@/stores/confirm'
import { useConnectionStore } from '@/stores/connection'
import { confirmDiscardChanges } from '@/stores/unsaved'

const PATH = '/esc'

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
    if (!client || !(await confirmDiscardChanges())) return
    const update = (next: ReadState) => setRead({ client, state: next })
    update({ phase: 'reading', index: 0, count: 0 })
    try {
      const reports = await readEscs(client, (index, count) =>
        update({ phase: 'reading', index, count }),
      )
      update({ phase: 'done', reports })
    } catch (cause) {
      update({ phase: 'failed', message: `Could not read the ESCs: ${describeError(cause)}` })
    }
  }

  return (
    <>
      <PageHeader
        title="ESC"
        description="Firmware and settings of the ESCs, read and changed through the flight controller."
      />
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
      {state?.phase === 'done' && client && (
        <EscEditor
          client={client}
          reports={state.reports}
          onWritten={(reports) => setRead({ client, state: { phase: 'done', reports } })}
        />
      )}
    </>
  )
}

/** The read result with its editable settings; Save writes the changed ones to the ESCs. */
function EscEditor({
  client,
  reports,
  onWritten,
}: {
  client: MspClient
  reports: EscReport[]
  onWritten: (reports: EscReport[]) => void
}) {
  const { draft, setDraft, dirty, revert } = useDraft(reports, toEscDraft)
  // The ESCs are read back while they are written, so there is nothing to reload afterwards.
  const { saving, error, save } = useSave(() => {})
  useUnsavedChanges(PATH, dirty)

  const write = async () => {
    const escs = changedEscs(reports, draft).map((index) => index + 1)
    const confirmed = await confirm({
      title: 'Write the settings to the ESCs?',
      description: `ESC ${escs.join(', ')} will be changed and restarted. Keep the flight battery plugged in and the props off until it is done.`,
      confirmLabel: 'Write settings',
    })
    if (!confirmed) return
    await save(async () => {
      onWritten(await writeEscs(client, reports, draft))
      return false
    })
  }

  return (
    <>
      <EscReportList reports={reports} draft={draft} onChange={setDraft} />
      {error && <Notice tone="error">{error}</Notice>}
      {draft.some((block) => block !== null) && (
        <SaveBar
          dirty={dirty}
          saving={saving}
          reboot={false}
          onRevert={revert}
          onSave={() => void write()}
        />
      )}
    </>
  )
}

interface EscReportListProps {
  reports: EscReport[]
  /** The settings as edited; without one the ESCs are shown as they were read. */
  draft?: EscDraft
  onChange?: (draft: EscDraft) => void
}

export function EscReportList({
  reports,
  draft = toEscDraft(reports),
  onChange = () => {},
}: EscReportListProps) {
  if (reports.length === 0) {
    return (
      <Notice tone="warning">
        The flight controller has no ESC outputs to read. Check the motor protocol on the Motors
        tab.
      </Notice>
    )
  }
  const groups = editableGroups(reports)
  const overview = combineReports(reports)
  if (overview.view === 'combined')
    return (
      <CombinedEscCard overview={overview} group={groups[0]} draft={draft} onChange={onChange} />
    )

  const differing = differingSettings(reports)
  const unsupported = new Set(
    reports.flatMap((report) => (report.status === 'unsupported' ? [report.description] : [])),
  )
  return (
    <>
      {reports.every((report) => report.status === 'missing') && (
        <Notice tone="warning">
          No ESC answered. Plug in the flight battery, then read again.
        </Notice>
      )}
      {[...unsupported].map((description) => (
        <Notice key={description} tone="error">
          <WithLinks text={description} />
        </Notice>
      ))}
      {overview.reason && <Notice tone="warning">{overview.reason}</Notice>}
      {groups.map((group) => (
        <UnevenNotice key={group.firmware} group={group} draft={draft} onChange={onChange} />
      ))}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        {reports.map((report, index) => {
          const group = groups.find((other) => other.escs.includes(index))
          return (
            <EscCard
              key={index}
              number={index + 1}
              report={report}
              differing={differing[index] ?? new Set()}
              group={group && { ...group, escs: [index] }}
              compareWith={group?.escs[0]}
              draft={draft}
              onChange={onChange}
            />
          )
        })}
      </div>
    </>
  )
}

/** ESCs of one firmware that differ in a setting this app changes: which, and a button that levels them. */
function UnevenNotice({ group, draft, onChange }: GroupEditorProps) {
  const uneven = unevenSettings(draft, group)
  const first = group.escs[0] ?? 0
  if (uneven.length === 0) return null
  return (
    <Notice tone="warning">
      Not the same on the {group.firmware} ESCs ({group.escs.map((esc) => esc + 1).join(', ')}):{' '}
      {uneven.join(', ')}.{' '}
      <Button
        size="sm"
        variant="outline"
        className="ml-1"
        onClick={() => onChange(alignGroup(draft, group))}
      >
        Use ESC {first + 1}&apos;s for all
      </Button>
    </Notice>
  )
}

/** All ESCs are alike: their settings once. */
interface CombinedEscCardProps {
  overview: Extract<EscOverview, { view: 'combined' }>
  /** The ESCs' editable settings, if this firmware has any. */
  group: EscGroup | undefined
  draft: EscDraft
  onChange: (draft: EscDraft) => void
}

function CombinedEscCard({ overview, group, draft, onChange }: CombinedEscCardProps) {
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
        <EscSettings
          settings={overview.settings}
          group={group}
          differing={new Set()}
          draft={draft}
          onChange={onChange}
        />
      </CardContent>
    </Card>
  )
}

interface EscCardProps {
  number: number
  report: EscReport
  /** Keys of the settings (as read) that are not what the first ESC with this firmware has. */
  differing: Set<string>
  /** This ESC's editable settings, if its firmware has any: edited at the top of the card. */
  group: EscGroup | undefined
  /** The first ESC with the same firmware: an edited value that isn't the same as there is marked. */
  compareWith: number | undefined
  draft: EscDraft
  onChange: (draft: EscDraft) => void
}

function EscCard({ number, report, differing, group, compareWith, draft, onChange }: EscCardProps) {
  return (
    <Card role="group" aria-label={`ESC ${number}`}>
      <CardHeader>
        <CardDescription>ESC {number}</CardDescription>
        <CardTitle>
          {report.status === 'ok' || report.status === 'unsupported'
            ? `${report.firmware} ${report.version}`
            : report.status === 'missing'
              ? 'Not responding'
              : 'Unknown firmware'}
        </CardTitle>
        <CardDescription>
          {report.status === 'ok' || report.status === 'unsupported'
            ? report.hardware
            : report.description}
        </CardDescription>
      </CardHeader>
      {report.status === 'unsupported' && (
        <CardContent className="text-destructive text-sm">Version not supported</CardContent>
      )}
      {report.status === 'ok' && (
        <CardContent className="text-sm">
          {report.note && <p className="text-muted-foreground">{report.note}</p>}
          <EscSettings
            settings={report.settings}
            group={group}
            compareWith={compareWith}
            differing={differing}
            draft={draft}
            onChange={onChange}
          />
        </CardContent>
      )}
    </Card>
  )
}

interface EscSettingsProps {
  settings: EscSetting[]
  group: EscGroup | undefined
  compareWith?: number | undefined
  differing: Set<string>
  draft: EscDraft
  onChange: (draft: EscDraft) => void
}

/**
 * What a card lists. ESCs that can be changed: the settings to change, the ones that are not on the firmware's
 * default, and what else needs fixing. Otherwise every setting, as read.
 */
function EscSettings({
  settings,
  group,
  compareWith,
  differing,
  draft,
  onChange,
}: EscSettingsProps) {
  const listed = group
    ? settings.filter(
        (setting) => setting.warning && !group.settings.some((def) => def.key === setting.key),
      )
    : settings
  return (
    <>
      {group && (
        <div className="mt-3">
          <GroupEditor group={group} draft={draft} onChange={onChange} compareWith={compareWith} />
        </div>
      )}
      {group && <OffDefaultNotice group={group} draft={draft} onChange={onChange} />}
      {listed.length > 0 && (
        <dl className={cn('divide-y', group && 'mt-4')}>
          {listed.map((setting) => (
            <div
              key={setting.key}
              className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"
            >
              <dt className="text-muted-foreground">{setting.label}</dt>
              <dd className="flex items-baseline gap-2 text-right font-medium">
                {setting.value}
                {differing.has(setting.key) && (
                  <Badge
                    className="py-0"
                    title="Not the same as on the first ESC with this firmware"
                  >
                    differs
                  </Badge>
                )}
              </dd>
              <SettingWarning warning={setting.warning} />
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

/** The settings this app doesn't change that are not on the firmware's default, each with a way back to it. */
function OffDefaultNotice({ group, draft, onChange }: GroupEditorProps) {
  const first = group.escs[0] ?? 0
  const off = offDefault(draft, first, group)
  if (off.length === 0) return null
  const reset = (defs: EscSettingDef[]) => onChange(resetToDefaults(draft, group.escs, defs))
  const shown = (def: EscSettingDef, raw: number) => def.format(raw) ?? String(raw)
  return (
    <div
      role="group"
      aria-label="Not on the default"
      className="border-primary/40 bg-primary/10 mt-4 rounded-md border p-3"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="text-warning size-4 shrink-0" />
        Not on the {group.firmware} default
      </p>
      <p className="text-muted-foreground mt-1">
        This app doesn&apos;t change these settings. Reset them unless they were set on purpose.
      </p>
      <ul className="mt-2 divide-y">
        {off.map((def) => (
          <li key={def.key} className="flex items-center justify-between gap-3 py-1.5">
            <span>
              {def.label}:{' '}
              <span className="font-medium">{shown(def, draftRaw(draft, first, def))}</span>{' '}
              <span className="text-muted-foreground">
                (default {shown(def, def.defaultRaw ?? 0)})
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Reset ${def.label} to default`}
              onClick={() => reset([def])}
            >
              Reset
            </Button>
          </li>
        ))}
      </ul>
      {off.length > 1 && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => reset(off)}>
          Reset all to defaults
        </Button>
      )}
    </div>
  )
}

const ESC_CONFIGURATOR = 'ESC Configurator'
const ESC_CONFIGURATOR_URL = 'https://esc-configurator.com'

/** Text from `lib/esc` with every "ESC Configurator" a link to it. */
function WithLinks({ text }: { text: string }) {
  return text.split(ESC_CONFIGURATOR).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && (
        <a
          href={ESC_CONFIGURATOR_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          {ESC_CONFIGURATOR}
        </a>
      )}
      {part}
    </Fragment>
  ))
}

/** A setting's warning, below its label and value in a `<dl>` row that wraps. */
function SettingWarning({ warning }: { warning: string | null }) {
  if (!warning) return null
  return (
    <dd className="border-primary/40 bg-primary/10 mt-1 flex basis-full gap-2 rounded-md border p-2 font-normal">
      <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" />
      <span>
        <WithLinks text={warning} />
      </span>
    </dd>
  )
}

interface GroupEditorProps {
  group: EscGroup
  draft: EscDraft
  onChange: (draft: EscDraft) => void
}

/** The settings of ESCs that are edited as one. A change goes to all of them. */
function GroupEditor({
  group,
  draft,
  onChange,
  compareWith,
}: GroupEditorProps & { compareWith?: number | undefined }) {
  const first = group.escs[0] ?? 0
  const raw = (key: string) => {
    const def = group.settings.find((other) => other.key === key)
    return def ? draftRaw(draft, first, def) : 0
  }
  const differs = (def: EscSettingDef) =>
    compareWith !== undefined && draftRaw(draft, first, def) !== draftRaw(draft, compareWith, def)

  return (
    <div className="divide-y">
      {group.settings
        .filter((def) => def.visible?.(raw) ?? true)
        .map((def) => {
          const id = `esc-${group.escs.join('-')}-${def.key}`
          const slider =
            def.control?.kind === 'number' && (def.control.slider || def.control.recommended)
          return (
            <div
              key={def.key}
              className={
                slider
                  ? 'flex flex-col gap-2 py-3'
                  : 'flex items-center justify-between gap-3 py-1.5'
              }
            >
              <div>
                <label id={`${id}-label`} htmlFor={slider ? undefined : id} className="font-medium">
                  {def.label}
                </label>
                {differs(def) && (
                  <Badge
                    className="ml-2 py-0"
                    title="Not the same as on the first ESC with this firmware"
                  >
                    differs
                  </Badge>
                )}
                {def.hint && <p className="text-muted-foreground text-xs">{def.hint}</p>}
              </div>
              {/* a long hint next to it must not squeeze the control */}
              <div className={slider ? undefined : 'shrink-0'}>
                <SettingControl
                  id={id}
                  def={def}
                  raw={draftRaw(draft, first, def)}
                  reach={(value) => def.reach?.(value, raw) ?? null}
                  onChange={(next) => onChange(setDraftRaw(draft, group.escs, def, next))}
                />
              </div>
            </div>
          )
        })}
    </div>
  )
}

interface SettingControlProps {
  id: string
  def: EscSettingDef
  raw: number
  /** How far the ESC takes a number by itself (see `EscSettingDef.reach`). */
  reach: (value: number) => number | null
  onChange: (raw: number) => void
}

function SettingControl({ id, def, raw, reach, onChange }: SettingControlProps) {
  const { control } = def
  if (!control) return null
  if (control.kind === 'switch')
    return <Switch id={id} checked={raw !== 0} onCheckedChange={(on) => onChange(on ? 1 : 0)} />
  if (control.kind === 'select') {
    return (
      <NativeSelect id={id} value={raw} onChange={(e) => onChange(Number(e.target.value))}>
        {/* a value the list doesn't have stays selectable as what it is */}
        {!control.options.some((option) => option.raw === raw) && (
          <NativeSelectOption value={raw}>{def.format(raw)}</NativeSelectOption>
        )}
        {control.options.map((option) => (
          <NativeSelectOption key={option.raw} value={option.raw}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    )
  }
  if (control.slider || control.recommended)
    return (
      <NumberSlider
        labelledBy={`${id}-label`}
        control={control}
        raw={raw}
        reach={reach(rawToNumber(control, raw))}
        onChange={onChange}
      />
    )
  return (
    <div className="flex items-center gap-2">
      <NumberInput
        id={id}
        min={control.min}
        max={control.max}
        step={control.step}
        value={rawToNumber(control, raw)}
        onValueChange={(value) => onChange(numberToRaw(control, value))}
        className="dark:bg-input/30 h-9 w-24 rounded-md border bg-transparent px-3"
      />
      {control.unit && <span className="text-muted-foreground">{control.unit}</span>}
    </div>
  )
}

type NumberControl = Extract<EscControl, { kind: 'number' }>

const ZONE_STYLE: Record<RecommendedZone, { bar: string; text: string; icon: typeof CircleCheck }> =
  {
    low: { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlert },
    good: { bar: 'bg-success', text: 'text-success', icon: CircleCheck },
    high: { bar: 'bg-warning', text: 'text-warning', icon: TriangleAlert },
  }

/**
 * A number setting as a slider. A recommended range is painted green under the track (like Motors' dynamic idle); how
 * far the ESC takes the value by itself (`reach`) is a paler bar growing on from the thumb.
 */
function NumberSlider({
  labelledBy,
  control,
  raw,
  reach,
  onChange,
}: {
  labelledBy: string
  control: NumberControl
  raw: number
  reach: number | null
  onChange: (raw: number) => void
}) {
  const value = rawToNumber(control, raw)
  const clamp = (v: number) => Math.min(control.max, Math.max(control.min, v))
  const percent = (v: number) => ((clamp(v) - control.min) / (control.max - control.min)) * 100
  const reaches = reach !== null && reach > value

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      <div className="font-mono tabular-nums">
        {value}
        {reaches && `–${reach}`}
        {control.unit && ` ${control.unit}`}
      </div>
      <div className="relative">
        <Slider
          aria-labelledby={labelledBy}
          min={control.min}
          max={control.max}
          step={control.step}
          value={[clamp(value)]}
          onValueChange={([v]) => v !== undefined && onChange(numberToRaw(control, v))}
          // above the reach bar, which is painted over the track
          className="[&_[data-slot=slider-thumb]]:relative [&_[data-slot=slider-thumb]]:z-10"
        />
        {reaches && (
          <div
            data-testid="slider-reach"
            aria-hidden="true"
            className="bg-primary/55 pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full saturate-50"
            style={{ left: `${percent(value)}%`, right: `${100 - percent(reach)}%` }}
          />
        )}
      </div>
      {control.recommended && (
        <RecommendedRange control={control} recommended={control.recommended} value={value} />
      )}
    </div>
  )
}

function RecommendedRange({
  control,
  recommended,
  value,
}: {
  control: NumberControl
  recommended: { min: number; max: number }
  value: number
}) {
  const percent = (v: number) =>
    ((Math.min(control.max, Math.max(control.min, v)) - control.min) /
      (control.max - control.min)) *
    100
  const zone = recommendedZone(recommended, value)
  const range = `${recommended.min}–${recommended.max}`
  const segments = [
    { from: control.min, to: recommended.min, zone: 'low' },
    { from: recommended.min, to: recommended.max, zone: 'good' },
    { from: recommended.max, to: control.max, zone: 'high' },
  ] as const
  const { text, icon: Icon } = ZONE_STYLE[zone]

  return (
    <>
      <div className="relative mx-2 h-1.5" aria-hidden="true">
        {segments
          .filter(({ from, to }) => to > from)
          .map(({ from, to, zone }) => (
            <div
              key={zone}
              className={cn('absolute h-full rounded-full', ZONE_STYLE[zone].bar)}
              style={{ left: `${percent(from)}%`, right: `${100 - percent(to)}%` }}
            />
          ))}
      </div>
      <p className={cn('flex items-center gap-1.5', text)}>
        <Icon className="size-4 shrink-0" />
        <span className="text-foreground">
          {zone === 'good'
            ? `Recommended (${range})`
            : `${zone === 'low' ? 'Below' : 'Above'} the recommended ${range}`}
        </span>
      </p>
    </>
  )
}
