# OSD

Status: ready
_Implemented; mock acceptance passes (`src/pages/Osd.test.tsx`, `src/lib/osd/model.test.ts`, `src/lib/osd/io.test.ts`). Set to `built` once the hardware checks pass._
Route: `/osd` · Page: `src/pages/Osd.tsx` · Logic: `src/lib/osd/` · Preview: `src/components/OsdPreview.tsx`

## Purpose

Choose which of a handful of elements show up in the goggles, and where.

## Layout

Betaflight's OSD tab without its right-hand column: element list on the left, screen preview next to it.

```
+------------------------------------+-----------------------------------------+
| Elements                  X    Y   | Preview          30 × 16 characters     |
| (o) Battery avg cell     [1] [14]  | +-------------------------------------+ |
| ( ) Current draw                   | | 2:100                       02:43   | |
| ( ) Used mAh                       | |                                     | |
| (o) Warnings            [9] [10]   | |          LOW BATTERY                | |
| ...                                | | 3.98V                               | |
+------------------------------------+ +-------------------------------------+ |
                                     +-----------------------------------------+
```

## Controls

| Control             | Type                                         | Betaflight setting / MSP                                                              | Values · default                                                                                                                       | Notes                                                           |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Element on/off      | toggle × 13 (× 21 with a GPS)                | profile bits 11–13 of `osd_*_pos` · `MSP_OSD_CONFIG` (84) / `MSP_SET_OSD_CONFIG` (85) | firmware: only Warnings on                                                                                                             | see element table                                               |
| X / Y               | 2 numbers per shown element                  | bits 0–4 + 10 (x), 5–9 (y) of the same value                                          | 0 … columns−1 / rows−1                                                                                                                 | same value the preview edits                                    |
| Preview             | drag & drop, arrow keys on a focused element | —                                                                                     | canvas: the display's size from `MSP_OSD_CANVAS` (189); if that is unset or can't be right: 30×16 (PAL/auto), 30×13 (NTSC), 53×20 (HD) | sample text per element, one character per cell                 |
| Units               | select                                       | `osd_units` · read: `MSP_OSD_CONFIG` byte 2 · write: `MSP2_CLI_SETTING`               | Metric, Imperial, British · Metric                                                                                                     | sample texts of altitude, distances, speed follow the choice    |
| Hide other elements | button                                       | clears the profile bits of every other element                                        | —                                                                                                                                      | only offered when the FC shows elements this app doesn't manage |

Elements (firmware index → `osd_item_e`):

| Element                      | Index                         | CLI                                    | Sample          |
| ---------------------------- | ----------------------------- | -------------------------------------- | --------------- |
| Battery average cell voltage | 22                            | `osd_avg_cell_voltage_pos`             | `3.98V`         |
| Current draw                 | 11                            | `osd_current_pos`                      | `42.0A`         |
| Used mAh                     | 12                            | `osd_mah_drawn_pos`                    | `690mAh`        |
| Link quality                 | 46                            | `osd_link_quality_pos`                 | `2:100`         |
| Warnings                     | 21                            | `osd_warnings_pos`                     | `LOW BATTERY`   |
| Disarmed                     | 29                            | `osd_disarmed_pos`                     | `DISARMED`      |
| Timer 2 (armed time)         | 6                             | `osd_tim_2_pos`, `osd_tim2`            | `02:43`         |
| Custom message 1–4           | 81–84 (`OSD_CUSTOM_MSG0`…`3`) | — (no CLI setting in 2026.6, MSP only) | `CUSTOM_MSG1` … |
| VTX channel                  | 10                            | `osd_vtx_channel_pos`                  | `R:1:25`        |
| Altitude                     | 15                            | `osd_altitude_pos`                     | `12.3m`         |

GPS elements — only listed while a GPS is set up in the Ports tab (a UART with the `GPS` function **and** feature
`GPS`; read with `MSP2_COMMON_SERIAL_CONFIG` + `MSP_FEATURE_CONFIG`, same check as Ports → "GPS: Connected"):

| Element         | Index | CLI                   | Sample        |
| --------------- | ----- | --------------------- | ------------- |
| GPS satellites  | 14    | `osd_gps_sats_pos`    | `SAT14`       |
| GPS speed       | 13    | `osd_gps_speed_pos`   | `67KPH`       |
| GPS latitude    | 24    | `osd_gps_lat_pos`     | `N48.2081743` |
| GPS longitude   | 23    | `osd_gps_lon_pos`     | `E16.3738189` |
| Home direction  | 30    | `osd_home_dir_pos`    | `H^`          |
| Home distance   | 31    | `osd_home_dist_pos`   | `H120m`       |
| Flight distance | 47    | `osd_flight_dist_pos` | `1.24km`      |
| Efficiency      | 58    | `osd_efficiency_pos`  | `42mAh/km`    |

## Behaviour

- **Save** (no reboot): one `MSP_SET_OSD_CONFIG` per element whose value changed, `set osd_units = …`
  (`MSP2_CLI_SETTING`) if the units changed, then `MSP_EEPROM_WRITE`. The general settings message (`addr = -1`:
  video system, units, alarms, warnings) is never sent — it would overwrite all of them at once.
