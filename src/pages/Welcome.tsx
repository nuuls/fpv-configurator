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
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pt-12">
      <h1 className="pb-4 text-3xl font-bold tracking-tight text-balance">
        A stripped-down Betaflight configurator that runs in the browser
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
    </div>
  )
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: SlidersHorizontal,
    title: 'Simplified setup',
    text: 'Only the settings most pilots actually change. PID tuning, for example, is three sliders.',
  },
  {
    icon: ListChecks,
    title: 'Finds config issues',
    text: 'Checks the settings a quad should not fly without, like bidirectional DShot and a calibrated accelerometer, and offers a fix.',
  },
  {
    icon: Cpu,
    title: 'ESC configuration',
    text: 'Change Bluejay and AM32 ESC settings through the flight controller, without a separate app.',
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
