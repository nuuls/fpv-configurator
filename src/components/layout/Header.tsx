import { CodeXml, Cpu, Plug, Unplug, Usb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatFirmware } from '@/lib/format'
import { WebSerialTransport } from '@/lib/transport/webserial'
import { useConnectionStore } from '@/stores/connection'
import { confirmDiscardChanges } from '@/stores/unsaved'

const SOURCE_URL = 'https://github.com/nuuls/fpv-configurator'

export function Header() {
  const status = useConnectionStore((s) => s.status)
  const fcInfo = useConnectionStore((s) => s.fcInfo)
  const transportLabel = useConnectionStore((s) => s.transportLabel)
  const connect = useConnectionStore((s) => s.connect)
  const disconnect = useConnectionStore((s) => s.disconnect)

  const serialSupported = WebSerialTransport.isSupported()

  const handleDisconnect = async () => {
    if (await confirmDiscardChanges()) await disconnect()
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
      <div className="flex items-center gap-2 font-semibold">
        <Cpu className="size-5 text-primary" />
        FPV Configurator
        {/* AGPL §13: everyone using the app gets offered its source. */}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          title="Source code — free software under the GNU AGPL 3.0 or later"
          className="ml-2 flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <CodeXml className="size-3.5" />
          Source
        </a>
      </div>

      <div className="flex items-center gap-3">
        {status === 'connected' && fcInfo && (
          <>
            <span className="text-sm text-muted-foreground">{formatFirmware(fcInfo)}</span>
            <Badge variant="success">
              <Usb />
              {transportLabel}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void handleDisconnect()}>
              <Unplug />
              Disconnect
            </Button>
          </>
        )}

        {status !== 'connected' && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={status !== 'disconnected'}
              onClick={() => void connect('mock')}
            >
              Connect Mock FC
            </Button>
            <Button
              size="sm"
              disabled={status !== 'disconnected' || !serialSupported}
              title={serialSupported ? undefined : 'Web Serial is not available in this browser'}
              onClick={() => void connect('serial')}
            >
              <Plug />
              {status === 'connecting' ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
