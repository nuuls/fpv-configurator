# Blackbox

Status: ready
_Implemented; mock acceptance passes (`src/pages/tabs.test.tsx`, `src/lib/features.test.ts`). Set to `built` once the hardware checks pass._
Route: `/blackbox` · Page: `src/pages/Blackbox.tsx` · Logic: `src/lib/blackbox/`

## Purpose

Choose where and how fast flight logs are recorded, and get the logs off the quad.

## Controls

| Control | Type | Betaflight setting / MSP | Values · default | Notes |
| ------- | ---- | ------------------------ | ---------------- | ----- |
| Log to | select | `blackbox_device` · `MSP_BLACKBOX_CONFIG` (80/81) | No logging, Onboard flash, SD card | Only storage the FC actually has is offered. "Serial port" appears only if already selected |
| Logging rate | select | `blackbox_sample_rate` | 1/1 … 1/16, shown with Hz | Hz derived from the PID loop time (`MSP_STATUS`) |
| Storage usage | readout | `MSP_DATAFLASH_SUMMARY` (70), `MSP_SDCARD_SUMMARY` (79) | — | |
| Erase storage | button | `MSP_DATAFLASH_ERASE` (72) | — | Flash only. Confirmation; polls until the chip is ready |
| Activate mass storage | button | `MSP_REBOOT` mode 2 | — | Confirmation; app disconnects and explains to replug |

## Behaviour

- Log device / rate: **Save & Reboot**.
- Erase and mass storage are disabled while there are unsaved edits.
- `fields_disabled_mask` is passed through unchanged.

## Hidden on purpose

- Which fields are logged, debug mode, serial logging setup, log download through the app (use mass storage).

## Acceptance

Mock FC (16 MB flash, 3.3 MB used, no SD card):

- [x] Shows flash usage; SD card / serial are not offered
- [x] Changing the rate → Save & Reboot → value persists
- [x] Erase asks first, then usage shows 0
- [x] Mass storage asks first, disconnects, welcome screen explains how to get back

On real hardware:

- [ ] Rate in Hz matches Betaflight Configurator
- [ ] Erase completes; mass storage mounts as a drive; replugging reconnects normally
- [ ] SD-card FC: usage shown, erase button absent

## Open questions

None.
