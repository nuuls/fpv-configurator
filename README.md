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
