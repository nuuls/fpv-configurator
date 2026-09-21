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
| 3D preview | view | board = the selection; quad = live `MSP_ATTITUDE` (roll, pitch **and yaw**) @ 25 Hz, eased per animation frame | — | Software projection → SVG (`src/lib/orientation/view3d.ts`), no library |
| Reset heading | button | — | — | Makes the current heading "nose away from the viewer". Done automatically when the tab opens |
| Angle readout | readout | `MSP_ATTITUDE` | roll / pitch / heading in degrees | Raw FC values |

## Behaviour

- **Save & Reboot**. The live frame reflects the *saved* alignment, so verification happens after saving:
  tilt the quad, the model must move the same way.
- Yaw is shown relative to the heading at the moment the tab was opened / "Reset heading" was pressed — without
  a compass the FC's absolute heading is arbitrary.
- Angle conventions are Betaflight's (`flight/imu.c`, North-West-Up): roll > 0 right side down, **pitch > 0 nose
  down**, yaw > 0 clockwise from above; applied yaw → pitch → roll. They are unit-tested in `view3d.test.ts`.
  The Setup tab's horizon uses the same pitch sign.
- Orange props = front. An upside-down board shows its grey underside without the arrow.

## Hidden on purpose

- Per-gyro sensor alignment, custom gyro alignment, accelerometer calibration/trim, magnetometer alignment.

## Acceptance

Mock FC:

- [x] Exactly the eight 45° steps per axis
- [x] Preview reflects the selection immediately
- [x] Save & Reboot persists the values

On real hardware:

- [ ] With a correct alignment saved: nose down, right side down and turning clockwise each move the model the
      same way (signs derived from firmware source, **not yet confirmed on a real FC** — the one place to change
      them is `betaflightRotation()` in `src/lib/orientation/view3d.ts`)
- [ ] Yaw 90° here equals "YAW 90°" in Betaflight Configurator

## Decisions

- Three dropdowns rather than yaw only: upside-down (roll 180°) mounts are common.
- Own small projection + SVG instead of three.js: no dependency and the math is unit-testable. (A first version
  used CSS 3D transforms — wrong pitch sign, no yaw, browser-dependent rendering — and was replaced.)
