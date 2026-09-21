import type { ReactNode } from 'react'
import { AttitudeIndicator } from '@/components/AttitudeIndicator'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMspPoll } from '@/hooks/useMspPoll'
import { formatApiVersion, formatFirmware } from '@/lib/format'
import { readAnalog, readAttitude, readStatus } from '@/lib/msp/api'
import { useConnectionStore } from '@/stores/connection'

const SENSOR_NAMES = ['Accelerometer', 'Barometer', 'Magnetometer', 'GPS', 'Rangefinder', 'Gyro']

export function SetupPage() {
  const fcInfo = useConnectionStore((s) => s.fcInfo)
  const attitude = useMspPoll(readAttitude, 50)
  const analog = useMspPoll(readAnalog, 250)
  const status = useMspPoll(readStatus, 500)

  if (!fcInfo) return null

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
              <Row label="Cycle time" value={status ? `${status.cycleTimeUs} µs` : '—'} />
              <Row label="CPU load" value={status ? `${status.cpuLoad} %` : '—'} />
              <Row label="PID profile" value={status ? String(status.pidProfile + 1) : '—'} />
              <Row label="Sensors" value={status ? sensors.join(', ') || 'None' : '—'} />
            </Rows>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">{children}</dl>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
  )
}
