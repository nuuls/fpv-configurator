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
| 3D preview | view | board = the selection; frame = live `MSP_ATTITUDE` @ 20 Hz | — | CSS 3D, no library |

## Behaviour

- **Save & Reboot**. The live frame reflects the *saved* alignment, so verification happens after saving:
  tilt the quad, the model must move the same way.
- Heading is not shown in the preview (the nose always points away from the viewer).

## Hidden on purpose

- Per-gyro sensor alignment, custom gyro alignment, accelerometer calibration/trim, magnetometer alignment.

## Acceptance

Mock FC:

- [x] Exactly the eight 45° steps per axis
- [x] Preview reflects the selection immediately
- [x] Save & Reboot persists the values

On real hardware:

- [ ] Nose up / right side down moves the model the same way — otherwise flip `PITCH_SIGN` / `ROLL_SIGN` in
      `src/components/BoardView.tsx` (**not yet verified against a real FC**)
- [ ] Yaw 90° here equals "YAW 90°" in Betaflight Configurator

## Decisions

- Three dropdowns rather than yaw only: upside-down (roll 180°) mounts are common.
- CSS 3D instead of three.js: no dependency, works in tests. Swap for a real model later if wanted.
