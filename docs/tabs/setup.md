# Setup

Status: built
Route: `/setup` · Page: `src/pages/Setup.tsx`

## Purpose

FC identity and system status at a glance, the one hardware-level setting that has no other home (the PID
loop frequency), a pre-flight checklist that verifies the settings a quad should not fly without, and the list of
everything that was changed outside this app (Betaflight Configurator, CLI) with a way to put it back.

## Layout

```
+---------------------------+---------------------------+
| Flight controller         | System                    |
|                           |  PID loop freq [4k][8k]   |
+---------------------------+---------------------------+
| Pre-flight checklist                                  |
|  2 of 5 settings need attention.                      |
|  ✓ Airmode is on                                  On  |
|  ! Arm angle is not 180°                    25° [Fix] |
|  ! Bidirectional DShot is not enabled  Off [Open Motors] |
+-------------------------------------------------------+
| Changed outside this app                  [Reset all] |
|  3 changes made outside this app. 1 to reset once saved. |
|  master   crashflip_motor_percent        [0] → [50] [Reset] |
|  master   osd_units  [IMPERIAL] → [METRIC] · not saved yet [Keep] |
|  led      led 0 0,0::C:2      Only in Betaflight Configurator |
+-------------------------------------------------------+
                                  [Revert] [Save & Reboot]
```

The values are coloured like the Diff Checker: red is what it was, green what it is — or, once marked for reset, what
it will be.

## Controls

| Control                                                    | Type                        | Betaflight setting / MSP                                                                                                                                         | Values · default                             | Notes                                                                                           |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Firmware, MSP API, board, target, manufacturer             | readout                     | `MSP_FC_VERSION`, `MSP_API_VERSION`, `MSP_BOARD_INFO`                                                                                                            |                                              | read at connect                                                                                 |
| PID loop frequency                                         | button group                | `pid_process_denom` · `MSP_ADVANCED_CONFIG` byte 1 (read-modify-write)                                                                                           | see Behaviour · FC value                     | needs reboot                                                                                    |
| Cycle time, CPU load, PID profile, sensors                 | live readout                | `MSP_STATUS` @ 2 Hz                                                                                                                                              |                                              |                                                                                                 |
| Check: bidirectional DShot is enabled                      | check + link to Motors      | `dshot_bidir` · `MSP_MOTOR_CONFIG` byte 8                                                                                                                        | pass = on                                    | edited on Motors                                                                                |
| Check: accelerometer is calibrated                         | check + link to Orientation | `MSP_BOARD_INFO` configuration problems, bit 0                                                                                                                   | pass = bit clear                             | calibrated on Orientation; no accelerometer = fails without a link                              |
| Check: arm angle is 180°                                   | check + **Fix**             | `small_angle` · `MSP_ARMING_CONFIG` byte 2 (read-modify-write)                                                                                                   | pass = 180 · Fix sets 180                    | needs reboot                                                                                    |
| Check: beeper and DShot beacon sound on RX set and RX loss | check + **Fix**             | `beeper`, `beacon` · `MSP_BEEPER_CONFIG` `beeper_off_flags` and `dshotBeaconOffFlags`, bits 9 (RX_SET) and 1 (RX_LOST) of each (read-modify-write)               | pass = all four bits clear · Fix clears them | other beeps and the beacon tone stay as they are                                                |
| Check: airmode is on                                       | check + **Fix**             | `feature AIRMODE` · `MSP_FEATURE_CONFIG` bit 22                                                                                                                  | pass = set · Fix sets it                     | needs reboot                                                                                    |
| Changed outside this app                                   | list                        | CLI `diff all defaults` (read as on the Diff Checker) minus every setting and command a tab of this app writes                                                   | —                                            | one row per change: section · name · default → value; read together with the checklist          |
| Reset / Keep                                               | button per row              | `set name = default` in the CLI, inside the diff's own `profile N` / `rateprofile N` switch and restore lines; `beeper -NAME` / `beeper NAME` and `beacon` alike | —                                            | Reset is a local edit (row: `value → default · not saved yet`, button reads Keep); needs reboot |
| Reset all                                                  | button                      | same                                                                                                                                                             | —                                            | marks every row that has a Reset                                                                |

