# Setup

Status: built
Route: `/setup` · Page: `src/pages/Setup.tsx`

## Purpose

FC identity and live telemetry at a glance, the one hardware-level setting that has no other home (the PID
loop frequency), and a pre-flight checklist that verifies the settings a quad should not fly without.

## Layout

```
+---------------------------+---------------------------+
| Flight controller         | Attitude                  |
+---------------------------+---------------------------+
| Battery                   | System                    |
|                           |  PID loop freq [4k][8k]   |
+---------------------------+---------------------------+
| Pre-flight checklist                                  |
|  2 of 5 settings need attention.                      |
|  ✓ Airmode is on                                  On  |
|  ! Arm angle is 180°                        25° [Fix] |
|  ! Bidirectional DShot is enabled  Off [Open Motors]  |
+-------------------------------------------------------+
                                  [Revert] [Save & Reboot]
```

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Firmware, MSP API, board, target, manufacturer | readout | `MSP_FC_VERSION`, `MSP_API_VERSION`, `MSP_BOARD_INFO` | | read at connect |
| Roll, pitch, heading + horizon | live readout | `MSP_ATTITUDE` @ 20 Hz | degrees | |
| Voltage, current, consumed | live readout | `MSP_ANALOG` @ 4 Hz | V, A, mAh | |
| PID loop frequency | button group | `pid_process_denom` · `MSP_ADVANCED_CONFIG` byte 1 (read-modify-write) | see Behaviour · FC value | needs reboot |
| Cycle time, CPU load, PID profile, sensors | live readout | `MSP_STATUS` @ 2 Hz | | |
| Check: bidirectional DShot is enabled | check + link to Motors | `dshot_bidir` · `MSP_MOTOR_CONFIG` byte 8 | pass = on | edited on Motors |
| Check: accelerometer is calibrated | check + link to Orientation | `MSP_BOARD_INFO` configuration problems, bit 0 | pass = bit clear | calibrated on Orientation; no accelerometer = fails without a link |
| Check: arm angle is 180° | check + **Fix** | `small_angle` · `MSP_ARMING_CONFIG` byte 2 (read-modify-write) | pass = 180 · Fix sets 180 | needs reboot |
| Check: beeper sounds on RX set and RX loss | check + **Fix** | `beeper` · `MSP_BEEPER_CONFIG` `beeper_off_flags` bits 9 (RX_SET) and 1 (RX_LOST) | pass = both bits clear · Fix clears both | other beeps and the DShot beacon stay as they are |
| Check: airmode is on | check + **Fix** | `feature AIRMODE` · `MSP_FEATURE_CONFIG` bit 22 | pass = set · Fix sets it | needs reboot |

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
- A failing check either links to the tab that owns the setting (**Open Motors**, **Open Orientation**) or, for
  the three settings no tab owns, has a **Fix** button. Fix is a local edit like any other (SPEC §5): the row
  passes marked "not saved yet", the tab becomes dirty, Revert takes it back, **Save & Reboot** writes it.
- Passing checks have no control: the checklist only ever moves a setting to the verified value.
- Save writes only the messages whose setting changed, then `MSP_EEPROM_WRITE`.
- Firmware built without a beeper (`MSP_BEEPER_CONFIG` answers with an error): the check fails with
  "No beeper support" and no Fix; everything else works.

## Hidden on purpose

- Magnetometer calibration, reset settings, backup / restore (accelerometer calibration lives on Orientation)
- Arming-disable flags, GPS, instruments
- Free choice of `pid_process_denom` (1–16)
- Free choice of arm angle, the other beeper conditions, DShot beacon, other features

## Decisions

- Generic rule "gyro rate and half of it, ≥ 3 kHz" instead of a hard-coded 8 k / 3.2 k table, so other gyros
  (6.66 kHz LSM6DSO → 3.3 k · 6.7 k) get sensible options too.
- SPEC §2 only says the checklist "verifies". Arm angle, beeper and airmode have no tab in this app, so a failing
  check without a way out would send the pilot back to Betaflight Configurator — hence the Fix buttons. Settings
  that do have a tab are linked instead of duplicated.
- Fix goes through the normal Save & Reboot instead of writing at once: one way of saving per tab (SPEC §5), and
  airmode and arm angle only take effect after a reboot anyway.
- "Beeper" is read literally as the wired buzzer (`beeper_off_flags`). The DShot beacon (`dshotBeaconOffFlags`,
  off by default, and limited to exactly RX set / RX loss) is not checked — see Open questions.
- "Accelerometer is calibrated" uses the firmware's own verdict (`accHasBeenCalibrated()` via `MSP_BOARD_INFO`),
  not the ACC_CALIBRATION arming flag, which is only raised while something that needs the accelerometer is set up.
- Airmode counts as on through the feature only; an AIRMODE switch is not a mode this app manages (Modes tab).

## Acceptance

Checkable with **Connect Mock FC**:

- [x] Setup shows 4 kHz · 8 kHz with 8 kHz selected; Save & Reboot is disabled
- [x] Pick 4 kHz → Save & Reboot → 4 kHz is selected and cycle time reads 250 µs
- [x] Mock with a 3.2 kHz gyro reports it; options are 3.2 kHz only (unit test — the app's mock is 8 kHz)

- [x] Checklist: "4 of 5 settings need attention." — bidirectional DShot (→ Open Motors), accelerometer
      (→ Open Orientation), arm angle 25°, beeper off for RX set; airmode passes
- [x] Fix arm angle → "180° · not saved yet", Revert brings back 25°; Fix arm angle + beeper → Save & Reboot →
      both pass, "2 of 5 settings need attention."
- [x] Open Orientation → Calibrate accelerometer → back on Setup the accelerometer check passes
- [x] Turning airmode off on the mock and fixing it writes only the feature mask (unit test)

On real hardware:

- [ ] BMI270 board shows only 3.2 kHz
- [ ] 8 kHz with DSHOT300 + bidirectional DShot comes back as 4 kHz after the reboot
- [ ] Fresh FC: accelerometer check fails, passes after calibrating; arm angle Fix survives a power cycle

## Open questions

- [ ] Rest of the tab (drone-type setup step) is still unspecified — see SPEC.md §6
- [ ] Beeper check: should the DShot beacon count too (quads without a wired buzzer)? Built: wired beeper only
- [ ] Fix buttons go beyond "verifies" in SPEC §2 — keep, or make the checklist read-only?
