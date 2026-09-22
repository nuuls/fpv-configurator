# Ports

Status: ready
_Implemented; mock acceptance passes (`src/pages/Ports.test.tsx`). Set to `built` once the hardware checks below pass._
Route: `/ports` · Page: `src/pages/Ports.tsx`

## Purpose

Tell the FC what is plugged into which UART — by picking the **device first**, then the port. The user never
sees function masks, baud rates or a port × function matrix.

## Layout

One card per device, each the same shape: type → port.

```
+---------------------------------------------------------+
| Receiver      [ ELRS / CRSF        v]  on  [ UART2   v] |
| Video (VTX)   [ Digital (MSP)      v]  on  [ UART1   v] |
| GPS           [ Connected          v]  on  [ UART4   v] |
| Other MSP     [ + add device ]                          |
+---------------------------------------------------------+
| UART3: ESC telemetry (not managed here)                 |
+---------------------------------------------------------+
|                          [ Revert ]  [ Save & Reboot ]  |
+---------------------------------------------------------+
```

## Controls

| Control           | Type                 | Betaflight setting / MSP                                                                                             | Values · default                                         | Notes                                                                                                                                                                                        |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receiver type     | select               | read: `MSP_RX_CONFIG` byte 0 + `MSP_FEATURE_CONFIG` · write: `serialrx_provider = CRSF`, feature `RX_SERIAL` (bit 3) | None, ELRS / CRSF                                        | Shown read-only as "Built-in (SPI)" when feature `RX_SPI` (bit 25) is active — no port needed. A different provider (SBUS, …) is shown read-only as "Other (SBUS)" until the user changes it |
| Receiver port     | select               | port function `RX_SERIAL` (64)                                                                                       | free UARTs                                               |                                                                                                                                                                                              |
| VTX type          | select               | derived from the port's function bits                                                                                | None, Digital (MSP), Analog (SmartAudio), Analog (Tramp) | see Behaviour for the extra settings written                                                                                                                                                 |
| VTX port          | select               | Digital: functions `MSP` (1) + `VTX_MSP` (131072) · Analog: `VTX_SMARTAUDIO` (2048) or `VTX_TRAMP` (8192)            | free UARTs                                               | MSP baud 115200                                                                                                                                                                              |
| GPS               | select               | feature `GPS` (bit 7)                                                                                                | None, Connected                                          |                                                                                                                                                                                              |
| GPS port          | select               | port function `GPS` (2)                                                                                              | free UARTs                                               | GPS baud: keep the FC's current value                                                                                                                                                        |
| Other MSP devices | list of port selects | port function `MSP` (1)                                                                                              | 0..n · none                                              | MSP baud 115200                                                                                                                                                                              |
| Unmanaged ports   | read-only list       | any other function bit                                                                                               | —                                                        | e.g. ESC sensor, blackbox, telemetry                                                                                                                                                         |

Ports: `MSP2_COMMON_SERIAL_CONFIG` (0x1009) to read, `MSP2_COMMON_SET_SERIAL_CONFIG` (0x100A) to write.
Per port: `identifier:u8, functionMask:u32, mspBaud:u8, gpsBaud:u8, telemetryBaud:u8, blackboxBaud:u8`.
Identifiers: USB VCP = 20, UART1 = 51, UART2 = 52, … , SOFTSERIAL1 = 30, LPUART1 = 40.
Features: `MSP_FEATURE_CONFIG` (36) / `MSP_SET_FEATURE_CONFIG` (37), one u32 mask.
Named settings are written with `MSP2_CLI_SETTING` (0x3010), payload = ASCII `name = value`. In 2026.6
**reads through it always fail** (firmware bug, fixed for API 1.49) — it is write-only here.

## Behaviour

- Port dropdowns list hardware UARTs only. **USB VCP is never shown and its config is never modified** (it's
  the connection we are talking over).
- One device per UART. A port already used by another card is shown disabled with "used by Receiver".
- A port used by something this tab doesn't manage **can** be picked; it is labelled "UART3 — ESC telemetry"
  and Save asks "UART3 is used for ESC telemetry — replace it?". Confirming clears the port's other bits.
- VTX type changes also write: → Digital: `osd_displayport_device = MSP`, `vcd_video_system = HD`.
  Digital → anything else: `osd_displayport_device = AUTO`, `vcd_video_system = AUTO`. Otherwise untouched.
- Function bits and baud rates this tab doesn't manage are written back unchanged (read-modify-write).
- Setting a type to "None" clears that device's function bit from its port; features (`RX_SERIAL`, `GPS`) are
  switched on/off to match.
- Every change on this tab needs a reboot → button is always **Save & Reboot** (SPEC §5).
- Save order: serial config → features → named settings → `MSP_EEPROM_WRITE` (250) → `MSP_REBOOT` (68). If any step fails: stop, don't write EEPROM, show the error, keep local edits.

## Hidden on purpose

- Function-mask matrix, all baud rates, telemetry output, blackbox-over-serial, ESC sensor, RunCam device,
  LIDAR/optical flow, softserial, peripherals dropdown.
- Receiver protocols other than CRSF (SBUS, IBUS, Spektrum, …).

## Acceptance

With **Connect Mock FC** (mock boots with: UART1–UART6, RX on UART2, ESC sensor on UART3):

- [x] Tab shows Receiver = ELRS / CRSF on UART2; UART3 listed as unmanaged "ESC telemetry"
- [x] Setting VTX = Digital (MSP) on UART1 → Save & Reboot → app reconnects by itself → tab shows it again
- [x] UART2 is disabled in the VTX/GPS dropdowns ("used by Receiver")
- [x] Revert restores the FC's values; leaving the tab with edits asks to discard
- [x] After save, the mock's UART3 mask is unchanged and USB VCP still has MSP

On real hardware (Betaflight 2026.6):

- [ ] Values shown match Betaflight Configurator's Ports tab
- [ ] Move the receiver to another UART and back; verify in Betaflight Configurator after each save

## Open questions

None.

## Decisions

- One receiver entry "ELRS / CRSF" (same protocol over a UART).
- Two analog VTX entries (SmartAudio, Tramp) instead of a protocol sub-step.
- Busy unmanaged ports are selectable with a confirmation.
- Built against 2026.6 (API 1.48). API 1.49 replaces function masks with `rx_uart` / `vtx_uart` / `gps_uart` /
  `msp_N_uart` settings — port logic lives behind one interface (`lib/ports/`) so that backend can be added.