## Behaviour

- PID loop frequency = gyro sample rate (`MSP_BOARD_INFO`, API ≥ 1.43) / `pid_process_denom`.
- Options are the gyro rate and half of it, never below 3 kHz:
  8 kHz gyro → **4 kHz · 8 kHz**; 3.2 kHz gyro (BMI270) → **3.2 kHz** only (a single, selected button).
- A different value already on the FC (e.g. 2 kHz) is added as an extra option so it can be shown and kept.
- Gyro rate not reported → the line shows "—" and nothing is editable.
- The firmware raises the denominator by itself when the motor protocol can't keep up (e.g. DSHOT300 +
  bidirectional DShot caps at 4 kHz); after the reboot the line shows what the FC actually uses.
- Live readouts keep working while the setting loads or if reading it fails.
- The checklist is read together with the PID loop frequency, every time the tab opens (so a calibration done on
  Orientation shows up), and sums up as "N of 5 settings need attention." or "All set."
- A row states what was found: a passing check reads "Bidirectional DShot is enabled", a failing one "Bidirectional
  DShot is not enabled" (likewise "Accelerometer is not calibrated", "Arm angle is not 180°", "Airmode is off",
  "Beeper or DShot beacon is silent on RX set or RX loss").
- A failing check either links to the tab that owns the setting (**Open Motors**, **Open Orientation**) or, for
  the three settings no tab owns, has a **Fix** button. Fix is a local edit like any other (SPEC §5): the row
  passes marked "not saved yet", the tab becomes dirty, Revert takes it back, **Save & Reboot** writes it.
- Passing checks have no control: the checklist only ever moves a setting to the verified value.
- Save writes only the messages whose setting changed, then `MSP_EEPROM_WRITE`.
- Firmware built without a beeper (`MSP_BEEPER_CONFIG` answers with an error): the check fails with
  "No beeper support" and no Fix; everything else works.
- A failing beeper check says what is muted, e.g. "Beeper off for RX set · DShot beacon off for RX set and RX
  loss". A `MSP_BEEPER_CONFIG` that ends before the beacon fields is judged by the wired beeper alone.
- **Changed outside this app** = the FC's `diff all defaults` (Diff Checker, `lib/diff/io.ts`) without what a tab
  writes — the allow-list `MANAGED_SETTINGS` / `MANAGED_COMMANDS` in `lib/diff/model.ts` (`externalOnly`), built
  from the "Betaflight setting / MSP" columns of every tab spec: e.g. `pid_process_denom`, `small_angle`,
  `serialrx_provider`, `align_board_*`, `rc_smoothing*`, the filter cutoffs Filters pins, `simplified_*`, the PIDs
  and rates, `motor_*`, `dshot_bidir`, `osd_*_pos`, `vtx_*`, `blackbox_device`; the commands `serial`, `aux`,
  `vtxtable`, `beeper`/`beacon` RX_SET and RX_LOST. Everything else that differs is listed: other `set` variables
  of `master`, the PID / rate / battery profiles, other beeper conditions, and lines such as `led`, `map`,
  `resource`, `mmix`, `adjrange`, plus the craft name. **A tab that starts writing a new setting must add it to
  that list.**
- **Not counted** (`NOT_COUNTED_SETTINGS`, and every `feature` line): features — switching one on is how a quad
  gets set up — and calibrations, which are meant to differ from the defaults: `acc_calibration`,
  `mag_calibration`, `acc_trim_roll/pitch`, `gyro_offset_yaw`, `vbat_scale/divider/multiplier`,
  `ibata_scale/offset`, `ibatv_scale/offset`. They neither appear in the list nor in the count.
- The summary reads "N changes made outside this app." (+ "M to reset once saved."), or "Nothing was changed
  outside this app."; the card reads the diff with the checklist (about a second) and again after every reboot.
