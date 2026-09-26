/** Motor direction (DShot commands) and output swapping (`motor_output_reordering`), model + I/O against the mock FC. */
import { describe, expect, it } from 'vitest'
import { mockEscReversed } from '@/lib/mock-fc/mockEscs'
import { MockFlightController } from '@/lib/mock-fc/mockFc'
import { readMotorsSnapshot, saveMotors, setMotorDirection } from '@/lib/motors/io'
import {
  decodeDshotCommand,
  decodeMotorOutputReordering,
  fcMotorIndexes,
  motorSettingsChanged,
  toFcOutputs,
  DSHOT_CMD,
  DSHOT_CMD_TYPE,
  encodeDshotCommand,
  encodeMotorOutputReordering,
  isDefaultOutputOrder,
  readMotors,
  remappedMotors,
  spinDirectionRequest,
  swapMotorOutputs,
  validateMotors,
} from '@/lib/motors/model'
import { sendReboot } from '@/lib/msp/api'
import { MspClient } from '@/lib/msp/client'
import { MockTransport } from '@/lib/transport/mock'

async function connect(fc = new MockFlightController()) {
  const transport = new MockTransport(fc, 0)
  await transport.open()
  return { fc, transport, client: new MspClient(transport) }
}

const IDENTITY = [0, 1, 2, 3, 4, 5, 6, 7]

describe('motor output reordering', () => {
  it('round-trips the count-prefixed list', () => {
    const order = [2, 1, 0, 3, 4, 5, 6, 7]
    const bytes = encodeMotorOutputReordering(order)
    expect([...bytes]).toEqual([8, 2, 1, 0, 3, 4, 5, 6, 7])
    expect(decodeMotorOutputReordering(bytes)).toEqual(order)
    expect(decodeMotorOutputReordering(Uint8Array.of(8, 0, 1))).toEqual([0, 1]) // short payload
  })

  it('swaps two motors and reports what is remapped', () => {
    expect(isDefaultOutputOrder(IDENTITY)).toBe(true)
    const swapped = swapMotorOutputs(IDENTITY, 1, 3)
    expect(swapped).toEqual([2, 1, 0, 3, 4, 5, 6, 7])
    expect(isDefaultOutputOrder(swapped)).toBe(false)
    expect(remappedMotors(swapped, 4)).toEqual([
      { motor: 1, output: 3 },
      { motor: 3, output: 1 },
    ])
    expect(swapMotorOutputs(swapped, 3, 1)).toEqual(IDENTITY) // swapping back
    expect(swapMotorOutputs(IDENTITY, 2, 2)).toEqual(IDENTITY)
    expect(swapMotorOutputs(IDENTITY, 2, 9)).toEqual(IDENTITY) // no such motor
    expect(remappedMotors(IDENTITY, 4)).toEqual([])
  })

  it('routes shown motors to the FC motor that drives their output until the order is saved', () => {
    const fcIdentity = IDENTITY
    expect(fcMotorIndexes(fcIdentity, IDENTITY, 4)).toEqual([0, 1, 2, 3])
    expect(fcMotorIndexes(fcIdentity, [2, 1, 0, 3, 4, 5, 6, 7], 4)).toEqual([2, 1, 0, 3])
    // saved already: identity again
    expect(fcMotorIndexes([2, 1, 0, 3, 4, 5, 6, 7], [2, 1, 0, 3, 4, 5, 6, 7], 4)).toEqual([
      0, 1, 2, 3,
    ])
    // a pending change on top of a saved one
    expect(fcMotorIndexes([1, 0, 2, 3, 4, 5, 6, 7], [2, 1, 0, 3, 4, 5, 6, 7], 4)).toEqual([
      2, 0, 1, 3,
    ])
    expect(fcMotorIndexes([], [], 2)).toEqual([0, 1]) // nothing known: as is

    expect(toFcOutputs([1010, 1000, 1000, 1000], [2, 1, 0, 3])).toEqual([
      1000, 1000, 1010, 1000, 1000, 1000, 1000, 1000,
    ])
  })

  it('a swap that trades the slider values along leaves the FC outputs untouched', () => {
    // whatever the FC has saved and whatever is pending, swapping two motors mid-spin changes nothing physically
    const trade = <T>(list: T[], a: number, b: number) => {
      const next = [...list]
      const va = next[a - 1]
      const vb = next[b - 1]
      if (va !== undefined && vb !== undefined) {
        next[a - 1] = vb
        next[b - 1] = va
      }
      return next
    }
    for (const fcOrder of [IDENTITY, [2, 1, 0, 3, 4, 5, 6, 7], [1, 0, 3, 2, 4, 5, 6, 7]])
      for (const pending of [IDENTITY, [3, 1, 2, 0, 4, 5, 6, 7]])
        for (const [a, b] of [
          [1, 3],
          [2, 4],
          [1, 2],
        ] as const) {
          const values = [1010, 1000, 1200, 1000]
          const before = toFcOutputs(values, fcMotorIndexes(fcOrder, pending, 4))
          const after = toFcOutputs(
            trade(values, a, b),
            fcMotorIndexes(fcOrder, swapMotorOutputs(pending, a, b), 4),
          )
          expect(after).toEqual(before)
        }
  })

  it('tells settings edits (which lock the test) from a pending order (which does not)', () => {
    const snapshot = {
      advancedConfig: [1, 1, 0, 6, 0xe0, 0x01, 0x26, 0x02],
      motorCount: 4,
      maxThrottle: 2000,
      minCommand: 1000,
      poles: 14,
      bidirDshot: false,
      mixerMode: 3,
      propsOut: false,
      dynIdle: 0,
      outputOrder: IDENTITY,
    }
    const draft = readMotors(snapshot)
    expect(motorSettingsChanged(draft, snapshot)).toBe(false)
    expect(
      motorSettingsChanged({ ...draft, outputOrder: swapMotorOutputs(IDENTITY, 1, 2) }, snapshot),
    ).toBe(false)
    expect(motorSettingsChanged({ ...draft, poles: 12 }, snapshot)).toBe(true)
  })

  it('rejects two motors on the same output', () => {
    const draft = {
      protocol: 6,
      bidirDshot: false,
      poles: 14,
      propsOut: false,
      dynIdle: 20,
      motorIdle: 550,
      outputOrder: IDENTITY,
    }
    expect(validateMotors(draft)).toEqual([])
    expect(validateMotors({ ...draft, outputOrder: [0, 0, 2, 3, 4, 5, 6, 7] })).toEqual([
      'Every motor needs its own output.',
    ])
  })

  it('saves a swap so it survives a reboot', async () => {
    const { fc, transport, client } = await connect()
    const snapshot = await readMotorsSnapshot(client)
    expect(snapshot.outputOrder).toEqual(IDENTITY)

    const draft = readMotors(snapshot)
    draft.outputOrder = swapMotorOutputs(draft.outputOrder, 2, 4)
    await saveMotors(client, snapshot, draft)
    const dropped = new Promise<void>((resolve) => transport.onClose(resolve))
    await sendReboot(client)
    await dropped
    const after = await readMotorsSnapshot((await connect(fc)).client)
    expect(after.outputOrder).toEqual([0, 3, 2, 1, 4, 5, 6, 7])
    expect(fc.savedConfig.motorOutputReordering).toEqual([0, 3, 2, 1, 4, 5, 6, 7])
  })
})

