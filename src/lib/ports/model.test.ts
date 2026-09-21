import { describe, expect, it } from 'vitest'
import { defaultMockConfig } from '@/lib/mock-fc/mockFc'
import { FEATURE } from '@/lib/msp/messages'
import {
  PORT_FUNCTION,
  planWrites,
  portName,
  readAssignments,
  validateAssignments,
  type PortAssignments,
  type PortsSnapshot,
} from './model'

const UART1 = 51
const UART2 = 52
const UART3 = 53
const UART4 = 54

function snapshot(edit?: (s: PortsSnapshot) => void): PortsSnapshot {
  const { ports, features } = defaultMockConfig()
  const s: PortsSnapshot = { ports, features, serialRxProvider: 9 }
  edit?.(s)
  return s
}

const maskOf = (ports: PortsSnapshot['ports'], identifier: number) =>
  ports.find((p) => p.identifier === identifier)?.functionMask

describe('portName', () => {
  it('names Betaflight port identifiers', () => {
    expect([20, 30, 40, 50, 51, 56, 70].map(portName)).toEqual([
      'USB VCP',
      'SOFTSERIAL1',
      'LPUART1',
      'UART0',
      'UART1',
      'UART6',
      'PIOUART0',
    ])
  })
})

describe('readAssignments', () => {
  it('reads the default mock config', () => {
    expect(readAssignments(snapshot())).toEqual({
      receiver: { type: 'crsf', port: UART2 },
      vtx: { type: 'none', port: null },
      gps: { enabled: false, port: null },
      mspDevices: [],
    })
  })

  it('never reports the USB port as an MSP device', () => {
    expect(readAssignments(snapshot()).mspDevices).not.toContain(20)
  })

  it('detects a digital VTX and does not double-count its MSP bit', () => {
    const s = snapshot((s) => {
      s.ports[1]!.functionMask = PORT_FUNCTION.MSP | PORT_FUNCTION.VTX_MSP
    })
    const a = readAssignments(s)
    expect(a.vtx).toEqual({ type: 'msp', port: UART1 })
    expect(a.mspDevices).toEqual([])
  })

  it('detects analog VTX protocols, GPS and plain MSP devices', () => {
    const s = snapshot((s) => {
      s.ports[1]!.functionMask = PORT_FUNCTION.VTX_TRAMP
      s.ports[4]!.functionMask = PORT_FUNCTION.GPS
      s.ports[5]!.functionMask = PORT_FUNCTION.MSP
      s.features |= FEATURE.GPS
    })
    const a = readAssignments(s)
    expect(a.vtx).toEqual({ type: 'tramp', port: UART1 })
    expect(a.gps).toEqual({ enabled: true, port: UART4 })
    expect(a.mspDevices).toEqual([55])
  })

  it('reports a built-in SPI receiver and non-CRSF serial receivers', () => {
    expect(readAssignments(snapshot((s) => void (s.features |= FEATURE.RX_SPI))).receiver.type).toBe('spi')
    expect(readAssignments(snapshot((s) => void (s.serialRxProvider = 2))).receiver).toEqual({
      type: 'other',
      port: UART2,
    })
  })
})

describe('validateAssignments', () => {
  const base = readAssignments(snapshot())

  it('accepts what was read from the FC', () => {
    expect(validateAssignments(base)).toEqual([])
  })

  it('requires a port for every enabled device', () => {
    expect(validateAssignments({ ...base, vtx: { type: 'msp', port: null } })).toHaveLength(1)
    expect(validateAssignments({ ...base, gps: { enabled: true, port: null } })).toHaveLength(1)
    expect(validateAssignments({ ...base, mspDevices: [null] })).toHaveLength(1)
  })

  it('rejects one port used twice', () => {
    expect(validateAssignments({ ...base, vtx: { type: 'msp', port: UART2 } })[0]).toMatch(/UART2/)
  })
})

