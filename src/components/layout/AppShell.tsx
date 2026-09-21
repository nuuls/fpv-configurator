import { useEffect, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { ConfirmDialogHost } from '@/components/ConfirmDialogHost'
import { isSupportedFirmware } from '@/lib/format'
import { RebootingPage } from '@/pages/Rebooting'
import { UnsupportedFirmwarePage } from '@/pages/UnsupportedFirmware'
import { WelcomePage } from '@/pages/Welcome'
import { useConnectionStore } from '@/stores/connection'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const status = useConnectionStore((s) => s.status)
  const fcInfo = useConnectionStore((s) => s.fcInfo)
  // Small screens only: the sidebar is a drawer there. On wide screens it is always shown.
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!navOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  let page: ReactNode = <WelcomePage />
  if (status === 'rebooting') page = <RebootingPage />
  else if (status === 'connected' && fcInfo) {
    page = isSupportedFirmware(fcInfo) ? <Outlet /> : <UnsupportedFirmwarePage fcInfo={fcInfo} />
  }
  const tabsUsable = status === 'connected' && fcInfo !== null && isSupportedFirmware(fcInfo)

  return (
    <div className="flex h-dvh flex-col">
      <Header navOpen={navOpen} onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar disabled={!tabsUsable} open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">{page}</main>
      </div>
      <ConfirmDialogHost />
    </div>
  )
}
