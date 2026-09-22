# ExpressLRS receiver: version and binding phrase from the configurator

Status: research only — **not planned for implementation** (decision 2026-09-22). Kept so the feature can be
picked up later without redoing the firmware reading.

Question: can the app read the ELRS receiver's firmware version and set its binding phrase?
Answer: yes for both, but not through Betaflight MSP. The path is Betaflight's serial passthrough, after which the
receiver answers CRSF frames itself. Betaflight then needs a power cycle.

Sources verified: Betaflight tag `2026.6.2` (API 1.48), ExpressLRS tags `4.1.0` (released 2026-07-17), `4.0.1`,
`3.5.5`, `3.4.3`.

## 1. What Betaflight exposes over MSP (2026.6.2)

- **Nothing about an external receiver.** `telemetry/crsf.c` pings the receiver once and only checks whether the
  DEVICE_INFO serial number starts with `ELRS` (`crsfHandleDeviceInfoResponse`), into a file-private flag. The
  receiver name and version fields are skipped. `msp.c` has no CRSF references. `CRSF_FRAMETYPE_PARAMETER_*`
  frames are not handled at all.
- `MSP_RX_CONFIG` carries 6 UID bytes + `modelId` (API 1.45/1.47), but they are the FC's **own SPI receiver**
  (`expresslrs_uid`, `rx/expresslrs.c`). Zero / discarded for a serial CRSF receiver.
- **Bind mode: `MSP2_BETAFLIGHT_BIND` (0x3000, no payload).** `startRxBind()` → `crsfRxBind()` writes one frame
  to the receiver UART: `C8 07 32 EC C8 10 01 9E E8` (COMMAND, subcmd RX 0x10, RX_BIND 0x01). Advertised as bit 6
  (`TARGET_SUPPORTS_RX_BIND`) of the capabilities byte in `MSP_BOARD_INFO`; `USE_RX_BIND` is on whenever CRSF is.
  Error reply if the provider isn't CRSF/SRXL2/SPI. Nothing confirms the receiver entered bind mode.
  CLI: `bind_rx`.
- **Serial passthrough: `MSP_SET_PASSTHROUGH` (245)** with payload `[0xFE, functionBitIndex]`
  (`MSP_PASSTHROUGH_SERIAL_FUNCTION_ID`; RX_SERIAL = bit 6) or `[0xFD, portIdentifier]`
  (`MSP_PASSTHROUGH_SERIAL_ID`). Reply: one byte, 1 = port found. The port must already be open (it is, for the
  receiver) and keeps its running baud — 420000 for CRSF; there is no baud parameter in the MSP form.
  After the reply is flushed the FC enters `serialPassthrough()` (`io/serial.c`): a `while (1)` byte copy loop.
  Scheduler, MSP and PID loop stop. Exits: power cycle / USB replug only. The `+++` escape in that function is
  disabled when the host side is USB VCP, and the DTR-reset callback exists only for the CLI
  `serialpassthrough <id> <baud> … reset` form.
- ExpressLRS' own tooling (`src/python/BFinitPassthrough.py`) uses the CLI form: `#`, checks
  `serialrx_provider` ∈ {CRSF, ELRS}, `serialrx_inverted = OFF`, `serialrx_halfduplex` ∈ {OFF, AUTO}, finds the
  port with function bit 64 in `serial`, then `serialpassthrough <port> 420000`. The docs end with "power-cycle
  the flight controller".

## 2. What the receiver accepts on its UART (ExpressLRS)

Parser (`src/lib/CrsfProtocol/CRSFParser.cpp`, 4.x): accepts sync bytes `C8`, `EA`, `EC`; CRC8 poly 0xD5 over
type..payload. Extended frames (type ≥ 0x28) addressed to `EC` (receiver) or `00` (broadcast) are handled locally;
others are forwarded over the air to the TX. Replies come back with sync byte `C8`. While in passthrough the
receiver keeps streaming RC channels (0x16) and link statistics (0x14) at 420000, so the PC needs a CRSF frame
parser and picks replies by type.

| Feature                 | Frame from the PC                                                                                                                                                                                                                                                                       | Firmware                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Firmware version**    | Device ping `C8 04 28 EC C8 5A` → DEVICE_INFO (0x29): `C8 len 29 C8 EC <name\0> serialNo(4) hardwareVer(4) softwareVer(4) fieldCnt(1) paramVersion(1) crc`. serialNo = `ELRS`, hardwareVer = 0, softwareVer big-endian packed version, e.g. `00 04 01 00` for 4.1.0 (`VersionStrToU32`) | 3.x and 4.x (checked 3.5.5, 4.1.0)              |
| Version + domain string | 4.x only: `PARAMETER_READ` (0x2C) of index = `fieldCnt`, chunk 0 → `PARAMETER_SETTINGS_ENTRY` (0x2B), an INFO field whose name is "version domain" and value the git commit (`RXParameters.cpp`, `luaELRSversion`)                                                                      | 4.x                                             |
| **Read UID**            | MSP over CRSF: `C8 09 7A EC C8 30 01 2D 00 49 CD` (MSP_REQ 0x7A, encapsulated `[0x30, size, function 0x2D, subcmd 0x00, mspCrc]`) → MSP_RESP (0x7B) `C8 0F 7B C8 EC 30 07 2D 00 u0 u1 u2 u3 u4 u5 mspcrc crc`                                                                           | **4.1.0+** only (absent in 3.4.3, 3.5.5, 4.0.1) |
| **Set binding phrase**  | MSP_WRITE (0x7C), function 0x2D, subcmd 0x01, ASCII phrase (≤ ~53 bytes). Example "myphrase": `C8 11 7C EC C8 30 09 2D 01 6D 79 70 68 72 61 73 65 83 B9`. Receiver hashes it, saves the UID and reboots itself after 200 ms. Empty payload clears the bind. No reply                    | **4.1.0+** only                                 |
| Set raw UID             | Same, subcmd 0x00 + 6 bytes                                                                                                                                                                                                                                                             | 4.1.0+                                          |
| Set model id            | Same, subcmd 0x0A + 1 byte; or raw `EC 05 32 6D 6D <id> crc` ("mm")                                                                                                                                                                                                                     | 3.x and 4.x                                     |
| Enter bind mode         | Raw `EC 04 32 62 64 23` ("bd"), or the CRSF command Betaflight sends (§1)                                                                                                                                                                                                               | 3.x and 4.x                                     |
| Bootloader              | Raw `EC 04 32 62 6C 0A` ("bl") — echoes the target name, then the RX only leaves it by power cycle. **Flashing is under Never; don't send this.**                                                                                                                                       | 3.x and 4.x                                     |

