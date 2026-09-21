import { describe, expect, it } from 'vitest'
import {
  availableElements,
  canvasFor,
  clampToCanvas,
  decodeOsdCanvas,
  decodeOsdConfig,
  decodePosition,
  decodeSetOsdConfig,
  elementIndex,
  elementName,
  encodeOsdCanvas,
  encodeOsdConfig,
  encodePosition,
  encodeSetOsdElement,
  encodeSetOsdTimer,
  OSD_ELEMENTS,
  otherVisibleElements,
  planOsdWrites,
  setElementCell,
  setElementShown,
  toDraft,
  validateOsd,
  VIDEO_SYSTEM,
  type OsdConfig,
  type OsdSnapshot,
} from './model'

const SD = { cols: 30, rows: 16 }
const HD = { cols: 53, rows: 20 }
const PILE = encodePosition({ x: 21, y: 10, profiles: 0, variant: 0 })

function snapshotWith(
  elements: Record<string, number>,
  overrides: Partial<OsdConfig> = {},
  gpsConfigured = false,
): OsdSnapshot {
  const positions = new Array<number>(88).fill(PILE)
  for (const [name, raw] of Object.entries(elements)) positions[elementIndex(name)] = raw
  const config: OsdConfig = {
    supported: true,
    deviceDetected: true,
    videoSystem: VIDEO_SYSTEM.AUTO,
    positions,
    timers: [0x0a00, 0x0a01],
    profileCount: 3,
    selectedProfile: 1,
    ...overrides,
  }
  return { config, canvas: canvasFor(config.videoSystem, { cols: 0, rows: 0 }), gpsConfigured }
}

const shownAt = (x: number, y: number, variant = 0) => encodePosition({ x, y, profiles: 0b111, variant })

describe('OSD elements', () => {
  it('uses the firmware indices of osd_items_e', () => {
    expect(OSD_ELEMENTS.filter((def) => !def.gps).map((def) => def.index)).toEqual([
      22, 11, 12, 46, 21, 29, 6, 81, 82, 83, 84, 10, 15,
    ])
    // GPS_SATS, GPS_SPEED, GPS_LAT, GPS_LON, HOME_DIR, HOME_DIST, FLIGHT_DIST, EFFICIENCY
    expect(OSD_ELEMENTS.filter((def) => def.gps).map((def) => def.index)).toEqual([14, 13, 24, 23, 30, 31, 47, 58])
    expect(elementName(2)).toBe('Crosshairs')
    expect(elementName(5)).toBe('Timer 1')
    expect(elementName(200)).toBe('Element 200')
  })

  it('suggests spots that keep every sample on both canvases without overlapping', () => {
    for (const canvas of [SD, HD, { cols: 30, rows: 13 }]) {
      const taken = new Set<string>()
      for (const def of OSD_ELEMENTS) {
        const cell = def.suggest(canvas)
        expect(clampToCanvas(cell, def.sample.length, canvas)).toEqual(cell)
        for (let i = 0; i < def.sample.length; i++) {
          const key = `${cell.x + i},${cell.y}`
          expect(taken.has(key), `${def.label} overlaps at ${key}`).toBe(false)
          taken.add(key)
        }
      }
    }
  })
})

describe('GPS elements', () => {
  const satsShown = { GPS_SATS: encodePosition({ x: 1, y: 2, profiles: 0b001, variant: 0 }) }

  it('are only managed while a GPS is set up', () => {
    const without = snapshotWith(satsShown)
    expect(availableElements(without)).toHaveLength(13)
    expect(toDraft(without).elements.some((el) => el.index === elementIndex('GPS_SATS'))).toBe(false)

    const withGps = snapshotWith(satsShown, {}, true)
    expect(availableElements(withGps)).toHaveLength(21)
    expect(toDraft(withGps).elements.find((el) => el.index === elementIndex('GPS_SATS'))).toEqual({
      index: 14,
      x: 1,
      y: 2,
      shown: true,
    })
  })

  it('count as other elements without a GPS, so they are never changed silently', () => {
    expect(otherVisibleElements(snapshotWith(satsShown))).toEqual([14])
    expect(otherVisibleElements(snapshotWith(satsShown, {}, true))).toEqual([])
    expect(planOsdWrites(snapshotWith(satsShown), toDraft(snapshotWith(satsShown)))).toEqual([])
  })
})

