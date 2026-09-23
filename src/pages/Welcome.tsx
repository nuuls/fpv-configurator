import type { ReactNode } from 'react'
import { CircleAlert, Cpu, ListChecks, MonitorPlay, Plug, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WebSerialTransport } from '@/lib/transport/webserial'
import { useConnectionStore } from '@/stores/connection'

/** Shown in place of every tab while no flight controller is connected. */
export function WelcomePage() {
  const error = useConnectionStore((s) => s.error)
  const notice = useConnectionStore((s) => s.notice)
  const status = useConnectionStore((s) => s.status)
  const connect = useConnectionStore((s) => s.connect)
  const serialSupported = WebSerialTransport.isSupported()

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 pt-12">
      <h1 className="pb-4 text-3xl font-bold tracking-tight text-balance">
        A simplified Betaflight configurator without all the nerd shit
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>No flight controller connected</CardTitle>
          <CardDescription>
            Plug in your flight controller over USB and connect it, or try the app in demo mode with
            a simulated Betaflight board.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={status !== 'disconnected' || !serialSupported}
              onClick={() => void connect('serial')}
            >
              <Plug />
              Connect FC
            </Button>
            <Button
              variant="outline"
              disabled={status !== 'disconnected'}
              onClick={() => void connect('mock')}
            >
              <MonitorPlay />
              Demo mode
            </Button>
          </div>
          {!serialSupported && (
            <Notice>
              This browser doesn&apos;t support Web Serial. Use a Chromium-based browser (Chrome,
              Edge, Brave) to connect to real hardware. Demo mode works everywhere.
            </Notice>
          )}
        </CardContent>
      </Card>

      {notice && <Notice>{notice}</Notice>}

      {error && (
        <div role="alert">
          <Notice tone="error">Connection failed: {error}</Notice>
        </div>
      )}

      <div className="grid gap-4 pt-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <f.icon className="text-muted-foreground size-5" />
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <footer className="text-muted-foreground mt-auto flex flex-col gap-3 border-t pt-6 text-xs">
        <p>
          Created and maintained by{' '}
          <ExternalLink href="https://github.com/nuuls">Nils Vo</ExternalLink> ·{' '}
          <ExternalLink href={SOURCE_URL}>Source code on GitHub</ExternalLink> · AGPL-3.0 license
        </p>
        <p>
          Built on the work of{' '}
          {CREDITS.map((project, i) => (
            <span key={project.name}>
              {i > 0 && ', '}
              <ExternalLink href={project.url}>{project.name}</ExternalLink>
            </span>
          ))}
        </p>
        <p>
          Disclaimer: this is an independent project, not affiliated with or endorsed by Betaflight
          or any of the projects above. It is provided as is, without any warranty. Wrong settings
          can make a drone fly away or spin up its motors unexpectedly — take the propellers off
          while configuring, and check everything before you fly. You are responsible for your
          aircraft.
        </p>
      </footer>
    </div>
  )
}

const SOURCE_URL = 'https://github.com/nuuls/fpv-configurator'

/** Projects this app builds on, shown in the footer. */
const CREDITS: { name: string; url: string }[] = [
  { name: 'Betaflight', url: 'https://github.com/betaflight/betaflight' },
  { name: 'Betaflight Configurator', url: 'https://github.com/betaflight/betaflight-configurator' },
  { name: 'Betaflight presets', url: 'https://github.com/betaflight/firmware-presets' },
  { name: 'Bluejay', url: 'https://github.com/bird-sanctuary/bluejay' },
  { name: 'AM32', url: 'https://github.com/am32-firmware/AM32' },
  { name: 'ESC Configurator', url: 'https://github.com/stylesuxx/esc-configurator' },
]

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground underline underline-offset-2"
    >
      {children}
    </a>
  )
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: SlidersHorizontal,
    title: 'Simplified setup',
    text: 'Only the settings pilots actually touch. PID tuning is three sliders, not a spaceship control panel.',
  },
  {
    icon: ListChecks,
    title: 'Finds config issues',
    text: 'Spots the settings you forgot, like bidirectional DShot or an accelerometer that was never calibrated, and fixes them before you have to ask on Discord.',
  },
  {
    icon: Cpu,
    title: 'ESC configuration',
    text: 'Change Bluejay and AM32 settings right here, through the flight controller. No second configurator. And it double checks your settings as well.',
  },
]

function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return (
    <div
      className={
        tone === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive flex gap-3 rounded-md border p-3 text-sm'
          : 'bg-muted/50 text-muted-foreground flex gap-3 rounded-md border p-3 text-sm'
      }
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  )
}
