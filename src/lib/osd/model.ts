/**
 * OSD elements — docs/tabs/osd.md. Layouts: Betaflight 2026.6 msp.c (MSP_OSD_CONFIG 84, MSP_SET_OSD_CONFIG 85,
 * MSP_OSD_CANVAS 189) and osd/osd.h (element order, position bits, timers).
 */
import { ByteReader, ByteWriter } from '@/lib/msp/bytes'

/** `osd_items_e` in firmware order: the position in this list is the element's index on the wire. */
const FIRMWARE_ELEMENTS = (
  'RSSI_VALUE MAIN_BATT_VOLTAGE CROSSHAIRS ARTIFICIAL_HORIZON HORIZON_SIDEBARS ITEM_TIMER_1 ITEM_TIMER_2 FLYMODE ' +
  'CRAFT_NAME THROTTLE_POS VTX_CHANNEL CURRENT_DRAW MAH_DRAWN GPS_SPEED GPS_SATS ALTITUDE ROLL_PIDS PITCH_PIDS ' +
  'YAW_PIDS POWER PIDRATE_PROFILE WARNINGS AVG_CELL_VOLTAGE GPS_LON GPS_LAT DEBUG PITCH_ANGLE ROLL_ANGLE ' +
  'MAIN_BATT_USAGE DISARMED HOME_DIR HOME_DIST NUMERICAL_HEADING NUMERICAL_VARIO COMPASS_BAR ESC_TMP ESC_RPM ' +
  'REMAINING_TIME_ESTIMATE RTC_DATETIME ADJUSTMENT_RANGE CORE_TEMPERATURE ANTI_GRAVITY G_FORCE MOTOR_DIAG ' +
  'LOG_STATUS FLIP_ARROW LINK_QUALITY FLIGHT_DIST STICK_OVERLAY_LEFT STICK_OVERLAY_RIGHT PILOT_NAME ESC_RPM_FREQ ' +
  'RATE_PROFILE_NAME PID_PROFILE_NAME PROFILE_NAME RSSI_DBM_VALUE RC_CHANNELS CAMERA_FRAME EFFICIENCY ' +
  'TOTAL_FLIGHTS UP_DOWN_REFERENCE TX_UPLINK_POWER WATT_HOURS_DRAWN AUX_VALUE READY_MODE RSNR_VALUE ' +
  'SYS_GOGGLE_VOLTAGE SYS_VTX_VOLTAGE SYS_BITRATE SYS_DELAY SYS_DISTANCE SYS_LQ SYS_GOGGLE_DVR SYS_VTX_DVR ' +
  'SYS_WARNINGS SYS_VTX_TEMP SYS_FAN_SPEED GPS_LAP_TIME_CURRENT GPS_LAP_TIME_PREVIOUS GPS_LAP_TIME_BEST3 DEBUG2 ' +
  'CUSTOM_MSG0 CUSTOM_MSG1 CUSTOM_MSG2 CUSTOM_MSG3 LIDAR_DIST CUSTOM_SERIAL_TEXT BATTERY_PROFILE_NAME'
).split(' ')

/** Number of elements Betaflight 2026.6 reports (without the optional flight-plan elements). */
export const FIRMWARE_ELEMENT_COUNT = FIRMWARE_ELEMENTS.length

/** Wire index of a firmware element, e.g. `elementIndex('WARNINGS')` → 21. */
export function elementIndex(firmwareName: string): number {
  return FIRMWARE_ELEMENTS.indexOf(firmwareName)
}

