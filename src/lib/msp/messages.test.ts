import { describe, expect, it } from 'vitest'
import {
  decodeCliSetting,
  decodeFeatureMask,
  decodeSerialConfig,
  encodeCliSettingWrite,
  encodeFcVersion,
  encodeFeatureMask,
  encodeSerialConfig,
  decodeAnalog,
  decodeApiVersion,
  decodeAttitude,
  decodeBoardInfo,
  decodeFcVariant,
  decodeFcVersion,
  decodeStatus,
  encodeAnalog,
  encodeAttitude,
  encodeBoardInfo,
  encodeStatus,
} from './messages'

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

describe('message decoders', () => {
  it('decodes MSP_API_VERSION', () => {
    expect(decodeApiVersion(Uint8Array.of(0, 1, 47))).toEqual({ protocolVersion: 0, major: 1, minor: 47 })
  })

  it('decodes MSP_FC_VARIANT', () => {
    expect(decodeFcVariant(Uint8Array.from(ascii('BTFL')))).toBe('BTFL')
  })

  it('decodes MSP_FC_VERSION', () => {
    expect(decodeFcVersion(Uint8Array.of(4, 5, 2))).toEqual({ major: 4, minor: 5, patch: 2, versionString: '' })
  })

  it('decodes a calendar-versioned MSP_FC_VERSION (API 1.47+)', () => {
    const version = { major: 26, minor: 6, patch: 2, versionString: '2026.6.2' }
    expect(decodeFcVersion(encodeFcVersion(version))).toEqual(version)
  })

  it('round-trips the serial config, including high function bits', () => {
    const ports = [
      { identifier: 20, functionMask: 1, mspBaud: 5, gpsBaud: 4, telemetryBaud: 0, blackboxBaud: 5 },
      { identifier: 51, functionMask: 131073, mspBaud: 5, gpsBaud: 4, telemetryBaud: 0, blackboxBaud: 5 },
    ]
    expect(decodeSerialConfig(encodeSerialConfig(ports))).toEqual(ports)
    expect(encodeSerialConfig(ports)).toHaveLength(1 + 2 * 9)
  })

  it('encodes and parses CLI settings', () => {
    const payload = encodeCliSettingWrite('vcd_video_system', 'HD')
    expect(String.fromCharCode(...payload)).toBe('vcd_video_system = HD')
    expect(decodeCliSetting(payload)).toEqual({ name: 'vcd_video_system', value: 'HD' })
    expect(decodeCliSetting(Uint8Array.from('vcd_video_system', (c) => c.charCodeAt(0)))).toBeNull()
  })

  it('round-trips feature masks with bit 31 set', () => {
    expect(decodeFeatureMask(encodeFeatureMask(0x80000008))).toBe(0x80000008)
  })

  it('decodes MSP_BOARD_INFO with names', () => {
    const info = {
      identifier: 'S405',
      hardwareRevision: 3,
      targetName: 'STM32F405',
      boardName: 'SPEEDYBEEF405V4',
      manufacturerId: 'SPBE',
      gyroSampleRateHz: 3200,
    }
    expect(decodeBoardInfo(encodeBoardInfo(info))).toEqual(info)
  })

  it('decodes a legacy MSP_BOARD_INFO that only has identifier + revision', () => {
    expect(decodeBoardInfo(Uint8Array.from([...ascii('AFNA'), 0x02, 0x00]))).toEqual({
      identifier: 'AFNA',
      hardwareRevision: 2,
      targetName: '',
      boardName: '',
      manufacturerId: '',
      gyroSampleRateHz: 0,
    })
  })

  it('decodes MSP_STATUS', () => {
    const status = { cycleTimeUs: 125, i2cErrors: 1, sensors: 0b100001, modeFlags: 0x80000001, pidProfile: 2, cpuLoad: 14 }
    expect(decodeStatus(encodeStatus(status))).toEqual(status)
  })

  it('decodes MSP_STATUS without cpu load', () => {
    expect(decodeStatus(Uint8Array.of(125, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0)).cpuLoad).toBe(0)
  })

  it('decodes MSP_ATTITUDE, including negative angles', () => {
    // roll -12.5° = -125 = 0xff83, pitch 3.0° = 30, yaw 270
    expect(decodeAttitude(Uint8Array.of(0x83, 0xff, 30, 0, 0x0e, 0x01))).toEqual({ roll: -12.5, pitch: 3, yaw: 270 })
    expect(decodeAttitude(encodeAttitude({ roll: -179.9, pitch: 45.5, yaw: 359 }))).toEqual({
      roll: -179.9,
      pitch: 45.5,
      yaw: 359,
    })
  })

  it('decodes MSP_ANALOG, preferring the high-resolution voltage', () => {
    expect(decodeAnalog(encodeAnalog({ voltage: 16.24, mAhDrawn: 850, rssi: 1023, amperage: -0.5 }))).toEqual({
      voltage: 16.24,
      mAhDrawn: 850,
      rssi: 1023,
      amperage: -0.5,
    })
  })

  it('decodes a legacy MSP_ANALOG with 0.1 V resolution only', () => {
    expect(decodeAnalog(Uint8Array.of(162, 0, 0, 0, 0, 0, 0)).voltage).toBeCloseTo(16.2)
  })

  it('throws RangeError on truncated payloads', () => {
    expect(() => decodeAttitude(Uint8Array.of(1, 2, 3))).toThrow(RangeError)
    expect(() => decodeFcVariant(Uint8Array.of(66, 84))).toThrow(RangeError)
  })
})