describe('motor direction', () => {
  it('encodes a blocking direction + save command for one motor', () => {
    const request = spinDirectionRequest(2, true)
    expect(request).toEqual({
      type: DSHOT_CMD_TYPE.BLOCKING,
      motorIndex: 1,
      commands: [DSHOT_CMD.SPIN_DIRECTION_REVERSED, DSHOT_CMD.SAVE_SETTINGS],
    })
    const bytes = encodeDshotCommand(request)
    expect([...bytes]).toEqual([1, 1, 2, 8, 12])
    expect(decodeDshotCommand(bytes)).toEqual(request)
    expect(spinDirectionRequest(1, false).commands).toEqual([7, 12])
  })

  it('flips the direction the mock ESC has stored, and only with a DShot protocol', async () => {
    const { fc, client } = await connect()
    // defaultMockEscs: motors 2 and 3 reversed
    expect(fc.connectedEscs.map(mockEscReversed)).toEqual([false, true, true, false])

    await setMotorDirection(client, 2, false)
    await setMotorDirection(client, 1, true)
    expect(fc.connectedEscs.map(mockEscReversed)).toEqual([true, false, true, false])
    expect(fc.dshotCommandLog).toEqual([
      { type: 1, motorIndex: 1, commands: [7, 12] },
      { type: 1, motorIndex: 0, commands: [8, 12] },
    ])

    const snapshot = await readMotorsSnapshot(client)
    await saveMotors(client, snapshot, { ...readMotors(snapshot), protocol: 0 }) // PWM
    await setMotorDirection(client, 3, false)
    expect(fc.connectedEscs.map(mockEscReversed)).toEqual([true, false, true, false])
    expect(fc.dshotCommandLog).toHaveLength(2)
  })
})
