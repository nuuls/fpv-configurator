# FPV Configurator

A simplified Betaflight configurator that runs entirely in the browser. It talks MSP (MultiWii Serial
Protocol) to the flight controller over the Web Serial API. Static SPA — there is no backend.

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
    ports/                 device-first port assignment: model.ts (pure logic), io.ts (read/apply)
    transport/             byte pipes: types.ts (interface), webserial.ts, mock.ts
    mock-fc/mockFc.ts      simulated Betaflight 2026.6 FC: running vs. saved config, EEPROM write, reboot
  stores/
    connection.ts          connection lifecycle, MspClient, FcInfo, reboot() + auto-reconnect
    unsaved.ts             which tabs have unsaved edits; confirmDiscardChanges()
    confirm.ts             confirm({...}) → Promise<boolean>, rendered by ConfirmDialogHost
  hooks/
    useMspPoll.ts          poll an api.ts read while connected + mounted
    useUnsavedChanges.ts   mark a tab dirty + ask before navigating away
  routes.ts                tab list — single source for router AND sidebar
  components/layout/       AppShell, Header (connect buttons), Sidebar, PageHeader
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

## Editable tabs (SPEC §5) — copy `src/pages/Ports.tsx`

Read a snapshot from the FC → keep a local draft → `useUnsavedChanges(path, dirty)` → **Save** writes,
calls `saveToEeprom`, then `useConnectionStore.reboot()` if needed (the page unmounts and reloads after the
automatic reconnect). Keep the read → draft → write-plan logic as pure functions in `lib/<feature>/` with
unit tests; ask with `confirm()` before destructive writes.

Firmware facts that are easy to get wrong (verified against Betaflight 2026.6.2 source):

- Version is calendar based: `MSP_FC_VERSION` = (year-2000, month, patch) + version string.
- Port identifiers: USB VCP 20, UART1 = 51. Never modify the USB VCP port config.
- `MSP2_CLI_SETTING` can **write** any CLI variable (`name = value`) but reads always fail in 2026.6.
  Read values through the classic messages instead.
- API 1.49 (`master`) removes the serial function-mask messages in favour of `rx_uart`/`vtx_uart`/… settings.

## Adding a feature (e.g. a new tab backed by a new MSP message)

0. Check the tab's spec in `docs/tabs/` is `Status: ready` — it lists the controls and MSP messages needed.
1. Add the command number to `lib/msp/codes.ts`.
2. Add `decodeX` (+ `encodeX`) and the result type to `lib/msp/messages.ts`; add tests to `messages.test.ts`.
3. Add a `readX` / `writeX` helper to `lib/msp/api.ts`.
4. Make the mock FC answer it: new `case` in `MockFlightController.respond()`.
5. Build the page in `src/pages/`, using `useMspPoll(readX, intervalMs)` for live data or a one-shot call
   through `useConnectionStore((s) => s.client)`. Register new tabs in `src/routes.ts`.
6. `pnpm check`.

## Testing

- Pure logic: plain Vitest next to the source (`*.test.ts`).
- Anything involving the connection: drive it through `MockTransport` (see `client.test.ts`) or the whole
  app through the "Connect Mock FC" button (see `App.test.tsx`). `MockFlightController` takes an injectable
  clock for deterministic telemetry.
