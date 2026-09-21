/** Blackbox settings and storage status (docs/tabs/blackbox.md). Layouts: Betaflight 2026.6 msp.c. */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

/** Betaflight `BlackboxDevice`. */
export const BLACKBOX_DEVICE = { NONE: 0, FLASH: 1, SDCARD: 2, SERIAL: 3 } as const

/** Betaflight `blackboxSampleRate_e`: log every 2^n-th PID loop. */
export const SAMPLE_RATES = [0, 1, 2, 3, 4] as const

export interface BlackboxConfig {
  supported: boolean
  device: number
  sampleRate: number
  /** Passed through unchanged; this app doesn't edit which fields are logged. */
  fieldsDisabledMask: number
}

// ---- MSP_BLACKBOX_CONFIG (80) / MSP_SET_BLACKBOX_CONFIG (81) ----

export function decodeBlackboxConfig(payload: Uint8Array): BlackboxConfig {
  const r = new ByteReader(payload)
  const supported = r.u8() !== 0
  const device = r.u8()
  r.skip(4) // rate numerator, rate denominator, pRatio:u16 — all superseded by sampleRate
  return { supported, device, sampleRate: r.u8(), fieldsDisabledMask: r.remaining >= 4 ? r.u32() : 0 }
}

export function encodeBlackboxConfig(config: BlackboxConfig): Uint8Array {
  return new ByteWriter()
    .u8(config.supported ? 1 : 0)
    .u8(config.device)
    .u8(1)
    .u8(1 << config.sampleRate)
    .u16(0)
    .u8(config.sampleRate)
    .u32(config.fieldsDisabledMask)
    .toBytes()
}

/** SET has no leading "supported" byte; the firmware prefers sampleRate over the legacy rate fields. */
export function encodeSetBlackboxConfig(config: BlackboxConfig): Uint8Array {
  return encodeBlackboxConfig(config).subarray(1)
}

// ---- MSP_DATAFLASH_SUMMARY (70) ----

export interface DataflashSummary {
  supported: boolean
  ready: boolean
  totalBytes: number
  usedBytes: number
}

export function decodeDataflashSummary(payload: Uint8Array): DataflashSummary {
  const r = new ByteReader(payload)
  const flags = r.u8()
  r.skip(4) // sector count
  return { supported: (flags & 2) !== 0, ready: (flags & 1) !== 0, totalBytes: r.u32(), usedBytes: r.u32() }
}

export function encodeDataflashSummary(s: DataflashSummary): Uint8Array {
  return new ByteWriter()
    .u8((s.supported ? 2 : 0) | (s.ready ? 1 : 0))
    .u32(0)
    .u32(s.totalBytes)
    .u32(s.usedBytes)
    .toBytes()
}

// ---- MSP_SDCARD_SUMMARY (79) ----

export const SDCARD_STATE = { NOT_PRESENT: 0, FATAL: 1, CARD_INIT: 2, FS_INIT: 3, READY: 4 } as const

export interface SdcardSummary {
  supported: boolean
  state: number
  freeKb: number
  totalKb: number
}

export function decodeSdcardSummary(payload: Uint8Array): SdcardSummary {
  const r = new ByteReader(payload)
  const supported = (r.u8() & 1) !== 0
  const state = r.u8()
  r.skip(1) // last error
  return { supported, state, freeKb: r.u32(), totalKb: r.u32() }
}

export function encodeSdcardSummary(s: SdcardSummary): Uint8Array {
  return new ByteWriter().u8(s.supported ? 1 : 0).u8(s.state).u8(0).u32(s.freeKb).u32(s.totalKb).toBytes()
}

// ---- presentation helpers ----

export interface BlackboxSnapshot {
  config: BlackboxConfig
  flash: DataflashSummary
  sdcard: SdcardSummary
  /** PID loop time in µs (MSP_STATUS), used to show logging rates in Hz. 0 = unknown. */
  cycleTimeUs: number
}

export function sdcardStateLabel(state: number): string {
  switch (state) {
    case SDCARD_STATE.NOT_PRESENT:
      return 'No card inserted'
    case SDCARD_STATE.FATAL:
      return 'Card error'
    case SDCARD_STATE.READY:
      return 'Ready'
    default:
      return 'Initialising…'
  }
}

/** e.g. "1/2 (4 kHz)" */
export function sampleRateLabel(sampleRate: number, cycleTimeUs: number): string {
  const fraction = `1/${1 << sampleRate}`
  if (cycleTimeUs <= 0) return fraction
  const hz = 1_000_000 / cycleTimeUs / (1 << sampleRate)
  return `${fraction} (${hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`})`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} kB`
}
