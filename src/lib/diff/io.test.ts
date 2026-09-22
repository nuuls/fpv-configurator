import { describe, expect, it } from 'vitest'
import {
  defaultMockConfig,
  firmwareDefaultConfig,
  MockFlightController,
} from '@/lib/mock-fc/mockFc'
import { readFcInfo } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'
import { Emitter, type Transport } from '@/lib/transport/types'
import {
  CliCommandError,
  CliTimeoutError,
  CliUnavailableError,
  readDiff,
  runCliCommands,
} from './io'
import { countDifferences } from './model'

async function openMock(fc = new MockFlightController()) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return new MspClient(transport)
}

/** Transport double: records writes, lets the test inject incoming bytes. */
class FakeTransport implements Transport {
  readonly label = 'fake'
  readonly written: Uint8Array[] = []
  private readonly data = new Emitter<Uint8Array>()
  private readonly closed = new Emitter<void>()

  async open() {}
  async close() {
    this.closed.emit()
  }
  async write(data: Uint8Array) {
    this.written.push(data)
  }
  onData(listener: (chunk: Uint8Array) => void) {
    return this.data.on(listener)
  }
  onClose(listener: () => void) {
    return this.closed.on(listener)
  }
  receive(chunk: Uint8Array) {
    this.data.emit(chunk)
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const ascii = (text: string) => new TextEncoder().encode(text)

describe('readDiff against the mock FC', () => {
  it('reports the setup of the default mock: telemetry, the receiver and ESC sensor ports, two modes, two settings', async () => {
    const report = await readDiff(await openMock())

    expect(report.firmware).toContain('Betaflight')
    expect(report.board).toBe('MOCK/MOCKF405')
    expect(report.errors).toEqual([])
    expect(report.restore).toEqual(['profile 0', 'rateprofile 0', 'battery_profile 0'])
    expect(report.sections.map((s) => s.title)).toEqual(['feature', 'serial', 'aux', 'master'])
    expect(report.sections.find((s) => s.title === 'serial')?.entries).toEqual([
      { kind: 'command', line: 'serial UART2 0 115200 57600 0 115200', isDefault: true },
      { kind: 'command', line: 'serial UART2 64 115200 57600 0 115200', isDefault: false },
      { kind: 'command', line: 'serial UART3 0 115200 57600 0 115200', isDefault: true },
      { kind: 'command', line: 'serial UART3 1024 115200 57600 0 115200', isDefault: false },
    ])
    expect(countDifferences(report)).toBe(8)
  })

  it('reports nothing for an FC at its defaults', async () => {
    const report = await readDiff(
      await openMock(new MockFlightController({ config: firmwareDefaultConfig() })),
    )
    expect(report.sections).toEqual([])
  })

  it('reports master and profile settings with their defaults', async () => {
    const config = defaultMockConfig()
    config.boardAlignment.yaw = 90
    config.settings.dyn_idle_min_rpm = '35'
    const report = await readDiff(await openMock(new MockFlightController({ config })))

    expect(report.sections.find((s) => s.title === 'master')?.entries).toEqual([
      { kind: 'setting', name: 'align_board_yaw', value: '90', defaultValue: '0' },
      { kind: 'setting', name: 'crashflip_motor_percent', value: '50', defaultValue: '0' },
      { kind: 'setting', name: 'osd_units', value: 'IMPERIAL', defaultValue: 'METRIC' },
    ])
    expect(report.sections.find((s) => s.title === 'profile 0')?.entries).toEqual([
      { kind: 'setting', name: 'dyn_idle_min_rpm', value: '35', defaultValue: '0' },
    ])
  })

  it('hands the link back to MSP', async () => {
    const client = await openMock()
    const [, info] = await Promise.all([readDiff(client), readFcInfo(client)])
    expect(info.variant).toBe('BTFL')
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })
})

describe('runCliCommands against the mock FC', () => {
  it('changes the running config, not the saved one', async () => {
    const fc = new MockFlightController()
    const client = await openMock(fc)
    await runCliCommands(client, ['profile 0', 'set osd_units = METRIC', 'profile 0'])
    const master = (await readDiff(client)).sections.find((s) => s.title === 'master')
    expect(master?.entries.map((e) => (e.kind === 'setting' ? e.name : e.line))).toEqual([
      'crashflip_motor_percent',
    ])
    expect(fc.savedConfig.settings.osd_units).toBe('IMPERIAL')
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })

  it('rejects with what the CLI complained about, and leaves the link in MSP', async () => {
    const client = await openMock()
    await expect(runCliCommands(client, ['set no_such_setting = 1'])).rejects.toThrow(
      /INVALID NAME/,
    )
    await expect(runCliCommands(client, ['set no_such_setting = 1'])).rejects.toBeInstanceOf(
      CliCommandError,
    )
    expect((await readFcInfo(client)).variant).toBe('BTFL')
  })

  it('sends nothing for no lines', async () => {
    const transport = new FakeTransport()
    await runCliCommands(new MspClient(transport), [])
    expect(transport.written).toEqual([])
  })
})

describe('readDiff on the wire', () => {
  it('sends STX, then the command with the ETX once the FC echoed the STX', async () => {
    const transport = new FakeTransport()
    const pending = readDiff(new MspClient(transport))
    await flush()
    expect(transport.written).toEqual([Uint8Array.of(0x02)])

    transport.receive(Uint8Array.of(0x02))
    await flush()
    expect(transport.written[1]).toEqual(Uint8Array.of(...ascii('diff all defaults\n'), 0x03))

    transport.receive(ascii('\r\n# master\r\nset small'))
    transport.receive(Uint8Array.of(...ascii('_angle = 180\r\n'), 0x03))
    expect((await pending).sections).toEqual([
      {
        title: 'master',
        entries: [{ kind: 'setting', name: 'small_angle', value: '180', defaultValue: null }],
      },
    ])
  })

  it('sends every line of a script in one go, the ETX last', async () => {
    const transport = new FakeTransport()
    const pending = runCliCommands(new MspClient(transport), [
      'profile 1',
      'set tpa_rate = 65',
      'profile 0',
    ])
    await flush()
    transport.receive(Uint8Array.of(0x02))
    await flush()
    expect(transport.written[1]).toEqual(
      Uint8Array.of(...ascii('profile 1\nset tpa_rate = 65\nprofile 0\n'), 0x03),
    )
    transport.receive(
      Uint8Array.of(...ascii('profile 1\r\ntpa_rate set to 65\r\nprofile 0\r\n'), 0x03),
    )
    await expect(pending).resolves.toBeUndefined()
  })

  it('fails when the FC ignores the STX (armed), and sends an ETX anyway', async () => {
    const transport = new FakeTransport()
    await expect(readDiff(new MspClient(transport), { enterTimeoutMs: 10 })).rejects.toBeInstanceOf(
      CliUnavailableError,
    )
    expect(transport.written.at(-1)).toEqual(Uint8Array.of(0x03))
  })

  it('fails when the output stops without an ETX', async () => {
    const transport = new FakeTransport()
    const pending = readDiff(new MspClient(transport), { idleTimeoutMs: 10 })
    await flush()
    transport.receive(Uint8Array.of(0x02, ...ascii('# master\r\n')))
    await expect(pending).rejects.toBeInstanceOf(CliTimeoutError)
    expect(transport.written.at(-1)).toEqual(Uint8Array.of(0x03))
  })
})