/** Readable name for any element, e.g. 2 → "Crosshairs". */
export function elementName(index: number): string {
  const name = FIRMWARE_ELEMENTS[index]
  if (!name) return `Element ${index}`
  const words = name
    .replace(/^ITEM_/, '')
    .toLowerCase()
    .split('_')
    .join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface Canvas {
  cols: number
  rows: number
}

export interface Cell {
  x: number
  y: number
}

export interface OsdElementDef {
  index: number
  label: string
  /** What the preview draws, one character per cell (metric units). */
  sample: string
  /** The sample per `osd_units` (imperial, metric, British) for elements that show a unit. */
  samples?: readonly [string, string, string]
  hint?: string
  /** Only drawn by the firmware with a GPS, so only listed when one is set up in the Ports tab. */
  gps?: boolean
  /** Where the element goes when it is switched on while still on the firmware's default pile. */
  suggest: (canvas: Canvas) => Cell
}

const centred = (canvas: Canvas, width: number) =>
  Math.max(0, Math.floor((canvas.cols - width) / 2))
const right = (canvas: Canvas, width: number) => Math.max(0, canvas.cols - 1 - width)
const fromBottom = (canvas: Canvas, rows: number) => Math.max(0, canvas.rows - 1 - rows)

const element = (
  firmwareName: string,
  label: string,
  sample: string,
  suggest: (canvas: Canvas) => Cell,
  hint?: string,
): OsdElementDef => ({ index: elementIndex(firmwareName), label, sample, suggest, hint })

const gpsElement = (...args: Parameters<typeof element>): OsdElementDef => ({
  ...element(...args),
  gps: true,
})

/** Samples in imperial, metric and British units; British is metric with the speed in mph. */
const withUnits = (def: OsdElementDef, imperial: string, british = def.sample): OsdElementDef => ({
  ...def,
  samples: [imperial, def.sample, british],
})

const CUSTOM_MESSAGE_HINT =
  'Shows this placeholder until a device (e.g. a Lua script) sends the text.'

/** The elements this app manages, in the order of docs/SPEC.md §2; the GPS ones only with a GPS. */
export const OSD_ELEMENTS: OsdElementDef[] = [
  element('AVG_CELL_VOLTAGE', 'Battery average cell voltage', '3.98V', (c) => ({
    x: 1,
    y: fromBottom(c, 1),
  })),
  element('CURRENT_DRAW', 'Current draw', '42.0A', (c) => ({ x: 1, y: fromBottom(c, 2) })),
  element('MAH_DRAWN', 'Used mAh', '690mAh', (c) => ({ x: right(c, 6), y: fromBottom(c, 1) })),
  element('LINK_QUALITY', 'Link quality', '2:100', () => ({ x: 1, y: 1 })),
  element('WARNINGS', 'Warnings', 'LOW BATTERY', (c) => ({
    x: centred(c, 11),
    y: Math.floor(c.rows / 2) + 2,
  })),
  element('DISARMED', 'Disarmed', 'DISARMED', (c) => ({ x: centred(c, 8), y: fromBottom(c, 3) })),
  element('ITEM_TIMER_2', 'Timer 2 (armed time)', '02:43', (c) => ({ x: right(c, 5), y: 1 })),
  ...[0, 1, 2, 3].map((n) =>
    element(
      `CUSTOM_MSG${n}`,
      `Custom message ${n + 1}`,
      `CUSTOM_MSG${n + 1}`,
      (c) => ({ x: centred(c, 11), y: 1 + n }),
      CUSTOM_MESSAGE_HINT,
    ),
  ),
  element(
    'VTX_CHANNEL',
    'VTX channel',
    'R:1:25',
    (c) => ({ x: right(c, 6), y: fromBottom(c, 2) }),
    'Band, channel and power.',
  ),
  withUnits(
    element('ALTITUDE', 'Altitude', '12.3m', (c) => ({ x: right(c, 5), y: 2 })),
    '40.4ft',
  ),
  // osdAddActiveElements adds exactly these `if (sensors(SENSOR_GPS))`; the lap timer is a separate build option.
  gpsElement('GPS_SATS', 'GPS satellites', 'SAT14', () => ({ x: 1, y: 2 })),
  withUnits(
    gpsElement('GPS_SPEED', 'GPS speed', '67KPH', () => ({ x: 1, y: 3 })),
    '42MPH',
    '42MPH',
  ),
  gpsElement('GPS_LAT', 'GPS latitude', 'N48.2081743', (c) => ({
    x: centred(c, 11),
    y: fromBottom(c, 2),
  })),
  gpsElement('GPS_LON', 'GPS longitude', 'E16.3738189', (c) => ({
    x: centred(c, 11),
    y: fromBottom(c, 1),
  })),
  gpsElement(
    'HOME_DIR',
    'Home direction',
    'H^',
    (c) => ({ x: right(c, 5) - 3, y: 3 }),
    'Arrow pointing home.',
  ),
  withUnits(
    gpsElement('HOME_DIST', 'Home distance', 'H120m', (c) => ({ x: right(c, 5), y: 3 })),
    'H394ft',
  ),
  withUnits(
    gpsElement('FLIGHT_DIST', 'Flight distance', '1.24km', (c) => ({ x: right(c, 6), y: 4 })),
    '0.77mi',
  ),
  withUnits(
    gpsElement(
      'EFFICIENCY',
      'Efficiency',
      '42mAh/km',
      (c) => ({ x: 1, y: fromBottom(c, 3) }),
      'Battery used per distance.',
    ),
    '68mAh/mi',
  ),
]

/** What the preview draws for this element with these `osd_units`. */
export function sampleFor(def: OsdElementDef, units: number): string {
  return def.samples?.[units] ?? def.sample
}

const VTX_CHANNEL = elementIndex('VTX_CHANNEL')
const TIMER_2_ELEMENT = elementIndex('ITEM_TIMER_2')

// ---- element position: [variant:2][profiles:3][x bit 5][y:5][x:5] ----

const XY_MASK = 0x1f
const X_HD_BIT = 0x400
const PROFILE_SHIFT = 11
const PROFILE_MASK = 0x3800
const VARIANT_SHIFT = 14

export const MAX_X = 63
export const MAX_Y = 31

export interface ElementPosition extends Cell {
  /** Bit n = visible in OSD profile n + 1. */
  profiles: number
  /** Element variant ("type"), 0–3. */
  variant: number
}

export function decodePosition(raw: number): ElementPosition {
  return {
    x: (raw & XY_MASK) | ((raw & X_HD_BIT) >> 5),
    y: (raw >> 5) & XY_MASK,
    profiles: (raw & PROFILE_MASK) >> PROFILE_SHIFT,
    variant: (raw >> VARIANT_SHIFT) & 0x3,
  }
}

export function encodePosition({ x, y, profiles, variant }: ElementPosition): number {
  return (
    (x & XY_MASK) |
    ((x << 5) & X_HD_BIT) |
    ((y & XY_MASK) << 5) |
    ((profiles << PROFILE_SHIFT) & PROFILE_MASK) |
    ((variant & 0x3) << VARIANT_SHIFT)
  )
}

// ---- MSP_OSD_CONFIG ----

export const VIDEO_SYSTEM = { AUTO: 0, PAL: 1, NTSC: 2, HD: 3 } as const
export const VIDEO_SYSTEM_NAMES = ['Auto', 'PAL', 'NTSC', 'HD']

/** `osd_unit_e`, byte 2 of MSP_OSD_CONFIG; the names are the CLI values of `osd_units`. */
export const OSD_UNITS = { IMPERIAL: 0, METRIC: 1, BRITISH: 2 } as const
export const OSD_UNIT_NAMES = ['IMPERIAL', 'METRIC', 'BRITISH']

const FLAG_OSD_FEATURE = 1 << 0
const FLAG_DEVICE_DETECTED = 1 << 5

export interface OsdConfig {
  /** False when the firmware was built without OSD. */
  supported: boolean
  deviceDetected: boolean
  videoSystem: number
  /** `osd_units`: an `OSD_UNITS` value. */
  units: number
  /** Raw `item_pos` per element, by firmware index. */
  positions: number[]
  /** Raw timer configs: source (bits 0–3), precision (4–7), alarm (8–15). */
  timers: number[]
  profileCount: number
  /** 1-based. */
  selectedProfile: number
}

export function decodeOsdConfig(payload: Uint8Array): OsdConfig {
  const config: OsdConfig = {
    supported: false,
    deviceDetected: false,
    videoSystem: VIDEO_SYSTEM.AUTO,
    units: OSD_UNITS.METRIC,
    positions: [],
    timers: [],
    profileCount: 1,
    selectedProfile: 1,
  }
  const r = new ByteReader(payload)
  if (r.remaining < 10) return config

  const flags = r.u8()
  config.supported = (flags & FLAG_OSD_FEATURE) !== 0
  config.deviceDetected = (flags & FLAG_DEVICE_DETECTED) !== 0
  config.videoSystem = r.u8()
  config.units = r.u8()
  r.skip(4) // rssi alarm, capacity alarm (u16), unused
  const itemCount = r.u8()
  r.skip(2) // altitude alarm
  for (let i = 0; i < itemCount && r.remaining >= 2; i++) config.positions.push(r.u16())

  if (r.remaining < 1) return config
  r.skip(Math.min(r.u8(), r.remaining)) // post-flight statistics
  if (r.remaining < 1) return config
  const timerCount = r.u8()
  for (let i = 0; i < timerCount && r.remaining >= 2; i++) config.timers.push(r.u16())

  if (r.remaining < 9) return config
  r.skip(7) // enabled warnings: low word, count, all 32 bits
  config.profileCount = Math.max(1, r.u8())
  config.selectedProfile = Math.min(Math.max(1, r.u8()), config.profileCount)
  return config
}

/** Inverse of `decodeOsdConfig` for the mock FC; alarms, statistics and warnings are zeroed. */
export function encodeOsdConfig(config: OsdConfig): Uint8Array {
  const w = new ByteWriter()
  w.u8(
    (config.supported ? FLAG_OSD_FEATURE : 0) | (config.deviceDetected ? FLAG_DEVICE_DETECTED : 0),
  )
  w.u8(config.videoSystem).u8(config.units).zeros(4).u8(config.positions.length).zeros(2)
  for (const position of config.positions) w.u16(position)
  w.u8(0) // no statistics
  w.u8(config.timers.length)
  for (const timer of config.timers) w.u16(timer)
  w.zeros(7).u8(config.profileCount).u8(config.selectedProfile)
  return w.zeros(7).toBytes() // stick overlay, camera frame, link quality + RSSI dBm alarms
}

export function decodeOsdCanvas(payload: Uint8Array): Canvas {
  const r = new ByteReader(payload)
  return r.remaining >= 2 ? { cols: r.u8(), rows: r.u8() } : { cols: 0, rows: 0 }
}

export function encodeOsdCanvas(canvas: Canvas): Uint8Array {
  return Uint8Array.of(canvas.cols, canvas.rows)
}

const SET_TIMER_ADDR = 0xfe // (int8_t)-2; -1 would be the general settings, which this app never writes
const IN_FLIGHT_SCREEN = 1 // screen 0 addresses the post-flight statistics instead

export function encodeSetOsdElement(index: number, position: number): Uint8Array {
  if (index < 0 || index >= SET_TIMER_ADDR) throw new RangeError(`Invalid OSD element ${index}`)
  return new ByteWriter().u8(index).u16(position).u8(IN_FLIGHT_SCREEN).toBytes()
}

export function encodeSetOsdTimer(timer: number, config: number): Uint8Array {
  return new ByteWriter().u8(SET_TIMER_ADDR).u8(timer).u16(config).toBytes()
}

export type OsdWrite = { element: number; position: number } | { timer: number; config: number }

/** Inverse of the two encoders, for the mock FC. Null for the general settings and malformed requests. */
export function decodeSetOsdConfig(payload: Uint8Array): OsdWrite | null {
  const r = new ByteReader(payload)
  if (r.remaining < 3) return null
  const addr = r.u8()
  if (addr === 0xff) return null
  if (addr === SET_TIMER_ADDR) return r.remaining >= 3 ? { timer: r.u8(), config: r.u16() } : null
  const position = r.u16()
  const screen = r.remaining >= 1 ? r.u8() : IN_FLIGHT_SCREEN
  return screen === 0 ? null : { element: addr, position }
}

// ---- canvas ----

const SD_COLS = 30
const PAL_ROWS = 16
const NTSC_ROWS = 13
const HD_DEFAULT: Canvas = { cols: 53, rows: 20 }

/**
 * Character grid of the display. `reported` is MSP_OSD_CANVAS, which `osdInit` sets to the display's real size:
 * with video system "auto" that can be NTSC's 13 rows (always, on an MSP displayport). It matters because at
 * boot the firmware moves every element below the display onto its last row, where they pile up. Without a
 * display an HD build keeps reporting its 53 × 20 default, which no SD video system has — then the video system
 * decides.
 */
export function canvasFor(videoSystem: number, reported: Canvas): Canvas {
  const hd = videoSystem === VIDEO_SYSTEM.HD
  const maxCols = hd ? MAX_X + 1 : SD_COLS
  const valid =
    reported.cols > 0 && reported.cols <= maxCols && reported.rows > 0 && reported.rows <= MAX_Y + 1
  if (valid) return reported
  return hd
    ? HD_DEFAULT
    : { cols: SD_COLS, rows: videoSystem === VIDEO_SYSTEM.NTSC ? NTSC_ROWS : PAL_ROWS }
}

// ---- snapshot → draft → writes ----

export interface OsdSnapshot {
  config: OsdConfig
  canvas: Canvas
  /** A GPS is set up in the Ports tab (port function + feature). */
  gpsConfigured: boolean
}

export interface ElementDraft extends Cell {
  index: number
  shown: boolean
}

export interface OsdDraft {
  elements: ElementDraft[]
  /** Switch off every element this app doesn't manage. */
  hideOthers: boolean
  /** `osd_units`: an `OSD_UNITS` value. */
  units: number
}

const selectedProfileBit = (config: OsdConfig) => 1 << (config.selectedProfile - 1)
const allProfiles = (config: OsdConfig) => (1 << Math.min(config.profileCount, 3)) - 1

/** The managed elements this firmware knows; the GPS ones only while a GPS is set up. */
export function availableElements(snapshot: OsdSnapshot): OsdElementDef[] {
  return OSD_ELEMENTS.filter(
    (def) => def.index < snapshot.config.positions.length && (!def.gps || snapshot.gpsConfigured),
  )
}

export function toDraft(snapshot: OsdSnapshot): OsdDraft {
  const { config } = snapshot
  return {
    hideOthers: false,
    units: config.units,
    elements: availableElements(snapshot).map((def) => {
      const { x, y, profiles } = decodePosition(config.positions[def.index] ?? 0)
      return { index: def.index, x, y, shown: (profiles & selectedProfileBit(config)) !== 0 }
    }),
  }
}

/** Elements outside this app's list that are switched on in any OSD profile. */
export function otherVisibleElements(snapshot: OsdSnapshot): number[] {
  const managed = new Set(availableElements(snapshot).map((def) => def.index))
  return snapshot.config.positions.flatMap((raw, index) =>
    !managed.has(index) && decodePosition(raw).profiles !== 0 ? [index] : [],
  )
}

/**
 * Every element starts on one spot near the centre: `OSD_POS(midCol - 5, midRow)`, with mid = (26, 10) in
 * builds with HD support and (15, 7) otherwise.
 */
function isOnDefaultPile({ x, y }: Cell): boolean {
  return (x === 21 && y === 10) || (x === 10 && y === 7)
}

export function setElementShown(
  draft: OsdDraft,
  index: number,
  shown: boolean,
  canvas: Canvas,
): OsdDraft {
  return {
    ...draft,
    elements: draft.elements.map((el) => {
      if (el.index !== index) return el
      const def = OSD_ELEMENTS.find((d) => d.index === index)
      const cell = shown && def && isOnDefaultPile(el) ? def.suggest(canvas) : { x: el.x, y: el.y }
      return { ...el, ...cell, shown }
    }),
  }
}

export function setElementCell(draft: OsdDraft, index: number, cell: Partial<Cell>): OsdDraft {
  return {
    ...draft,
    elements: draft.elements.map((el) => (el.index === index ? { ...el, ...cell } : el)),
  }
}

/** Where a drag or an arrow key may put an element: the whole sample text stays on the canvas. */
export function clampToCanvas(cell: Cell, sampleLength: number, canvas: Canvas): Cell {
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(0, Math.round(value)), Math.max(0, max))
  return { x: clamp(cell.x, canvas.cols - sampleLength), y: clamp(cell.y, canvas.rows - 1) }
}

