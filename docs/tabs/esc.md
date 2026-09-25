# ESC

Status: ready
_Implemented; mock acceptance passes (`src/pages/Esc.test.tsx`, `src/lib/esc/*.test.ts`). Set to `built` once the hardware checks pass._
Route: `/esc` · Sidebar: "ESC" · Page: `src/pages/Esc.tsx` · Logic: `src/lib/esc/`

## Purpose

See which firmware every ESC runs and how it is set up, and change the settings that matter — without opening a
second configurator (SPEC §2 "ESC"). Bluejay 0.21: motor timing, both startup powers and the power rating. AM32 2.21:
3D mode, PWM type, PWM frequency, motor KV and poles. Every other Bluejay / AM32 setting only shows up when it is not
on the firmware's default, with a way back to it. BLHeli_S is only shown. The motor direction is ignored. Firmware is
never flashed (SPEC "Never").

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
| Power rating                      [2S+ ]  |
| +---------------------------------------+ |
| | ! Not on the Bluejay default          | |   <- only when a setting is off
| | This app doesn't change these …       | |      its default
| | Demag compensation: High              | |
| |   (default Low)             [Reset]   | |
| | Temperature protection: 140 °C        | |
| |   (default Off)             [Reset]   | |
| | [Reset all to defaults]               | |
| +---------------------------------------+ |
| PWM frequency                      48 kHz |   <- only with its warning
| [! Flight performance is greatly reduced …]|
+-------------------------------------------+
                                            [Revert] [Save]
