import { describe, expect, it } from 'vitest'
import { matchLastUsed } from './webserial'

const port = (usbVendorId?: number, usbProductId?: number) => ({ getInfo: () => ({ usbVendorId, usbProductId }) })
const stm32 = { usbVendorId: 0x0483, usbProductId: 0x5740 }

describe('matchLastUsed', () => {
  it('finds the last used device among the granted ports', () => {
    const fc = port(0x0483, 0x5740)
    expect(matchLastUsed([port(0x10c4, 0xea60), fc], stm32)).toBe(fc)
  })

  it('asks instead of guessing', () => {
    expect(matchLastUsed([port(0x0483, 0x5740)], null)).toBeNull() // nothing remembered
    expect(matchLastUsed([port(0x10c4, 0xea60), port()], stm32)).toBeNull() // not plugged in
    expect(matchLastUsed([port(0x0483, 0x5740), port(0x0483, 0x5740)], stm32)).toBeNull() // two of the same kind
  })
})
