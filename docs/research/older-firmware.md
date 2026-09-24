# Older Betaflight firmware (4.5, 2025.12)

Status: research only — **not planned for implementation** (decision 2026-09-25: the app stays 2026.x only, as in
SPEC §3; per-version workarounds would be bugs waiting to happen). Kept so the question isn't audited again.

Question: would the app work with Betaflight 4.5 (API 1.46) and 2025.12 (API 1.47)?
Answer: mostly — every MSP code the app uses exists with the same number, and nearly every byte layout is the same
(newer releases only append fields, which the decoders tolerate). Today both are blocked by `isSupportedFirmware`
(`src/lib/format.ts`). Lifting that gate alone would ship the breakages below.

Sources compared: Betaflight tags `4.5.5`, `2025.12.5`, `2026.6.2` (`src/main`).

## Works unchanged on both

Setup, Orientation, Modes, Rates, Filters, Blackbox, OSD, VTX, Diff (the STX non-interactive CLI exists and behaves
the same in all three). On 4.5 the OSD tab lists fewer elements: custom messages 81–84 don't exist there.

## Breaks

| Problem                                                                                                                                                                                                                               | 4.5    | 2025.12 | Possible fix                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MSP2_CLI_SETTING` (0x3010) only exists in 2026.6. Every `writeSetting` fails: PID Tuning preset + TPA, Motors dynamic idle, Ports receiver protocol + digital VTX. The save aborts after earlier writes (RAM only, no EEPROM write). | broken | broken  | Read-modify-write the MSP messages carrying the same values (`PID_ADVANCED`, `RX_CONFIG`, `OSD_CONFIG` addr -1), or `set` via the non-interactive CLI. |
| UART identifiers are 0–9 on 4.5 (`io/serial.h`: `SERIAL_PORT_USART1 = 0`), 51+ later. Ports hides every UART; receiver/VTX/GPS show as "none".                                                                                        | broken | ok      | Map identifiers by API version.                                                                                                                        |
| `SET_MOTOR_CONFIG` bytes 0–1 are stored as `minthrottle` on 4.5 (`msp.c:2826`); the app sends 0 → analog protocols break.                                                                                                             | wrong  | ok      | Send back the value read from `MOTOR_CONFIG`.                                                                                                          |
| 4-way init calls `motorShutdown()` on 2025.12 (`serial_4way.c:146`); `motorEnable()` is a no-op afterwards → no motor output until reboot.                                                                                            | ok     | broken  | Reboot after an ESC session.                                                                                                                           |
| `feedforward_smooth_factor` uses a different scale on 4.5 (default 25, per RC packet; 65 from 2025.12, normalised to 250 Hz). The presets' 65/80 smooth far more than intended.                                                       | wrong  | ok      | Per-version preset values.                                                                                                                             |

Minor: `DYN_NOTCH_COUNT_MAX` is 5 on 4.5 (app offers ≤ 2); `FILTER_CONFIG` is 49 bytes and `RC_TUNING` 23 bytes
before API 1.48/1.47 (handled by read-modify-write).
