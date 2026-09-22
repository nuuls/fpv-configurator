import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WebSerialTransport } from '@/lib/transport/webserial'
import { useConnectionStore } from '@/stores/connection'

/** Shown in place of every tab while no flight controller is connected. */
export function WelcomePage() {
  const error = useConnectionStore((s) => s.error)
  const notice = useConnectionStore((s) => s.notice)
  const serialSupported = WebSerialTransport.isSupported()

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pt-12">
      <Card>
        <CardHeader>
          <CardTitle>No flight controller connected</CardTitle>
          <CardDescription>
            Plug in your flight controller over USB and press <strong>Connect</strong>, or use{' '}
            <strong>Connect Mock FC</strong> to explore the app with a simulated Betaflight board.
          </CardDescription>
        </CardHeader>
        {!serialSupported && (
          <CardContent>
            <Notice>
              This browser doesn&apos;t support Web Serial. Use a Chromium-based browser (Chrome,
              Edge, Brave) to connect to real hardware. The mock FC works everywhere.
            </Notice>
          </CardContent>
        )}
      </Card>

      {notice && <Notice>{notice}</Notice>}

      {error && (
        <div role="alert">
          <Notice tone="error">Connection failed: {error}</Notice>
        </div>
      )}
    </div>
  )
}

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
