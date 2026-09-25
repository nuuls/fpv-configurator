# ESC

Status: ready
_Implemented; mock acceptance passes (`src/pages/Esc.test.tsx`, `src/lib/esc/*.test.ts`). Set to `built` once the hardware checks pass._
Route: `/esc` · Sidebar: "ESC" · Page: `src/pages/Esc.tsx` · Logic: `src/lib/esc/`

## Purpose

See which firmware every ESC runs and how it is set up, and change the settings that matter — without opening a
second configurator (SPEC §2 "ESC"). Bluejay 0.21: motor timing and both startup powers. AM32 2.21: every setting of
the AM32 configurator. BLHeli_S is only shown. Firmware is never flashed (SPEC "Never").

## Layout

```
+-------------------------------------------------------------------------+
| [Read ESCs]   Plug in the flight battery first — the ESCs need power.   |
|               Props off: the ESCs restart while they are being read.    |
+-------------------------------------------+-----------------------------+
| All 4 ESCs — same firmware, same settings |
| Bluejay 0.21.0                            |
| Z-H-30 · EFM8BB21                         |
| Minimum startup power                     |   <- what can be changed
| 1025                                      |
| [-----o----------------------]            |      slider
|  ▔▔▔▔▔████▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔            |      green = recommended 1025–1050
| ✓ Recommended (1025–1050)                 |
| Maximum startup power                     |
| 1020  (slider, green 1050–1200)           |
| ! Below the recommended 1050–1200         |
| Motor timing           [22.5° (medium h.)]|
| Other settings                            |   <- only shown
| Motor direction             ESC 1 Normal  |
|                             ESC 2 Reversed|
| PWM frequency                      48 kHz |
| [! Flight performance is greatly reduced …]|   <- warning in the row
| …                                         |
+-------------------------------------------+
                                            [Revert] [Save]
```

