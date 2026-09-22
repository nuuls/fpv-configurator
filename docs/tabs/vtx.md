# Analog VTX

Status: ready
_Implemented; mock acceptance passes (`src/pages/Vtx.test.tsx`, `src/lib/vtx/*.test.ts`). Set to `built` once the hardware checks pass._
Route: `/vtx` · Sidebar: "Analog VTX" · Page: `src/pages/Vtx.tsx` · Logic: `src/lib/vtx/` (presets: `presets.ts`)

## Purpose

Give the FC the VTX table of the pilot's analog video transmitter — from a preset, editable by hand — and pick
band, channel and power (SPEC §2 "VTX").

## Layout

```
+----------------------------------+--------------------------------------+
| Channel and power                | VTX table preset                     |
| (VTX status line)                | Manufacturer [TBS            v]      |
| Band    [RACEBAND (R)     v]     | VTX          [Unify Pro32 HV v]      |
| Channel [R1 — 5658 MHz    v]     | [Load preset]  Loaded … made for     |
| Power   [25               v]     |                SmartAudio 2.1 …      |
| Low power disarm [Off     v]     |                                      |
+----------------------------------+--------------------------------------+
| VTX table                                                               |
| Band       Letter Factory CH1 … CH8                              [bin]  |
| [BOSCAM_A] [A]    [x]     [5865] … [5725]                        [bin]  |
| [+ Add band]                                                            |
| Power levels:  1 [25 ] [14]  [bin]   …   [+ Add power level]            |
+-------------------------------------------------------------------------+
```

## Controls

| Control                        | Type                            | Betaflight setting / MSP                                                                                   | Values · default                                         | Notes                                                                                                             |
| ------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| VTX status                     | readout                         | `MSP_VTX_CONFIG` (88): device type + ready                                                                 | SmartAudio / Tramp / MSP / RTC6705, or "No VTX detected" | Points to the Ports tab when nothing is detected                                                                  |
| Band                           | select                          | `vtx_band` · `MSP_VTX_CONFIG` / `MSP_SET_VTX_CONFIG` (89)                                                  | bands of the table · 4                                   | `vtx_band = 0` (fixed frequency) on the FC is listed as "Fixed frequency (… MHz)" and kept until a band is picked |
| Channel                        | select                          | `vtx_channel`                                                                                              | channels of the band, "R1 — 5658 MHz" · 1                | Channels with frequency 0 are disabled ("not available")                                                          |
| Power                          | select                          | `vtx_power`                                                                                                | labels of the power levels · 1                           |                                                                                                                   |
| Low power disarm               | select                          | `vtx_low_power_disarm` · same messages                                                                     | Off (0) / On (1) / On until first arm (2) · Off          | Lowest power level while disarmed, except after a failsafe. Works without a table                                 |
| Manufacturer                   | select                          | — (editing aid, not stored)                                                                                | manufacturers in `presets.ts`                            |                                                                                                                   |
| VTX                            | select                          | —                                                                                                          | models of that manufacturer, with protocol               |                                                                                                                   |
| Load preset                    | button                          | —                                                                                                          | —                                                        | Replaces the table in the draft; nothing is written until Save                                                    |
| Band name / letter / factory   | text · text · checkbox per band | `vtxtable band` · `MSP_VTXTABLE_BAND` (137) / `MSP_SET_VTXTABLE_BAND` (227)                                | 1–8 chars · 1 char · CUSTOM                              | Typed text is upper-cased like the firmware does                                                                  |
| Channel frequencies            | numbers per band                | same                                                                                                       | 0 or 5000–5999 MHz                                       | 0 = channel not available                                                                                         |
| Power value / label            | number · text per level         | `vtxtable powervalues/powerlabels` · `MSP_VTXTABLE_POWERLEVEL` (138) / `MSP_SET_VTXTABLE_POWERLEVEL` (228) | 0–65535 · 1–3 chars                                      | Value = level index (SmartAudio 2.0), dBm (SmartAudio 2.1) or mW (Tramp)                                          |
| Add / remove band, power level | buttons                         | `vtxtable bands` / `powerlevels`                                                                           | max 8 each                                               | New bands get the table's channel count (8 in an empty table)                                                     |

## Behaviour

- **Save**, no reboot: the firmware rebuilds its table right after `MSP_EEPROM_WRITE`.
- Write order: `MSP_SET_VTX_CONFIG` (selection + table size + "clear table"), every power level, every band,
  EEPROM. When only band/channel/power changed, the table is not cleared or rewritten.
- Loading a preset keeps the selected band by **letter** (R stays R even if it moves), else by position; if that
  channel doesn't exist in the new table the first available one is taken. A power index beyond the new table
  becomes level 1.
- Removing a band or power level keeps the selection on the same entry (indexes shift).
- Validation blocks Save: names/labels empty, too long or with spaces; duplicate band letters; frequencies outside
  5000–5999 (0 allowed); selected band/channel missing from a non-empty table; selected power level missing.
- Pit mode and `vtx_pit_mode_freq` are written back unchanged.
- Firmware built without `USE_VTX_TABLE`: a notice instead of the editor.
- Preset values are copied from Betaflight's official presets (`betaflight/firmware-presets`, `presets/4.3/vtx/`).
  Where those offer regional variants, the full table is the default entry and the restricted one is "(EU)".
  The card reminds the pilot to check what is legal locally.

## Hidden on purpose

- Pit mode, pit mode frequency, direct frequency entry (`vtx_freq`), the live "current VTX
  state" readout, number of channels per band (taken from the table), load/save table as file or clipboard.
- Digital VTXs (DJI, Walksnail, HDZero) have no presets here — this tab is for analog.

## Acceptance

Mock FC (fresh: F1, power 1, empty table, no VTX detected):

- [x] Empty table: band/channel/power and "Load preset" disabled, hint shown
- [x] Manufacturer → only that manufacturer's VTXs; "Load preset" fills bands and power levels, marks the tab unsaved
- [x] Preset + manual edits (frequency, removed power level) + selection → Save without reboot → shown again
- [x] A hand-built invalid table blocks Save with a message; Revert restores
- [x] Low power disarm offers Off / On / On until first arm; the choice is saved without a reboot and shown again
- [x] Channels a regional table leaves out are disabled; the selection moves to the first available one

On real hardware:

- [ ] After loading the matching preset and saving, `vtxtable` in the CLI equals the official preset
- [ ] Changing channel and power here changes the VTX (OSD / goggles) without a reboot
- [ ] Status line shows the right protocol and "connected" with a SmartAudio and a Tramp VTX

## Decisions

- Band / channel / power selects were added although SPEC §2 only lists presets and the table: they travel in
  the same message (`MSP_SET_VTX_CONFIG`) that sets the table size, and a table nobody can pick a channel from
  would send pilots back to Betaflight Configurator. Remove the card if that is not wanted.
- "Load preset" is a button rather than loading on select: it overwrites manual edits, so it should be deliberate.
  No confirm dialog — Revert undoes it.
- Presets carry a protocol (SmartAudio 2.0 / 2.1 / Tramp), inferred from the official preset's power values and
  shown after loading, because the same VTX table is wrong with the other protocol.
- T-Motor FT800 from the official presets is left out: its band B lists 5999 MHz for channel 5, an apparent typo.
- Mock FC starts like a fresh Betaflight FC (empty table) so the preset flow is what gets exercised.

## Open questions

None.
