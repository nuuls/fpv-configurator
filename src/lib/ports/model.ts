/**
 * Device-first port assignment (docs/tabs/ports.md) on top of Betaflight 2026.6's per-UART
 * function masks. Pure logic: FC snapshot → assignments the UI edits → write plan.
 *
 * API 1.49 replaces function masks with `rx_uart` / `vtx_uart` / ... settings. When that is added,
 * `PortAssignments` stays the same and only `readAssignments` / `planWrites` get a second variant.
 */
import { FEATURE, SERIALRX_CRSF, SERIALRX_PROVIDER_NAMES, type SerialPortConfig } from '@/lib/msp/messages'

/** Betaflight `serialPortFunction_e` (io/serial.h). */
export const PORT_FUNCTION = {
  MSP: 1 << 0,
  GPS: 1 << 1,
  TELEMETRY_FRSKY_HUB: 1 << 2,
  TELEMETRY_HOTT: 1 << 3,
  TELEMETRY_LTM: 1 << 4,
  TELEMETRY_SMARTPORT: 1 << 5,
  RX_SERIAL: 1 << 6,
  BLACKBOX: 1 << 7,
  TELEMETRY_MAVLINK: 1 << 9,
  ESC_SENSOR: 1 << 10,
  VTX_SMARTAUDIO: 1 << 11,
  TELEMETRY_IBUS: 1 << 12,
  VTX_TRAMP: 1 << 13,
  RCDEVICE: 1 << 14,
  LIDAR_TF: 1 << 15,
  FRSKY_OSD: 1 << 16,
  VTX_MSP: 1 << 17,
  GIMBAL: 1 << 18,
} as const

const UNMANAGED_FUNCTION_LABELS: [mask: number, label: string][] = [
  [PORT_FUNCTION.TELEMETRY_FRSKY_HUB, 'FrSky telemetry'],
  [PORT_FUNCTION.TELEMETRY_HOTT, 'HoTT telemetry'],
  [PORT_FUNCTION.TELEMETRY_LTM, 'LTM telemetry'],
  [PORT_FUNCTION.TELEMETRY_SMARTPORT, 'SmartPort telemetry'],
  [PORT_FUNCTION.BLACKBOX, 'Blackbox logging'],
  [PORT_FUNCTION.TELEMETRY_MAVLINK, 'MAVLink telemetry'],
  [PORT_FUNCTION.ESC_SENSOR, 'ESC telemetry'],
  [PORT_FUNCTION.TELEMETRY_IBUS, 'iBUS telemetry'],
  [PORT_FUNCTION.RCDEVICE, 'Camera control'],
  [PORT_FUNCTION.LIDAR_TF, 'Lidar'],
  [PORT_FUNCTION.FRSKY_OSD, 'FrSky OSD'],
  [PORT_FUNCTION.GIMBAL, 'Gimbal'],
]

/** Function bits this tab owns. Everything else on a port is "unmanaged" and preserved. */
const MANAGED_MASK =
  PORT_FUNCTION.MSP |
  PORT_FUNCTION.GPS |
  PORT_FUNCTION.RX_SERIAL |
  PORT_FUNCTION.VTX_SMARTAUDIO |
  PORT_FUNCTION.VTX_TRAMP |
  PORT_FUNCTION.VTX_MSP

const BAUD_INDEX_115200 = 5

const USB_VCP = 20

export type ReceiverType = 'none' | 'crsf' | 'spi' | 'other'
export type VtxType = 'none' | 'msp' | 'smartaudio' | 'tramp'

/** What the user edits. Ports are Betaflight port identifiers; null = not chosen yet. */
export interface PortAssignments {
  receiver: {
    /** 'spi' (built-in) and 'other' (non-CRSF serial protocol) are read from the FC, never chosen. */
    type: ReceiverType
    port: number | null
  }
  vtx: { type: VtxType; port: number | null }
  gps: { enabled: boolean; port: number | null }
  /** Ports with plain MSP for other devices. */
  mspDevices: (number | null)[]
}

