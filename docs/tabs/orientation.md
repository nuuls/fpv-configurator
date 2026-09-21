# Orientation

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/orientation` · Page: `src/pages/Orientation.tsx` · Logic: `src/lib/orientation/`

## Purpose

Tell the FC how it is mounted in the frame (SPEC §2 "FC Orientation").

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Yaw / Roll / Pitch | 3 selects | `align_board_yaw/roll/pitch` · `MSP_BOARD_ALIGNMENT_CONFIG` (38/39) | 0–315° in 45° steps · 0 | A non-45° value already on the FC is offered as an extra option |
| 3D preview | view | board (+ its edge mark) = the selection; quad and arrow = live `MSP_ATTITUDE` (roll, pitch **and yaw**) @ 25 Hz, eased per animation frame | — | Software projection → SVG (`src/lib/orientation/view3d.ts`), no library |
| Reset heading | button | — | — | Makes the current heading "nose away from the viewer". Done automatically when the tab opens |
| Calibrate accelerometer | button | `MSP_ACC_CALIBRATION` (205) | — | Immediate action, not part of Save. See Behaviour |
| Angle readout | readout | `MSP_ATTITUDE` | roll / pitch / heading in degrees | Raw FC values |

## Behaviour

- **Save & Reboot**. The live frame reflects the *saved* alignment, so verification happens after saving:
  tilt the quad, the model must move the same way.
- Yaw is shown relative to the heading at the moment the tab was opened / "Reset heading" was pressed — without
  a compass the FC's absolute heading is arbitrary.
- Angle conventions are Betaflight's (`flight/imu.c`, North-West-Up): roll > 0 right side down, **pitch > 0 nose
  down**, yaw > 0 clockwise from above; applied yaw → pitch → roll. They are unit-tested in `view3d.test.ts`.
  The Setup tab's horizon uses the same pitch sign.
- **Calibrate accelerometer:** own card below, with the instruction "level surface, don't touch". Sends
  `MSP_ACC_CALIBRATION`, shows "Calibrating… / Keep the quad still…" for 2 s (the firmware averages 400 samples
  and doesn't report completion; same wait as Betaflight Configurator), then "Calibration finished and saved."
  - No Save needed and no reboot: the firmware writes the result to EEPROM itself — together with the rest of
    its running config, which is why the button is disabled while the rotation has unsaved edits ("Save the
    board rotation first"; calibrating with the wrong alignment would also be pointless).
  - Disabled with "No accelerometer detected." when `MSP_STATUS` reports no acc. No confirmation dialog: it is
    repeatable and harmless. The firmware ignores the command while armed.
- Orange props and the arrow = front of the quad. The arrow belongs to the frame: it never turns with the
  selected alignment. The board turns with the selection; a small grey mark at its edge shows where the arrow
  printed on the flight controller points (yaw 90° → to the right). An upside-down board shows its grey
  underside without the mark.

## Hidden on purpose

- Per-gyro sensor alignment, custom gyro alignment, accelerometer trim, magnetometer alignment/calibration.

## Acceptance

Mock FC:

- [x] Exactly the eight 45° steps per axis
- [x] Preview reflects the selection immediately
- [x] Save & Reboot persists the values
- [x] Calibrate accelerometer → "Keep the quad still…" → "Calibration finished and saved."; disabled while the
      rotation has unsaved edits

On real hardware:

- [x] With a correct alignment saved: nose down, right side down and turning clockwise each move the model the
      same way (confirmed by the user on a real FC, 2026-09-21; signs live in `betaflightRotation()` in
      `src/lib/orientation/view3d.ts`)
- [ ] After calibrating on a level surface the readout shows roll ≈ 0°, pitch ≈ 0°
- [ ] Yaw 90° here equals "YAW 90°" in Betaflight Configurator

## Decisions

- Three dropdowns rather than yaw only: upside-down (roll 180°) mounts are common.
- The arrow shows the quad's front, not the board's printed arrow: an arrow pointing sideways after a correct
  alignment was saved read as a bug. The board's own direction is the small grey mark instead.
- Own small projection + SVG instead of three.js: no dependency and the math is unit-testable. (A first version
  used CSS 3D transforms — wrong pitch sign, no yaw, browser-dependent rendering — and was replaced.)