- Reset puts the Betaflight default back — what the FC printed as the default (`#set` line) or the opposite flag.
  Save & Reboot first runs the resets in one non-interactive CLI session (`runCliCommands`: STX, the lines, ETX —
  no `#`, no arming flag), laid out like the diff: `set …` for `master`, `profile N` → `set …` → the diff's own
  restore line (`profile 0`) for profile settings, `beeper GYRO_CALIBRATED` for a muted beep; then the tab's MSP writes,
  `MSP_EEPROM_WRITE`, reboot. A `###ERROR` from the CLI (e.g. INVALID NAME) fails the save with that message and
  nothing is saved.
- No Reset ("Only in Betaflight Configurator"): the craft name, a setting whose default the FC didn't print, lines
  that are neither `set` nor a flag (`resource`, `timer`, `dma`, `led`, `map`, `mmix`, `adjrange`, `rxrange`, …),
  and a profile section whose restore line is missing from the diff.
- Armed FC (no CLI): the card says "Could not read the flight controller's diff: …"; the checklist and the PID loop
  frequency work as usual.

## Hidden on purpose

- Magnetometer calibration, reset settings, backup / restore (accelerometer calibration lives on Orientation)
- Arming-disable flags, GPS, instruments
- Attitude (horizon, roll / pitch / heading) and battery readouts (voltage, current, consumed)
- Free choice of `pid_process_denom` (1–16)
- Free choice of arm angle, the other beeper conditions, DShot beacon tone, other features
- Editing an external change to anything but its default; resetting `resource` / `timer` / `dma` / `led` / `map`
  lines (the CLI could, but a wrong `resource` or `map` reset can make a board unusable)
- What the app's own tabs changed — the Diff Checker shows the tune, the tabs show the setup

## Decisions

- Generic rule "gyro rate and half of it, ≥ 3 kHz" instead of a hard-coded 8 k / 3.2 k table, so other gyros
  (6.66 kHz LSM6DSO → 3.3 k · 6.7 k) get sensible options too.
- SPEC §2 only says the checklist "verifies". Arm angle, beeper and airmode have no tab in this app, so a failing
  check without a way out would send the pilot back to Betaflight Configurator — hence the Fix buttons. Settings
  that do have a tab are linked instead of duplicated.
- Fix goes through the normal Save & Reboot instead of writing at once: one way of saving per tab (SPEC §5), and
  airmode and arm angle only take effect after a reboot anyway.
- "Beeper" covers the wired buzzer (`beeper_off_flags`) and the DShot beacon (`dshotBeaconOffFlags`, off by
  default, and limited to exactly RX set / RX loss): many quads have no buzzer, and the ESC beacon is the lost-model
  finder that works on all of them. One check and one Fix for both; the beacon tone (`beeper_dshot_beacon_tone`,
  1–5) is always a valid tone and stays as it is.
- "Accelerometer is calibrated" uses the firmware's own verdict (`accHasBeenCalibrated()` via `MSP_BOARD_INFO`),
  not the ACC_CALIBRATION arming flag, which is only raised while something that needs the accelerometer is set up.
- Airmode counts as on through the feature only; an AIRMODE switch is not a mode this app manages (Modes tab).
- "Changed outside this app" (2026-09-22, asked for by the user) lives on Setup, not on the Diff Checker: the Diff
  Checker is about the tune and changes nothing, this list is about the setup and can write. It reuses the Diff
  Checker's CLI read and the `git diff` colouring.
- What counts as "managed" is one allow-list of CLI names in `lib/diff/model.ts` rather than something derived from
  the tabs at runtime: the tabs write raw MSP messages (read-modify-write) and an MSP message doesn't say which
  CLI variables it carries. Passed-through fields (e.g. `gyro_lpf1_type`, `thr_expo`, `vtx_pit_mode_freq`) count as
  not managed: the app never changes them, so a change to them was made elsewhere.
