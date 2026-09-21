/**
 * MSP command codes (subset). Names and numbers match Betaflight's `msp_protocol.h`.
 * Add new codes here first, then a decoder/encoder in `messages.ts`, a test, and a mock-FC response.
 */
export const MSP = {
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  BUILD_INFO: 5,

  FEATURE_CONFIG: 36,
  SET_FEATURE_CONFIG: 37,
  RX_CONFIG: 44,
  REBOOT: 68,

  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  RC: 105,
  ATTITUDE: 108,
  ANALOG: 110,

  EEPROM_WRITE: 250,

  // MSP v2 (16-bit codes)
  COMMON_SERIAL_CONFIG: 0x1009,
  COMMON_SET_SERIAL_CONFIG: 0x100a,
  /** Payload: ASCII "name = value". Reading ("name") is broken in Betaflight 2026.6 — write-only. */
  CLI_SETTING: 0x3010,
} as const

export type MspCode = (typeof MSP)[keyof typeof MSP]