export function validateOsd(draft: OsdDraft, canvas: Canvas): string[] {
  const problems: string[] = []
  for (const el of draft.elements) {
    if (!el.shown) continue
    const label = OSD_ELEMENTS.find((def) => def.index === el.index)?.label ?? elementName(el.index)
    if (!Number.isInteger(el.x) || el.x < 0 || el.x >= canvas.cols)
      problems.push(`${label}: X must be between 0 and ${canvas.cols - 1}.`)
    if (!Number.isInteger(el.y) || el.y < 0 || el.y >= canvas.rows)
      problems.push(`${label}: Y must be between 0 and ${canvas.rows - 1}.`)
  }
  return problems
}

const TIMER_2 = 1
const TIMER_SOURCE_MASK = 0x000f
const TIMER_SOURCE_TOTAL_ARMED = 1
const TIMER_SOURCE_LAST_ARMED = 2

/**
 * `set osd_units = …` when the draft changes the units, else null. The general settings message (addr -1) would
 * also write the video system, alarms and warnings, so the one CLI variable is set instead.
 */
export function unitsSetting(
  snapshot: OsdSnapshot,
  draft: OsdDraft,
): { name: string; value: string } | null {
  const value = OSD_UNIT_NAMES[draft.units]
  return draft.units === snapshot.config.units || value === undefined
    ? null
    : { name: 'osd_units', value }
}