/** Everything read from the FC that port assignment depends on. */
export interface PortsSnapshot {
  ports: SerialPortConfig[]
  features: number
  serialRxProvider: number
}

export interface SettingWrite {
  name: string
  value: string
}

export interface PortsWritePlan {
  ports: SerialPortConfig[]
  features: number
  settings: SettingWrite[]
  /** Unmanaged functions that get removed because the user picked their port. Needs confirmation. */
  replaced: { port: number; functions: string[] }[]
}

export function portName(identifier: number): string {
  if (identifier === USB_VCP) return 'USB VCP'
  if (identifier >= 70) return `PIOUART${identifier - 70}`
  if (identifier >= 50) return `UART${identifier - 50}`
  if (identifier >= 40) return `LPUART${identifier - 39}`
  if (identifier >= 30) return `SOFTSERIAL${identifier - 29}`
  return `Port ${identifier}`
}

/** Hardware UARTs the user can plug things into. Never the USB port, never softserial. */
export function isSelectablePort(identifier: number): boolean {
  return identifier >= 40
}

/** Labels for the function bits on a port that this tab doesn't manage. Empty = none. */
export function unmanagedFunctions(functionMask: number): string[] {
  if (!(functionMask & ~MANAGED_MASK)) return []
  const labels = UNMANAGED_FUNCTION_LABELS.filter(([mask]) => functionMask & mask).map(([, label]) => label)
  return labels.length ? labels : ['another function']
}

export function serialRxProviderName(provider: number): string {
  return SERIALRX_PROVIDER_NAMES[provider] ?? `#${provider}`
}

export function readAssignments(snapshot: PortsSnapshot): PortAssignments {
  const ports = snapshot.ports.filter((p) => isSelectablePort(p.identifier))
  const portWith = (mask: number) => ports.find((p) => p.functionMask & mask)?.identifier ?? null

  const rxPort = portWith(PORT_FUNCTION.RX_SERIAL)
  let receiver: PortAssignments['receiver']
  if (snapshot.features & FEATURE.RX_SPI) receiver = { type: 'spi', port: null }
  else if (rxPort === null || !(snapshot.features & FEATURE.RX_SERIAL)) receiver = { type: 'none', port: null }
  else receiver = { type: snapshot.serialRxProvider === SERIALRX_CRSF ? 'crsf' : 'other', port: rxPort }

  let vtx: PortAssignments['vtx'] = { type: 'none', port: null }
  const vtxPort = ports.find(
    (p) => p.functionMask & (PORT_FUNCTION.VTX_MSP | PORT_FUNCTION.VTX_SMARTAUDIO | PORT_FUNCTION.VTX_TRAMP),
  )
  if (vtxPort) {
    const type: VtxType =
      vtxPort.functionMask & PORT_FUNCTION.VTX_MSP
        ? 'msp'
        : vtxPort.functionMask & PORT_FUNCTION.VTX_SMARTAUDIO
          ? 'smartaudio'
          : 'tramp'
    vtx = { type, port: vtxPort.identifier }
  }

  const gpsPort = portWith(PORT_FUNCTION.GPS)
  const gpsEnabled = gpsPort !== null && Boolean(snapshot.features & FEATURE.GPS)

  const mspDevices = ports
    .filter((p) => p.functionMask & PORT_FUNCTION.MSP && !(p.functionMask & PORT_FUNCTION.VTX_MSP))
    .map((p) => p.identifier)

  return {
    receiver,
    vtx,
    gps: { enabled: gpsEnabled, port: gpsEnabled ? gpsPort : null },
    mspDevices,
  }
}

/** Every port the assignments use, with the label of the device using it. */
export function usedPorts(assignments: PortAssignments): { port: number; usedBy: string }[] {
  const used: { port: number; usedBy: string }[] = []
  const { receiver, vtx, gps, mspDevices } = assignments
  if ((receiver.type === 'crsf' || receiver.type === 'other') && receiver.port !== null)
    used.push({ port: receiver.port, usedBy: 'Receiver' })
  if (vtx.type !== 'none' && vtx.port !== null) used.push({ port: vtx.port, usedBy: 'Video (VTX)' })
  if (gps.enabled && gps.port !== null) used.push({ port: gps.port, usedBy: 'GPS' })
  for (const port of mspDevices) if (port !== null) used.push({ port, usedBy: 'MSP device' })
  return used
}

