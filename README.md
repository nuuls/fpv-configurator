# FPV Configurator

A simplified, browser-based configurator for Betaflight flight controllers. Connects over USB using the
Web Serial API and speaks MSP. Includes a simulated flight controller, so no hardware is needed to develop.

## Getting started

Requires Node.js ≥ 22.22 and pnpm.

```
pnpm install
pnpm dev
```

Open the printed URL in a Chromium-based browser (Chrome, Edge, Brave — Web Serial isn't available in
Firefox or Safari). Click **Connect Mock FC** to try it without hardware, or **Connect** to pick a serial
port.

On Linux your user needs access to the serial device (on Arch-based distros: `uucp` group; on Debian-based:
`dialout`).

## Scripts

| Command       | What it does                 |
| ------------- | ---------------------------- |
| `pnpm dev`    | Dev server with HMR          |
| `pnpm check`  | Typecheck + lint + tests     |
| `pnpm build`  | Static production build      |
| `pnpm format` | Format with Prettier         |

## CI and deployment

GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm check` and `pnpm build` on every push. Pushes to
`master` are deployed to GitHub Pages: <https://nuuls.github.io/fpv-configurator/>. The deployment is skipped
while the repository is private, and needs _Settings → Pages → Source_ set to **GitHub Actions** once.

Architecture and conventions are documented in [CLAUDE.md](./CLAUDE.md).

## Built on other projects

This app would not exist without the open-source projects it re-implements. Protocol and byte layouts, value
tables, presets and a lot of behaviour are taken from — or checked against — their source code:

| Project                                                                          | License  | Used for                                                  |
| -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| [Betaflight](https://github.com/betaflight/betaflight) (firmware)                | GPL-3.0  | MSP messages and byte layouts, BLHeli 4-way interface     |
| [Betaflight Configurator](https://github.com/betaflight/betaflight-configurator) | GPL-3.0  | Reference for every tab: behaviour, ranges, calculations  |
| [Betaflight firmware presets](https://github.com/betaflight/firmware-presets)    | GPL-3.0  | VTX tables                                                |
| [ESC Configurator](https://github.com/stylesuxx/esc-configurator)                | AGPL-3.0 | BLHeli_S / Bluejay settings layouts and value tables      |
| [AM32](https://github.com/am32-firmware/AM32) (firmware)                         | GPL-3.0  | AM32 settings (EEPROM) layout and value handling          |

The per-tab sources are listed in `docs/tabs/*.md`. [Bluejay](https://github.com/bird-sanctuary/bluejay),
[BLHeli](https://github.com/bitdump/BLHeli) and
[BLHeli Configurator](https://github.com/blheli-configurator/blheli-configurator) are GPL-3.0 too, so their code can
be used here as well.

Thank you to everyone who works on them. This project is not affiliated with or endorsed by any of them.

## License

Copyright © 2026 nuuls and contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](./LICENSE) as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

Why AGPL: it is the one license under which code from **all** of the projects above can be combined. AGPL-3.0 code
(ESC Configurator) can only be re-used in an AGPL-3.0 work, and section 13 of both licenses explicitly allows
combining GPL-3.0 code with it. Parts taken from a GPL-3.0 project stay available under GPL-3.0; the app as a whole
is AGPL-3.0. When copying code, keep the original copyright notice and name the source in a comment.

Code can **not** be taken from projects without a license (e.g. `am32-firmware/am32-configurator` at the time of
writing) or with an incompatible one — use those as a reference for behaviour only.