Code: `src/lib/rx-crsf/RXEndpoint.cpp` (`handleRaw`, `handleMessage`), `src/lib/CrsfProtocol/RxTxEndpoint.cpp`
(`handleMspGetRxTxConfig` / `handleMspSetRxTxConfig`), `src/lib/MSP/msptypes.h` (`MSP_ELRS_RXTX_CONFIG = 0x2D`,
subcmds `UID = 0`, `BIND_PHRASE = 1`, `MODEL_ID = 0x0A`), `src/lib/CrsfProtocol/CRSFEndpoint.cpp`
(`sendDeviceInformationPacket`). In 3.5.x the same ping/bind/bootloader handling lives in
`src/src/rx-serial/SerialCRSF.cpp` + `src/lib/Handset/CRSF.cpp`.

Not reachable from the UART: WiFi mode (`MSP_ELRS_SET_RX_WIFI_MODE` is handled only in the over-the-air path from
the TX Lua) and the over-the-air bind message `MSP_ELRS_BIND`.

## 3. Binding phrase vs UID

- The phrase is **never stored**; the receiver's web UI says so too. Only the 6-byte UID exists.
- UID = first 6 bytes of `MD5('-DMY_BINDING_PHRASE="<phrase>"')` (`config.cpp` `SetBindPhrase`, and
  `src/html/src/pages/binding-panel.js`). Example: "myphrase" → `[40, 170, 64, 190, 129, 219]`.
- A tool can only **confirm** a phrase the user types by hashing and comparing with the read-back UID.
- Receivers bound over the air (classic bind mode) have `uid[0] = uid[1] = 0` (only 4 bytes travel OTA).
- 4.x adds `Bind Storage` (Persistent / Volatile / Returnable / Administered); with Administered, bind mode is
  refused.

## 4. Alternative: the receiver's WiFi web API (`src/lib/WIFI/devWIFI.cpp`)

- `GET /config` → `settings.version`, `settings.target`, `settings["git-commit"]`, `settings.product_name`,
  `config.uid`, `settings.uidtype` (Bound / Not Bound / Volatile / Loaned). `POST /config {"uid": [...]}` sets
  the UID (hash in the browser), effective without reboot. `GET /options.json` also exposes the flashed uid and
  the home WiFi credentials in clear.
- CORS: global `Access-Control-Allow-Origin: *`, methods `POST,GET,OPTIONS`. A cross-origin GET works; the POST
  preflight (`OPTIONS /config`) has no explicit handler — unverified.
- Blockers for this app: the receiver must be in WiFi mode (auto-on timer `wifi-on-interval` or the TX Lua; nothing
  the FC can trigger), the PC must join the receiver's network (AP 10.0.0.1) or the RX must be on the home WiFi,
  and an https page can't call an http device (mixed content). Not a fit.

## 5. If this is ever built

- One "Receiver" action running inside `MspClient.exclusive` (like `lib/esc/io.ts`): `MSP_SET_PASSTHROUGH
[0xFE, 6]` → CRSF parser on the raw byte stream → ping (version) → read UID → optionally write phrase → tell the
  user to unplug the FC. The connection store's auto-reconnect can pick it back up after the replug
  (`lib/esc/io.ts` already has the "did not leave the passthrough" message).
- Preconditions to check first: `serialrx_provider = CRSF`, `serialrx_inverted = OFF`, `serialrx_halfduplex` ≠
  ON, a UART with function RX_SERIAL, and the receiver's UART baud = 420000 (`rcvr-uart-baud` option on the RX).
- Setting the phrase needs ExpressLRS ≥ 4.1.0: read the version first and report "unsupported, update the
  receiver" below that. Reading the version works on every 3.x/4.x receiver.
- The mock FC needs a simulated receiver behind the passthrough (device info + 0x2D handlers + a trickle of RC
  frames) so the mock-acceptance rule holds.
- Bind mode alone needs no passthrough: `MSP2_BETAFLIGHT_BIND` is enough.
- Needs a spec entry first (`docs/SPEC.md` §2 and a tab/section spec); it is not flashing, so it isn't under Never.