```

When the ESCs are not alike (or one couldn't be read), a card per ESC instead, two side by side (one column on
narrow screens). Each card is built like the combined one: what can be changed on that ESC, then what is not on the
default, then the PWM frequency warning. Firmware this app doesn't change (BLHeli_S, unsupported layouts, AM32 on 128 k
flash) lists every setting instead:

```
| The ESCs are not set up alike (PWM frequency), so they are listed …     |
| Not the same on the Bluejay ESCs (1, 2): Motor timing. [Use ESC 1's for all]
+-----------------------------------+-------------------------------------+
| ESC 1                             | ESC 2                               |
| Bluejay 0.21.0                    | Bluejay 0.21.0                      |
| Z-H-30 · EFM8BB21                 | Z-H-30 · EFM8BB21                   |
| Minimum startup power [--o--] 1025| Minimum startup power [--o--] 1025  |
| …                                 | …                                   |
| Motor timing     [22.5° (m. high)]| Motor timing [differs] [7.5° (m. l.)]|
| Power rating              [2S+ ]  | Power rating              [2S+ ]    |
| PWM frequency             48 kHz  |                                     |
| [! Flight performance is …]       |                                     |
+-----------------------------------+-------------------------------------+
| ESC 3                             | ESC 4                               |
| BLHeli_S 16.7                     | AM32 2.21                           |
| A-H-30 · EFM8BB10                 | MOCK_ESC_F051                       |
| Startup power               0.50  | Bidirectional (3D) mode       [ o]  |
| …   (only shown)                  | PWM type                [Variable]  |
|                                   | PWM frequency  24 kHz [--o-------]  |
|                                   | Motor KV                  [ 2220 ]  |
|                                   | Motor poles               [   14 ]  |
+-----------------------------------+-------------------------------------+
                                            [Revert] [Save]
```

## Controls

| Control                        | Type                                                            | Betaflight setting / MSP                                                                                                                                                                                                                     | Values · default                                | Notes                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read ESCs                      | button                                                          | `MSP_SET_PASSTHROUGH` (245, no payload = BLHeli 4-way), then the 4-way interface: `cmd_DeviceInitFlash`, `cmd_DeviceRead`, `cmd_DeviceReset`, `cmd_InterfaceExit`                                                                            | —                                               | Nothing is read before it is pressed. Reads "Read again" afterwards; asks "Discard changes?" first when there are unsaved edits                                                                                                                                                                  |
| Firmware                       | readout per ESC                                                 | settings block (below)                                                                                                                                                                                                                       | BLHeli_S / Bluejay / AM32 + version             | Bluejay: `main.sub` + the suffix in its name field, e.g. `0.21.0`. AM32: `major.minor` with two digits                                                                                                                                                                                           |
| Hardware                       | readout per ESC                                                 | BLHeli_S / Bluejay: `LAYOUT` field + MCU from the bootloader signature. AM32: firmware file name (16 bytes, 32 below the settings)                                                                                                           | e.g. `Z-H-30 · EFM8BB21`, `AIKON_F051`          | AM32 builds without a file name: flash size from the signature instead                                                                                                                                                                                                                           |
| Settings                       | readout list per ESC                                            | settings block: SiLabs 0x1A00 (BB1/BB21) or 0x3000 (BB51), 0xFF bytes (settings, name tags, startup melody). AM32 0x7C00 (32 k flash), 0xF800 (64 k) or 0x7E00 (128 k, address shifted by 2), 0xB8 bytes (settings, startup tune, CAN block) | see `src/lib/esc/model.ts`                      | Shown with the unit and wording of ESC Configurator / the AM32 configurator                                                                                                                                                                                                                      |
| Version check                  | error notice + "Version not supported" on the card              | Bluejay: `main.sub` of the settings block must be 0.21. AM32: `major.minor` must be 2.21                                                                                                                                                     | —                                               | Older Bluejay: told to update with ESC Configurator (a link to esc-configurator.com, as in the PWM frequency warning); other AM32: told to flash 2.21 with the AM32 configurator. No settings are shown or changed on such an ESC                                                                |
| Bluejay: minimum startup power | slider with recommended range                                   | byte 0x04; shown as 1000 + raw × 1000 / 2047                                                                                                                                                                                                 | 1000–1125, step 5 · 1010                        | Same for all Bluejay ESCs (per ESC on its card when they are listed one by one). 1025–1050 painted green under the track (the rest amber) with a line "Recommended (…)" / "Below / Above the recommended …", like dynamic idle on Motors                                                         |
| Bluejay: maximum startup power | slider with recommended range                                   | byte 0x07; shown as 1000 + raw × 4                                                                                                                                                                                                           | 1004–1300, step 4 · 1020                        | Same for all Bluejay ESCs (per ESC on its card when they are listed one by one). Recommended range 1050–1200, shown like the minimum                                                                                                                                                             |
| Bluejay: motor timing          | dropdown                                                        | byte 0x15                                                                                                                                                                                                                                    | 0° / 7.5° / 15° / 22.5° / 30° (raw 1–5) · 22.5° | Same for all Bluejay ESCs (per ESC on its card when they are listed one by one)                                                                                                                                                                                                                  |
| Bluejay: power rating          | dropdown                                                        | byte 0x29                                                                                                                                                                                                                                    | 1S / 2S+ (raw 1, 2) · 2S+                       | Same for all Bluejay ESCs (per ESC on its card when they are listed one by one). Hint: sets the temperature limits, 1S only on a 1S quad                                                                                                                                                         |
| Bluejay: PWM frequency         | readout + warning                                               | byte 0x0A (`24 SHL PWM_FREQ`: what the firmware was built for)                                                                                                                                                                               | 24 / 48 / 96 kHz                                | Read-only, changing it means flashing. Only shown when it isn't 24 kHz, with the warning that flight performance is greatly reduced, flash the 24 kHz build                                                                                                                                      |
| AM32: motor settings           | switch / dropdown / slider / number                             | 3D mode (18), PWM type (21), PWM frequency (24, slider), motor KV (26), motor poles (27) — offsets of `Inc/eeprom.h`                                                                                                                         | see "AM32 settings" below                       | Same for all AM32 ESCs (per ESC on its card when they are listed one by one). PWM frequency greyed out with PWM type "By RPM"; with "Variable" it reads e.g. "24–48 kHz" and a paler bar grows on from the thumb to twice the frequency (the firmware follows the RPM up to half the set period) |
| "Not on the … default"         | warning box with a "Reset" per setting, "Reset all to defaults" | the settings this app doesn't change, see "Defaults" below                                                                                                                                                                                   | —                                               | Only when one of them isn't on the firmware's default (compared as shown, so bytes that mean the same don't count); lists value and default. Reset puts the default into the draft of every ESC the card stands for; Save writes it                                                              |
| "Use ESC 1's for all"          | button in a notice                                              | —                                                                                                                                                                                                                                            | —                                               | Only when ESCs of one firmware differ in a setting that can be changed: the notice (above the cards) names the settings, the setting carries "differs" on the other ESCs' cards; the button puts the first ESC's values into the draft of the others                                             |
| Revert / Save                  | SaveBar (SPEC §5)                                               | 4-way `cmd_DevicePageErase` (SiLabs only), `cmd_DeviceWrite`, `cmd_DeviceRead`                                                                                                                                                               | —                                               | Save asks first ("Write the settings to the ESCs?", names the ESCs). No reboot of the FC, nothing is written to the FC                                                                                                                                                                           |
| Combined view                  | readout                                                         | —                                                                                                                                                                                                                                            | —                                               | Shown instead of the cards per ESC once all ESCs are read and they are alike: every one readable, same firmware, version, settings layout and hardware, and the same value for every setting. The motor direction isn't read into it                                                             |
| "differs" badge                | readout                                                         | —                                                                                                                                                                                                                                            | —                                               | Cards per ESC only. On a setting whose value is not the one of the first ESC with the same firmware                                                                                                                                                                                              |

Settings — the motor direction is never shown or compared: it is set per motor on purpose (Motors tab).

- BLHeli_S (layout 32, 33), all shown: startup power, motor timing, demag compensation, temperature protection, low RPM
  power protection, brake on stop, beep strength, beacon strength, beacon delay.
- Bluejay 0.21 (layout 208): changed here — minimum / maximum startup power, motor timing, power rating. PWM frequency
  only with its warning. The rest only when not on the default (below).
- AM32 2.21 (`eeprom_version` 4): changed here — bidirectional (3D) mode (18), PWM type (21 · Fixed / Variable / By
  RPM), PWM frequency (24 · slider 8–144 kHz · off with "By RPM" · with "Variable" the ESC runs from it up to twice
  as much, shown as a range and a paler bar), motor KV (26 · 20–10220, step 40), motor poles (27 ·
  2–36). The rest only when not on the default (below).

Defaults (raw byte · shown as):

- Bluejay — the firmware's `DEFAULT_PGM_*` (`Bluejay.asm` v0.21.0, what a fresh flash starts with): demag
  compensation (0x1F · 2 = Low), rampup power (0x09 · 9x), temperature protection (0x23 · 0 = Off), brake on stop
  (0x27 · Off), braking strength (0x10 · 255), force EDT arm (0x2A · Off), beep strength (0x1B · 40), beacon strength
  (0x1C · 80), beacon delay (0x1D · 4 = 10 minutes).
- AM32 — the firmware has no default table; these are what the AM32 configurator's "Send Default Settings" writes
  (`public/eeprom-defaults/DEFAULT/v4.bin`): signal protocol (46 · DShot), disable stick calibration (7 · Off), auto
  timing advance (47 · Off), timing advance (23 · 26 = 15°), startup power (25 · 100 %), complementary PWM (20 · On),
  stuck rotor protection (22 · On), stall protection (29 · Off), hall sensors (39 · Off), 30 ms telemetry (31 · Off),
  beep volume (30 · 5), ramp rate (5 · 16 % duty cycle per ms), minimum duty cycle (6 · 2 %), low voltage cutoff
  (36 · Off), cutoff voltage per cell (37 · 3.00 V), absolute cutoff voltage (8 · 5 V), temperature limit (43 · 141 =
  Off), current limit (44 · 102 = Off), current P / I / D (9, 10, 11 · 100 / 0 / 50), sinusoidal startup (19 · Off),
  sine mode range (40 · 15 % throttle), sine mode power (45 · 6), brake on stop (28 · Off), car type reverse braking
  (38 · Off), brake strength (41 · 10), running brake level (42 · 10), active brake power (12 · 2 % duty cycle), servo
  low / high / neutral (32, 33, 34 · 1006 / 2006 / 1502 µs), servo dead band (35 · 50).

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
  single bytes patched — a change goes into the block of every ESC the card stands for (all of them in the combined
  view, one on a card per ESC). Numbers are kept inside their range and on the values the ESC can store. The AM32 PWM
  frequency is greyed out with PWM type "By RPM". "Reset" / "Reset all to defaults" patch the defaults in the same way.
- Save asks for confirmation, then takes over the MSP link like reading does (same waiting and retries). Per ESC whose
  block changed: `cmd_DeviceInitFlash`, check it is the same MCU, read the block again — if it already holds the new
  settings it is skipped, if it is no longer what was read the save stops ("read the ESCs again") — then SiLabs:
  `cmd_DevicePageErase` of the settings page; both: one `cmd_DeviceWrite` with the whole block, read it back and
  compare; `cmd_DeviceReset`. `cmd_InterfaceExit` on every exit path. It stops at the first ESC that fails and says
  which one; pressing Save again finishes the rest. Afterwards the page shows what was read back — no second read.
- Only the settings block is ever erased or written; ESCs that were not changed, BLHeli_S, unsupported versions and
  AM32 on 128 k flash are never written to. Nothing on this tab changes the FC or needs a reboot.
- Bluejay built for anything but 24 kHz PWM: a warning in the PWM frequency row of the card(s) — it can only be fixed
  by flashing, so there is no reset for it.

## Hidden on purpose

- Flashing (SPEC "Never"), startup melodies / the AM32 "Tune" tab, changing BLHeli_S settings, changing Bluejay / AM32
  settings other than the ones SPEC §2 lists (they are only put back to their default).
- The motor direction (SPEC §2): it is set per motor, on the Motors tab.
- BLHeli_S programming by TX, PPM throttle range and LED control; Bluejay LED control and startup beep — none of them
  matter on a DShot multirotor. AM32 `brake_on_zero_throttle` (byte 13): not in the AM32 configurator.
- Bluejay / AM32 versions other than 0.21 / 2.21: not even their settings are shown (SPEC §2).
- ESC Configurator's "mistagged firmware" dead-time check.

## Acceptance

Mock FC ("Connect Mock FC" / demo mode: a Bluejay 0.21.0 ESC, 48 kHz build, with demag compensation and temperature
protection off their defaults, and an AM32 2.21 ESC with stall protection and current D off theirs; like real ones they
only answer once the signal wire was high for 0.7 s, and their SiLabs flash only takes a write after an erase). The
mock ESCs are otherwise on the firmware's defaults. The combined view runs against `defaultMockEscs()` (4 Bluejay set
up alike, motors 2 and 3 reversed), the other checks on
ESCs that are not alike against `mixedMockEscs()` (two Bluejay 0.21.0 — the second one reversed and with another PWM
frequency —, a BLHeli_S 16.7 and an AM32 2.21) in the tests:

- [x] Nothing is read before "Read ESCs" is pressed
- [x] Read ESCs in demo mode → a card each for the Bluejay and the AM32 ESC, each with its settings to change and the
      two that are not on the default
- [x] Four ESCs that are alike (motor directions differ) → one combined view; no cards per ESC, no motor direction
- [x] ESCs with different firmware → four cards with firmware, version, hardware and settings, and a notice
- [x] A setting that differs → cards per ESC, the notice names it; the motor direction is never named
- [x] The FC answers MSP again afterwards (another tab opens and reads)
- [x] An ESC that doesn't answer is shown as such next to the ones that do; none answering → battery hint
- [x] Reading sends no write / erase command (the mock logs every one)
- [x] Bluejay: timing, both startup powers and the power rating can be changed, PWM frequency can't; the 48 kHz build
      shows the warning, the 24 kHz build no PWM frequency at all
- [x] Save asks first; then every ESC gets one page erase + one write of its settings block, the other bytes of the
      block (direction, name tags, melody) are unchanged, and "Read again" shows the new values
- [x] AM32: 3D mode, PWM type, PWM frequency (slider, greyed out with "By RPM"), motor KV and poles; written without
      a page erase; numbers stay in range
- [x] A setting that isn't changed here and isn't on its default is listed with value and default; "Reset" / "Reset
      all to defaults" put the default into the draft (of all ESCs in the combined view); on the default it isn't
      shown. Bytes that mean the same (AM32 current limit 101 / 102) count as the default
- [x] Bluejay ≠ 0.21 / AM32 ≠ 2.21: error telling what to flash, "Version not supported", nothing to change
- [x] ESCs listed one by one are edited on their own card; one that differs in an editable setting is marked "differs"
      and "Use ESC 1's for all" levels them
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
  identical is the actual question. Hardware has to match too — the view has one header.
- The mock's default ESCs are a realistic quad (four Bluejay set up alike), used by the tests of the combined view.
  "Connect Mock FC" (demo mode) reads `demoMockEscs()` instead — one Bluejay and one AM32 ESC — so both editors can be
  seen (user request, 2026-09-25); the combined view is then only covered by the tests. `mixedMockEscs()` (three
  firmwares) keeps BLHeli_S covered.
- ESCs listed one by one are edited on their own cards (user request, 2026-09-25): a separate editor per firmware below
  the cards repeated every setting, far from the card that shows it. An edit there goes to that ESC only; the notice
  with "Use ESC 1's for all" keeps a way to level ESCs of one firmware.
- Only a few settings are changed; the others are hidden and only come up when they are off the firmware's default,
  with a reset (user request, 2026-09-25). The motor direction is ignored completely — not shown, not compared.
  Defaults are compared as shown, not as bytes: several bytes mean the same (AM32 current limit 101 from ESC
  Configurator and 102 from the AM32 configurator are both off; timing 2 is the old format of 15°).
- AM32 defaults: the firmware has none (a blank eeprom is only range-corrected), so the AM32 configurator's generic
  `DEFAULT/v4.bin` is used. It can serve a different file per ESC model, which isn't public — an ESC shipped with other
  defaults shows those settings as not on the default.
- Bluejay minimum startup power has no reset: it is changed here (the firmware's default is 1010, ESC Configurator's
  1025).

- Editing (SPEC §2, 2026-09): the draft is the raw settings block per ESC and saving is read-modify-write of that
  block, the way ESC Configurator and the AM32 configurator write settings (SiLabs: erase the page, write 0xFF bytes;
  AM32: one write of 0xB8 bytes, its bootloader erases). Bytes this app doesn't know go back untouched. Unlike the AM32
  configurator the read-back is compared for AM32 too.
- Before writing, the block is read again and must still be what the page shows — otherwise another tool changed the
  ESC in between and the bytes we'd write back would be stale.
- "Editable timings" = Bluejay motor (commutation) timing; "startup speeds (both types)" = minimum and maximum startup
  power. Ranges and steps as in ESC Configurator.
- AM32 3D mode is one switch for all ESCs (the AM32 configurator has it per ESC). The PWM frequency is a slider (user
  request); the other AM32 numbers stay number fields.
- Versions are matched exactly (Bluejay `0.21`, any patch level; AM32 `2.21`). AM32 2.21 raises `eeprom_version` to 4
  when it first starts, so only that layout is known.
- AM32 on 128 k flash (signature 0x2B06, CAN ESCs) is read but not written: newer bootloaders report their own flash
  map ("v3 devinfo" in the AM32 configurator), which this app doesn't read.
- Numbers are typed (number fields) instead of the configurators' sliders: 255 steps on a short slider can't be hit,
  and a motor KV is something you know.
- Save asks for confirmation although SPEC §5 doesn't: a failed write leaves an ESC on default settings, and the ESCs
  restart.
- The 48 kHz warning shows on "Connect Mock FC" on purpose (the mock Bluejay is the 48 kHz build), so the warning is exercised.

## Open questions

None.
