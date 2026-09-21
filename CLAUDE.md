# FPV Configurator

A simplified Betaflight configurator that runs entirely in the browser. It talks MSP (MultiWii Serial
Protocol) to the flight controller over the Web Serial API. Static SPA — there is no backend.

## Working in parallel — one task, one branch, one worktree

Several agents work on this repo at the same time. **Never edit, commit or push on `master` directly**, and never
work in a directory another agent is using.

1. **Start** every task in your own git worktree on your own branch, cut from the latest `origin/master`:
   use the worktree tool (it creates `.claude/worktrees/<name>`), or
   `git fetch origin && git worktree add .claude/worktrees/<name> -b <branch> origin/master`.
   Branch names: `feat/<topic>`, `fix/<topic>`, `docs/<topic>` — e.g. `feat/osd-tab`. One task per branch.
2. Run `pnpm install` in the new worktree (each has its own `node_modules`; the pnpm store makes it quick).
   `pnpm dev` picks a free port by itself, so several dev servers can run side by side.
3. **Finish**: `git fetch origin && git rebase origin/master` (resolve conflicts, keep both sides' additions) →
   `pnpm check` → commit on your branch → `git push -u origin <branch>`. Committing and pushing **your own
   branch** needs no permission; report the branch name and what it contains.
   **A pushed but unmerged branch is not a completed task — it waits for the user.** End that report with a
   `needs input:` line asking whether to merge, on its own line, e.g.
   `needs input: feat/osd-tab is pushed and passes pnpm check — merge into master?`
   Do **not** write a `result:` line yet, so the job shows up as needing input instead of done.
4. **Merging into `master` happens only when the user asks.** Then: rebase once more, `pnpm check`, fast-forward
   (`git checkout master && git merge --ff-only <branch> && git push`), delete the branch and remove the worktree
   (`git worktree remove …`, `git branch -d …`, `git push origin --delete …`). Don't touch other agents' branches
   or worktrees. Only now — after the merge, or once the user says the branch should stay unmerged — write the
   `result:` line. Tasks that change no files (questions, investigations) have nothing to merge and end with
   `result:` as usual.

To keep branches mergeable, stay out of each other's way in the files everyone touches:

- `src/routes.ts`, `src/lib/msp/codes.ts`, `src/lib/mock-fc/mockFc.ts`, `src/index.css`: only **add** lines, in
  the place they belong (codes are sorted by number); don't reorder, reformat or rename what is there.
- Tests for a new tab go in their own file (`src/pages/<Tab>.test.tsx`, helpers from `src/test/app.tsx`), not into
  `src/pages/tabs.test.tsx`.
- `docs/SPEC.md` is the user's document: change only the lines your task is about. Your tab's
  `docs/tabs/<tab>.md` is yours.
- Don't run `pnpm format` on files you didn't otherwise change, and don't bump dependencies as a side effect.

## Specs — read before building features

`docs/SPEC.md` (scope, layout, global behaviour) and `docs/tabs/<tab>.md` (one per tab) define what the app
does; format rules are in `docs/README.md`.

- Before working on a tab, read `docs/SPEC.md` and that tab's spec.
- Only implement tabs whose spec says `Status: ready`. If it's `placeholder`/`draft` or has unchecked
  _Open questions_, ask the user instead of inventing behaviour.
- Never build anything listed under **Never** in `SPEC.md`, and don't add controls a tab spec doesn't list.
- When behaviour changes, update the spec in the same change; set `Status: built` once acceptance passes.

## Commands

```
pnpm dev         # dev server (open in a Chromium browser for Web Serial)
pnpm check       # typecheck + lint + tests — run this after EVERY change, it must pass
pnpm test:watch  # vitest in watch mode
pnpm build       # production build into dist/
pnpm format      # prettier
```

Add shadcn components with `pnpm dlx shadcn@latest add <name>` (config in `components.json`).

## Stack

Vite · React 19 · TypeScript (strict, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`) · Tailwind CSS v4 ·
shadcn/ui (source lives in `src/components/ui`) · zustand · react-router (`createHashRouter`, needed for `useBlocker`) · Vitest + Testing
Library · oxlint · pnpm.

## Architecture

```
src/
  lib/                     pure TypeScript — NO React imports in here
    msp/
      codes.ts             MSP command numbers
      codec.ts             frame encode + streaming parser (v1, v1 jumbo, v2)
      bytes.ts             ByteReader / ByteWriter (little-endian)
      messages.ts          typed payload decoders/encoders, one pair per message
      client.ts            MspClient: serialized request/response with timeouts
      api.ts               high-level typed reads/writes (request + decode) — what the UI calls
    ports/ blackbox/ orientation/ modes/ tuning/ motors/ rates/ setup/ osd/ filters/
                           one folder per feature: model.ts (types, payload codecs, pure logic) + io.ts
                           (read snapshot / save via MspClient). Core messages stay in msp/messages.ts.
    transport/             byte pipes: types.ts (interface), webserial.ts, mock.ts
    mock-fc/mockFc.ts      simulated Betaflight 2026.6 FC: running vs. saved config, EEPROM write, reboot
  stores/
    connection.ts          connection lifecycle, MspClient, FcInfo, reboot() + auto-reconnect
    unsaved.ts             which tabs have unsaved edits; confirmDiscardChanges()
    confirm.ts             confirm({...}) → Promise<boolean>, rendered by ConfirmDialogHost
  hooks/
    useMspPoll.ts          poll a read while connected + mounted (live data)
    useFcSnapshot.ts       read a tab's config once per connection (+ reload)
    useDraft.ts            editable copy of a snapshot: draft, dirty, revert
    useSave.ts             run a save action, then reboot or reload; keeps the error
    useUnsavedChanges.ts   mark a tab dirty + ask before navigating away
  routes.ts                tab list — single source for router AND sidebar
  components/layout/       AppShell, Header (connect buttons), Sidebar, PageHeader
  components/              SaveBar, Notice/LoadingState, ConfirmDialogHost, BoardView
  components/ui/           shadcn components (generated; excluded from lint; they import `cn` from the
                           `cn` package, app code uses `@/lib/utils`)
  pages/                   one file per tab
```

Data flow: `page → useMspPoll / store → api.ts → MspClient → Transport → (Web Serial | MockFlightController)`.

## Rules

- `navigator.serial` is touched **only** in `src/lib/transport/webserial.ts`.
- UI code never builds or parses bytes. It calls functions from `lib/msp/api.ts`.
- Decoders/encoders in `messages.ts` are pure functions and every one has a unit test.
- Everything must work against the mock FC: a feature isn't done until "Connect Mock FC" exercises it.
- Byte layouts come from Betaflight firmware source (`src/main/msp/msp.c`, `msp_protocol.h`) — don't guess
  them. Decoders must tolerate shorter payloads from older firmware (check `reader.remaining`).
- `erasableSyntaxOnly` is on: no `enum`, no constructor parameter properties, no namespaces. Use
  `as const` objects and explicit fields.
- Use `import type` for type-only imports (`verbatimModuleSyntax`). Import via the `@/` alias.
- Array/typed-array indexing yields `T | undefined`; handle it rather than asserting with `!`.
- Writes that change FC settings must be explicit user actions; persisting needs `MSP_EEPROM_WRITE`.
  Never send motor-spinning commands without a clear on-screen safety confirmation.

## Editable tabs (SPEC §5) — copy `src/pages/Orientation.tsx` (smallest) or `Modes.tsx`

```tsx
const { client, snapshot, error, reload } = useFcSnapshot(readXSnapshot)   // lib/<feature>/io.ts
// in an <Editor> rendered once snapshot exists:
const { draft, setDraft, dirty, revert } = useDraft(snapshot, toDraft)      // toDraft: pure, in model.ts
const { saving, error, save } = useSave(reload)
useUnsavedChanges(PATH, dirty)
<SaveBar dirty saving reboot={needsReboot} problem={validate(draft)[0]} onRevert={revert}
         onSave={() => void save(async () => { await saveX(client, snapshot, draft); return needsReboot })} />
```

`saveX` writes, then calls `saveToEeprom`. Keep snapshot → draft → payload logic as pure functions in
`lib/<feature>/model.ts` with unit tests; ask with `confirm()` before destructive actions. For messages with
many fields we don't edit, keep the raw payload in the snapshot and patch bytes (read-modify-write) instead
of decoding everything — see `lib/tuning` and `lib/motors`.

UI tests: wait for the reboot/reload to finish before asserting (`saveAndReboot` / `saveWithoutReboot` helpers
in `src/test/app.tsx`, next to `openTab`, `nudge` and `resetAppAfterEach`) — elements of the pre-save page are still mounted right after the click.

Firmware facts that are easy to get wrong (verified against Betaflight 2026.6.2 source):

- Version is calendar based: `MSP_FC_VERSION` = (year-2000, month, patch) + version string.
- Port identifiers: USB VCP 20, UART1 = 51. Never modify the USB VCP port config.
- PID loop rate = gyro sample rate (u16 near the end of `MSP_BOARD_INFO`) / `pid_process_denom` (byte 1 of
  `MSP_ADVANCED_CONFIG`). The firmware raises the denominator itself if the motor protocol is too slow.
- `MSP_BOARD_INFO` ends (after the gyro rate) with a u32 of configuration problems: bit 0 = accelerometer not
  calibrated (`accHasBeenCalibrated()`). The ACC_CALIBRATION arming flag is only raised when something uses the acc.
- `MSP_BEEPER_CONFIG`: `beeper_off_flags` u32, DShot beacon tone u8, `dshotBeaconOffFlags` u32. A set bit
  **mutes** the beep; bit = `1 << (beeperMode_e - 1)`: RX_LOST bit 1, RX_SET bit 9.
- Motor outputs set with `MSP_SET_MOTOR` persist until changed or reboot — always stop them on every exit path.
- `MSP2_CLI_SETTING` can **write** any CLI variable (`name = value`) but reads always fail in 2026.6.
  Read values through the classic messages instead.
- OSD element position (u16): x bits 0–4 plus bit 10 (HD, x ≥ 32), y bits 5–9, visible-in-profile bits 11–13,
  variant bits 14–15. `MSP_SET_OSD_CONFIG` first byte: element index, `-2` = timer, `-1` = general settings.
  The custom message elements (81–84) have no CLI setting and their text can't be read back.
- `osdInit` sets `osd_canvas_width/height` (`MSP_OSD_CANVAS`) to the detected display — also for SD: video system
  AUTO is 13 rows on an MSP displayport or with an NTSC camera — and clamps every element outside of it onto the
  last row/column at boot. Use the reported canvas, don't derive the rows from the video system.
- `MSP_SIMPLIFIED_TUNING` is 53 bytes (17 PID sliders, 18 D-term filter, 18 gyro filter) and carries the same
  lowpass cutoffs as `MSP_FILTER_CONFIG`. A filter slider only rescales filters whose cutoff isn't 0, and only
  `MSP_SET_FILTER_CONFIG` re-initialises the running filters — send it last. `dyn_notch_count` max is 7.
- `MSP_SET_PASSTHROUGH` (245) without payload starts the BLHeli 4-way interface even when it reports 0 ESCs: the
  port stops speaking MSP until `cmd_InterfaceExit`, then the FC re-enables the motor outputs by itself (no
  reboot). Run such sessions through `MspClient.exclusive` (see `lib/esc/io.ts`) so polls wait instead of
  corrupting them. `lib/esc` is read-only on purpose — flashing is under **Never**.
- ESCs don't sit in their bootloader when the 4-way interface starts: they jump into it once the signal wire was
  high for a few hundred ms (longer with a startup tune), and the FC's `cmd_DeviceInitFlash` gives up within ~50 ms.
  Wait (1.2 s) before the first one and retry with pauses — an immediate attempt always fails on real ESCs.
- API 1.49 (`master`) removes the serial function-mask messages in favour of `rx_uart`/`vtx_uart`/… settings.

## Adding a feature (e.g. a new tab backed by a new MSP message)

0. Check the tab's spec in `docs/tabs/` is `Status: ready` — it lists the controls and MSP messages needed.
1. Add the command number to `lib/msp/codes.ts`.
2. Add `decodeX` / `encodeX` and types to `lib/<feature>/model.ts` (core/shared messages: `lib/msp/messages.ts`),
   with tests.
3. Add `readXSnapshot` / `saveX` to `lib/<feature>/io.ts`.
4. Make the mock FC answer it: new `case` in `MockFlightController.respond()`.
5. Build the page in `src/pages/`, using `useMspPoll(readX, intervalMs)` for live data or a one-shot call
   through `useConnectionStore((s) => s.client)`. Register new tabs in `src/routes.ts`.
6. `pnpm check`.

## Testing

- Pure logic: plain Vitest next to the source (`*.test.ts`).
- Anything involving the connection: drive it through `MockTransport` (see `client.test.ts`) or the whole
  app through the "Connect Mock FC" button (see `App.test.tsx`). `MockFlightController` takes an injectable
  clock for deterministic telemetry.
