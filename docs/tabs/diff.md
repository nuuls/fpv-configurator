# Diff Checker

Status: built
Route: `/diff` · Page: `src/pages/Diff.tsx`

## Purpose

See every setting that is not at its Betaflight default — mostly to debug what the other tabs (or something else)
changed on the FC.

## Layout

```
+-----------------------------------------------------------------+
| [Read again] [Copy as text]   7 differences · board · firmware  |
+-----------------------------------------------------------------+
| feature                                                         |
|   feature -TELEMETRY  [default]                                 |
|   feature TELEMETRY                                             |
+-----------------------------------------------------------------+
| master                                                          |
|   Setting            Current      Default                       |
|   align_board_yaw    90           0                             |
+-----------------------------------------------------------------+
| profile 0 …                                                     |
+-----------------------------------------------------------------+
```

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Read again | button | CLI `diff all defaults` | — | The tab also reads once when it is opened |
| Copy as text | button | — | — | The CLI output as it came, to paste into a bug report |
| Summary | readout | `# version`, `board_name`, `manufacturer_id` lines | — | Number of differences · board · firmware |
| Section card | readout | one per CLI heading: `feature`, `serial`, `aux`, `master`, `profile 0`, `rateprofile 0`, … | — | Only sections with differences; every PID / rate / battery profile (`all`) |
| Setting row | readout | `set name = value` + `#set name = default` | — | Setting · Current · Default |
| Command row | readout | any other line (`feature`, `serial`, `aux`, `vtxtable`, …) | — | The line as printed; a `#…` default line is muted and tagged "default" |

## Behaviour

- The FC does the comparison: the app runs the CLI command `diff all defaults` and only parses the output, so the
  defaults are those of the connected firmware **and board** (a board's own defaults don't show up as differences).
- Transport: Betaflight 2026.6's non-interactive CLI on the MSP port — `0x02` (STX) starts it and is echoed, the
  command is sent together with `0x03` (ETX), the output ends with the echoed ETX. No reboot, and the CLI arming
  flag isn't set (both would be with `#` … `exit`). The session owns the link (`MspClient.exclusive`); polls wait.
- Nothing is written to the FC. The firmware itself resets its config in RAM to defaults and restores it while
  it prints a diff, as it does for every `diff`.
- Left out of the view: what the CLI prints for pasting the diff into another FC (`batch start`, `defaults nosave`,
  `profile 0` restores, `save`, `mcu_id`, `signature`). "Copy as text" keeps them.
- Errors: no STX echo within 1 s → "did not start its command line" (the FC ignores it while armed); output that
  stops for 3 s without ETX → error; an ETX is sent in both cases so the port doesn't stay in CLI mode. `###ERROR…`
  and `ERR_CMD_NA` lines from the CLI are shown as errors.
- Empty state: "No differences — every setting is at its default."

## Hidden on purpose

- The CLI itself: no command input, no `dump`, no applying or restoring a diff.
- Filtering / searching, and comparing with a saved diff or a drone-type preset (SPEC §2 "Drone type" will need
  its own diff of what it is going to change).

## Acceptance

Checkable with **Connect Mock FC** (so the mock has to support it):

- [x] Open the tab → "6 differences", cards `feature`, `serial`, `aux` with the mock's telemetry, UART2/UART3 and
      two modes; default lines tagged "default"; no `master` card
- [x] Orientation → Yaw 90° → Save & Reboot → Diff Checker → `master` lists `align_board_yaw` · 90 · 0
- [x] Read again reads again; Copy as text puts the raw CLI output on the clipboard
- [x] Afterwards other tabs load as usual (the FC is back in MSP)

On real hardware:

- [ ] Output of a real 2026.6 FC is parsed completely (resources, vtxtable, OSD settings, several profiles)
- [ ] The FC can be armed afterwards without a reboot
- [ ] Over a slow link (MSP on a UART / wireless bridge) the diff still completes

## Decisions

_Made while building without asking (2026-09-21) — change freely._

- `diff all defaults` through the CLI rather than comparing MSP reads with a table of defaults in the app: it is
  the only way to cover **all** settings, and the defaults can't go stale.
- Non-interactive CLI (STX/ETX) rather than `#` + `exit noreboot`: the latter leaves `ARMING_DISABLED_CLI` set
  until the next power cycle.
- Reads when the tab is opened (it is read-only and takes about a second), plus **Read again**.
- CLI names and values are shown as they are, not translated — the tab is a debugging tool.
- Sidebar label "Diff Checker", between Analog VTX and Blackbox as in SPEC §2.

## Open questions

_None._
