# Filters

Status: ready
_Implemented; mock acceptance passes (`src/pages/Filters.test.tsx`, `src/lib/filters/model.test.ts`). Set to `built` once the hardware checks pass._
Route: `/filters` · Page: `src/pages/Filters.tsx` · Logic: `src/lib/filters/`

## Purpose

The minimal filter stack for a quad with working RPM filtering: five sliders and a notch count, everything else off.

## Layout

```
+---------------------------------+---------------------------------+
| Gyro lowpass 2                  | RPM filter · min frequency      |
|                                 |                                 |
| 500 Hz                          | 100 Hz                          |
|                                 |                                 |
| [----------o----------]         | [--------o------------]         |
| Off                 2.0         | 30 Hz            200 Hz         |
+---------------------------------+---------------------------------+
| Dynamic notch · min   [Off|1|2] | D-term filtering                |
|                                 |                                 |
| 100 Hz                          | 1.00        75–150 / 150 Hz     |
|                                 |                                 |
| [-------o-------------]         | [----------o----------]         |
| 20 Hz            250 Hz         | 0.5                 1.5         |
+---------------------------------+---------------------------------+
| Yaw lowpass                     |
|                                 |
| 100 Hz                          |
|                                 |
| [----o----------------]         |
| Off              500 Hz         |
+---------------------------------+
```

Only sliders and button groups — no number inputs or dropdowns, and no explanatory text. Every filter is one card,
in the order above: its name, the resulting cutoff in large monospace type (the one thing to look at), then its
slider with the meaning of the track ends underneath. Gyro lowpass 2 shows only the cutoff, not the slider position;
D-term filtering shows the slider position on the left and its cutoffs on the right. The dynamic notch card also
holds the count.

## Controls

| Control                     | Type         | Betaflight setting / MSP                                                                                                                        | Values · default                                 | Notes                                                                                                                |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Gyro lowpass 2              | slider       | `simplified_gyro_filter_multiplier` → `gyro_lpf2_static_hz` = 500 Hz × slider · `MSP_SIMPLIFIED_TUNING` (140/141) + `MSP_FILTER_CONFIG` (92/93) | 0–2.0, step 0.1 · 1.0                            | 0 = filter off (`gyro_lpf2_static_hz = 0`). Only the resulting cutoff is shown                                       |
| RPM filter min frequency    | slider       | `rpm_filter_min_hz` · `MSP_FILTER_CONFIG` byte 44                                                                                               | 30–200 Hz, step 5 · 100                          |                                                                                                                      |
| Dynamic notch count         | button group | `dyn_notch_count` · byte 48                                                                                                                     | Off, 1–2 · app recommends 1 (firmware default 3) | The firmware takes up to 7; a higher count on the FC shows as 2 and the pinned-filters warning says saving lowers it |
| Dynamic notch min frequency | slider       | `dyn_notch_min_hz` · bytes 41–42                                                                                                                | 20–250 Hz, step 5 · 100                          | Dimmed and disabled while the count is Off                                                                           |
| D-term filtering            | slider       | `simplified_dterm_filter_multiplier` → `dterm_lpf1_dyn_min/max_hz`, `dterm_lpf1_static_hz`, `dterm_lpf2_static_hz`                              | 0.50–1.50, step 0.05 · 1.0                       | Range widens if the FC's value is outside. Cutoffs (lowpass 1 min–max / lowpass 2) shown on the right                |
| Yaw lowpass                 | slider       | `yaw_lowpass_hz` · bytes 3–4 (PID profile)                                                                                                      | 0–500 Hz, step 5 · 100                           | 0 = filter off. PT1 on the yaw P term                                                                                |

Pinned on every save ("No other filters"): gyro lowpass 1 off (`gyro_lpf1_static_hz`, `gyro_lpf1_dyn_min/max_hz` = 0),
`gyro_lpf2_type = PT1`, static gyro notches 1 + 2 and the D-term notch off, both filter sliders on
(`simplified_gyro_filter`, `simplified_dterm_filter`) so the cutoffs are the firmware defaults × slider, and
`rpm_filter_harmonics = 3` if it was 0 (RPM filter off). PID slider bytes in `MSP_SIMPLIFIED_TUNING` are passed
through untouched; so are D-term lowpass types/expo, dynamic notch Q/max and RPM filter Q/weights/fade.

