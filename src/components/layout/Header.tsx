import { CodeXml, Cpu, Menu, Plug, TriangleAlert, Unplug, Usb, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatFirmware } from '@/lib/format'
import { WebSerialTransport } from '@/lib/transport/webserial'
import { useConnectionStore } from '@/stores/connection'
import { confirmDiscardChanges } from '@/stores/unsaved'
import { SIDEBAR_ID } from './Sidebar'

const SOURCE_URL = 'https://github.com/nuuls/fpv-configurator'
const ALPHA_WARNING =
  'Test version — many things are not properly tested yet. Use at your own risk.'

interface HeaderProps {
  navOpen: boolean
  onToggleNav: () => void
}

export function Header({ navOpen, onToggleNav }: HeaderProps) {
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
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-3 py-2 md:flex-nowrap md:px-4">
      <div className="flex shrink-0 items-center gap-2 font-semibold">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 md:hidden"
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          aria-controls={SIDEBAR_ID}
          onClick={onToggleNav}
        >
          {navOpen ? <X /> : <Menu />}
        </Button>
        <Cpu className="size-5 text-primary" />
        <span className="max-sm:sr-only">FPV Configurator</span>
        {/* AGPL §13: everyone using the app gets offered its source. */}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          title="Source code — free software under the GNU AGPL 3.0 or later"
          className="ml-2 flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <CodeXml className="size-3.5" />
          <span className="max-sm:sr-only">Source</span>
        </a>
      </div>

      <div
        role="alert"
        title={ALPHA_WARNING}
        className="flex min-w-0 items-center gap-2 rounded-md bg-warning px-3 py-1.5 text-sm font-semibold text-black max-md:order-last max-md:w-full max-md:text-xs"
      >
        <TriangleAlert className="size-5 shrink-0" />
        <span className="shrink-0 text-base font-extrabold tracking-wide uppercase">Alpha</span>
        <span className="md:truncate">{ALPHA_WARNING}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {status === 'connected' && fcInfo && (
          <>
            <span className="text-sm text-muted-foreground max-md:hidden">{formatFirmware(fcInfo)}</span>
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