describe('planWrites', () => {
  const s = snapshot()
  const base = readAssignments(s)

  it('is a no-op for unchanged assignments', () => {
    const plan = planWrites(s, base)
    expect(plan.ports).toEqual(s.ports)
    expect(plan.features).toBe(s.features)
    expect(plan.settings).toEqual([])
    expect(plan.replaced).toEqual([])
  })

  it('sets up a digital VTX: MSP + VTX_MSP at 115200 and the displayport settings', () => {
    const plan = planWrites(s, { ...base, vtx: { type: 'msp', port: UART1 } })
    expect(maskOf(plan.ports, UART1)).toBe(PORT_FUNCTION.MSP | PORT_FUNCTION.VTX_MSP)
    expect(plan.ports.find((p) => p.identifier === UART1)?.mspBaud).toBe(5)
    expect(plan.settings).toEqual([
      { name: 'osd_displayport_device', value: 'MSP' },
      { name: 'vcd_video_system', value: 'HD' },
    ])
  })

  it('resets the displayport settings when leaving digital', () => {
    const digital = snapshot((s) => {
      s.ports[1]!.functionMask = PORT_FUNCTION.MSP | PORT_FUNCTION.VTX_MSP
    })
    const plan = planWrites(digital, { ...readAssignments(digital), vtx: { type: 'smartaudio', port: UART1 } })
    expect(maskOf(plan.ports, UART1)).toBe(PORT_FUNCTION.VTX_SMARTAUDIO)
    expect(plan.settings.map((w) => w.value)).toEqual(['AUTO', 'AUTO'])
  })

  it('moves the receiver and keeps the RX_SERIAL feature', () => {
    const plan = planWrites(s, { ...base, receiver: { type: 'crsf', port: UART4 } })
    expect(maskOf(plan.ports, UART2)).toBe(0)
    expect(maskOf(plan.ports, UART4)).toBe(PORT_FUNCTION.RX_SERIAL)
    expect(plan.features & FEATURE.RX_SERIAL).toBeTruthy()
  })

  it('switches a non-CRSF receiver to CRSF', () => {
    const sbus = snapshot((s) => void (s.serialRxProvider = 2))
    const plan = planWrites(sbus, { ...readAssignments(sbus), receiver: { type: 'crsf', port: UART2 } })
    expect(plan.settings).toEqual([{ name: 'serialrx_provider', value: 'CRSF' }])
  })

  it('removing the receiver clears its port bit and feature', () => {
    const plan = planWrites(s, { ...base, receiver: { type: 'none', port: null } })
    expect(maskOf(plan.ports, UART2)).toBe(0)
    expect(plan.features & FEATURE.RX_SERIAL).toBe(0)
  })

  it('toggles the GPS feature with the GPS device', () => {
    const plan = planWrites(s, { ...base, gps: { enabled: true, port: UART4 } })
    expect(maskOf(plan.ports, UART4)).toBe(PORT_FUNCTION.GPS)
    expect(plan.features & FEATURE.GPS).toBeTruthy()
  })

  it('never touches the USB port or unmanaged functions on untouched ports', () => {
    const edited: PortAssignments = {
      receiver: { type: 'none', port: null },
      vtx: { type: 'msp', port: UART1 },
      gps: { enabled: true, port: UART4 },
      mspDevices: [55],
    }
    const plan = planWrites(s, edited)
    expect(plan.ports[0]).toEqual(s.ports[0])
    expect(maskOf(plan.ports, UART3)).toBe(PORT_FUNCTION.ESC_SENSOR)
    expect(plan.replaced).toEqual([])
  })

  it('reports and clears unmanaged functions on a port the user picked', () => {
    const plan = planWrites(s, { ...base, gps: { enabled: true, port: UART3 } })
    expect(plan.replaced).toEqual([{ port: UART3, functions: ['ESC telemetry'] }])
    expect(maskOf(plan.ports, UART3)).toBe(PORT_FUNCTION.GPS)
  })

  it('leaves RX features alone for a built-in SPI receiver', () => {
    const spi = snapshot((s) => {
      s.features = (s.features | FEATURE.RX_SPI) & ~FEATURE.RX_SERIAL
      s.ports[2]!.functionMask = 0
    })
    const plan = planWrites(spi, readAssignments(spi))
    expect(plan.features).toBe(spi.features)
  })
})
