# Diff Checker

Status: built
Route: `/diff` · Page: `src/pages/Diff.tsx`

## Purpose

See every **tuning** setting — PIDs, rates, filters — that is not at its Betaflight default: what makes this quad
fly differently from a stock one. The setup (ports, modes, VTX table, OSD, …) is left out.

## Layout

```
+-----------------------------------------------------------------+
| [Read again] [Copy full diff]                                   |
|        3 tuning differences · 7 other hidden · board · firmware |
+-----------------------------------------------------------------+
  [Betaflight default] → [this flight controller]
+-----------------------------------------------------------------+
| master                                             1 difference |
| set dshot_bidir = [OFF] → [ON]                                  |
+-----------------------------------------------------------------+
| profile 0                                         2 differences |
| set d_roll = [30] → [34]                                        |
| set d_pitch = [34] → [38]                                       |
+-----------------------------------------------------------------+
| rateprofile 0 …                                                 |
+-----------------------------------------------------------------+
```

Coloured like `git diff`: a section is a "file"; in a line the default is marked red, the current value green.

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Read again | button | CLI `diff all defaults` | — | The tab also reads once when it is opened |
| Copy full diff | button | — | — | The **complete** CLI output as it came (setup included), to paste into a bug report |
| Summary | readout | `# version`, `board_name`, `manufacturer_id` lines | — | Number of tuning differences · how many other differences are hidden · board · firmware |
| Legend | readout | — | — | Red "Betaflight default" → green "this flight controller"; only while there are differences |
| Section block | readout | CLI headings `master`, `profile N`, `rateprofile N` | — | Only sections with tuning differences; every PID / rate profile (`all`). Header: heading · number of differences |
| Setting line | readout | `set name = value` + `#set name = default` | — | One line: `set name = default → value`, the default marked red, the value green; only the green value if the FC printed no default. Long values wrap |

## Behaviour

- The FC does the comparison: the app runs the CLI command `diff all defaults` and only parses the output, so the
  defaults are those of the connected firmware **and board** (a board's own defaults don't show up as differences).
- Transport: Betaflight 2026.6's non-interactive CLI on the MSP port — `0x02` (STX) starts it and is echoed, the
  command is sent together with `0x03` (ETX), the output ends with the echoed ETX. No reboot, and the CLI arming
  flag isn't set (both would be with `#` … `exit`). The session owns the link (`MspClient.exclusive`); polls wait.
- Nothing is written to the FC. The firmware itself resets its config in RAM to defaults and restores it while
  it prints a diff, as it does for every `diff`.
- Tuning only (`tuningOnly` in `lib/diff/model.ts`): every setting of the PID profiles (`profile N`) and rate
  profiles (`rateprofile N`), and from `master` the gyro filters (`gyro_hardware_lpf`, `gyro_lpf*`, `gyro_notch*`,
  `dyn_notch_*`, `rpm_filter_*`, `simplified_*`), RC smoothing and deadband (`rc_smoothing*`, `deadband`,
  `yaw_deadband`), and what the PID loop and the RPM filter run on (`pid_process_denom`, `motor_pwm_protocol`,
  `dshot_bidir`, `motor_poles`, `motor_idle` / `dshot_idle_value`, `mixer_type`, `rpm_limit*`).
- Hidden: all other `master` settings (board alignment, receiver, OSD, VTX, GPS, failsafe, …), battery profiles, the
  craft name and every line that isn't a `set` — `feature`, `serial`, `aux`, `adjrange`, `vtxtable`, `resource`,
  `timer`, `dma`, `beeper`, `map`, … The summary says how many differences are hidden; "Copy full diff" has them.
- Also left out of the view: what the CLI prints for pasting the diff into another FC (`batch start`, `defaults nosave`,
  `profile 0` restores, `save`, `mcu_id`, `signature`). "Copy as text" keeps them.
- Errors: no STX echo within 1 s → "did not start its command line" (the FC ignores it while armed); output that
  stops for 3 s without ETX → error; an ETX is sent in both cases so the port doesn't stay in CLI mode. `###ERROR…`
  and `ERR_CMD_NA` lines from the CLI are shown as errors.
- Empty state: "No tuning differences — PIDs, rates and filters are at their defaults."

## Hidden on purpose

- The CLI itself: no command input, no `dump`, no applying or restoring a diff.
- The setup part of the diff (see Behaviour) — the other tabs show it, and "Copy full diff" still has it.
- Filtering / searching, and comparing with a saved diff or a drone-type preset (SPEC §2 "Drone type" will need
  its own diff of what it is going to change).

## Acceptance

Checkable with **Connect Mock FC** (so the mock has to support it):

- [x] Open the tab → "0 tuning differences · 6 other hidden" and the empty state: the mock's telemetry, UART2/UART3
      and two modes are setup, so there are no cards
- [x] Motors → Bidirectional DShot on, props out → Save & Reboot → Diff Checker → "1 tuning difference · 7 other
      hidden", `master` lists only `set dshot_bidir = OFF → ON` (not `yaw_motors_reversed`)
- [x] Read again reads again; Copy full diff puts the complete raw CLI output on the clipboard
- [x] Afterwards other tabs load as usual (the FC is back in MSP)

On real hardware:

- [ ] Output of a real 2026.6 FC is parsed completely (resources, vtxtable, OSD settings, several profiles) and only
      the tuning of it is shown
- [ ] The FC can be armed afterwards without a reboot
- [ ] Over a slow link (MSP on a UART / wireless bridge) the diff still completes

## Decisions

_Made while building without asking (2026-09-21) — change freely._

- `diff all defaults` through the CLI rather than comparing MSP reads with a table of defaults in the app: it is
  the only way to cover **all** settings, and the defaults can't go stale.
- Non-interactive CLI (STX/ETX) rather than `#` + `exit noreboot`: the latter leaves `ARMING_DISABLED_CLI` set
  until the next power cycle.
- Reads when the tab is opened (it is read-only and takes about a second), plus **Read again**.
- Tuning only (2026-09-21, asked for by the user). Which `master` settings count as tuning is an allow-list of
  names from the firmware's `cli/settings.c`; commands other than `set` are all setup. The copy button keeps the
  complete diff (renamed "Copy full diff"), so nothing is lost for bug reports, and the summary counts what is hidden.
- CLI names and values are shown as they are, not translated — the tab is a debugging tool.
- Coloured like `git diff` (2026-09-21, asked for by the user — the three-column table was hard to read), condensed
  to one line per setting on the user's request: `set name = default → value`, the default marked red and the value
  green, instead of a `-` and a `+` line. The values are `<del>` / `<ins>` elements, so the sides don't depend on the
  colour alone.
- Sidebar label "Diff Checker", between Analog VTX and Blackbox as in SPEC §2.

## Open questions

_None._
