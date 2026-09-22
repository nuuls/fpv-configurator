# Modes

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/modes` · Page: `src/pages/Modes.tsx` · Logic: `src/lib/modes/`

## Purpose

Assign radio switches to the four modes a normal pilot needs. Betaflight's layout, minus everything else.

## Controls

One card per mode: **Arm** (box 0), **Angle** (1), **Turtle mode** (35, "FLIP OVER AFTER CRASH"), **Beeper** (13).
A mode the firmware build doesn't offer (`MSP_BOXIDS`, 119) is not shown.

| Control            | Type                   | Betaflight setting / MSP                           | Values · default                           | Notes                                                  |
| ------------------ | ---------------------- | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Channel            | select per range       | `MSP_MODE_RANGES` (34) / `MSP_SET_MODE_RANGE` (35) | AUX 1..n                                   | n from the live channel count                          |
| Range              | two-thumb slider       | same                                               | 900–2100 µs, step 25 · new range 1700–2100 | Marker shows the live channel value (`MSP_RC` @ 10 Hz) |
| Add range / remove | buttons                | same                                               | —                                          |                                                        |
| Active             | badge + card highlight | derived from `MSP_RC`                              | —                                          |                                                        |

## Behaviour

- **Save** (no reboot).
- The FC has 20 range slots. Ranges of modes this app doesn't show stay in their slots untouched and are
  mentioned in a note ("2 other mode ranges … left untouched").
- Written ranges use mode logic OR and no linked mode.

## Hidden on purpose

- All other modes (Horizon, Air mode, Failsafe, Blackbox, GPS rescue, …), AND/linked-mode logic, adjustments.

## Acceptance

Mock FC (ARM on AUX1 1700–2100, FAILSAFE on AUX4, AUX2 sweeping):

- [x] Only the four modes appear; note mentions 1 untouched range
- [x] Add a range, change channel and bounds, Save → persists, no reboot
- [x] Removing a range clears its slot; the FAILSAFE slot is unchanged

On real hardware:

- [ ] Flipping the arm switch moves the marker and shows "Active"
- [ ] Ranges match Betaflight Configurator's Modes tab after saving

## Open questions

None.
