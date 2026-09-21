/**
 * MSP command codes (subset). Names and numbers match Betaflight's `msp_protocol.h`.
 * Add new codes here first, then a decoder/encoder, a test, and a mock-FC response.
 */
export const MSP = {
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  BUILD_INFO: 5,

  MODE_RANGES: 34,
  SET_MODE_RANGE: 35,
  FEATURE_CONFIG: 36,
  SET_FEATURE_CONFIG: 37,
  BOARD_ALIGNMENT_CONFIG: 38,
  SET_BOARD_ALIGNMENT_CONFIG: 39,
  MIXER_CONFIG: 42,
  SET_MIXER_CONFIG: 43,
  RX_CONFIG: 44,
  REBOOT: 68,
  DATAFLASH_SUMMARY: 70,
  DATAFLASH_ERASE: 72,
  SDCARD_SUMMARY: 79,
  BLACKBOX_CONFIG: 80,
  SET_BLACKBOX_CONFIG: 81,
  ADVANCED_CONFIG: 90,
  SET_ADVANCED_CONFIG: 91,
  SET_ARMING_DISABLED: 99,

  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  RC: 105,
  ATTITUDE: 108,
  ANALOG: 110,
  PID: 112,
  BOXIDS: 119,
  MOTOR_CONFIG: 131,
  SIMPLIFIED_TUNING: 140,
  SET_SIMPLIFIED_TUNING: 141,
  CALCULATE_SIMPLIFIED_PID: 142,

  SET_MOTOR: 214,
  SET_MOTOR_CONFIG: 222,
  MODE_RANGES_EXTRA: 238,
  EEPROM_WRITE: 250,

  // MSP v2 (16-bit codes)
  COMMON_SERIAL_CONFIG: 0x1009,
  COMMON_SET_SERIAL_CONFIG: 0x100a,
  /** Payload: ASCII "name = value". Reading ("name") is broken in Betaflight 2026.6 — write-only. */
  CLI_SETTING: 0x3010,
} as const

export type MspCode = (typeof MSP)[keyof typeof MSP]
