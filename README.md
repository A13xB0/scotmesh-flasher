![ScotMesh Reticulum](https://raw.githubusercontent.com/ScotMesh/branding/main/networks/reticulum/readme-header.png)

# ScotMesh Flasher

The step-by-step web flasher at **[rnode.scotmesh.net](https://rnode.scotmesh.net)**:
flash, provision and configure **RNode radios** (markqvist's RNode firmware) and
**standalone microReticulum nodes** (the ScotMesh build of attermann's
microReticulum_Firmware) from Chrome or Edge on a desktop. No command line.

- Firmware is fetched from this site's own `/firmware/` mirror (GitHub release
  assets have no CORS headers). A timer on the server mirrors the newest
  releases hourly and writes `firmware/index.json`.
- Flashing: `lib/nrf52_dfu_flasher.js` (liamcottle, WebSerial port of
  `adafruit-nrfutil dfu serial`) for nRF52840 boards, `esptool-js` 0.4.5 for ESP32.
- Provisioning: EEPROM identity block + firmware hash, exactly what
  `rnodeconf --autoinstall` does. Verified with `CMD_HASHES` before continuing.
- Node configuration: radio profile + boot-into-transport over KISS, then the
  microReticulum **Provisioning** protocol (MsgPack over `CMD_PROVISION_REQ`)
  for transport/role, NomadNet name and the remote-management allow-list.
- "Reconfigure an existing node" connects over USB or Web Bluetooth (NUS)
  and skips flashing.

## Layout

| Path | What |
|---|---|
| `index.html` | shell + styles (same identity as scotmesh.net) |
| `src/app.js` | the wizard |
| `src/boards.js` | board catalogue: USB IDs, EEPROM codes, flash offsets, assets per family |
| `src/profiles.js` | the ScotMesh 433 / 868 radio profiles |
| `src/rnode.js` | KISS framing, RNode commands, Provisioning ops |
| `src/serial.js`, `src/ble.js` | WebSerial / Web Bluetooth transports |
| `src/firmware.js` | index, download, sha256, unzip, firmware-hash algorithms |
| `src/flash.js` | esptool-js and nRF52 DFU flows |
| `lib/` | vendored esptool-js, nrf52_dfu_flasher.js, zip.js |
| `console/` | redirect to the RNode Console of the latest mirrored release |
| `deploy.sh` | rsync to the server |

## Run locally

WebSerial needs HTTPS or `localhost`:

```
python3 -m http.server 8000
# open http://localhost:8000 in Chrome
```

`firmware/` is not in the repo; point a symlink at a copy of the mirror or let
the page fetch from the live site by editing `loadIndex()`.

## Licence

GPL-3.0. Includes code from liamcottle/rnode-flasher (MIT), esptool-js (Apache-2.0),
zip.js (BSD-3) and microReticulum_Firmware / RNode_Firmware (GPL-3).
