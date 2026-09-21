# ESC

Status: ready
_Implemented; mock acceptance passes (`src/pages/Esc.test.tsx`, `src/lib/esc/*.test.ts`). Set to `built` once the hardware checks pass._
Route: `/esc` · Sidebar: "ESC" · Page: `src/pages/Esc.tsx` · Logic: `src/lib/esc/`

## Purpose

See which firmware every ESC runs and how it is set up — without opening a second configurator (SPEC §2 "ESC").
Read-only.

## Layout

```
+-------------------------------------------------------------------------+
| [Read ESCs]   Plug in the flight battery first — the ESCs need power.   |
|               Props off: the ESCs restart while they are being read.    |
+------------------+------------------+------------------+----------------+
| ESC 1            | ESC 2            | ESC 3            | ESC 4          |
| Bluejay 0.21.0   | Bluejay 0.21.0   | BLHeli_S 16.7    | AM32 2.18      |
| Z-H-30 · EFM8BB21| …                | A-H-30 · EFM8BB10| MOCK_ESC_F051  |
| Motor direction  |                  |                  |                |
|   Normal         |   Reversed       |                  |                |
| PWM frequency    |                  |                  |                |
|   48 kHz         |   24 kHz [differs]                  |                |
| …                |                  |                  |                |
+------------------+------------------+------------------+----------------+
```

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Read ESCs | button | `MSP_SET_PASSTHROUGH` (245, no payload = BLHeli 4-way), then the 4-way interface: `cmd_DeviceInitFlash`, `cmd_DeviceRead`, `cmd_DeviceReset`, `cmd_InterfaceExit` | — | Nothing is read before it is pressed. Reads "Read again" afterwards |
| Firmware | readout per ESC | settings block (below) | BLHeli_S / Bluejay / AM32 + version | Bluejay: `main.sub` + the suffix in its name field, e.g. `0.21.0`. AM32: `major.minor` with two digits |
| Hardware | readout per ESC | BLHeli_S / Bluejay: `LAYOUT` field + MCU from the bootloader signature. AM32: firmware file name (16 bytes, 32 below the settings) | e.g. `Z-H-30 · EFM8BB21`, `AIKON_F051` | AM32 builds without a file name: flash size from the signature instead |
| Settings | readout list per ESC | settings block: SiLabs 0x1A00 (BB1/BB21) or 0x3000 (BB51), 0x70 bytes. AM32 0x7C00 (32 k flash), 0xF800 (64 k) or 0x7E00 (128 k, address shifted by 2), 48 bytes | see `src/lib/esc/model.ts` | Only settings that matter on a multirotor; shown with the unit and wording of ESC Configurator |
| "differs" badge | readout | — | — | On a setting whose value is not the one of the first ESC with the same firmware. Motor direction is left out — it is per motor on purpose |

Settings shown — BLHeli_S (layout 32, 33): motor direction, startup power, motor timing, demag compensation,
temperature protection, low RPM power protection, brake on stop, beep strength, beacon strength, beacon delay.
Bluejay (layout 200–209): motor direction, PWM frequency (from 209; before that it is part of the firmware build),
minimum / maximum startup power, motor timing, demag compensation, rampup power, temperature protection, brake on
stop, braking strength, power rating, force EDT arm, beep strength, beacon strength, beacon delay — each only in the
layouts that have it. AM32 (EEPROM version 0 and up): motor direction, 3D mode, PWM frequency / variable PWM, timing
advance, startup power, motor KV, motor poles, complementary PWM, brake on stop, stuck rotor and stall protection,
sinusoidal startup, protocol, temperature and current limit, low voltage cutoff, beep volume, 30 ms telemetry.

## Behaviour

- Reading takes over the MSP link: other MSP requests (header, polls) wait until the ESCs are done. The FC stops the
  motor outputs while the 4-way interface is active and re-enables them on `cmd_InterfaceExit` — no reboot.
- Every ESC is reset (`cmd_DeviceReset`) right after it was read so it leaves its bootloader, and
  `cmd_InterfaceExit` is sent on every exit path, also after an error. If the FC doesn't leave the 4-way interface the
  page says so and asks to replug it.
- An ESC that doesn't answer gets a card saying so (battery, signal wire); the others are still read. No ESC
  answering at all: a hint to plug in the battery. `MSP_SET_PASSTHROUGH` reporting 0 ESCs: a notice pointing to the
  Motors tab (motor protocol).
- Unknown firmware (BLHeli_32, BLHeli_M, JESC, Atmel, unknown MCU signature): firmware "Unknown" with the raw
  signature, no settings. Known firmware with a newer settings layout than listed above: firmware and version, plus a
  note that the settings can't be shown.
- The result is kept while the tab is open; leaving the tab or reconnecting clears it.
- Nothing is ever written to an ESC: the 4-way write, erase and verify commands are not implemented.

## Hidden on purpose

- Changing settings, flashing, startup melodies — SPEC "Later" / "Never".
- BLHeli_S programming by TX, PPM throttle range and LED control; Bluejay dithering and startup beep (removed from the
  firmware); AM32 servo thresholds, RC car reversing, hall sensors, sine mode range and power, brake strength levels
  — none of them matter on a DShot multirotor.
- ESC Configurator's "mistagged firmware" dead-time check.

## Acceptance

Mock FC (4 ESCs: two Bluejay 0.21.0 — the second one reversed and with another PWM frequency —, a BLHeli_S 16.7 and
an AM32 2.18):

- [x] Nothing is read before "Read ESCs" is pressed
- [x] Read ESCs → four cards with firmware, version, hardware and settings; ESC 2 shows "Reversed"
- [x] ESC 2's PWM frequency carries "differs"; its motor direction doesn't
- [x] The FC answers MSP again afterwards (another tab opens and reads)
- [x] An ESC that doesn't answer is shown as such next to the ones that do; none answering → battery hint
- [x] No write / erase command reaches the 4-way interface (the mock rejects and counts them)

On real hardware:

- [ ] Bluejay, BLHeli_S and AM32 ESCs: firmware, version and settings match ESC Configurator / the AM32 configurator
- [ ] Motors spin from the Motors tab after reading, without replugging
- [ ] Without a battery the page reports that no ESC answered within a few seconds

## Decisions

- No tab spec existed; this one was written from SPEC §2 ("Read out ESC firmware and settings and display it. AM32,
  Bluejay and BL_heli_s supported") with the recommended options. Change freely.
- Explicit "Read ESCs" button instead of reading on tab open: it needs the battery plugged in and restarts the ESCs.
  No confirm dialog — nothing spins and nothing is written.
- Placed after Motors in the sidebar.
- Byte layouts: 4-way protocol from Betaflight `src/main/io/serial_4way.c`; BLHeli_S / Bluejay layouts and value
  tables from ESC Configurator (`stylesuxx/esc-configurator`, `src/sources`); AM32 from `am32-firmware/AM32`
  (`Inc/eeprom.h`, value handling in `Src/main.c`) and the AM32 bootloader (signature = flash size code + `0x06`).
- AM32 is told apart from BLHeli_32 (same interface mode) by the bootloader's input pin code, like ESC Configurator
  does: only PA2, PB4 and PA6 are AM32.
- AM32 timing advance: raw 0–3 is ×7.5°, raw 10–42 is (raw − 10) × 0.9375° (`Src/main.c`).
- The mock's four ESCs run three different firmwares so that "Connect Mock FC" shows every supported one. Not a
  realistic quad, but a realistic one would leave two decoders invisible.

## Open questions

None.
