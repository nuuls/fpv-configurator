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
| Dynamic idle | slider with zone band | `dyn_idle_min_rpm` (×100 rpm) · read `MSP_PID_ADVANCED` (94) byte 49, written by name via `MSP2_CLI_SETTING` | 12–40 · FC value | Zones per drone type, see below. Disabled without bidirectional DShot (it needs RPM data). FC value 0 is shown as "Off" |
| Motor test enable | switch | `MSP_SET_ARMING_DISABLED` (99) | off | "I have removed all propellers" |
| Motor 1–4 | vertical sliders on a 2D quad seen from above | `MSP_SET_MOTOR` (214) | 1000–1300 | Each motor sits where it is on the quad (4 front-left, 2 front-right, 3 rear-left, 1 rear-right). Minimal text: the prop disc's rim carries arrows for the expected spin direction (from the saved prop direction) and rotates that way, in red, while the motor is driven; the motor number is a small badge; the arrow on the body marks the front |
| All motors | slider | same | 1000–1300 | |
| Reported RPM | the single readout inside each prop disc | `MSP_MOTOR_TELEMETRY` (139) @ 10 Hz | rpm | Without bidirectional DShot the disc shows the output value instead, plus one hint line under the drawing. The output value is otherwise in the hover title and the "All motors" readout |

Dynamic idle zones (`DYN_IDLE_ZONES` in `src/lib/motors/model.ts`). Status is always icon + text, never colour alone:

| Drone type | Good | Warning | Danger |
| ---------- | ---- | ------- | ------ |
| 5" | 18–25 | 3 either side: 15–17, 26–28 | the rest: 12–14, 29–40 |

Only 5" exists so far and every quad is treated as one until drone types (SPEC §2) are built.

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
- [x] Dynamic idle: off → danger → warning → good as the slider moves; Save & Reboot persists it
- [x] Quad drawn from above with CW/CCW per motor; RPM shows "—" without bidirectional DShot and live values with it
- [x] Sliders disabled until the switch is on
- [x] An unsaved edit switches the test off and zeroes the sliders
- [x] Motors are stopped and arming re-enabled when the test ends; reboot stops motors

On real hardware — **props off**:

- [ ] Each slider spins the matching motor (4 front-left, 2 front-right, 3 rear-left, 1 rear-right), in the
      direction shown
- [ ] Reported RPM rises with the slider and is plausible (a few thousand rpm at 1100)
- [ ] Dynamic idle value matches `get dyn_idle_min_rpm` in the CLI after saving
- [ ] Leaving the tab / turning the switch off stops the motors immediately
- [ ] Settings match Betaflight Configurator after saving

## Decisions

- "Copy Betaflight design" interpreted as: keep what a new build needs, drop the rest (list above).
- Dynamic idle is a PID-profile value; it is read from `MSP_PID_ADVANCED` but written by name, because the matching
  SET message carries ~40 unrelated tuning fields.
- A danger-zone idle is marked, not blocked — some builds legitimately need unusual values.
- Motors other than 4 fall back to a plain slider grid.
- Test throttle capped at 1300 — enough to see direction, not enough to be dangerous on the bench.
