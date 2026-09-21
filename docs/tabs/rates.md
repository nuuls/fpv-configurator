# Rates

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/rates/model.test.ts`). Set to `built` once the hardware checks pass._
Route: `/rates` · Page: `src/pages/Rates.tsx` · Logic: `src/lib/rates/` · Chart: `src/components/RateCurveChart.tsx`

## Purpose

Set how fast the quad rotates for a given stick movement — one profile, one rate type, nine numbers at most.

## Layout

```
+-------------------------------------------+-----------------------------+
| Rate type [Actual v]   Axes [Sync all v]  |  — Roll · Pitch · Yaw  max… |
|         Center (°/s)  Max (°/s)  Expo     |  °/s |              _/      |
| Roll    [ 70 ]        [ 670 ]    [ 0 ]    |      |          __/         |
| Pitch   [ 70 ]        [ 670 ]    [ 0 ]    |      |  ____---             |
| Yaw     [ 70 ]        [ 670 ]    [ 0 ]    |      +------------------ %  |
+-------------------------------------------+-----------------------------+
```

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Rate type | select | `rates_type` · `MSP_RC_TUNING` (111/204) byte 22 | Actual | A different type on the FC is listed as "(not supported yet)" |
| Axes | select | — (editing aid, not stored) | Sync all · Sync pitch and roll · Sync disabled | Starts at the most linked mode the FC's values allow — "Sync all" for stock values |
| Center sensitivity | 3 numbers | `roll/pitch/yaw_rc_rate` | 10–2000 °/s, step 10 · 70 | Firmware stores value / 10 |
| Max rate | 3 numbers | `roll/pitch/yaw_srate` | 10–2000 °/s, step 10 · 670 | Firmware stores value / 10 |
| Expo | 3 numbers | `roll/pitch/yaw_expo` | 0.00–1.00, step 0.01 · 0 | Firmware stores × 100 |
| Rate curve | line chart | computed (`applyActualRates` in `fc/rc.c`), capped at `rate_limit` | °/s over 0–100 % stick | One line per *distinct* axis setting, legend with max rate, hover for exact values |

## Behaviour

- **Save** (no reboot). Applies to the FC's current rate profile; profiles are not shown.
- Sync: axes that follow roll are disabled and mirror it. Turning a sync mode on copies roll onto the followers
  (visible immediately, nothing is written until Save).
- Switching a non-Actual quad to Actual starts from Betaflight's defaults (70 / 670 / 0): numbers of different
  rate types aren't comparable. Until then the matrix is replaced by an explanation.
- Throttle mid/expo/limit and rate limits in the same message are written back unchanged.

## Hidden on purpose

- Rate profiles, other rate types (for now), throttle curve and limit, rate limits, the 3D rate preview,
  per-axis "deg/s at full stick" readouts beyond the legend.

## Acceptance

Mock FC (stock Actual rates):

- [x] Actual + "Sync all"; pitch and yaw inputs disabled; one curve labelled "Roll · Pitch · Yaw", max 670°/s
- [x] Editing roll changes all three; with "Sync pitch and roll" yaw is independent and gets its own curve
- [x] Save without reboot; values and the detected sync mode persist
- [x] Out-of-range values block saving with a message

On real hardware:

- [ ] Values and the curve's max rate match Betaflight Configurator's Rates tab
- [ ] The quad's feel changes right after Save, without a reboot

## Decisions

- Initial sync mode is detected from the values instead of always "Sync all": forcing "all" on a quad with
  different yaw rates would overwrite them on the first edit.
- Identical axes share one curve and one legend entry — three lines on top of each other would hide two.
- Chart colours: blue / orange / green per axis (not per line), checked for colour-blind separation on both
  themes (`--series-1..3` in `src/index.css`).

## Open questions

None.