- Resets go through the CLI (`set name = default`), not `MSP2_CLI_SETTING`: the diff prints settings of every
  profile, and only the CLI can switch to `profile 1` and back (the diff's own restore lines are reused), and the
  same session undoes `beeper` / `beacon` flags.
- "Recommended" is the Betaflight default the FC itself reports — there are no drone-type presets yet (SPEC §2
  "Drone type"); when there are, they take this list's place.
- Reset is a local edit saved with the tab's Save & Reboot (SPEC §5, one Save per tab), never written on click;
  every reset reboots since most of these settings need it and the tab reboots anyway.
- Features and calibrations don't count (2026-09-22, asked for by the user): the mock's ESC telemetry
  (`feature TELEMETRY`, `feature ESC_SENSOR`) is not listed although no tab sets it up, and a calibrated battery
  meter isn't something to reset. Beeper conditions still are, as resettable flags (`-GYRO_CALIBRATED → GYRO_CALIBRATED`).

## Acceptance

Checkable with **Connect Mock FC**:

- [x] Setup shows 4 kHz · 8 kHz with 8 kHz selected; Save & Reboot is disabled
- [x] Pick 4 kHz → Save & Reboot → 4 kHz is selected and cycle time reads 250 µs
- [x] Mock with a 3.2 kHz gyro reports it; options are 3.2 kHz only (unit test — the app's mock is 8 kHz)

- [x] Checklist: "4 of 5 settings need attention." — bidirectional DShot (→ Open Motors), accelerometer
      (→ Open Orientation), arm angle 25°, beeper off for RX set and DShot beacon off for both; airmode passes
- [x] Fix arm angle → "180° · not saved yet", Revert brings back 25°; Fix arm angle + beeper → Save & Reboot →
      both pass, "2 of 5 settings need attention."
- [x] Open Orientation → Calibrate accelerometer → back on Setup the accelerometer check passes
- [x] Fix beeper clears RX set / RX loss in both off-flag masks and nothing else (unit test); a stock Betaflight
      config (beeper on, beacon off) fails the check
- [x] Turning airmode off on the mock and fixing it writes only the feature mask (unit test)

- [x] Changed outside this app: "2 changes made outside this app." — `crashflip_motor_percent` 0 → 50, `osd_units`
      METRIC → IMPERIAL, each with Reset; Reset all enabled; the app's own setup (ports, modes, `dshot_bidir`, …)
      and the mock's features (`TELEMETRY`, `ESC_SENSOR`) aren't listed
- [x] Reset `osd_units` → "IMPERIAL → METRIC · not saved yet" and "1 to reset once saved.", Keep takes it back;
      Reset all marks both, Revert unmarks them; Reset `osd_units` → Save & Reboot → "1 change made outside
      this app.", Diff Checker reads "0 tuning differences · 7 other hidden"
- [x] Reset all on a mock with `anti_gravity_gain = 100` in profile 0 sends `set crashflip_motor_percent = 0`,
      `set osd_units = METRIC`, `profile 0`, `set anti_gravity_gain = 80`, `profile 0`, and leaves the features
      alone; afterwards the FC is back on MSP (unit test)
- [x] The craft name, `led` lines and a setting without a printed default have no Reset; calibrations
      (`vbat_scale`, `acc_calibration`, …) and features aren't listed; an unknown name makes the save fail with the
      CLI's error (unit tests)
- [x] FC that ignores the STX: the card reports it, the checklist still works (unit test)

On real hardware:

- [ ] BMI270 board shows only 3.2 kHz
- [ ] 8 kHz with DSHOT300 + bidirectional DShot comes back as 4 kHz after the reboot
- [ ] Fresh FC: accelerometer check fails, passes after calibrating; arm angle Fix survives a power cycle
- [ ] After Fix beeper + Save: `beacon` in the CLI lists RX_LOST and RX_SET, and the ESCs beep with the BEEPER switch
- [x] A quad set up in Betaflight Configurator lists what that configurator changed, minus what this app's tabs
      cover, features and calibrations; resetting a `profile 1` setting leaves the selected profile as it was and
      survives the power cycle (user, 2026-09-22)

## Open questions

- [ ] Rest of the tab (drone-type setup step) is still unspecified — see SPEC.md §6
- [x] Beeper check: should the DShot beacon count too (quads without a wired buzzer)? Yes — checked and fixed
      together with the wired beeper
- [ ] Fix buttons go beyond "verifies" in SPEC §2 — keep, or make the checklist read-only?
- [x] Should Reset all touch calibrations (`vbat_scale`, `ibata_scale`, …)? No — they and the features aren't
      counted at all (user, 2026-09-22)
