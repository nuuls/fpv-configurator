import { useState } from 'react'
import { Notice, LoadingState } from '@/components/Notice'
import { SaveBar } from '@/components/SaveBar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDraft } from '@/hooks/useDraft'
import { describeError, useFcSnapshot } from '@/hooks/useFcSnapshot'
import { useSave } from '@/hooks/useSave'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { eraseDataflash, readBlackboxSnapshot, saveBlackboxConfig } from '@/lib/blackbox/io'
import {
  BLACKBOX_DEVICE,
  formatBytes,
  SAMPLE_RATES,
  sampleRateLabel,
  SDCARD_STATE,
  sdcardStateLabel,
  type BlackboxSnapshot,
} from '@/lib/blackbox/model'
import type { MspClient } from '@/lib/msp/client'
import { confirm } from '@/stores/confirm'
import { useConnectionStore } from '@/stores/connection'

const PATH = '/blackbox'

/** Spec: docs/tabs/blackbox.md */
export function BlackboxPage() {
  const { client, snapshot, error, reload } = useFcSnapshot(readBlackboxSnapshot)
  return (
    <>
      <PageHeader title="Blackbox" description="Flight log recording and storage." />
      {client && snapshot ? (
        <Editor client={client} snapshot={snapshot} reload={reload} />
      ) : (
        <LoadingState error={error} />
      )}
    </>
  )
}

const toDraft = (s: BlackboxSnapshot) => ({
  device: s.config.device,
  sampleRate: s.config.sampleRate,
})

function Editor({
  client,
  snapshot,
  reload,
}: {
  client: MspClient
  snapshot: BlackboxSnapshot
  reload: () => void
}) {
  const rebootToMassStorage = useConnectionStore((s) => s.rebootToMassStorage)
  const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)
  const { saving, error, save } = useSave(reload)
  const [busy, setBusy] = useState<'erasing' | 'msc' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  useUnsavedChanges(PATH, dirty)

  const { config, flash, sdcard } = snapshot
  if (!config.supported) return <Notice>This firmware build has no blackbox support.</Notice>

  const devices = [
    { value: BLACKBOX_DEVICE.NONE, label: 'No logging' },
    ...(flash.supported ? [{ value: BLACKBOX_DEVICE.FLASH, label: 'Onboard flash' }] : []),
    ...(sdcard.supported ? [{ value: BLACKBOX_DEVICE.SDCARD, label: 'SD card' }] : []),
    ...(config.device === BLACKBOX_DEVICE.SERIAL
      ? [{ value: BLACKBOX_DEVICE.SERIAL, label: 'Serial port (external logger)' }]
      : []),
  ]
  const storageReady = flash.supported ? flash.ready : sdcard.state === SDCARD_STATE.READY

  const handleErase = async () => {
    const ok = await confirm({
      title: 'Erase all logs?',
      description: 'This deletes every flight log on the onboard flash. It cannot be undone.',
      confirmLabel: 'Erase',
      destructive: true,
    })
    if (!ok) return
    setBusy('erasing')
    setActionError(null)
    try {
      await eraseDataflash(client)
      reload()
    } catch (cause) {
      setActionError(`Erasing failed: ${describeError(cause)}`)
    }
    setBusy(null)
  }

  const handleMassStorage = async () => {
    const ok = await confirm({
      title: 'Restart as USB drive?',
      description:
        'The flight controller restarts and shows up as a USB drive with your logs. This app disconnects; unplug and replug the flight controller afterwards to get back.',
      confirmLabel: 'Restart as USB drive',
    })
    if (!ok) return
    setBusy('msc')
    setActionError(null)
    try {
      await rebootToMassStorage()
    } catch (cause) {
      setActionError(`Could not switch to USB drive mode: ${describeError(cause)}`)
      setBusy(null)
    }
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Logging</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 text-sm">
            <label htmlFor="bb-device" className="font-medium">
              Log to
            </label>
            <NativeSelect
              id="bb-device"
              value={draft.device}
              onChange={(e) => setDraft({ ...draft, device: Number(e.target.value) })}
            >
              {devices.map((d) => (
                <NativeSelectOption key={d.value} value={d.value}>
                  {d.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>

            <label htmlFor="bb-rate" className="font-medium">
              Logging rate
            </label>
            <NativeSelect
              id="bb-rate"
              value={draft.sampleRate}
              disabled={draft.device === BLACKBOX_DEVICE.NONE}
              onChange={(e) => setDraft({ ...draft, sampleRate: Number(e.target.value) })}
            >
              {SAMPLE_RATES.map((rate) => (
                <NativeSelectOption key={rate} value={rate}>
                  {sampleRateLabel(rate, snapshot.cycleTimeUs)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>
              {flash.supported
                ? `Onboard flash: ${formatBytes(flash.usedBytes)} of ${formatBytes(flash.totalBytes)} used`
                : sdcard.supported
                  ? sdcard.state === SDCARD_STATE.READY
                    ? `SD card: ${formatBytes(sdcard.freeKb * 1024)} free of ${formatBytes(sdcard.totalKb * 1024)}`
                    : `SD card: ${sdcardStateLabel(sdcard.state)}`
                  : 'This flight controller has no log storage.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {flash.supported && (
              <Button
                variant="outline"
                disabled={busy !== null || dirty || !flash.ready}
                onClick={() => void handleErase()}
              >
                {busy === 'erasing' ? 'Erasing…' : 'Erase storage'}
              </Button>
            )}
            {(flash.supported || sdcard.supported) && (
              <Button
                variant="outline"
                disabled={busy !== null || dirty || !storageReady}
                onClick={() => void handleMassStorage()}
              >
                Activate mass storage
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {(error ?? actionError) && <Notice tone="error">{error ?? actionError}</Notice>}
      <SaveBar
        dirty={dirty}
        saving={saving}
        reboot
        onRevert={revert}
        onSave={() =>
          void save(async () => {
            await saveBlackboxConfig(client, { ...config, ...draft })
            return true
          })
        }
      />
    </>
  )
}
