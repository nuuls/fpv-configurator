# Motors

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/motors` · Page: `src/pages/Motors.tsx` · Logic: `src/lib/motors/`

## Purpose

Set up the ESC link and check that every motor spins the right way.

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| ESC protocol | select | `motor_pwm_protocol` · `MSP_ADVANCED_CONFIG` (90/91, byte 3) | DSHOT150 / 300 / 600 | Another protocol already on the FC is offered, marked "not recommended" |
| Bidirectional DShot | switch | `dshot_bidir` · `MSP_MOTOR_CONFIG` (131/222) | **on** | Only with a DShot protocol. A warning is shown whenever it is off |
| Motor poles | number | `motor_poles` | even, 4–40 · 14 | |
| Prop direction | select | `yaw_motors_reversed` · `MSP_MIXER_CONFIG` (42/43) | **Props out**, Props in | |
| Motor test enable | switch | `MSP_SET_ARMING_DISABLED` (99) | off | "I have removed all propellers" |
| Motor 1–4, All motors | sliders | `MSP_SET_MOTOR` (214) | 1000–1300 | Laid out like the quad seen from above (4 2 / 3 1) |

## Behaviour

- "Default" = what the app recommends and what the drone-type defaults (SPEC §2) will apply. The tab always shows
  what is on the FC and never changes prop direction or DShot settings by itself — wrong prop direction flips
  the quad on take-off.
- Settings: **Save & Reboot**. The rest of `MSP_ADVANCED_CONFIG` is written back unchanged.
- Motor test safety: locked until the switch is on; arming from the radio is blocked meanwhile; output is
  capped at 1300; motors stop and the switch resets when it is turned off, on unsaved edits, on leaving the
  tab, on closing the page, and on lost contact (with a "unplug the battery" message). A reboot always stops.

## Hidden on purpose

- Mixer type, motor reordering and direction wizard, 3D mode, idle, PWM rate, ESC sensor, telemetry readouts,
  servo settings.

## Acceptance

Mock FC:

- [x] Protocol, bidirectional DShot, prop direction → Save & Reboot → persist; only byte 3 of the advanced
      config changed
- [x] Warning while bidirectional DShot is off; "Props out (default)" listed first
- [x] Sliders disabled until the switch is on
- [x] An unsaved edit switches the test off and zeroes the sliders
- [x] Motors are stopped and arming re-enabled when the test ends; reboot stops motors

On real hardware — **props off**:

- [ ] Each slider spins the matching motor (4 front-left, 2 front-right, 3 rear-left, 1 rear-right)
- [ ] Leaving the tab / turning the switch off stops the motors immediately
- [ ] Settings match Betaflight Configurator after saving

## Decisions

- "Copy Betaflight design" interpreted as: keep what a new build needs, drop the rest (list above).
- Test throttle capped at 1300 — enough to see direction, not enough to be dangerous on the bench.