describe('element position', () => {
  it('matches the firmware OSD_POS / OSD_X / OSD_Y macros', () => {
    // x = 5, y = 3, profile 1 → 5 | 3 << 5 | 1 << 11
    expect(encodePosition({ x: 5, y: 3, profiles: 0b001, variant: 0 })).toBe(0x0865)
    // HD: x = 40 needs the extra bit 10 (40 = 0b101000 → low five bits 8, bit 10 set)
    expect(encodePosition({ x: 40, y: 19, profiles: 0, variant: 0 })).toBe(8 | 0x400 | (19 << 5))
    expect(decodePosition(0x0865)).toEqual({ x: 5, y: 3, profiles: 0b001, variant: 0 })
  })

  it('round-trips every field', () => {
    const position = { x: 52, y: 19, profiles: 0b101, variant: 2 }
    expect(decodePosition(encodePosition(position))).toEqual(position)
  })
})

describe('MSP_OSD_CONFIG', () => {
  it('decodes the 2026.6 layout', () => {
    // flags (feature + MSP device + detected), HD, units, rssi alarm, cap alarm, 0, 3 items, alt alarm
    const header = [0x61, 3, 0, 20, 0x98, 0x08, 0, 3, 100, 0]
    const items = [0x65, 0x08, 0x00, 0x00, 0x08, 0x3c] // 0x0865, 0, 0x3c08
    const stats = [2, 1, 0]
    const timers = [2, 0x00, 0x0a, 0x01, 0x0a]
    const warnings = [0xff, 0xff, 20, 0xff, 0xff, 0x0f, 0x00]
    const tail = [3, 2, 2, 24, 11, 80, 0, 60, 0] // 3 profiles, #2 selected, overlay, camera frame, alarms
    const config = decodeOsdConfig(Uint8Array.from([...header, ...items, ...stats, ...timers, ...warnings, ...tail]))
    expect(config).toEqual({
      supported: true,
      deviceDetected: true,
      videoSystem: VIDEO_SYSTEM.HD,
      positions: [0x0865, 0, 0x3c08],
      timers: [0x0a00, 0x0a01],
      profileCount: 3,
      selectedProfile: 2,
    })
  })

  it('tolerates short and empty payloads', () => {
    expect(decodeOsdConfig(new Uint8Array(0)).supported).toBe(false)
    const short = decodeOsdConfig(Uint8Array.from([0x01, 1, 0, 20, 0, 0, 0, 2, 0, 0, 0x65, 0x08, 0x00, 0x00]))
    expect(short).toMatchObject({ supported: true, deviceDetected: false, positions: [0x0865, 0], timers: [] })
    expect(short).toMatchObject({ profileCount: 1, selectedProfile: 1 })
  })

  it('round-trips through the mock encoder', () => {
    const { config } = snapshotWith({ WARNINGS: shownAt(9, 10) }, { selectedProfile: 3, videoSystem: VIDEO_SYSTEM.NTSC })
    expect(decodeOsdConfig(encodeOsdConfig(config))).toEqual(config)
  })
})

describe('MSP_SET_OSD_CONFIG', () => {
  it('addresses an element on the in-flight screen', () => {
    expect([...encodeSetOsdElement(22, 0x3c08)]).toEqual([22, 0x08, 0x3c, 1])
    expect(decodeSetOsdConfig(encodeSetOsdElement(22, 0x3c08))).toEqual({ element: 22, position: 0x3c08 })
    expect(() => encodeSetOsdElement(0xff, 0)).toThrow(RangeError)
  })

  it('addresses a timer with -2', () => {
    expect([...encodeSetOsdTimer(1, 0x0a01)]).toEqual([0xfe, 1, 0x01, 0x0a])
    expect(decodeSetOsdConfig(encodeSetOsdTimer(1, 0x0a01))).toEqual({ timer: 1, config: 0x0a01 })
  })

  it('rejects general settings, statistics and truncated requests', () => {
    expect(decodeSetOsdConfig(Uint8Array.of(0xff, 1, 0, 20))).toBeNull()
    expect(decodeSetOsdConfig(Uint8Array.of(3, 1, 0, 0))).toBeNull()
    expect(decodeSetOsdConfig(Uint8Array.of(3, 1))).toBeNull()
  })
})

