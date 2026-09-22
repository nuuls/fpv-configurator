# Motors

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/motors` · Page: `src/pages/Motors.tsx` · Logic: `src/lib/motors/`

## Purpose

Set up the ESC link and check that every motor spins the right way.

## Controls

| Control             | Type                                                   | Betaflight setting / MSP                                                                                         | Values · default        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ESC protocol        | select                                                 | `motor_pwm_protocol` · `MSP_ADVANCED_CONFIG` (90/91, byte 3)                                                     | DSHOT150 / 300 / 600    | Another protocol already on the FC is offered, marked "not recommended"                                                                                                                                                                                                                                                                                                                                                                                                        |
| Bidirectional DShot | switch                                                 | `dshot_bidir` · `MSP_MOTOR_CONFIG` (131/222)                                                                     | **on**                  | Only with a DShot protocol. A warning is shown whenever it is off                                                                                                                                                                                                                                                                                                                                                                                                              |
| Motor poles         | number                                                 | `motor_poles`                                                                                                    | even, 4–40 · 14         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Prop direction      | select                                                 | `yaw_motors_reversed` · `MSP_MIXER_CONFIG` (42/43)                                                               | **Props out**, Props in |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Dynamic idle        | slider with zone band                                  | `dyn_idle_min_rpm` (×100 rpm) · read `MSP_PID_ADVANCED` (94) byte 49, written by name via `MSP2_CLI_SETTING`     | 12–40 · FC value        | Zones per drone type, see below. Disabled without bidirectional DShot (it needs RPM data). FC value 0 is shown as "Off"                                                                                                                                                                                                                                                                                                                                                        |
| Motor test enable   | switch                                                 | `MSP_SET_ARMING_DISABLED` (99)                                                                                   | off                     | "I have removed all propellers"                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Motor 1–4           | vertical sliders on a 2D quad seen from above          | `MSP_SET_MOTOR` (214)                                                                                            | 1000–1300               | Each motor sits where it is on the quad (4 front-left, 2 front-right, 3 rear-left, 1 rear-right). Minimal text: the prop disc's rim carries arrows for the expected spin direction (from the saved prop direction) and rotates that way, in red, while the motor is driven; the motor number is a small badge; the arrow on the body marks the front                                                                                                                           |
| All motors          | slider                                                 | same                                                                                                             | 1000–1300               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Reported RPM        | the single readout inside each prop disc               | `MSP_MOTOR_TELEMETRY` (139) @ 10 Hz                                                                              | rpm                     | Without bidirectional DShot the disc shows the output value instead, plus one hint line under the drawing. The output value is otherwise in the hover title and the "All motors" readout                                                                                                                                                                                                                                                                                       |
| Motor direction     | icon (↻) on each disc: one click flips it              | `MSP2_SEND_DSHOT_COMMAND` (0x3003): blocking, `DSHOT_CMD_SPIN_DIRECTION_1` (7) / `_2` (8) + `SAVE_SETTINGS` (12) | —                       | Only while motor control is on and the FC runs a DShot protocol. Like the Betaflight Configurator's wizard: all motors stop, 500 ms pause (ESCs drop commands while the motor turns), command, 500 ms, then that motor spins at 1100 for 2 s so the result shows. The ESC stores it, no reboot. Nothing reports the current direction, so the first click sends "reversed" and each click sends the opposite of the last one; the note says "Still the wrong way? Click again" |
| Swap motor          | icon (⇄) on each disc, then a click on the other motor | `motor_output_reordering` · `MSP2_MOTOR_OUTPUT_REORDERING` (0x3001) / SET (0x3002)                               | —                       | Pick mode: the other discs light up as targets, Esc or the icon cancels. Exchanges the ESC outputs of the two motors in the draft: **Save & Reboot**. Remapped motors are listed under the drawing ("Motor 1 drives ESC output 3 · …"); nothing is shown for the default order                                                                                                                                                                                                 |

Dynamic idle zones (`DYN_IDLE_ZONES` in `src/lib/motors/model.ts`). Status is always icon + text, never colour alone:

| Drone type | Good  | Warning                     | Danger                 |
| ---------- | ----- | --------------------------- | ---------------------- |
| 5"         | 18–25 | 3 either side: 15–17, 26–28 | the rest: 12–14, 29–40 |

Only 5" exists so far and every quad is treated as one until drone types (SPEC §2) are built.

## Behaviour

- "Default" = what the app recommends and what the drone-type defaults (SPEC §2) will apply. The tab always shows
  what is on the FC and never changes prop direction or DShot settings by itself — wrong prop direction flips
  the quad on take-off.
- Settings: **Save & Reboot**. The rest of `MSP_ADVANCED_CONFIG` is written back unchanged. The output order is
  only written when it changed; motors beyond the sent list keep their own output (firmware behaviour).
- Motor direction is the one write that skips the save bar: it goes to the ESC, which keeps it itself. It needs
  the motor test switch (the ESC beeps and the motor twitches) — the same "props off" confirmation as spinning.
- Motor test safety: locked until the switch is on; arming from the radio is blocked meanwhile; output is
  capped at 1300; motors stop and the switch resets when it is turned off, on unsaved edits, on leaving the
  tab, on closing the page, and on lost contact (with a "unplug the battery" message). A reboot always stops.

## Hidden on purpose

- Mixer type, Betaflight's step-by-step reordering / direction wizards (replaced by the per-motor icons), 3D mode,
  idle, PWM rate, ESC sensor, telemetry readouts, servo settings.

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
- [x] Flip icon locked until motor control is on; a click stops the motors, sends 8 + 12 to that ESC (blocking),
      the mock ESC's stored direction flips (visible on the ESC tab), the motor spins for the check and stops; the
      next click sends 7 + 12; nothing is sent on a non-DShot protocol
- [x] Swap icon on motor 1, then motor 3 → hint "Motor 1 drives ESC output 3 · Motor 3 drives ESC output 1 — Save &
      Reboot to apply", test locked; Esc / the icon cancel pick mode; Save & Reboot persists `[2, 1, 0, 3, …]` and
      the hint stays; swapping back clears it

On real hardware — **props off**:

- [ ] Each slider spins the matching motor (4 front-left, 2 front-right, 3 rear-left, 1 rear-right), in the
      direction shown
- [ ] Reported RPM rises with the slider and is plausible (a few thousand rpm at 1100)
- [ ] Dynamic idle value matches `get dyn_idle_min_rpm` in the CLI after saving
- [ ] Leaving the tab / turning the switch off stops the motors immediately
- [ ] Settings match Betaflight Configurator after saving
- [ ] A flip makes the motor spin the other way (seen in the check spin and on the next slider move), also after a
      power cycle; a flip right after the motor was spinning takes effect too
- [ ] After swapping two motors and rebooting, each slider spins the motor at its position; `get
  motor_output_reordering` matches

## Decisions

- "Copy Betaflight design" interpreted as: keep what a new build needs, drop the rest (list above).
- Dynamic idle is a PID-profile value; it is read from `MSP_PID_ADVANCED` but written by name, because the matching
  SET message carries ~40 unrelated tuning fields.
- A danger-zone idle is marked, not blocked — some builds legitimately need unusual values.
- Motors other than 4 fall back to a plain slider grid.
- Test throttle capped at 1300 — enough to see direction, not enough to be dangerous on the bench.
- Direction via DShot commands (like the Betaflight Configurator's wizard) rather than through the ESC settings
  block on the ESC tab: works with any DShot ESC firmware, takes no passthrough session and no reboot. The
  price is that the current direction can't be read back, so the flip only tracks what it sent: on an ESC that
  was already reversed the first click changes nothing and the second one does — the note says so. Bluejay
  (`wait_for_start` loop) and AM32 (`running == 0`) only take commands while the motor is stopped, hence the
  pause after stopping; the check spin afterwards is what the Configurator's wizard does as well.
- Swap instead of Betaflight's full remap wizard: on a wrongly wired quad the fix is one or two swaps, and a
  swap can't produce an invalid order.