When the ESCs are not alike (or one couldn't be read), a card per ESC instead, and below them one editor per firmware
that can be changed:

```
| The ESCs are not set up alike (PWM frequency), so they are listed …     |
+------------------+------------------+------------------+----------------+
| ESC 1            | ESC 2            | ESC 3            | ESC 4          |
| Bluejay 0.21.0   | Bluejay 0.21.0   | BLHeli_S 16.7    | AM32 2.21      |
| Z-H-30 · EFM8BB21| …                | A-H-30 · EFM8BB10| MOCK_ESC_F051  |
| Motor direction  |                  |                  |                |
|   Normal         |   Reversed       |                  |                |
| PWM frequency    |                  |                  |                |
|   48 kHz         |   24 kHz [differs]                  |                |
| …                |                  |                  |                |
+------------------+------------------+------------------+----------------+
| Change Bluejay 0.21.0 settings            | | Change AM32 2.21 settings |
| ESC 1, 2 — set up alike                   | | ESC 4                     |
| Minimum startup power  [--o--] 1025       | | Essentials …              |
| …                                         | | …                         |
+-------------------------------------------+ +---------------------------+
                                            [Revert] [Save]
```

## Controls

| Control                        | Type                                                            | Betaflight setting / MSP                                                                                                                                                                                                                     | Values · default                                | Notes                                                                                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read ESCs                      | button                                                          | `MSP_SET_PASSTHROUGH` (245, no payload = BLHeli 4-way), then the 4-way interface: `cmd_DeviceInitFlash`, `cmd_DeviceRead`, `cmd_DeviceReset`, `cmd_InterfaceExit`                                                                            | —                                               | Nothing is read before it is pressed. Reads "Read again" afterwards; asks "Discard changes?" first when there are unsaved edits                                                                                                                    |
| Firmware                       | readout per ESC                                                 | settings block (below)                                                                                                                                                                                                                       | BLHeli_S / Bluejay / AM32 + version             | Bluejay: `main.sub` + the suffix in its name field, e.g. `0.21.0`. AM32: `major.minor` with two digits                                                                                                                                             |
| Hardware                       | readout per ESC                                                 | BLHeli_S / Bluejay: `LAYOUT` field + MCU from the bootloader signature. AM32: firmware file name (16 bytes, 32 below the settings)                                                                                                           | e.g. `Z-H-30 · EFM8BB21`, `AIKON_F051`          | AM32 builds without a file name: flash size from the signature instead                                                                                                                                                                             |
| Settings                       | readout list per ESC                                            | settings block: SiLabs 0x1A00 (BB1/BB21) or 0x3000 (BB51), 0xFF bytes (settings, name tags, startup melody). AM32 0x7C00 (32 k flash), 0xF800 (64 k) or 0x7E00 (128 k, address shifted by 2), 0xB8 bytes (settings, startup tune, CAN block) | see `src/lib/esc/model.ts`                      | Shown with the unit and wording of ESC Configurator / the AM32 configurator                                                                                                                                                                        |
| Version check                  | error notice + "Version not supported" on the card              | Bluejay: `main.sub` of the settings block must be 0.21. AM32: `major.minor` must be 2.21                                                                                                                                                     | —                                               | Older Bluejay: told to update with ESC Configurator (a link to esc-configurator.com, as in the PWM frequency warning); other AM32: told to flash 2.21 with the AM32 configurator. No settings are shown or changed on such an ESC                  |
| Bluejay: minimum startup power | slider with recommended range                                   | byte 0x04; shown as 1000 + raw × 1000 / 2047                                                                                                                                                                                                 | 1000–1125, step 5 · 1010                        | Same for all Bluejay ESCs. 1025–1050 painted green under the track (the rest amber) with a line "Recommended (…)" / "Below / Above the recommended …", like dynamic idle on Motors                                                                 |
| Bluejay: maximum startup power | slider with recommended range                                   | byte 0x07; shown as 1000 + raw × 4                                                                                                                                                                                                           | 1004–1300, step 4 · 1020                        | Same for all Bluejay ESCs. Recommended range 1050–1200, shown like the minimum                                                                                                                                                                     |
| Bluejay: motor timing          | dropdown                                                        | byte 0x15                                                                                                                                                                                                                                    | 0° / 7.5° / 15° / 22.5° / 30° (raw 1–5) · 22.5° | Same for all Bluejay ESCs                                                                                                                                                                                                                          |
| Bluejay: PWM frequency         | readout + warning                                               | byte 0x0A (`24 SHL PWM_FREQ`: what the firmware was built for)                                                                                                                                                                               | 24 / 48 / 96 kHz                                | Read-only, changing it means flashing. Anything but 24 kHz: warning in the row (every card that shows it) that flight performance is greatly reduced, flash the 24 kHz build                                                                       |
| AM32: all settings             | switch / dropdown / number, grouped as in the AM32 configurator | offsets of `Inc/eeprom.h`, see "AM32 settings" below                                                                                                                                                                                         | see below                                       | Same for all AM32 ESCs, except the motor direction: one dropdown per ESC                                                                                                                                                                           |
| "Use them for all"             | button in a notice                                              | —                                                                                                                                                                                                                                            | —                                               | Only when ESCs of one firmware differ in a setting that can be changed: the editor shows ESC 1's values; the button puts them into the draft of the others                                                                                         |
| Revert / Save                  | SaveBar (SPEC §5)                                               | 4-way `cmd_DevicePageErase` (SiLabs only), `cmd_DeviceWrite`, `cmd_DeviceRead`                                                                                                                                                               | —                                               | Save asks first ("Write the settings to the ESCs?", names the ESCs). No reboot of the FC, nothing is written to the FC                                                                                                                             |
| Combined view                  | readout                                                         | —                                                                                                                                                                                                                                            | —                                               | Shown instead of the cards per ESC once all ESCs are read and they are alike: every one readable, same firmware, version, settings layout and hardware, and the same value for every setting. Motor direction may vary — it is then listed per ESC |
| "differs" badge                | readout                                                         | —                                                                                                                                                                                                                                            | —                                               | Cards per ESC only. On a setting whose value is not the one of the first ESC with the same firmware. Motor direction is left out — it is per motor on purpose                                                                                      |

Settings shown — BLHeli_S (layout 32, 33): motor direction, startup power, motor timing, demag compensation,
temperature protection, low RPM power protection, brake on stop, beep strength, beacon strength, beacon delay.
Bluejay 0.21 (layout 208): motor direction, PWM frequency, minimum / maximum startup power, motor timing, demag
compensation, rampup power, temperature protection, brake on stop, braking strength, power rating, force EDT arm, beep
strength, beacon strength, beacon delay.

AM32 settings (2.21, `eeprom_version` 4; offset · range as shown · what disables it):

- Essentials: signal protocol (46 · Auto / DShot / Servo / Serial / EDT ARM), disable stick calibration (7).
- Motor: motor direction (17, per ESC), bidirectional (3D) mode (18), PWM type (21 · Fixed / Variable / By RPM), PWM
  frequency (24 · 8–144 kHz · off with "By RPM"), auto timing advance (47), timing advance (23 · 0–30° in steps of
  0.9375°, raw 10–42 · off with auto timing), startup power (25 · 50–150 %), motor KV (26 · 20–10220, step 40), motor
  poles (27 · 2–36), complementary PWM (20), stuck rotor protection (22), stall protection (29), use hall sensors
  (39), 30 ms telemetry (31), beep volume (30 · 0–11).
- Extended settings: ramp rate (5 · 0.1–20 % duty cycle per ms), minimum duty cycle (6 · 0–25 %, step 0.5).
- Limits: low voltage cutoff (36 · Off / Per cell / Absolute), cutoff voltage per cell (37 · 2.50–3.50 V · only with
  "Per cell"), absolute cutoff voltage (8 · 0.5–50 V · only with "Absolute"), temperature limit (43 · 70–141 °C, 141 =
  off), current limit (44 · 0–202 A, step 2, 0 and 202 = off).
- Current control: current P / I / D (9, 10, 11 · 0–255).
- Sinusoidal startup: sinusoidal startup (19), sine mode range (40 · 5–25 % throttle), sine mode power (45 · 1–10) —
  both off without sinusoidal startup or with car type reverse braking.
- Brake: brake on stop (28 · Off / On / Active brake), car type reverse braking (38), brake strength (41 · 1–10 · off
  without brake on stop or with car braking), running brake level (42 · 1–10 · off with car braking), active brake
  power (12 · 0–5 % duty cycle, 0 = off · only with "Active brake").
- Servo input: low threshold (32 · 750–1250 µs), high threshold (33 · 1750–2250 µs), neutral (34 · 1374–1629 µs), dead
  band (35 · 0–100).

## Behaviour

- Reading takes over the MSP link: other MSP requests (header, polls) wait until the ESCs are done. The FC stops the
  motor outputs while the 4-way interface is active and re-enables them on `cmd_InterfaceExit` — no reboot.
- The FC pulls the signal wires high when the passthrough starts; a running ESC needs a few hundred ms (more with a
  startup tune) to notice and jump into its bootloader, and the FC gives up on a silent bootloader within ~50 ms. So
  the app waits 1.2 s before the first `cmd_DeviceInitFlash` and asks each ESC up to 5 times, 250 ms apart (timing as
  in ESC Configurator). Without a battery the result therefore takes about 6 s.
- Every ESC is reset (`cmd_DeviceReset`) right after it was read so it leaves its bootloader, and
  `cmd_InterfaceExit` is sent on every exit path, also after an error. If the FC doesn't leave the 4-way interface the
  page says so and asks to replug it.
- All ESCs are always read. Only then they are compared: alike (see "Combined view") → one view with the firmware,
  hardware and settings once. Otherwise a card per ESC, below a notice saying what keeps them apart — different
  firmware, different hardware, or the names of the settings that differ. No such notice when an ESC wasn't readable:
  its card says so. A single ESC is shown as its card.
- An ESC that doesn't answer gets a card saying so (battery, signal wire); the others are still read. No ESC
  answering at all: a hint to plug in the battery. `MSP_SET_PASSTHROUGH` reporting 0 ESCs: a notice pointing to the
  Motors tab (motor protocol).
- Unknown firmware (BLHeli_32, BLHeli_M, JESC, Atmel, unknown MCU signature): firmware "Unknown" with the raw
  signature, no settings. Known firmware with a newer settings layout than listed above: firmware and version, plus a
  note that the settings can't be shown.
- The result is kept while the tab is open; leaving the tab or reconnecting clears it.
- Version check: Bluejay other than 0.21 and AM32 other than 2.21 get an error notice (once per message) saying what
  to flash, and "Version not supported" on their card — no settings, nothing to change. Such ESCs are never combined.
- Editing (SPEC §5): edits stay local until Save. The draft is the settings block of each ESC as it was read, with
  single bytes patched — a change to a shared setting goes into the block of every ESC with that firmware, a per-motor
  one (AM32 motor direction) into one. Numbers are kept inside their range and on the values the ESC can store.
  Settings that another one makes meaningless are greyed out (see "AM32 settings").
- Save asks for confirmation, then takes over the MSP link like reading does (same waiting and retries). Per ESC whose
  block changed: `cmd_DeviceInitFlash`, check it is the same MCU, read the block again — if it already holds the new
  settings it is skipped, if it is no longer what was read the save stops ("read the ESCs again") — then SiLabs:
  `cmd_DevicePageErase` of the settings page; both: one `cmd_DeviceWrite` with the whole block, read it back and
  compare; `cmd_DeviceReset`. `cmd_InterfaceExit` on every exit path. It stops at the first ESC that fails and says
  which one; pressing Save again finishes the rest. Afterwards the page shows what was read back — no second read.
- Only the settings block is ever erased or written; ESCs that were not changed, BLHeli_S, unsupported versions and
  AM32 on 128 k flash are never written to. Nothing on this tab changes the FC or needs a reboot.
- Bluejay built for anything but 24 kHz PWM: a warning in the PWM frequency row of the card(s) — it can only be fixed
  by flashing.

## Hidden on purpose

- Flashing (SPEC "Never"), startup melodies / the AM32 "Tune" tab, changing BLHeli_S settings, Bluejay settings
  other than the three SPEC §2 lists (they are shown).
- BLHeli_S programming by TX, PPM throttle range and LED control; Bluejay LED control — none of them matter on a
  DShot multirotor. AM32 `brake_on_zero_throttle` (byte 13): not in the AM32 configurator.
- Bluejay / AM32 versions other than 0.21 / 2.21: not even their settings are shown (SPEC §2).
- ESC Configurator's "mistagged firmware" dead-time check.

## Acceptance

Mock FC ("Connect Mock FC" / demo mode: a Bluejay 0.21.0 ESC, 48 kHz build, and an AM32 2.21 ESC; like real ones they
only answer once the signal wire was high for 0.7 s, and their SiLabs flash only takes a write after an erase). The
combined view runs against `defaultMockEscs()` (4 Bluejay set up alike, motors 2 and 3 reversed), the other checks on
ESCs that are not alike against `mixedMockEscs()` (two Bluejay 0.21.0 — the second one reversed and with another PWM
frequency —, a BLHeli_S 16.7 and an AM32 2.21) in the tests:

- [x] Nothing is read before "Read ESCs" is pressed
- [x] Read ESCs in demo mode → a card each for the Bluejay and the AM32 ESC, and an editor for each firmware
- [x] Four ESCs that are alike → one combined view with firmware, version, hardware and settings; motor
      direction listed per ESC (ESC 2 and 3 "Reversed"); no cards per ESC
- [x] ESCs with different firmware → four cards with firmware, version, hardware and settings, and a notice
- [x] A setting that differs → cards per ESC, the notice names it and the ESC's value carries "differs"; its motor
      direction doesn't
- [x] The FC answers MSP again afterwards (another tab opens and reads)
- [x] An ESC that doesn't answer is shown as such next to the ones that do; none answering → battery hint
- [x] Reading sends no write / erase command (the mock logs every one)
- [x] Bluejay: timing and both startup powers can be changed, PWM frequency can't; the 48 kHz build shows the warning
- [x] Save asks first; then every ESC gets one page erase + one write of its settings block, the other bytes of the
      block (direction, name tags, melody) are unchanged, and "Read again" shows the new values
- [x] AM32: all settings of the AM32 configurator in its groups, motor direction per ESC, written without a page
      erase; dependent settings are greyed out; numbers stay in range
- [x] Bluejay ≠ 0.21 / AM32 ≠ 2.21: error telling what to flash, "Version not supported", nothing to change
- [x] ESCs that differ in an editable setting: ESC 1's values shown, "Use them for all" levels them
- [x] An ESC whose settings changed since the read is refused; an ESC that doesn't answer stops the save, and saving
      again only writes the ESCs that are still missing
- [x] Revert drops the edits; unsaved edits mark the tab

On real hardware:

- [ ] Bluejay, BLHeli_S and AM32 ESCs: firmware, version and settings match ESC Configurator / the AM32 configurator
- [ ] Bluejay 0.21: a changed timing / startup power shows up in ESC Configurator, the startup melody still plays
- [ ] AM32 2.21: changed settings show up in the AM32 configurator, the startup tune is still there
- [ ] Motors spin from the Motors tab after reading, without replugging
- [ ] Without a battery the page reports that no ESC answered within about 6 seconds

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
- One combined view for ESCs that are alike (user request): four identical lists say nothing, and whether they are
  identical is the actual question. Hardware has to match too — the view has one header — and a differing motor
  direction doesn't keep them apart, it is per motor on purpose.
- The mock's default ESCs are a realistic quad (four Bluejay set up alike), used by the tests of the combined view.
  "Connect Mock FC" (demo mode) reads `demoMockEscs()` instead — one Bluejay and one AM32 ESC — so both editors can be
  seen (user request, 2026-09-25); the combined view is then only covered by the tests. `mixedMockEscs()` (three
  firmwares) keeps BLHeli_S covered.

- Editing (SPEC §2, 2026-09): the draft is the raw settings block per ESC and saving is read-modify-write of that
  block, the way ESC Configurator and the AM32 configurator write settings (SiLabs: erase the page, write 0xFF bytes;
  AM32: one write of 0xB8 bytes, its bootloader erases). Bytes this app doesn't know go back untouched. Unlike the AM32
  configurator the read-back is compared for AM32 too.
- Before writing, the block is read again and must still be what the page shows — otherwise another tool changed the
  ESC in between and the bytes we'd write back would be stale.
- "Editable timings" = Bluejay motor (commutation) timing; "startup speeds (both types)" = minimum and maximum startup
  power. Ranges and steps as in ESC Configurator. Other Bluejay settings stay read-only because SPEC §2 doesn't list
  them.
- "All settings from AM32 configurator" = its "Base" tab, with its groups, ranges, units and enable rules. Not the
  "Tune" tab (startup melody editor) — ask if wanted. 3D mode is one switch for all ESCs (the AM32 configurator has it
  per ESC); only the motor direction is per ESC.
- Versions are matched exactly (Bluejay `0.21`, any patch level; AM32 `2.21`). AM32 2.21 raises `eeprom_version` to 4
  when it first starts, so only that layout is known.
- AM32 on 128 k flash (signature 0x2B06, CAN ESCs) is read but not written: newer bootloaders report their own flash
  map ("v3 devinfo" in the AM32 configurator), which this app doesn't read.
- Numbers are typed (number fields) instead of the configurators' sliders: 255 steps on a short slider can't be hit,
  and a motor KV is something you know. Timing advance is a dropdown of its 33 values.
- Save asks for confirmation although SPEC §5 doesn't: a failed write leaves an ESC on default settings, and the ESCs
  restart.
- The 48 kHz warning shows on "Connect Mock FC" on purpose (the mock Bluejay is the 48 kHz build), so the warning is exercised.

## Open questions

None.
