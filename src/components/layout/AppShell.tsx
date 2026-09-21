import type { ReactNode } from 'react'
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

  let page: ReactNode = <WelcomePage />
  if (status === 'rebooting') page = <RebootingPage />
  else if (status === 'connected' && fcInfo) {
    page = isSupportedFirmware(fcInfo) ? <Outlet /> : <UnsupportedFirmwarePage fcInfo={fcInfo} />
  }
  const tabsUsable = status === 'connected' && fcInfo !== null && isSupportedFirmware(fcInfo)

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar disabled={!tabsUsable} />
        <main className="min-w-0 flex-1 overflow-y-auto p-6">{page}</main>
      </div>
      <ConfirmDialogHost />
    </div>
  )
}
