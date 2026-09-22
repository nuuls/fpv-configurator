# PID Tuning

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/pid-tuning` · Page: `src/pages/PidTuning.tsx` · Logic: `src/lib/tuning/`

## Purpose

Three sliders and one stick-feel choice. The firmware's own slider math ("simplified tuning") computes the PIDs.

## Controls

| Control           | Type            | Betaflight setting / MSP                                                                 | Values · default                          | Notes                                             |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Damping           | slider          | `simplified_d_gain` · `MSP_SIMPLIFIED_TUNING` (140/141)                                  | 0.50–1.50, step 0.05 · 1.0                | Range widens if the FC's value is outside         |
| Pitch gains       | slider          | `simplified_pitch_pi_gain` + `simplified_roll_pitch_ratio`, both set to the slider value | same                                      | A master multiplier for pitch only, see Decisions |
| Master multiplier | slider          | `simplified_master_multiplier`                                                           | same                                      |                                                   |
| Resulting PIDs    | view-only table | `MSP_CALCULATE_SIMPLIFIED_PID` (142)                                                     | P, I, D, FF per axis                      | Recalculated by the FC as the sliders move        |
| Stick feel        | 3 preset cards  | see below                                                                                | Direct, Light smoothing, Strong smoothing | "Custom" note when the FC matches none            |

Pinned on every save: `simplified_pids_mode = RPY`, I / PI sliders = 1.0,
Dynamic D (`simplified_d_max_gain`) = 0. Filter sliders in the same message are passed through untouched.

| Preset           | `rc_smoothing` | `rc_smoothing_auto_factor` (+`_throttle`) | FF slider | `feedforward_smooth_factor`         |
| ---------------- | -------------- | ----------------------------------------- | --------- | ----------------------------------- |
| Direct           | OFF            | —                                         | 1.0       | 65 (default)                        |
| Light smoothing  | ON             | 25                                        | 1.0       | 65 (default)                        |
| Strong smoothing | ON             | 30                                        | 0.5       | **80 — placeholder, SPEC says TBD** |

## Behaviour

- Sliders only: **Save**. Preset change: **Save & Reboot** (RC smoothing is initialised at boot).
- If the FC has values this app pins (true for stock Betaflight: Dynamic D is on), a warning says saving will
  reset them.
- Pitch gains shows the FC's `simplified_pitch_pi_gain`. If `simplified_roll_pitch_ratio` differs from it (set
  separately in Betaflight Configurator), the hidden-tuning warning is shown and saving makes them equal.
- Preset detection reads `rc_smoothing` + auto factor (`MSP_RX_CONFIG` bytes 31/30) and the FF slider.

## Hidden on purpose

- All other sliders, raw PID editing, PID profiles, TPA, anti-gravity, I-term relax, and every filter.

## Acceptance

Mock FC (stock defaults):

- [x] Three sliders; PID table follows them; hidden-tuning warning shown
- [x] Slider change → Save (no reboot) → persists, warning gone
- [x] Preset → Save & Reboot → preset shown as selected afterwards
- [x] Pitch gains 1.2 → only the Pitch row changes (all four columns × 1.2) → Save (no reboot) → persists

On real hardware:

- [ ] PID numbers equal Betaflight Configurator's for the same slider positions
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

## Open questions

- [ ] Value for Strong smoothing's "higher feed forward smoothing" — 80 used meanwhile
      (`STRONG_FF_SMOOTH_FACTOR` in `src/lib/tuning/model.ts`).
