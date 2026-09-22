import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatFirmware } from '@/lib/format'
import type { FcInfo } from '@/lib/msp/api'

/** SPEC §3: only Betaflight 2026.x is supported; anything else connects but can't be configured. */
export function UnsupportedFirmwarePage({ fcInfo }: { fcInfo: FcInfo }) {
  return (
    <div className="mx-auto max-w-xl pt-12">
      <Card>
        <CardHeader>
          <CardTitle>Unsupported firmware: {formatFirmware(fcInfo)}</CardTitle>
          <CardDescription>
            This app only works with Betaflight 2026.x. Flash a current Betaflight release with
            Betaflight Configurator, then connect again.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
