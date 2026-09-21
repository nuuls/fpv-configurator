import { LoaderCircle } from 'lucide-react'

/** Shown while the FC restarts after "Save & Reboot"; the connection store reconnects by itself. */
export function RebootingPage() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 pt-24 text-muted-foreground">
      <LoaderCircle className="size-8 animate-spin" />
      <p>Rebooting flight controller…</p>
    </div>
  )
}