describe('canvas', () => {
  it('is what the FC reports, else what the video system implies', () => {
    // "auto" on an MSP displayport or with an NTSC camera: 13 rows, not PAL's 16
    expect(canvasFor(VIDEO_SYSTEM.AUTO, { cols: 30, rows: 13 })).toEqual({ cols: 30, rows: 13 })
    expect(canvasFor(VIDEO_SYSTEM.PAL, { cols: 28, rows: 15 })).toEqual({ cols: 28, rows: 15 })
    expect(canvasFor(VIDEO_SYSTEM.AUTO, { cols: 0, rows: 0 })).toEqual(SD)
    expect(canvasFor(VIDEO_SYSTEM.NTSC, { cols: 0, rows: 0 })).toEqual({ cols: 30, rows: 13 })
    // an HD build without a display reports its HD default whatever the video system is
    expect(canvasFor(VIDEO_SYSTEM.AUTO, HD)).toEqual(SD)
    expect(canvasFor(VIDEO_SYSTEM.PAL, HD)).toEqual(SD)
    expect(canvasFor(VIDEO_SYSTEM.NTSC, HD)).toEqual({ cols: 30, rows: 13 })
    expect(canvasFor(VIDEO_SYSTEM.HD, { cols: 60, rows: 22 })).toEqual({ cols: 60, rows: 22 })
    expect(canvasFor(VIDEO_SYSTEM.HD, { cols: 0, rows: 0 })).toEqual(HD)
    expect(canvasFor(VIDEO_SYSTEM.HD, { cols: 80, rows: 40 })).toEqual(HD)
  })

  it('codes MSP_OSD_CANVAS', () => {
    expect(decodeOsdCanvas(encodeOsdCanvas(HD))).toEqual(HD)
    expect(decodeOsdCanvas(new Uint8Array(0))).toEqual({ cols: 0, rows: 0 })
  })

  it('keeps dragged samples on screen', () => {
    expect(clampToCanvas({ x: 28, y: 20 }, 5, SD)).toEqual({ x: 25, y: 15 })
    expect(clampToCanvas({ x: -3, y: -1 }, 5, SD)).toEqual({ x: 0, y: 0 })
  })
})

describe('draft', () => {
  it('reads visibility from the selected profile', () => {
    const profile2Only = encodePosition({ x: 3, y: 4, profiles: 0b010, variant: 0 })
    const draftFor = (selectedProfile: number) =>
      toDraft(snapshotWith({ DISARMED: profile2Only }, { selectedProfile })).elements.find((el) => el.index === 29)
    expect(draftFor(1)).toEqual({ index: 29, x: 3, y: 4, shown: false })
    expect(draftFor(2)).toEqual({ index: 29, x: 3, y: 4, shown: true })
  })

  it('leaves out elements an older firmware does not report', () => {
    const snapshot = snapshotWith({})
    snapshot.config.positions.length = 80 // the API 1.46 layout ends before the custom messages
    expect(availableElements(snapshot).map((def) => def.label)).not.toContain('Custom message 1')
    expect(toDraft(snapshot).elements).toHaveLength(9)
  })

  it('moves an element off the default pile when it is switched on, but keeps a chosen place', () => {
    const snapshot = snapshotWith({ ALTITUDE: encodePosition({ x: 4, y: 4, profiles: 0, variant: 0 }) })
    const draft = toDraft(snapshot)
    const timer = setElementShown(draft, 6, true, SD).elements.find((el) => el.index === 6)
    expect(timer).toEqual({ index: 6, x: 24, y: 1, shown: true })
    const altitude = setElementShown(draft, 15, true, SD).elements.find((el) => el.index === 15)
    expect(altitude).toEqual({ index: 15, x: 4, y: 4, shown: true })
  })

  it('validates shown elements against the canvas', () => {
    const draft = setElementCell(toDraft(snapshotWith({ WARNINGS: shownAt(9, 10) })), 21, { x: 30 })
    expect(validateOsd(draft, SD)).toEqual(['Warnings: X must be between 0 and 29.'])
    expect(validateOsd(draft, HD)).toEqual([])
    expect(validateOsd(setElementShown(draft, 21, false, SD), SD)).toEqual([])
  })
})

