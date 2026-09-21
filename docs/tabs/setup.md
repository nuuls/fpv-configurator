# Setup

Status: built
Route: `/setup` · Page: `src/pages/Setup.tsx`

## Purpose

FC identity and live telemetry at a glance, plus the one hardware-level setting that has no other home:
the PID loop frequency.

## Layout

```
+---------------------------+---------------------------+
| Flight controller         | Attitude                  |
+---------------------------+---------------------------+
| Battery                   | System                    |
|                           |  PID loop freq [4k][8k]   |
+---------------------------+---------------------------+
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

## Behaviour

- PID loop frequency = gyro sample rate (`MSP_BOARD_INFO`, API ≥ 1.43) / `pid_process_denom`.
- Options are the gyro rate and half of it, never below 3 kHz:
  8 kHz gyro → **4 kHz · 8 kHz**; 3.2 kHz gyro (BMI270) → **3.2 kHz** only (a single, selected button).
- A different value already on the FC (e.g. 2 kHz) is added as an extra option so it can be shown and kept.
- Gyro rate not reported → the line shows "—" and nothing is editable.
- The firmware raises the denominator by itself when the motor protocol can't keep up (e.g. DSHOT300 +
  bidirectional DShot caps at 4 kHz); after the reboot the line shows what the FC actually uses.
- Live readouts keep working while the setting loads or if reading it fails.

## Hidden on purpose

- Magnetometer calibration, reset settings, backup / restore (accelerometer calibration lives on Orientation)
- Arming-disable flags, GPS, instruments
- Free choice of `pid_process_denom` (1–16)

## Decisions

- Generic rule "gyro rate and half of it, ≥ 3 kHz" instead of a hard-coded 8 k / 3.2 k table, so other gyros
  (6.66 kHz LSM6DSO → 3.3 k · 6.7 k) get sensible options too.

## Acceptance

Checkable with **Connect Mock FC**:

- [x] Setup shows 4 kHz · 8 kHz with 8 kHz selected; Save & Reboot is disabled
- [x] Pick 4 kHz → Save & Reboot → 4 kHz is selected and cycle time reads 250 µs
- [x] Mock with a 3.2 kHz gyro reports it; options are 3.2 kHz only (unit test — the app's mock is 8 kHz)

On real hardware:

- [ ] BMI270 board shows only 3.2 kHz
- [ ] 8 kHz with DSHOT300 + bidirectional DShot comes back as 4 kHz after the reboot

## Open questions

- [ ] Rest of the tab (drone-type setup step) is still unspecified — see SPEC.md §6
