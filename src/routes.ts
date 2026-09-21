import type { ComponentType } from 'react'
import { Cable, Fan, Gauge, Radio, Settings, Terminal, ToggleLeft, type LucideIcon } from 'lucide-react'
import { CliPage } from '@/pages/Cli'
import { ConfigurationPage } from '@/pages/Configuration'
import { ModesPage } from '@/pages/Modes'
import { MotorsPage } from '@/pages/Motors'
import { PortsPage } from '@/pages/Ports'
import { ReceiverPage } from '@/pages/Receiver'
import { SetupPage } from '@/pages/Setup'

export interface AppRoute {
  path: string
  label: string
  icon: LucideIcon
  component: ComponentType
}

/** Single source of truth for tabs: drives both the router and the sidebar. */
export const ROUTES: AppRoute[] = [
  { path: '/setup', label: 'Setup', icon: Gauge, component: SetupPage },
  { path: '/ports', label: 'Ports', icon: Cable, component: PortsPage },
  { path: '/configuration', label: 'Configuration', icon: Settings, component: ConfigurationPage },
  { path: '/receiver', label: 'Receiver', icon: Radio, component: ReceiverPage },
  { path: '/modes', label: 'Modes', icon: ToggleLeft, component: ModesPage },
  { path: '/motors', label: 'Motors', icon: Fan, component: MotorsPage },
  { path: '/cli', label: 'CLI', icon: Terminal, component: CliPage },
]

export const DEFAULT_PATH = '/setup'
