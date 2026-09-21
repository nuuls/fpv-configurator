# FPV Configurator — Product Spec

Status: placeholder

## 1. Purpose

Extremely simplified and cut down version of the Betaflight, AM32 and ESC-configurator as an all-in-one app.
It removes 99% of power user features and only keeps the important features. It also lets you choose the type of drone you are
configuring and chooses defaults based on that. A 5" freestyle drone will have different default than a 65mm whoop.

- **Audience:**
	- Any pilot who is not a power-user
- **Goal:**
	- Easily and quickly configure your FC and ESC with sensible defaults
	- Save some cross-drone presets in the browser such as rates, OSD setup etc

## 2. Scope

- Drone type
	- Pick the type of drone (5" freestyle, 65mm whoop, ...) in a setup step
	- Shows a diff of what will change, then applies the defaults to the FC once ("Apply defaults")
	- Afterwards the type is only remembered in the browser (keyed to the FC) to pick slider ranges and hints
	- List of types and their defaults: TBD

- FC Orientation
	- 3D view
	- Dropdown based spins in 45 deg steps

- Port assignment
	- Do it the other way around as in betaflight:
		- VTX -> Select type (Digital (msp), Analog) -> Select UART port
		- RX -> Select type (ELRS, CRSF) -> Select port
		- GPS
		- Other MSP devices -> Select port
- PID Tuning
	- Slider based
	- Show raw numbers as view-only
	- Only show the following sliders
		- Damping
		- Master multiplier
	- Dynamic D is locked at 0 (and not visible)
	- Other sliders are locked at 1 (and not visible)

	- Replace entire smoothing section with:
		- _Built without the Hz selector — Betaflight 2026.6 detects the link rate itself, see
		  `docs/tabs/pid-tuning.md` → Decisions._
		- RC link hz selector
		- Smoothing presets (hz must be selected)
			- Direct
				- RC smoothing disabled
				- Race preset feed forward settings (automatically adjust to packet rate)
			- Light smoothing
				- 25 auto RC smoothing
				- Race feed forward
			- Strong smoothing
				- 30 auto RC smoothing
				- Higher feed forward smoothing (TBD)
				- Automatically lower feed forward to 0.5

- Filters
	- Gyro Lowpass 2 PT1
		- Slider from 0 - 2
	- RPM filter
		- Only min frequency
	- Dynamic notch
		- Notch count (1 default)
		- Min frequency
	- D term filtering
		- Only slider from 0.5 - 1.5
	- No other filters

- Rates
	- Very simple interface, only one profile
	- Dropdown for rate type
		- Actual (default)
		- ...others (not implemented yet)
	- 3x3 input matrix
	- Values can be synced across axis:
		- Sync all (default)
		- Sync Picth and Roll
		- Sync disabled
	- Graph on the side to show rate curve

- Modes
	- Copy betaflight design but only keep the following modes:
		- ARM
		- Angle
		- Turtle mode
		- Beeper

- Motors
	- Copy betaflight design
	- Props out is the default
	- Bi-directional dshot is enabled by default, mark as warning if its disabled
	- Dynamic idle input
		- Slider ranging from 12-40
		- Add green, warning and danger zone according to type of drone
		- Currently only 5" with the following
			- Green 18-25
			- 3 point warning zone
			- Rest danger zone
	- Motor spin tester menu should be visual where you can drag the slider on each motor on a 2d quad
	- Also display reported RPM

- OSD
	- Copy the existing betaflight UI but only keep the following elements
		- Battery average cell voltage
		- Current amp draw
		- Used mah
		- Link quality
		- Warnings
		- Disarmed
		- Timer 2 (armed time)
		- Custom message 1-4
		- VTX channel (combined mode)
		- Altitude
	- Only allow one OSD profile
	- Remove everything thats on the right in betaflight

- VTX
	- Sidenav name is Analog VTX
	- Presets can be selected from a dropdown UI, values are hardcoded in the app
		- Choose manufacturer
		- Choose vtx
	- VTX table can be edited manually after loading preset

- Blackbox
	- Copy betaflight design but remove everything except the following
		- Select logging device
		- Blackbox rate
		- Erase storage
		- Activate mass storage

**Later** (not v1, but keep the door open):

- ESC configuration (AM32 / BLHeli via 4-way passthrough)

**Never** (deliberately out of scope — do not build, do not suggest):

- Firmware flashing
- Advanced GPS rescue setup
- Blackbox analysis

## 3. Supported hardware & firmware

- Firmware: Betaflight 2026.x only. Anything else (older, INAV, ...): connect, show a warning, tabs stay disabled.
	- 2026.6 = MSP API 1.48 — the version to build against now
	- Next release (API 1.49, currently `master`) changes how ports are assigned (per-feature `rx_uart`,
	  `vtx_uart`, ... set through `MSP2_CLI_SETTING`; the serial function-mask messages are removed).
	  Keep version-specific code behind one interface per feature so a second backend can be added.
- Browsers: Chromium-based (Web Serial). Others: mock FC only.

## 4. Layout

Header (app name · firmware · connection · Connect / Disconnect) + sidebar tabs + page. One sidebar tab per
scope item in §2, in this order (single source: `src/routes.ts`):

Setup · Ports · Orientation · PID Tuning · Filters · Rates · Modes · Motors · OSD · VTX · Blackbox

Tabs still marked TBD in §2 (Filters, Rates, VTX) show a "not specified yet" placeholder.
_Assumed — change freely; the drone-type setup step has no place in the layout yet._

## 5. Global behaviour

Rules every tab follows. Tab specs only mention deviations.

- **Connect:** goes straight to the last used FC — no port picker — when the browser still has permission for
  it and exactly one such device is plugged in. Otherwise (first time, not plugged in, several boards of the
  same USB type) the browser's picker shows. Remembered per browser as USB vendor/product id (all Web Serial
  exposes), only after the device answered as an FC. If the direct connection fails it is forgotten, so
  pressing Connect again shows the picker.
- **Saving:** one **Save** button per tab. Edits stay local until pressed; Save writes to the FC and persists
  (`MSP_EEPROM_WRITE`). If any changed setting needs a reboot the button reads **Save & Reboot**. A **Revert**
  button discards local edits.
- **Unsaved changes:** changed controls are marked, the tab gets a dot in the sidebar, and leaving the tab or
  disconnecting asks "Discard changes?".
- **Reboot:** the app sends `MSP_REBOOT`, shows "Rebooting…", and reconnects by itself to the same port
  (already-granted Web Serial port, no picker). After 10 s without the FC it falls back to the welcome screen.
  Each tab spec says which of its settings need a reboot.
- **Disconnect / errors:** _unplugged mid-session, MSP timeout, FC returns an error_
- **Safety:** _motors never spin without a props-off confirmation; what else?_
- **Units & formatting:** _e.g. volts with 2 decimals, degrees, µs_

## 6. Open questions

- [ ] §4 Layout was filled in with what got built — confirm or change
- [ ] Strong smoothing: value for "higher feed forward smoothing" (80 used as a placeholder)
- [ ] Drone types: which ones, and what does each set?
- [ ] Browser presets (rates, OSD, ...): localStorage + JSON export/import OK?
- [ ] Disconnect / errors, Safety, Units in §5 are still unfilled
