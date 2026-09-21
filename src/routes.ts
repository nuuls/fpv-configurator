import type { ComponentType } from 'react'
import {
  Activity,
  Cable,
  Fan,
  Filter,
  Gauge,
  HardDrive,
  MonitorPlay,
  Move3d,
  Radio,
  SlidersHorizontal,
  ToggleLeft,
  type LucideIcon,
} from 'lucide-react'
import { BlackboxPage } from '@/pages/Blackbox'
import { ModesPage } from '@/pages/Modes'
import { MotorsPage } from '@/pages/Motors'
import { OrientationPage } from '@/pages/Orientation'
import { PidTuningPage } from '@/pages/PidTuning'
import { OsdPage } from '@/pages/Osd'
import { FiltersPage, VtxPage } from '@/pages/placeholders'
import { PortsPage } from '@/pages/Ports'
import { RatesPage } from '@/pages/Rates'
import { SetupPage } from '@/pages/Setup'

export interface AppRoute {
  path: string
  label: string
  icon: LucideIcon
  component: ComponentType
}

/**
 * Single source of truth for tabs: drives both the router and the sidebar.
 * Mirrors the scope list in docs/SPEC.md §2; tabs whose spec is still TBD are placeholders.
 */
export const ROUTES: AppRoute[] = [
  { path: '/setup', label: 'Setup', icon: Gauge, component: SetupPage },
  { path: '/ports', label: 'Ports', icon: Cable, component: PortsPage },
  { path: '/orientation', label: 'Orientation', icon: Move3d, component: OrientationPage },
  { path: '/pid-tuning', label: 'PID Tuning', icon: SlidersHorizontal, component: PidTuningPage },
  { path: '/filters', label: 'Filters', icon: Filter, component: FiltersPage },
  { path: '/rates', label: 'Rates', icon: Activity, component: RatesPage },
  { path: '/modes', label: 'Modes', icon: ToggleLeft, component: ModesPage },
  { path: '/motors', label: 'Motors', icon: Fan, component: MotorsPage },
  { path: '/osd', label: 'OSD', icon: MonitorPlay, component: OsdPage },
  { path: '/vtx', label: 'VTX', icon: Radio, component: VtxPage },
  { path: '/blackbox', label: 'Blackbox', icon: HardDrive, component: BlackboxPage },
]

export const DEFAULT_PATH = '/setup'