describe('planOsdWrites', () => {
  it('writes nothing for an untouched draft', () => {
    const snapshot = snapshotWith({ WARNINGS: shownAt(9, 10), CROSSHAIRS: shownAt(13, 6) })
    expect(planOsdWrites(snapshot, toDraft(snapshot))).toEqual([])
  })

  it('writes only changed elements, on in every profile, keeping the variant', () => {
    const snapshot = snapshotWith({
      WARNINGS: shownAt(9, 10),
      ALTITUDE: encodePosition({ x: 2, y: 2, profiles: 0, variant: 1 }),
    })
    let draft = setElementShown(toDraft(snapshot), 15, true, SD)
    draft = setElementCell(draft, 21, { y: 11 })
    expect(planOsdWrites(snapshot, draft)).toEqual([
      { element: 21, position: shownAt(9, 11) },
      { element: 15, position: shownAt(2, 2, 1) },
    ])
  })

  it('uses a single profile bit when the firmware has no OSD profiles', () => {
    const snapshot = snapshotWith({}, { profileCount: 1 })
    const draft = setElementShown(toDraft(snapshot), 29, true, SD)
    const [write] = planOsdWrites(snapshot, draft)
    expect(write).toMatchObject({ element: 29 })
    expect(decodePosition((write as { position: number }).position).profiles).toBe(0b001)
  })

  it('forces the VTX element to the combined variant', () => {
    const snapshot = snapshotWith({ VTX_CHANNEL: shownAt(20, 13, 1) })
    const draft = setElementCell(toDraft(snapshot), 21, { x: 8 })
    expect(planOsdWrites(snapshot, draft)).toContainEqual({ element: 10, position: shownAt(20, 13, 0) })
  })

  it('switches off other elements only when asked to', () => {
    const snapshot = snapshotWith({ CROSSHAIRS: shownAt(13, 6, 2), CRAFT_NAME: encodePosition({ x: 1, y: 1, profiles: 0b010, variant: 0 }) })
    expect(otherVisibleElements(snapshot)).toEqual([2, 8])
    expect(planOsdWrites(snapshot, { ...toDraft(snapshot), hideOthers: true })).toEqual([
      { element: 2, position: encodePosition({ x: 13, y: 6, profiles: 0, variant: 2 }) },
      { element: 8, position: encodePosition({ x: 1, y: 1, profiles: 0, variant: 0 }) },
    ])
  })

  it('makes a shown Timer 2 count armed time, keeping precision and alarm', () => {
    const onTime = 0x0520 // source "on", hundredths, alarm 5
    const snapshot = snapshotWith({ ITEM_TIMER_2: shownAt(24, 1) }, { timers: [0x0a00, onTime] })
    const draft = setElementCell(toDraft(snapshot), 6, { y: 2 })
    expect(planOsdWrites(snapshot, draft)).toContainEqual({ timer: 1, config: 0x0521 })

    const lastArmed = snapshotWith({ ITEM_TIMER_2: shownAt(24, 1) }, { timers: [0x0a00, 0x0a02] })
    expect(planOsdWrites(lastArmed, setElementCell(toDraft(lastArmed), 6, { y: 2 }))).toHaveLength(1)
    const hidden = snapshotWith({}, { timers: [0x0a00, onTime] })
    expect(planOsdWrites(hidden, toDraft(hidden))).toEqual([])
  })
})
