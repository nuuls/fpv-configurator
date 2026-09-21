import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { applyPortsPlan, readPortsSnapshot } from '@/lib/ports/io'
import {
  assignmentsEqual,
  isSelectablePort,
  planWrites,
  portName,
  readAssignments,
  serialRxProviderName,
  unmanagedFunctions,
  usedPorts,
  validateAssignments,
  type PortAssignments,
  type PortsSnapshot,
  type ReceiverType,
  type VtxType,
} from '@/lib/ports/model'
import { confirm } from '@/stores/confirm'
import { useConnectionStore } from '@/stores/connection'

const PATH = '/ports'

/** Spec: docs/tabs/ports.md */
export function PortsPage() {
  const client = useConnectionStore((s) => s.client)
  const reboot = useConnectionStore((s) => s.reboot)

  const [snapshot, setSnapshot] = useState<PortsSnapshot | null>(null)
  const [draft, setDraft] = useState<PortAssignments | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    readPortsSnapshot(client).then(
      (loaded) => {
        if (cancelled) return
        setSnapshot(loaded)
        setDraft(readAssignments(loaded))
      },
      (cause: unknown) => {
        if (!cancelled) setError(`Could not read the port configuration: ${describe(cause)}`)
      },
    )
    return () => {
      cancelled = true
    }
  }, [client])

  const dirty = snapshot !== null && draft !== null && !assignmentsEqual(readAssignments(snapshot), draft)
  useUnsavedChanges(PATH, dirty)

  if (!snapshot || !draft) {
    return (
      <>
        <PageHeader title="Ports" description="What is plugged into which UART." />
        {error ? <ErrorNotice>{error}</ErrorNotice> : <p className="text-sm text-muted-foreground">Reading ports…</p>}
      </>
    )
  }

  const problems = validateAssignments(draft)
  const update = (patch: Partial<PortAssignments>) => setDraft({ ...draft, ...patch })

  const handleSave = async () => {
    if (!client) return
    const plan = planWrites(snapshot, draft)
    if (plan.replaced.length > 0) {
      const what = plan.replaced.map((r) => `${portName(r.port)} is used for ${r.functions.join(', ')}`).join('. ')
      const ok = await confirm({
        title: 'Replace existing port function?',
        description: `${what}. Saving will remove that and use the port for the device you picked.`,
        confirmLabel: 'Replace',
        destructive: true,
      })
      if (!ok) return
    }

    setSaving(true)
    setError(null)
    try {
      await applyPortsPlan(client, plan)
    } catch (cause) {
      // Nothing was persisted: the FC still has its old config in EEPROM.
      setError(`Saving failed, nothing was stored: ${describe(cause)}`)
      setSaving(false)
      return
    }
    await reboot() // unmounts this page; it reloads from the FC after reconnecting
  }

  const selectablePorts = snapshot.ports.filter((p) => isSelectablePort(p.identifier))
  const used = usedPorts(draft)
  const unmanagedRows = selectablePorts.filter(
    (p) => unmanagedFunctions(p.functionMask).length > 0 && !used.some((u) => u.port === p.identifier),
  )

  const portSelect = (label: string, value: number | null, onChange: (port: number | null) => void) => (
    <NativeSelect
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <NativeSelectOption value="">Select port…</NativeSelectOption>
      {selectablePorts.map((p) => {
        const takenBy = p.identifier === value ? undefined : used.find((u) => u.port === p.identifier)?.usedBy
        const other = unmanagedFunctions(p.functionMask)
        const suffix = takenBy ? ` (used by ${takenBy})` : other.length ? ` — ${other.join(', ')}` : ''
        return (
          <NativeSelectOption key={p.identifier} value={p.identifier} disabled={takenBy !== undefined}>
            {portName(p.identifier) + suffix}
          </NativeSelectOption>
        )
      })}
    </NativeSelect>
  )

  const { receiver, vtx, gps, mspDevices } = draft
  const fcReceiver = readAssignments(snapshot).receiver

  return (
    <>
      <PageHeader title="Ports" description="Pick what is plugged in, then the UART it is wired to." />

      <Card>
        <CardContent className="flex flex-col divide-y">
          <DeviceRow name="Receiver">
            {receiver.type === 'spi' ? (
              <span className="text-sm text-muted-foreground">Built-in (SPI) — no port needed</span>
            ) : (
              <>
                <NativeSelect
                  aria-label="Receiver type"
                  value={receiver.type}
                  onChange={(e) => {
                    const type = e.target.value as ReceiverType
                    update({ receiver: { type, port: type === 'none' ? null : receiver.port } })
                  }}
                >
                  <NativeSelectOption value="none">None</NativeSelectOption>
                  <NativeSelectOption value="crsf">ELRS / CRSF</NativeSelectOption>
                  {fcReceiver.type === 'other' && (
                    <NativeSelectOption value="other">
                      Other ({serialRxProviderName(snapshot.serialRxProvider)})
                    </NativeSelectOption>
                  )}
                </NativeSelect>
                {receiver.type !== 'none' && (
                  <On>{portSelect('Receiver port', receiver.port, (port) => update({ receiver: { ...receiver, port } }))}</On>
                )}
              </>
            )}
          </DeviceRow>

          <DeviceRow name="Video (VTX)">
            <NativeSelect
              aria-label="VTX type"
              value={vtx.type}
              onChange={(e) => {
                const type = e.target.value as VtxType
                update({ vtx: { type, port: type === 'none' ? null : vtx.port } })
              }}
            >
              <NativeSelectOption value="none">None</NativeSelectOption>
              <NativeSelectOption value="msp">Digital (MSP)</NativeSelectOption>
              <NativeSelectOption value="smartaudio">Analog (SmartAudio)</NativeSelectOption>
              <NativeSelectOption value="tramp">Analog (Tramp)</NativeSelectOption>
            </NativeSelect>
            {vtx.type !== 'none' && <On>{portSelect('VTX port', vtx.port, (port) => update({ vtx: { ...vtx, port } }))}</On>}
          </DeviceRow>

          <DeviceRow name="GPS">
            <NativeSelect
              aria-label="GPS"
              value={gps.enabled ? 'on' : 'off'}
              onChange={(e) => {
                const enabled = e.target.value === 'on'
                update({ gps: { enabled, port: enabled ? gps.port : null } })
              }}
            >
              <NativeSelectOption value="off">None</NativeSelectOption>
              <NativeSelectOption value="on">Connected</NativeSelectOption>
            </NativeSelect>
            {gps.enabled && <On>{portSelect('GPS port', gps.port, (port) => update({ gps: { ...gps, port } }))}</On>}
          </DeviceRow>

          <DeviceRow name="Other MSP devices">
            <div className="flex flex-col gap-2">
              {mspDevices.map((port, index) => (
                <div key={index} className="flex items-center gap-2">
                  {portSelect(`MSP device ${index + 1} port`, port, (next) =>
                    update({ mspDevices: mspDevices.map((p, i) => (i === index ? next : p)) }),
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove MSP device ${index + 1}`}
                    onClick={() => update({ mspDevices: mspDevices.filter((_, i) => i !== index) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => update({ mspDevices: [...mspDevices, null] })}
              >
                <Plus />
                Add device
              </Button>
            </div>
          </DeviceRow>
        </CardContent>
      </Card>

      {unmanagedRows.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
          {unmanagedRows.map((p) => (
            <li key={p.identifier}>
              {portName(p.identifier)}: {unmanagedFunctions(p.functionMask).join(', ')} (not managed here)
            </li>
          ))}
        </ul>
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}

      <div className="mt-6 flex items-center justify-end gap-3">
        {dirty && problems.length > 0 && <p className="mr-auto text-sm text-destructive">{problems[0]}</p>}
        <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(readAssignments(snapshot))}>
          Revert
        </Button>
        <Button disabled={!dirty || saving || problems.length > 0} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save & Reboot'}
        </Button>
      </div>
    </>
  )
}

function DeviceRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
      <div className="w-40 shrink-0 pt-1.5 text-sm font-medium">{name}</div>
      {children}
    </div>
  )
}

function On({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="pt-1.5 text-sm text-muted-foreground">on</span>
      {children}
    </>
  )
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {children}
    </p>
  )
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