/** Problems that make the assignments unsaveable. Empty = OK. */
export function validateAssignments(assignments: PortAssignments): string[] {
  const problems: string[] = []
  const { receiver, vtx, gps, mspDevices } = assignments
  if (receiver.type === 'crsf' && receiver.port === null) problems.push('Pick a port for the receiver.')
  if (vtx.type !== 'none' && vtx.port === null) problems.push('Pick a port for the VTX.')
  if (gps.enabled && gps.port === null) problems.push('Pick a port for the GPS.')
  if (mspDevices.includes(null)) problems.push('Pick a port for every MSP device.')

  const seen = new Set<number>()
  for (const { port } of usedPorts(assignments)) {
    if (seen.has(port)) problems.push(`${portName(port)} is assigned to more than one device.`)
    seen.add(port)
  }
  return problems
}

export function assignmentsEqual(a: PortAssignments, b: PortAssignments): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Computes what to write to the FC. `assignments` must pass `validateAssignments`. */
export function planWrites(snapshot: PortsSnapshot, assignments: PortAssignments): PortsWritePlan {
  const before = readAssignments(snapshot)
  const wanted = new Map<number, number>()
  const add = (port: number | null, mask: number) => {
    if (port !== null) wanted.set(port, (wanted.get(port) ?? 0) | mask)
  }

  const { receiver, vtx, gps, mspDevices } = assignments
  if (receiver.type === 'crsf' || receiver.type === 'other') add(receiver.port, PORT_FUNCTION.RX_SERIAL)
  if (vtx.type === 'msp') add(vtx.port, PORT_FUNCTION.MSP | PORT_FUNCTION.VTX_MSP)
  if (vtx.type === 'smartaudio') add(vtx.port, PORT_FUNCTION.VTX_SMARTAUDIO)
  if (vtx.type === 'tramp') add(vtx.port, PORT_FUNCTION.VTX_TRAMP)
  if (gps.enabled) add(gps.port, PORT_FUNCTION.GPS)
  for (const port of mspDevices) add(port, PORT_FUNCTION.MSP)

  const replaced: PortsWritePlan['replaced'] = []
  const ports = snapshot.ports.map((port) => {
    if (!isSelectablePort(port.identifier)) return port

    const managed = wanted.get(port.identifier) ?? 0
    let unmanaged = port.functionMask & ~MANAGED_MASK
    if (managed && unmanaged) {
      replaced.push({ port: port.identifier, functions: unmanagedFunctions(unmanaged) })
      unmanaged = 0
    }
    return {
      ...port,
      functionMask: (managed | unmanaged) >>> 0,
      mspBaud: managed & PORT_FUNCTION.MSP ? BAUD_INDEX_115200 : port.mspBaud,
    }
  })

  let features = snapshot.features
  const setFeature = (bit: number, on: boolean) => {
    features = (on ? features | bit : features & ~bit) >>> 0
  }
  // Built-in SPI receivers are configured by the board's defaults; leave RX features alone.
  if (receiver.type !== 'spi') setFeature(FEATURE.RX_SERIAL, receiver.type !== 'none')
  setFeature(FEATURE.GPS, gps.enabled)

  const settings: SettingWrite[] = []
  if (receiver.type === 'crsf' && snapshot.serialRxProvider !== SERIALRX_CRSF) {
    settings.push({ name: 'serialrx_provider', value: 'CRSF' })
  }
  if (vtx.type === 'msp' && before.vtx.type !== 'msp') {
    settings.push({ name: 'osd_displayport_device', value: 'MSP' }, { name: 'vcd_video_system', value: 'HD' })
  }
  if (vtx.type !== 'msp' && before.vtx.type === 'msp') {
    settings.push({ name: 'osd_displayport_device', value: 'AUTO' }, { name: 'vcd_video_system', value: 'AUTO' })
  }

  return { ports, features, settings, replaced }
}