/** Element and timer writes so the FC matches the draft; empty when nothing differs. */
export function planOsdWrites(snapshot: OsdSnapshot, draft: OsdDraft): OsdWrite[] {
  const { config } = snapshot
  const writes: OsdWrite[] = []

  for (const el of draft.elements) {
    const raw = config.positions[el.index]
    if (raw === undefined) continue
    const position = encodePosition({
      x: el.x,
      y: el.y,
      // One profile as far as this app is concerned: on or off everywhere.
      profiles: el.shown ? allProfiles(config) : 0,
      // The VTX element is specified as band:channel:power, which is variant 0.
      variant: el.index === VTX_CHANNEL ? 0 : decodePosition(raw).variant,
    })
    if (position !== raw) writes.push({ element: el.index, position })
  }

  if (draft.hideOthers) {
    for (const index of otherVisibleElements(snapshot))
      writes.push({ element: index, position: (config.positions[index] ?? 0) & ~PROFILE_MASK })
  }

  // "Timer 2 (armed time)": make sure it counts armed time, keeping precision and alarm.
  const timer = config.timers[TIMER_2]
  const timerShown = draft.elements.some((el) => el.index === TIMER_2_ELEMENT && el.shown)
  if (timerShown && timer !== undefined) {
    const source = timer & TIMER_SOURCE_MASK
    if (source !== TIMER_SOURCE_TOTAL_ARMED && source !== TIMER_SOURCE_LAST_ARMED)
      writes.push({
        timer: TIMER_2,
        config: (timer & ~TIMER_SOURCE_MASK) | TIMER_SOURCE_TOTAL_ARMED,
      })
  }
  return writes
}