## Behaviour

- **Save**, no reboot: `MSP_SET_SIMPLIFIED_TUNING`, then `MSP_SET_FILTER_CONFIG` (re-initialises gyro, dynamic
  notch, RPM and D-term filters in the running firmware), then `MSP_EEPROM_WRITE`.
- If the FC has filter settings this app pins (true for stock Betaflight: gyro lowpass 1 is on), a warning
  lists what saving will change.
- Warning when bidirectional DShot is off (`MSP_MOTOR_CONFIG`): the RPM filter isn't running, and this stack
  relies on it. Points to the Motors tab.
- Applies to the FC's current PID profile (D-term filters are per profile); profiles are not shown.

## Hidden on purpose

- Gyro lowpass 1, static notch filters, filter types, dynamic lowpass expo, dynamic notch Q and max frequency,
  RPM filter harmonics / Q / weights / fade range, PID profiles.
- Any explanation of what the filters do: the tab is numbers and sliders only.

## Acceptance

Mock FC (stock Betaflight filters, bidirectional DShot off):

- [x] Filter sliders at 1.0, RPM min 100 Hz, notch count 2 (the FC's 3 is more than the app offers), notch min
      100 Hz, yaw lowpass 100 Hz; pinned-filters (gyro lowpass 1, notch count 3 → 2) and bidirectional-DShot
      warnings shown
- [x] Change sliders + notch count → Save (no reboot) → values persist, pinned-filters warning gone
- [x] Gyro slider at 0 shows "Off" and saves `gyro_lpf2_static_hz = 0`; yaw lowpass at 0 shows "Off" and saves
      `yaw_lowpass_hz = 0`
- [x] Frequency sliders stop at the firmware range; the notch frequency is disabled while the count is Off
- [x] PID Tuning sliders are unchanged by a Filters save, and the other way round

On real hardware:

- [ ] After saving, Betaflight Configurator shows gyro lowpass 1 off, lowpass 2 PT1 at 500 Hz × slider, the
      D-term slider position and the yaw lowpass
- [ ] `diff all` shows only the settings listed above

## Decisions

- **"No other filters" = the others are turned off**, not just hidden — the RPM-filter-era minimal stack
  (gyro lowpass 2 only, one dynamic notch, D-term lowpasses). Saving on a stock quad therefore disables gyro
  lowpass 1; the page says so before the first save.
- **Yaw lowpass is a slider** (user request, 2026-09-22; it was left alone before): 0–500 Hz like the CLI, 0 = off.
  It is written with `MSP_SET_FILTER_CONFIG` like the rest and needs no pinning.
- **Numbers first, no prose** (user request, 2026-09-22): the resulting Hz (and for D-term the slider position) are
  the large monospace text of each card, the cards sit in the order of SPEC §2 (gyro lowpass 2, RPM filter, dynamic
  notch, D-term, yaw lowpass), and the descriptions of what each filter does were dropped along with the card
  groupings. The gyro slider's position is not shown at all — the cutoff says it.
- **Slider 0–2**: Betaflight's multiplier range is 0.1–2.0 (CLI rejects < 10), so the step is 0.1 and 0 means "off".
- **"Notch count (1 default)"**: the tab shows what the FC has and recommends 1; actually applying 1 is left to
  the drone-type "Apply defaults" step (SPEC §2), which doesn't exist yet.
- **Sliders and button groups only** (user request, 2026-09-21): the frequencies are sliders in 5 Hz steps, the notch
  count a button group. A frequency the FC holds outside the firmware range is shown as it is with the thumb at the
  end of the track, and blocks saving with a message until the slider is moved.
- **At most 2 dynamic notches** (user request, 2026-09-21): next to a working RPM filter more only adds delay. A
  count above 2 on the FC (stock: 3) is treated like the other settings the app doesn't offer — shown as 2, listed
  in the warning, written on the next save — instead of blocking the save.
- RPM filter can't be turned off here ("only min frequency"); harmonics 0 is reset to the firmware default 3.

## Open questions

_None._