- **Units** (`osd_unit_e`: 0 Imperial, 1 Metric, 2 British = metric with speeds in mph): the preview's altitude,
  GPS speed, home / flight distance and efficiency samples switch between `12.3m` / `40.4ft`, `67KPH` / `42MPH`,
  `H120m` / `H394ft`, `1.24km` / `0.77mi`, `42mAh/km` / `68mAh/mi`.
- **One profile:** "on" = visible in the FC's selected OSD profile. Writing an element sets it on (or off) in
  _all_ profiles, so switching profiles elsewhere changes nothing for these elements.
- **VTX channel** is always written as variant 0 (`band:channel:power`, "combined"); other elements keep their variant bits.
- **Timer 2:** if it is on and `osd_tim2` doesn't count armed time (source "on" / "on or armed" / "launch"),
  Save sets its source to total armed time (Betaflight's default), keeping precision and alarm.
- Switching on an element that still sits on the firmware's default pile (all elements start on one spot near
  the centre) moves it to a suggested free spot for the canvas; an element that was placed before keeps its place.
- **Canvas:** at boot the firmware sets `osd_canvas_width/height` to the display it found and moves every element
  outside of it onto the last row / column, where they pile up. So the reported canvas counts for SD too: video
  system "auto" is 13 rows on an MSP displayport or with an NTSC camera, not 16. Only an SD video system with a
  reported canvas wider than 30 columns (HD build without a display) falls back to the video system's size.
- Dragging keeps the whole sample text on screen; the number fields allow every cell. Out-of-range numbers block Save.
- **GPS elements** are listed only while a GPS is set up in the Ports tab; without one a short note below the list
  says so. A GPS element that is switched on while no GPS is set up counts as an "other" element: it shows up in
  that notice and is only changed by "Hide other elements". They keep their variant bits (coordinate format, …).
- Elements the firmware doesn't know (shorter `MSP_OSD_CONFIG`, e.g. no custom messages) aren't listed.
- No OSD in the firmware build → notice instead of the editor. No OSD device detected → warning, still editable.

## Hidden on purpose

- Everything in Betaflight's right-hand column: OSD profile selection and preview profile, video format,
  timers, alarms, warning selection, post-flight statistics, font manager, logo upload.
- All other elements (~75). They are left untouched unless the user presses "Hide other elements".
- Element variants, position presets, the text of the custom messages (it can't be read back over MSP; it is sent
  by whatever device uses it, e.g. a Lua script — until then the OSD shows `CUSTOM_MSG1`).

## Acceptance

Mock FC (auto video system → 30 × 16; Warnings and average cell voltage on, plus Crosshairs which isn't managed):

- [x] 13 elements listed; Warnings and cell voltage on with X/Y fields, the rest off; preview shows both samples
- [x] Switching on Timer 2 places it top right (not on the pile); Save without reboot; it is still on after a reload
- [x] MSP displayport with auto video system → 30 × 13; elements switched on there keep their rows over a reboot
- [x] Arrow keys move the focused preview element, the X/Y fields follow; Revert puts it back
- [x] X beyond the last column blocks saving with a message
- [x] "1 other element (Crosshairs)" notice; Hide + Save clears it on the FC and the notice disappears
- [x] A digital VTX (Ports tab → HD) gives a 53 × 20 preview
- [x] Units shows Metric; Altitude on → `12.3m`; Imperial → `40.4ft`; Save without reboot keeps Imperial
- [x] A changed `osd_units` isn't listed under Setup → "Changed outside this app" (unit test)
- [x] No GPS → 13 elements and the note; GPS on UART4 in the Ports tab → 21 elements, GPS satellites switches on
      at 1, 2 and is saved

On real hardware:

- [ ] Positions match what the goggles show, SD and HD (x ≥ 32 on HD uses the extra bit)
- [ ] Elements enabled here appear without a reboot
- [ ] An OSD set up in Betaflight Configurator reads back with the same positions
- [ ] GPS elements show up in the goggles once the GPS is connected and set up
- [ ] Units: the selector shows what Betaflight Configurator shows, and a change here shows up in the goggles

## Decisions

- X/Y number fields and arrow keys in addition to Betaflight's drag & drop: precise, accessible, testable.
- Sample texts are plain characters instead of the OSD font's symbols — no font upload or rendering needed.
- Other elements aren't hidden silently: a quad set up elsewhere would lose its OSD on the first save.
- Units are the one general setting offered (asked for by the user), set through `osd_units` so video system,
  alarms and warnings stay untouched. Being managed here, `osd_units` isn't listed as "changed outside this app".
- Timer 2 source is fixed on save rather than exposed: the timers live in the removed right-hand column, and the
  element is specified as "armed time".
- "The GPS elements" = exactly the eight that the firmware only draws with a GPS sensor (`osdAddActiveElements`:
  `if (sensors(SENSOR_GPS))`). Not included: the GPS lap timer elements (separate build option and feature),
  compass bar / heading (work without a GPS) and Altitude, which was already listed (baro or GPS).
- GPS elements are hidden rather than greyed out without a GPS: the firmware wouldn't draw them anyway, and the list
  stays short for the many quads without one. Suggested spots: satellites/speed below link quality, home and flight
  distance below altitude, coordinates bottom centre, efficiency above current draw.
- Suggested spots: voltage/current bottom left, mAh/VTX bottom right, link quality top left, timer/altitude top
  right, custom messages top centre, Disarmed below centre. Will move to the drone-type defaults once those exist.

## Open questions

None.
