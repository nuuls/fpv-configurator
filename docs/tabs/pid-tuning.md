# PID Tuning

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/pages/PidTuning.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/pid-tuning` · Page: `src/pages/PidTuning.tsx` · Logic: `src/lib/tuning/`

## Purpose

Three sliders, one stick-feel choice and TPA. The firmware's own slider math ("simplified tuning") computes the PIDs.

## Controls

| Control           | Type            | Betaflight setting / MSP                                                                  | Values · default                          | Notes                                              |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| Damping           | slider          | `simplified_d_gain` · `MSP_SIMPLIFIED_TUNING` (140/141)                                   | 0.50–1.50, step 0.05 · 1.0                | Range widens if the FC's value is outside          |
| Pitch gains       | slider          | `simplified_pitch_pi_gain` + `simplified_roll_pitch_ratio`, both set to the slider value  | same                                      | A master multiplier for pitch only, see Decisions  |
| Master multiplier | slider          | `simplified_master_multiplier`                                                            | same                                      |                                                    |
| Resulting PIDs    | view-only table | `MSP_CALCULATE_SIMPLIFIED_PID` (142)                                                      | P, I, D, FF per axis                      | Recalculated by the FC as the sliders move         |
| Stick feel        | 3 preset cards  | see below                                                                                 | Direct, Light smoothing, Strong smoothing | "Custom" note when the FC matches none             |
| TPA mode          | button group    | `tpa_mode` · read `MSP_PID_ADVANCED` (94) byte 57, written by name via `MSP2_CLI_SETTING` | D only (`D`), P and D (`PD`) · D          | Neither pressed for `PDS` (wing builds)            |
| TPA rate          | slider          | `tpa_rate` · byte 58, written by name                                                     | 0–100 %, step 5 · 65                      | 0 = off. Range widens if the FC's value is outside |
| TPA breakpoint    | slider          | `tpa_breakpoint` (u16) · bytes 59–60, written by name                                     | 1000–2000 µs, step 10 · 1350              | Same; a sentence below says what TPA now does      |

Pinned on every save: `simplified_pids_mode = RPY`, I / PI sliders = 1.0,
Dynamic D (`simplified_d_max_gain`) = 0. Filter sliders in the same message are passed through untouched.

| Preset           | `rc_smoothing` | `rc_smoothing_auto_factor` (+`_throttle`) | FF slider | `feedforward_smooth_factor`         |
| ---------------- | -------------- | ----------------------------------------- | --------- | ----------------------------------- |
| Direct           | OFF            | —                                         | 1.0       | 65 (default)                        |
| Light smoothing  | ON             | 25                                        | 1.0       | 65 (default)                        |
| Strong smoothing | ON             | 30                                        | 0.5       | **80 — placeholder, SPEC says TBD** |

## Behaviour

- Sliders and TPA: **Save**. Preset change: **Save & Reboot** (RC smoothing is initialised at boot). TPA takes
  effect with the EEPROM write (`activateConfig` → `pidInit`); only changed TPA settings are written.
- If the FC has values this app pins (true for stock Betaflight: Dynamic D is on), a warning says saving will
  reset them.
- Pitch gains shows the FC's `simplified_pitch_pi_gain`. If `simplified_roll_pitch_ratio` differs from it (set
  separately in Betaflight Configurator), the hidden-tuning warning is shown and saving makes them equal.
- Preset detection reads `rc_smoothing` + auto factor (`MSP_RX_CONFIG` bytes 31/30) and the FF slider.

## Hidden on purpose

- All other sliders, raw PID editing, PID profiles, anti-gravity, I-term relax, and every filter.
- TPA low (`tpa_low_rate`, `tpa_low_breakpoint`, `tpa_low_always`) and the wing TPA settings (`tpa_curve_*`,
  `tpa_speed_*`) — they stay as they are.

## Acceptance

Mock FC (stock defaults):

- [x] Three sliders; PID table follows them; hidden-tuning warning shown
- [x] Slider change → Save (no reboot) → persists, warning gone
- [x] Preset → Save & Reboot → preset shown as selected afterwards
- [x] Pitch gains 1.2 → only the Pitch row changes (all four columns × 1.2) → Save (no reboot) → persists
- [x] TPA shows D only / 65 % / 1350 µs → P and D, 55 %, 1400 µs → Save (no reboot) → persists

On real hardware:

- [ ] PID numbers equal Betaflight Configurator's for the same slider positions
- [ ] TPA mode, rate and breakpoint match Betaflight Configurator after saving
- [ ] After saving, Configurator shows Dynamic D slider at 0 and the others at 1.0 (Pitch Damping and Pitch
      Tracking both at the Pitch gains value)

## Decisions

- **No RC-link Hz selector.** SPEC asked for one, but Betaflight 2026.6 detects the packet rate and adapts
  feedforward and smoothing by itself; its official RC-link presets no longer set per-rate values either.
- "Race feed forward" = firmware defaults (that is what the official 2026.6 race preset uses).
- **Pitch gains = Betaflight's two pitch sliders moved together.** `simplified_tuning.c` multiplies pitch P, I
  and FF by `simplified_pitch_pi_gain` ("Pitch Tracking") and pitch D / D max by `simplified_roll_pitch_ratio`
  ("Pitch Damping"), next to the master multiplier. Writing the same value to both scales every pitch gain and
  nothing on roll or yaw.

- **TPA = the three settings Betaflight Configurator shows** (mode, rate, breakpoint), per PID profile like the
  rest of this tab. Rate step 5 and breakpoint 1000–2000 µs keep the sliders short; the firmware accepts 0–100
  and 750–2250 µs.

## Open questions

- [ ] Value for Strong smoothing's "higher feed forward smoothing" — 80 used meanwhile
      (`STRONG_FF_SMOOTH_FACTOR` in `src/lib/tuning/model.ts`).
