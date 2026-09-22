# Rates

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/pages/Rates.test.tsx`, `src/lib/rates/model.test.ts`). Set to `built` once the hardware checks pass._
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

| Control       | Type       | Betaflight setting / MSP                                                                   | Values · default                                                 | Notes                                                                                                                                   |
| ------------- | ---------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Rate type     | select     | `rates_type` · `MSP_RC_TUNING` (111/204) byte 22                                           | Betaflight · Raceflight · KISS · Actual · Quick · default Actual | Picking a type resets the matrix to that type's defaults, see _Rate types_. A type this app doesn't know is listed as "(not supported)" |
| Axes          | select     | — (editing aid, not stored)                                                                | Sync all · Sync pitch and roll · Sync disabled                   | Starts at the most linked mode the FC's values allow — "Sync all" for stock values                                                      |
| First column  | 3 numbers  | `roll/pitch/yaw_rc_rate`                                                                   | per rate type, see _Rate types_                                  | Label, unit and range follow the rate type                                                                                              |
| Second column | 3 numbers  | `roll/pitch/yaw_srate`                                                                     | per rate type                                                    | ″                                                                                                                                       |
| Third column  | 3 numbers  | `roll/pitch/yaw_expo`                                                                      | per rate type                                                    | ″                                                                                                                                       |
| Rate curve    | line chart | computed (`applyBetaflightRates` … `applyQuickRates` in `fc/rc.c`), capped at `rate_limit` | °/s over 0–100 % stick                                           | One line per _distinct_ axis setting, legend with max rate, hover for exact values                                                      |

### Rate types

The three numbers per axis are the same three firmware bytes for every type; label, unit, range
(`ratesSettingLimits` in `fc/controlrate_profile.c`) and meaning differ. Defaults are Betaflight Configurator's.
°/s columns are stored / 10 (step 10), two-decimal columns × 100 (step 0.01), Acro+ and Raceflight's expo as they are.

| Rate type  | `rc_rate` column · default            | `srate` column · default     | `expo` column · default   |
| ---------- | ------------------------------------- | ---------------------------- | ------------------------- |
| Betaflight | RC rate 0.01–2.55 · 1.00              | Super rate 0.00–1.00 · 0.70  | RC expo 0.00–1.00 · 0.00  |
| Raceflight | Rate (°/s) 10–2000 · 370              | Acro+ 0–255 · 80             | Expo 0–100 · 50           |
| KISS       | RC rate 0.01–2.55 · 1.00              | Rate 0.00–0.99 · 0.70        | RC curve 0.00–1.00 · 0.00 |
| Actual     | Center sensitivity (°/s) 10–2000 · 70 | Max rate (°/s) 10–2000 · 670 | Expo 0.00–1.00 · 0.00     |
| Quick      | RC rate 0.01–2.55 · 1.00              | Max rate (°/s) 10–2000 · 670 | Expo 0.00–1.00 · 0.00     |

## Behaviour

- **Save** (no reboot). Applies to the FC's current rate profile; profiles are not shown.
- Sync: axes that follow roll are disabled and mirror it. Turning a sync mode on copies roll onto the followers
  (visible immediately, nothing is written until Save).
- Picking a rate type **always** resets all three axes to that type's defaults and the sync mode to "Sync all" —
  also when switching back to the type the FC has: numbers of different rate types aren't comparable. Revert
  brings the FC's type and values back. The column labels, ranges and the explanation above the matrix follow the type.
- A rate type this app doesn't know (newer firmware) replaces the matrix by an explanation; its bytes are written
  back unchanged unless another type is picked.
- Throttle mid/expo/limit and rate limits in the same message are written back unchanged.

## Hidden on purpose

- Rate profiles, `quick_rates_rc_expo`, throttle curve and limit, rate limits, the 3D rate preview,
  per-axis "deg/s at full stick" readouts beyond the legend.

## Acceptance

Mock FC (stock Actual rates):

- [x] Actual + "Sync all"; pitch and yaw inputs disabled; one curve labelled "Roll · Pitch · Yaw", max 670°/s
- [x] Editing roll changes all three; with "Sync pitch and roll" yaw is independent and gets its own curve
- [x] Save without reboot; values and the detected sync mode persist
- [x] Out-of-range values block saving with a message
- [x] All five rate types are offered; picking one relabels the columns and shows its defaults, synced on all axes
- [x] Switching away and back to Actual gives the defaults again, not the edited values
- [x] A Betaflight-type edit saves without reboot and comes back with the right type, values and curve
- [x] Limits follow the type (KISS rate 1.00 is refused)

On real hardware:

- [ ] Values and the curve's max rate match Betaflight Configurator's Rates tab
- [ ] The quad's feel changes right after Save, without a reboot
- [ ] For each rate type: defaults, labels and the curve's max rate match Betaflight Configurator after a switch

## Decisions

- Initial sync mode is detected from the values instead of always "Sync all": forcing "all" on a quad with
  different yaw rates would overwrite them on the first edit.
- Column labels follow Betaflight Configurator, except Betaflight's second column: "Super rate" (what everyone
  calls it, and the Configurator's own help text) instead of a second bare "Rate".
- `quick_rates_rc_expo` isn't in any MSP message and can't be read (CLAUDE.md: `MSP2_CLI_SETTING` reads fail), so
  the Quick curve is drawn for its default, OFF. With it ON the curve's ends are the same, only the bend differs.
- Identical axes share one curve and one legend entry — three lines on top of each other would hide two.
- Chart colours: blue / orange / green per axis (not per line), checked for colour-blind separation on both
  themes (`--series-1..3` in `src/index.css`).

## Open questions

None.
