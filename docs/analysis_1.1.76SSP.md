# EKG Pro Firmware Analysis — v1.1.76SSP

## Overview

| Field | Value |
|-------|-------|
| **Device** | Fellow EKG Pro (smart electric kettle) |
| **Chip** | ESP32 - https://www.espboards.dev/esp32/esp32-wroom/ |
| **SDK** | ESP-IDF v4.4 |
| **Firmware Version** | 1.1.76SSP |
| **Build Date** | May 9, 2024 13:53:38 |
| **Source Path** | `/home/lenovo/fellow/EKG_Pro/firmware/` |
| **Flash** | 8MB, 40MHz, DIO mode |
| **File Size** | 1,708,032 bytes (0x1A1040) |
| **Firmware image SHA256** | `15558f47b756a3930e9c290ef75b4e21bdd073ee3dc517f4731f05fa9fec9bff` |
| **Embedded ELF SHA256** | `1b21ef31bcb74393f8014396d09a575be06ce691c5a39323b7fdd23e487c9e22` |
| **Prev Version** | [v1.1.75SSP](./analysis.md) |

## Changes from v1.1.75SSP

v1.1.76SSP is a **significant feature update** over v1.1.75SSP, adding local firmware upload, RSA code signing, multi-language support, and factory reset.

### New Features

1. **Local HTTP Firmware Upload** — New `/upload` and `/uploadfw` HTTP endpoints with a browser-based upload page (`EKG Firmware Upload`). Supports uploading `ekg-firmware.bin` files up to 2 MB (`MAX_FILE_SIZE 0x200000`). State messages include "Already uploaded" and "Already in progress."

2. **RSA Code Signing for OTA** — Firmware updates are now RSA-signed and verified before installation. The OTA config JSON embeds the Starfield Root CA G2 certificate (`fwcert`) and a signature field (`sign`). Verification uses RSA-PSS (`rsa_pss_verify`), with timing logs: `OTA config OK. time: hash: %d us read sign: %d verif rsa: %d rsa_pss_verify: %d us total: %d us`. Error handling includes "New firmware corrupted" and "Bad sign string" / "No sign in iot config."

3. **Multi-Language UI** — Support for 8 languages with dedicated language selection menu. Languages include English, Spanish ("Agregar agua"), Simplified Chinese, Traditional Chinese, Korean, Japanese, French ("Langue"), and Portuguese ("Idioma"). Non-English languages may require a firmware upgrade: `FW UPGRADE NEEDED FOR NEW LANG.` Language assets: `Language/1-01.png` through `Language/7-01.png`.

4. **Factory Reset** — New factory reset UI with `factory reset - select.png` and `factory reset - cancel.png` screens. Triggered via CLI `factory` command.

5. **New Settings** — Altitude limit (`setaltitudef`, `setaltitudem`), chime (`chime`/`Chime`), hold time (`HOLD`), and units (`setunitsc`, `setunitsf`).

6. **HTTP Test Framework** — Built-in CLI commands for testing the remote firmware service (`httptest`, `httpfw`, `httpdwn`) with 6 test scenarios covering outbound `key` and `id` header combinations. These tests do not protect the local `/api` or `/cli` handlers.

7. **New CLI Commands**:
   - `httptest` — verify that HTTPS server follows rules
   - `httpfw` — download/install FW via HTTP
   - `httpdwn` — download file via HTTP and drop
   - `factory` — factory reset
   - `setaltitudef` / `setaltitudem` — altitude in feet/meters
   - `setunitsc` / `setunitsf` — temperature units
   - `settempr` — set temperature
   - `setsettingb` — boolean setting variant
   - `setsettingd` — double setting variant

### Certificate Changes

| Purpose | v1.1.75 | v1.1.76 |
|---------|---------|---------|
| Google Cloud TLS | GlobalSign ECC Root CA R4 | **GTS LTSR** (Google Trust Services Long Term Self-signed Root) |
| OTA Verification | None (unsigned) | **Starfield Root CA G2** (RSA) |
| TLS Chain | Single cert (GlobalSign ECC) | Two certs (GTS LTSR + GlobalSign ECC R4) |

### Segment Changes

| Segment | Load Address | v1.1.75 | v1.1.76 | Delta | Notes |
|---------|-------------|---------|---------|-------|-------|
| DROM | 0x3f400020 | 484,976 B | 563,272 B | **+78,296** | New strings, images, OTA cert |
| DRAM | 0x3ffbdb60 | 30,760 B | 26,536 B | −4,224 | Certs reorganized |
| DRAM | **0x3ffc4308** | *(none)* | **4,224 B** | **new** | TLSF heap data |
| IROM | 0x400d0020 | 942,332 B | 942,484 B | +152 | Minor code changes |
| IRAM | 0x40080000 | 8,528 B | 104,412 B | **+95,884** | Entry + functions merged |
| IRAM | 0x40082150 | 95,884 B | *(merged)* | −95,884 | Folded into segment 4 |
| RTC | 0x50000000 | 16 B | 16 B | 0 | Unchanged |
| PAD | 0x00000000 | 10,240 B | 62,864 B | +52,624 | Padding growth |
| **Total** | | **1,572,736 B** | **1,703,808 B** | **+131,072** | ~8.3% growth |

### New UI Assets (embedded PNGs)

| Asset | Purpose |
|-------|---------|
| `factory reset - select.png` | Factory reset confirmation |
| `factory reset - cancel.png` | Factory reset cancellation |
| `error screen - Downloading.png` | New OTA download error state |
| `Language/1-01.png` – `Language/7-01.png` | Language selection screens |
| `menu - altitude.png` | Altitude settings menu |
| `menu - chime.png` | Chime settings menu |
| `menu - hold.png` | Hold time settings menu |
| `clock - select analog.png` | Analog clock mode |
| `clock - select digital.png` | Digital clock mode |
| `clock - select off.png` | Clock off mode |
| `Finished.png` | Completion screen |

## BLE Interfaces

Firmware v1.1.76 exposes two distinct BLE mechanisms. They should not be
treated as one protocol:

1. **ESP-IDF Wi-Fi provisioning** uses protocomm Security 1 and the hardcoded
   proof-of-possession value `abcd1234`.
2. **Operational GATT configuration** exposes kettle settings and status after
   an ordinary BLE connection. This is the interface implemented by the
   third-party
   [`ekg-pro-ble-lib`](https://codeberg.org/breiflabb/ekg-pro-ble-lib/src/branch/main),
   principally
   [`kettle_ble.py`](https://codeberg.org/breiflabb/ekg-pro-ble-lib/src/branch/main/kettle_ble.py),
   examined at main-tree revision `347b6f34649a49c57cfa388e4c4fb14ec350c5b9`.

### Wi-Fi provisioning and PoP

The provisioning PoP `abcd1234` is present at firmware file offset `0x4df8`,
mapped into DROM at `0x3f404df8`. It is not a BLE pairing PIN, an operational
GATT password, or a dynamically generated per-device credential. The call at
`0x400d9d1d` is equivalent to:

```c
ekg_wifi_prov_mgr_start_provisioning(
    WIFI_PROV_SECURITY_1,
    "abcd1234",
    service_name,  // MAC-derived EKG service/device name
    NULL           // no BLE service key
);
```

The provisioning manager copies the eight-byte string into its Security 1
context. No per-device derivation or NVS lookup occurs on this path. The
provisioning JSON can carry Wi-Fi and cloud-IoT fields as documented under
"IoT Config Keys (NVS)."

### Operational GATT service

A read-only live capture identifies the operational service as:

```text
7aebf330-6cb1-46e4-b23b-7cc2262c605e
```

The previously reported service UUID
`00001820-0000-1000-8000-00805f9b34fb` was not present on the tested
v1.1.76SSP device and is superseded by the live result. The second observed
service, `021a9004-0382-4aea-bff4-6b3f1c5adfb4`, is not another operational
kettle protocol. Static recovery identifies it as a legacy ESP-IDF
protocomm/Wi-Fi-provisioning transport; its five characteristics are audited
below.

All nine operational characteristics use the base UUID
`2291c4bX-5d7f-4477-a88b-b266edb97142`. Their consolidated static and live
mapping appears below under “Operational GATT findings.” The third-party
`ekg-pro-ble-lib` uses only `c4b5`.

### Wi-Fi provisioning GATT service

When Wi-Fi provisioning is active, ESP-IDF protocomm exposes the following
service and endpoint characteristics:

Service UUID:

```text
1775244d-6b43-439b-877c-060f2d9bed07
```

| Characteristic UUID | Protocomm endpoint | Function |
|---------------------|--------------------|----------|
| `1775ff50-6b43-439b-877c-060f2d9bed07` | `prov-scan` | Wi-Fi access-point scanning |
| `1775ff51-6b43-439b-877c-060f2d9bed07` | `prov-session` | Security-1 session establishment |
| `1775ff52-6b43-439b-877c-060f2d9bed07` | `prov-config` | Wi-Fi configuration and status |
| `1775ff53-6b43-439b-877c-060f2d9bed07` | `proto-ver` | Protocomm protocol-version exchange |

These provisioning characteristics use encrypted read/write access under
Security 1. The proof-of-possession value is `abcd1234`; it is not an
operational GATT password.

The image also contains the legacy provisioning service observed in the live
capture:

```text
021a9004-0382-4aea-bff4-6b3f1c5adfb4
```

Its initialized NimBLE definitions at `0x3ffbeff8`--`0x3ffbf068` map all five
characteristics to the shared access callback at `0x400d6bbc`:

| Characteristic UUID | Endpoint | Recovered purpose |
|---------------------|----------|-------------------|
| `021aff50-0382-4aea-bff4-6b3f1c5adfb4` | `prov-scan` | Wi-Fi access-point scanning |
| `021aff51-0382-4aea-bff4-6b3f1c5adfb4` | `prov-session` | Protocomm security session |
| `021aff52-0382-4aea-bff4-6b3f1c5adfb4` | `prov-config` | Wi-Fi configuration and status |
| `021aff53-0382-4aea-bff4-6b3f1c5adfb4` | `proto-ver` | Protocol-version exchange |
| `021aff54-0382-4aea-bff4-6b3f1c5adfb4` | `prov_cst` | Application Wi-Fi station-password field |

The callback resolves the UUID to endpoint index 0--4 and calls the
protocomm request dispatcher at `0x400ee694`. The application creates
`prov_cst` at `0x400d9d00` and registers handler `0x400db2f4` at
`0x400d9d39`. That handler accepts read/write operation types 0 and 1, then
calls `0x400dacd8` through wrapper `0x400db2e0`. The recovered decoder passes
offset `0x20` and NUL termination to the 64-byte Wi-Fi password field, while
the outer function accepts at most `0x3f` payload bytes. Those bounds select
`wifi_config_t.sta.password`; the adjacent firmware diagnostics are
`esp_wifi_get_config`, `too long pw`, `saved pw`, and
`esp_wifi_set_config`. This endpoint does not call the kettle controller,
write its input counters, post a kettle-state event, or invoke a heat
primitive.

### Operational settings characteristic

The Codeberg library connects with Bleak, enables notifications, and reads and
writes this characteristic directly:

```text
2291c4b5-5d7f-4477-a88b-b266edb97142
```

Firmware data at file offset `0x6adfd` contains the corresponding little-endian
128-bit UUID. The GATT handler at `0x400e9b44` dispatches the `...c4b5...`
characteristic as follows:

- **Read:** calls the settings-record builder at `0x400d8274` and returns 17
  bytes.
- **Write:** requires a 17-byte value and passes it to the settings parser at
  `0x400d83a0`.
- **Notify:** emits the same settings record when settings change. The library
  notes that these notifications follow menu/configuration changes, not live
  heating or temperature changes.

These are the same builder and parser used by HTTP `/api` record type `t=3`.
BLE and `/api?t=3` are therefore two transports for the same `RT_Settings`
record, not independent command implementations.

| Byte(s) | Codeberg interpretation | Firmware-backed interpretation |
|---------|-------------------------|--------------------------------|
| `0` | Flags; bit `0x08` enables schedule | Low byte of the settings mask; `0x08` is the schedule value bit |
| `1` | Bit `0x02` Celsius; bit `0x08` pre-boil | High mask byte containing units and pre-boil value bits |
| `2-3` | Altitude in meters | Raw little-endian altitude setting |
| `4-5` | Byte 4 is half-degree Celsius; byte 5 unknown | One raw 16-bit target-temperature encoding, including unit/format state |
| `6-7` | Scheduled temperature; byte 7 unknown | Raw 16-bit scheduled-temperature encoding |
| `8-9` | Schedule minute, hour | Schedule minute, hour |
| `10-11` | Clock minute, hour | Clock minute, hour |
| `12` | Clock mode: off/digital/analog | Clock mode: `0`, `1`, or `2` |
| `13` | Hold time in minutes | Hold time in minutes |
| `14` | Chime volume | Chime value |
| `15` | Language | Language ID |
| `16` | Write counter; bit 3 also interpreted as schedule mode | Settings ordinal/counter; a schedule-mode role is not confirmed by the shared parser |

The library performs read-modify-write operations on the complete 17-byte
record and increments byte 16 before every write. It exposes methods for target
temperature, units, clock, chime, pre-boil, hold time, altitude, schedule, and
language.

### Library limitations and discrepancies

The Codeberg implementation is useful experimental documentation, but several
parts should not be treated as a complete protocol specification:

- Its
  [README](https://codeberg.org/breiflabb/ekg-pro-ble-lib/src/branch/main/readme.md)
  explicitly says that real-time controls have not been unlocked; it is a
  settings/configuration library, not a heating controller.
- Target temperature is decoded from byte 4 alone as half-degree Celsius. The
  firmware treats bytes 4-5 as one raw 16-bit temperature value, so the helper
  is safest only for the encoding/state in which it was tested.
- `set_schedule()` writes bytes 6, 8, and 9, but the shared firmware parser has
  no direct write branch for scheduled temperature or time. It can change the
  schedule-enabled mask bits; the remaining schedule behavior is experimental.
- `set_schedule()` also modifies bit 3 of byte 16 and then `_write_state()`
  replaces byte 16 with `counter + 1`, so its requested once/daily bit is not
  reliably preserved.
- The language enum covers English, French, Spanish, Simplified Chinese, and
  Traditional Chinese only; Korean and Japanese are left unresolved. Its
  unknown-language path also ends with `return Non`, a source-level bug.

### Operational GATT findings

This follow-up used a clean, disposable Ghidra project imported from the
unmodified image. Its SHA-256 is
`15558f47b756a3930e9c290ef75b4e21bdd073ee3dc517f4731f05fa9fec9bff`;
the ESP application metadata reports embedded ELF SHA-256
`1b21ef31bcb74393f8014396d09a575be06ce691c5a39323b7fdd23e487c9e22`.
The ESP32 Flash Image loader identified Xtensa LE 32-bit and ESP-IDF v4.4.
Ghidra 12.1.2 and Temurin 21 were used. The reusable export script is
[`ghidra_scripts/ExportBleControlPaths.java`](./ghidra_scripts/ExportBleControlPaths.java).
It may create missing function boundaries only in a disposable analysis
database; it does not alter the firmware image.

The registration descriptors at DRAM `0x3ffbef08` through `0x3ffbefdc`
establish that all nine UUIDs are real GATT entries using the same access
callback, `0x400e9b44`; they are not UUID-table padding. The raw property words
retain implementation bits. Their low NimBLE bits correspond to read (`0x2`),
write (`0x8`), and notify (`0x10`), and the live properties agree.

| UUID | Static flags | Live properties / read result | Static handler and control classification |
|---|---:|---|---|
| `c4b1` | `0x212` | read, notify; 16 zero bytes | Copies the saved 16-byte record. Status only; no write path. |
| `c4b2` | `0x212` | read, notify; ATT `0x0e` “Unlikely Error” | Registered at `0x3ffbef20` but has no case in `0x400e9b44`. Application-layer orphan, not a control. |
| `c4b3` | `0x212` | read, notify; ATT `0x0e` “Unlikely Error” | Registered at `0x3ffbef38` but has no dispatcher case. Application-layer orphan, not a control. |
| `c4b4` | `0x120a` | read, write; 39-byte status record | Read uses `0x400da94c`. An exact 8-byte write passes through `0x400d711c` to `0x400dcccc` as `RT_Params`; type 6 directly controls GPIO 25 duty without a state transition, while type 7 posts only to the Wi-Fi/provisioning `EKG_EVENTS` loop. No kettle heat-state edge was found. |
| `c4b5` | `0x121a` | read, write, notify; 17-byte settings record | Builder `0x400d8274`, parser `0x400d83a0`; shared with HTTP record type 3. Configuration only; no direct event/GPIO edge. |
| `c4b6` | `0x1218` | write, notify; not readable | The callback contains a two-byte read-operation branch, but the attribute does not advertise read and its analyzed write branch rejects the request. No usable control path identified. |
| `c4b7` | `0x120a` | read, write; `1.1.76SSP C` plus padding (32 bytes) | Read helper `0x400d9c8c`. Writes of 2–1024 bytes copy to `0x3ffd1070`; no other reference to that buffer or edge to events/GPIO/PWM was found. Firmware identity; write consumer unresolved. |
| `c4b8` | `0x2` | read; `EKG-2d-10-f0` (12 bytes) | Dynamic string read via `0x400efaa4` and `strlen`. Advertised BLE logical name; no control path. |
| `c4b9` | `0x2` | read; `24:DC:C3:2C:10:F0\0` (18 bytes) | Identity builder `0x400d53b4`, followed by callback `0x401aa210`; the static `0x3a` is buffer capacity, not the returned length. Bluetooth/BLE MAC identity; no control path. |

This resolves `c4b2` and `c4b3` as registered-but-unimplemented, `c4b7` as a
firmware-identity read with an unrelated unresolved write buffer, `c4b8` as
the advertised name, and `c4b9` as the Bluetooth identity address.

#### Live identity and Wi-Fi/Bluetooth MAC relationship

The read-only capture was made on 2026-08-14 from the device advertising as
`EKG-2d-10-f0`. The device owner independently confirmed its Wi-Fi MAC as
`24:DC:C3:2D:10:F0`; `c4b9` returned `24:DC:C3:2C:10:F0`.

| Identity | Value | Evidence |
|---|---|---|
| Wi-Fi interface | `24:DC:C3:2D:10:F0` | Confirmed independently from the device/network. |
| Advertised BLE logical name | `EKG-2d-10-f0` | Live scan and `c4b8` read; its suffix matches the final three Wi-Fi-MAC octets. |
| Bluetooth/BLE interface | `24:DC:C3:2C:10:F0` | Live `c4b9` read; adjacent to, but distinct from, the Wi-Fi address. |
| macOS CoreBluetooth identifier | `9C7DE1ED-0A36-E499-C697-D409EA1BBBF8` | Host-local opaque identifier used for the connection, not a hardware MAC. |

Because macOS hides the peer's over-the-air BLE address behind its opaque
CoreBluetooth identifier, the scan cannot independently compare that address
with `c4b9`. Nevertheless, the characteristic's identity role, its
colon-separated address value, and its distinction from the independently
confirmed Wi-Fi MAC support the Bluetooth/BLE-MAC interpretation with high
confidence. The `2c` versus `2d` octet difference must not be normalized away:
these are two distinct interface addresses.

#### Control paths and quarantine boundary

`c4b4 → 0x400dcccc` (`RT_Params`) is a write-capable operational route, but
its type 7 action does **not** share the kettle heat-state machinery. It calls
`esp_event_post(EKG_EVENTS, value, NULL, 0, 0)`, where `EKG_EVENTS` is the
Wi-Fi/provisioning event base documented below. Type 6 calls `0x400dc0e8` and
then the recovered GPIO 25 duty helper `0x400dbb28`; types 1 and 2 change the
temperature target. Thus a direct BLE duty path exists, but no BLE
**state-machine** heat-control path has been established. The type-6 path
bypasses `S_Heat`/`S_HeatOff` and is quarantined as a direct actuator control;
no event value or write payload is approved for heating.

The CLI paths are separate low-level controls, registered in DROM at
`0x3f40f418`:

| CLI command | Handler | Documented physical target | BLE relationship |
|---|---:|---|---|
| `heaton` | `0x400d6960` | `gpio_set_direction(27, output)` then `gpio_set_level(27, 1)` | No `c4b1`–`c4b9` path reaches it. |
| `heatoff` | `0x400d6930` | `gpio_set_direction(27, output)` then `gpio_set_level(27, 0)` | No `c4b1`–`c4b9` path reaches it. |
| `warmon` | `0x400d6900` | Direct `WARM` output high | No `c4b1`–`c4b9` path reaches it. |
| `warmoff` | `0x400d68d0` | Direct `WARM` output low | No `c4b1`–`c4b9` path reaches it. |
| `warmduty` | `0x400e86dc` | Direct WARM PWM duty | No `c4b1`–`c4b9` path reaches it. |

No `warman` command string is present in v1.1.76SSP; the registered command
is `warmon`.

Correctly aligned raw Xtensa disassembly recovers both short CLI handlers past
the logging call and proves their GPIO 27 direction/level calls. These direct
controls remain quarantined; they are not exposed by the inspection utility.

#### Event-ID recovery status

The follow-up headless export was rerun against the preserved image in a
disposable Ghidra project using Ghidra 12.1.2 / Xtensa LE 32-bit. Correcting
the executable segment mapping and manually following the indirect call
recovers the complete transport edge:

```text
gatt_dispatch (0x400e9b44)
  -> exact 8-byte bounded write
  -> RT_Params wrapper (0x400dcccc / 0x400dcf44)
  -> type 7
  -> esp_event_post (0x401b3c00)
       (EKG_EVENTS, value, NULL, 0, 0)
  -> Wi-Fi/provisioning handler (0x400e7c4e)
```

The event-base object at `0x3ffc0c40` points to the string `EKG_EVENTS`. Its
handler has this recovered ID map:

| Event ID | Action |
|---:|---|
| `0` | `C_WiFiStop` |
| `1` | `C_WiFiStartSoftAP` |
| `2` | `C_WiFiStartSta` |
| `3` | `C_WiFiEraseAll` |
| `4` | `C_WiFiEraseStaOnly` |
| `5` | `C_ProvStart` |
| `6` | `C_ProvStop` |
| `7` | `C_WiFiOn`, selecting station or AP behavior by mode |
| other | Unknown-event log path |

The kettle state-name table is independent: state `5` is `S_Heat` and state
`6` is `S_HeatOff`, at string addresses `0x3f40f1ba` and `0x3f40f1c1`. These
state numbers are not event IDs. The large controller beginning at
`0x400e55d4` explicitly assigns state 5 near `0x400e701e` and state 6 near
`0x400e7028`/`0x400e7030`.

The controller consumes local input as six byte-counter deltas. It subtracts
saved counters at kettle-object offsets `0x74`--`0x79` from input-snapshot
counters at offsets `0x1a`--`0x1f`, then stores the deltas at stack offsets
`0xc0`--`0xc5`. In the order established by the CLI input descriptors and
their counter-increment stubs, these are button 1 down, button 1 up, button 1
short, button 2 down, button 2 up, and button 2 short. A concrete guarded start
edge is now recovered: while the current state is `S_Hold` (7), either the
button-2-up delta or the button-2-short delta is accepted at
`0x400e6c61`--`0x400e6c6d`, after which `0x400e701e`--`0x400e7025` commits
`S_Heat` (5). This is a local UI-counter transition, not an event dispatcher
and not an `RT_Params` payload.

An all-service BLE audit found no alternate route to this edge. The nine
operational `c4b1`--`c4b9` characteristics either terminate in
status/settings/identity handling, the unrelated `EKG_EVENTS` Wi-Fi loop, or
the quarantined raw GPIO 25 duty path. Both provisioning UUID families
terminate in protocomm Wi-Fi scan, session, configuration, version, or the
`prov_cst` password-field handler described above. None calls the sole kettle
controller entry at `0x400e55d4` or the sole state-5 predecessor at
`0x400e6c6d`.

The same audit covered the guarded `S_HeatOff` assignments. State 6 at
`0x400e7028` is reached only when internal flag `0x3ffcfb80` is nonzero;
state 6 at `0x400e7030` is reached only when internal flag `0x3ffcfb82` is
zero. All recovered writers of those flags are internal controller blocks:
`0x400e611c`, `0x400e6b58`, and `0x400e750a` for the first flag, and
`0x400e58ae`, `0x400e60d1`, and `0x400e6b4c` for the second. The
`0x400e750a` block jumps back into the controller at `0x400e6888`; none of
these writers has a BLE callback edge. A BLE settings change may alter data
subsequently consumed by normal controller policy, but no BLE path synthesizes
the required button deltas, writes either stop flag, or directly selects
state 5 or 6.

The common branch taken from `S_Standby`, `S_Heat`, and `S_Hold` to
`0x400e7018` must not be called a heat-off event. It commits a next-state value
already held in `a15`, loaded from `0x3ffcf900`. Cross-references recover only
two writers: `0x400e63db` stores `1`, and `0x400e6434` stores `0`. The full
state-name table identifies state 0 as `S_Off` and state 1 as
`S_StartupToTempr`; the branch therefore never directly selects
`S_HeatOff` (6). Its guard combines normalized internal activity/lock state
derived from object fields `0x68`, `0x69`, and `0x6b` with a second
enable/result flag.

The inputs selecting this override are now identified as OTA lifecycle flags.
The HTTPS OTA worker sets `0x3ffcfb97` to 1 when OTA begins, sets
`0x3ffcfb95` to 1 only on the `ESP_HTTPS_OTA upgrade successful` path, and
sets `0x3ffcfb96` to 1 on begin, image-validation, incomplete-receive, or
finalization failures. The UI controller then performs three distinct actions:

| OTA condition | Controller action |
|---|---|
| Start flag `0x3ffcfb97 == 1`, override currently 0 | Store override 1 (`S_StartupToTempr`) at `0x400e63db` |
| Success flag `0x3ffcfb95 == 1` | Clear success/start flags and store override 0 (`S_Off`) at `0x400e642f`--`0x400e6443` |
| Failure flag `0x3ffcfb96 == 1`, override currently 1 | Clear failure/start flags and override, then explicitly store state 12 (`S_OTA_Abort`) at `0x400e64f3`--`0x400e6519` |

The adjacent firmware logs are `OTA STARTED CHANGING SCREEN`,
`OTA FINSHED CHANGING SCREEN`, and `OTA ABORTED CHANGING SCREEN`. Thus the
`S_Off`/`S_StartupToTempr` selector is OTA screen/state coordination. It is
not a local heat-stop selector, an `EKG_EVENTS` ID, or a BLE payload field.

`S_Heat` asserts GPIO 2 at `0x400e69c2`. This is a display-backlight action,
not a heater relay action. In the controller's explicit backlight update at
`0x400e6692`--`0x400e66c9`, object byte `0xaa` is compared and updated, the
firmware emits `Enable backlight` or `Disable backlight`, GPIO 2 is configured
as an output, and that same byte is written to GPIO 2. The common controller
also writes a computed backlight state to GPIO 2 at `0x400e57b3`.

Neither normal state handler directly calls the GPIO 27 primitive. The
separate kettle PID loop emits its
`PID OP` / `heat_warm_on` log near `0x400eb322` and computes PID output through
`0x400e9258`; that output is retained in kettle-object fields at this stage.
Later in the same periodic worker, a signed duty command is loaded near
`0x400eb3d9` and passed at `0x400eb5d6` to `0x400dbb28`. The helper drives
GPIO 25 low for demand `<= 0`, drives GPIO 25 high for demand `>= 100`, and for
demand `1..99` computes and stores an intermediate switching interval. Its
wrapper at `0x400dbbd0` supplies the kettle singleton and forwards the demand.
The shared partial-duty state is an active byte at `0x3ffd02fc` plus timing
values at `0x3ffd0300`--`0x3ffd0308`. IRAM code tests the active byte and calls
`gpio_set_level(25, 1)` at `0x40084879`, loads the elapsed interval at
`0x40084894`, then configures/arms the hardware timer. Timer ISR `0x400847f4`
acknowledges the timer-group interrupt, calls `gpio_set_level(25, 0)` at
`0x40084835`, and rearms the alarm. This completes the normal periodic path
from duty demand to the final switched GPIO 25 primitive for 0%, partial, and
100% output.

Manufacturing self-test code resolves the remaining GPIO 25/27 terminology.
The `TRIGERRING RELAY` diagnostic at `0x400e3c07` is immediately followed by
`gpio_set_level(27, 1)` at `0x400e3c0f`; `TURNING RELAY OFF` at `0x400e3888`
is immediately followed by `gpio_set_level(27, 0)` at `0x400e388f`.
Device calibration repeats the relay-on operation at `0x400e4f46`--
`0x400e4f4d`. After the self-test turns that relay off, it calls the GPIO 25
duty helper with value 35 at `0x400e3892`--`0x400e3894` and then logs `TRIAC
ON AT 35 PERCENT DUTY CYCLE` at `0x400e38a7`. This identifies GPIO 27 as the
relay-control output and GPIO 25 as the triac/PWM output in the firmware's own
manufacturing vocabulary. Exact electrical connectivity remains subject to
schematic or continuity confirmation, but the intended software/net roles are
no longer ambiguous.

The CLI has two independent output pairs, not one: `warmoff`/`warmon` at
`0x400d68d0`/`0x400d6900` directly control GPIO 25, whereas
`heatoff`/`heaton` at `0x400d6930`/`0x400d6960` directly control GPIO 27.
Normal state handlers and the periodic PID worker do not directly call GPIO
27; the other recovered direct GPIO 27 sites belong to initialization and
relay calibration/test sequences. The CLI naming therefore separates coarse
`HEAT` relay control on GPIO 27 from modulated `WARM` triac duty on GPIO 25;
it does not identify a kettle state or BLE event namespace. `warm_isr_intrv`
and `read_temp` are names attached
to linked diagnostic/timing objects near `0x400ebde6`, not sufficient evidence
of callback registration. These distinctions keep the direct CLI controls,
normal duty control, and BLE type-7 event loop as separate control planes.

Accordingly, the proposed c4b4 heat event IDs do not exist: the candidate has
been **disproved**, rather than merely left numerically unresolved. No BLE
payload, event probe, or experimental write utility is included. The existing
[`inspect_ble.py`](../scripts/inspect_ble.py) remains permanently read-only,
and any controlled-write phase must wait for discovery and independent review
of a different, statically proven heat-state route.

#### Read-only baseline capture

```bash
uv run --with bleak scripts/inspect_ble.py --address <BLE-ADDRESS> --output ble-baseline.json
```

The utility inventories services, characteristics, properties, and
descriptors, and reads only target characteristics advertising `read`. It
never subscribes and contains no write method, write flag, or heater command.
Use `--no-read` for metadata only. No live BLE writes, notification
subscriptions, or heater activation occurred during this investigation.

The successful live baseline produced these exact readable values:

| UUID | Length | Hex |
|---|---:|---|
| `c4b1` | 16 | `00000000000000000000000000000000` |
| `c4b4` | 39 | `c0a808c471006c61623132362d6b32000000000000000000000000000000000000000000000006` |
| `c4b5` | 17 | `f7170080c600c08000003309010f060004` |
| `c4b7` | 32 | `312e312e373653535020430000000000ffff3fb3000000000000000000000000` |
| `c4b8` | 12 | `454b472d32642d31302d6630` |
| `c4b9` | 18 | `32343a44433a43333a32433a31303a463000` |

Reads of `c4b2` and `c4b3` returned ATT error `0x0e`; `c4b6` was not read
because it does not advertise the read property. The capture performed no
notification subscriptions or writes.

## Architecture

- **HTTP Server** — Local control API with `/api`, `/cli`, `/upload`, `/uploadfw` endpoints
- **Google Cloud IoT Core** — MQTT over TLS for cloud connectivity
- **BLE Provisioning** — WiFi credentials provisioned via BLE (protocomm)
- **OTA Updates** — Firmware updates via Google IoT + HTTP download, now with RSA code signing; also local upload via `/uploadfw`
- **LVGL** — Touch display UI (TFT via SPI), with PNG decoding (`pngle_new`, `/upng`)
- **PID Temperature Control** — PID loop for precise water heating
- **Buzzer** — PWM-driven audio alerts
- **NVS** — Non-volatile storage for device settings

## Cloud Connectivity

### MQTT Broker

- **Hostname**: `mqtt.2030.ltsapis.goog` (Google Cloud IoT Core)
- **TLS Root CA**: GTS LTSR (Google Trust Services Long Term Self-signed Root)
- **Authentication**: JWT tokens signed with device private key
- **Device Path**: `projects/%s/locations/%s/registries/%s/devices/%s`

### MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `/devices/%s/config` | ↓ Subscribe | Device configuration updates |
| `/devices/%s/commands/#` | ↓ Subscribe | Cloud commands |
| `/devices/%s/state` | ↑ Publish | Device state reporting |
| `/devices/%s/events` | ↑ Publish | Device events |

### Firmware OTA Server

- **Base URL**: `https://qhderznbzup.firmware.fellowproducts.com`
- **Endpoints**:
  - `GET /get_ota_device_firmware` — Download firmware (requires `id`, `mac`, `fwv`, `User-Agent` headers)
  - `POST /confirm_firmware_install` — Confirm successful OTA install
  - `POST /set_firmware_time` — Sync device clock

### OTA Config JSON (embedded)

The firmware contains an embedded JSON configuration:

```json
{
  "fwp": "0.0.76",
  "fwurl": "https://qhderznbzup.firmware.fellowproducts.com/get_ota_device_firmware",
  "fwcert": "<base64-encoded Starfield Root CA G2 (RSA)>",
  "sign": "<RSA-PSS signature for OTA verification>"
}
```

- `fwp` — Firmware patch version
- `fwurl` — OTA download endpoint
- `fwcert` — CA certificate for verifying firmware signatures (Starfield Root CA G2, wrapped in custom TLV format)
- `sign` — Signature block used to verify downloaded firmware images

### IoT Config Keys (NVS)

The device-specific IoT credentials are provisioned at runtime and stored in
the default NVS partition under namespace `EKG`. They use the NVS **BLOB** type,
not `NVS_TYPE_STR`: the writer at `0x400decc8` calls the four-argument
`nvs_set_blob` implementation at `0x40139f60`, and the reader at `0x400d7b94`
uses `nvs_get_blob` at `0x4013a03c` (`NVS_TYPE_BLOB`, value `0x41`). The nearby
diagnostic strings call these operations `nvs_set_str`/`nvs_get_str`, but that
is not the type actually passed to NVS.

| Key | NVS type | Description |
|-----|----------|-------------|
| `iotkey` | BLOB | Device private key used to create the Google IoT JWT |
| `iotprj` | BLOB | Google Cloud project ID |
| `iotrgn` | BLOB | Google Cloud region |
| `iotreg` | BLOB | Google Cloud device-registry ID |

The provisioning JSON handler at `0x400ded3c` accepts these fields alongside
the Wi-Fi `ssid` and `pw` fields:

```json
{
  "ssid": "<Wi-Fi SSID>",
  "pw": "<Wi-Fi password>",
  "iotkey": "<device private key>",
  "iotprj": "<cloud project>",
  "iotrgn": "<cloud region>",
  "iotreg": "<device registry>"
}
```

The parser decodes quoted JSON strings in place and writes the decoded bytes
with their explicit lengths; the terminating NUL is not part of the stored
BLOB. Each IoT field may be omitted from an individual update, in which case
the handler logs `no <key>` and leaves that item unchanged. Cloud startup reads
indices 4 through 7 in the order shown above and requires every value to exist
and be non-empty before starting the IoT task (`0x400e78e0`).

Only the key names and handling code can be extracted from
`firmware_1.1.76SSP.img`. Its app image contains no device-specific values or
NVS partition, so the private key, project, region, and registry values cannot
be recovered from this file. Recovering actual values requires an NVS flash
dump from a provisioned kettle; the relevant lookup is namespace `EKG`, keys
`iotkey`, `iotprj`, `iotrgn`, and `iotreg`, type BLOB.

## HTTP API (Local)

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api` | GET/POST | Compact query string plus binary real-time records |
| `/cli` | GET | HTML form and arbitrary registered CLI commands |
| `/upload` | GET | Firmware upload page (HTML) |
| `/uploadfw` | POST | Upload firmware binary (max 2 MB) |

The static URI descriptors map both `GET /api` and `POST /api` directly to the
handler at `0x400dd028`. `GET /cli` maps to `0x400ea154`.

### Authentication Scope

No `key`, `id`, authorization-header, or other authentication check occurs in
the local `/api` or `/cli` handlers before commands are dispatched. The
`httptest` cases involving `key` and `id` exercise the **outbound client for the
remote firmware-download service**, not the local server. The local endpoints
should therefore be treated as unauthenticated LAN control surfaces.

### `/api` Wire Protocol

Despite its name, `/api` does **not** parse or emit JSON. Sending a JSON object
as the request body does not provide a supported command format. Requests use
five ordered, base-10 query fields and, for writes, a packed little-endian
binary body:

```text
GET /api?i=<ip>,p=<port>,d=<duration>,t=<record-type>,s=<session>
```

The fields must appear in exactly that order. Each value is parsed with
base-10 `strtol`; reordered, omitted, hexadecimal, or non-numeric fields fail
parsing.

| Field | Meaning |
|-------|---------|
| `i` | Packed IPv4 destination used for real-time notifications |
| `p` | Notification destination port; truncated to 16 bits |
| `d` | Notification lifetime in seconds; stored internally as `d * 1000` ms |
| `t` | Record selector: `-1`, `3`, `4`, or `5` |
| `s` | Client session number; a change resets ordinal/replay tracking |

The request-body read is capped at `0x400` (1024) bytes and is performed only
once. The handler does not use `Content-Type` to choose a decoder.

#### Record selectors

| `t` | GET behavior | POST/write behavior |
|-----|--------------|---------------------|
| `-1` | No record; refreshes destination/session timing and returns `OK` | Same |
| `3` | Returns the 17-byte `RT_Settings` record | Requires exactly 17 bytes and applies fields selected by its change mask |
| `4` | Returns a 39-byte status snapshot | Rejected as a bad request |
| `5` | Processes an `RT_Params` body; method is not otherwise significant | Processes an `RT_Params` body |
| other | Bad request | Bad request |

Successful GET record requests return the raw bytes directly. Successful
non-record operations return the two-byte text `OK`. Invalid selectors,
record sizes, or parameter types produce HTTP `400 Bad request`; a negative
`httpd_req_recv` result aborts the request.

#### `t=3`: 17-byte `RT_Settings`

All multi-byte fields are little-endian. GET constructs a mask of `0x15f7`
and adds the current boolean-value bits. POST requires exactly 17 bytes but
only applies fields whose corresponding "present" bits are set.

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 2 | Change/presence mask and embedded boolean values |
| `0x02` | 2 | Altitude setting, encoded as the kettle's raw 16-bit setting |
| `0x04` | 2 | Target temperature in the kettle's raw 16-bit encoding (including its unit/format flag) |
| `0x06` | 2 | Scheduled target temperature in the same raw encoding |
| `0x08` | 2 | Scheduled time (`minute`, `hour`) |
| `0x0a` | 2 | Clock time (`minute`, `hour`) |
| `0x0c` | 1 | Clock mode: `0` off, `1` digital, `2` analog |
| `0x0d` | 1 | Hold time in minutes |
| `0x0e` | 1 | Chime volume |
| `0x0f` | 1 | Language ID |
| `0x10` | 1 | Settings ordinal/counter |

Mask bits:

| Bit/mask | POST meaning |
|----------|--------------|
| `0x0001` | Apply altitude |
| `0x0002` | Apply target temperature |
| `0x0004` / `0x0008` | Apply schedule-enabled flag / enabled value |
| `0x0010` | Apply clock time |
| `0x0020` | Apply clock mode |
| `0x0040` | Apply hold time |
| `0x0080` | Apply chime volume |
| `0x0100` / `0x0200` | Apply temperature units / Celsius value |
| `0x0400` / `0x0800` | Apply pre-boil / enabled value |
| `0x1000` | Apply language |

The scheduled temperature/time fields are included in GET snapshots, but the
17-byte POST parser has no direct write branch for offsets `0x06` or `0x08`.

#### `t=4`: 39-byte status snapshot

The GET path calls the function identified by the embedded assertion text
`wifins::WiFi::copy_status_to_record(StatusRecord*)` at `0x400da94c` and sends
39 bytes:

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | Status timestamp/sequence word |
| `0x04` | 2 | Status-record counter |
| `0x06` | 32 | Saved `StatusRecord` payload |
| `0x26` | 1 | Current global status flag |

The firmware copies the 32-byte payload as an opaque block. Its individual
members cannot be named confidently from this stripped image alone; consumers
should preserve the layout rather than treating it as JSON or text.

#### `t=5`: 8-byte `RT_Params`

The body is at least eight bytes. Additional bytes are ignored:

```c
struct RT_Params {
    int16_t type;
    int16_t ordinal;
    int32_t value;
};
```

If the saved ordinal is not `-1`, a record is accepted only when its signed
16-bit ordinal is strictly greater than the last accepted ordinal. Equal and
lower ordinals are ignored but still treated as successful requests. A changed
query session (`s`) resets the saved ordinal to `-1`. BLE and HTTP `t=5` use
the same parser singleton and therefore share this session/ordinal state.

| Parameter `type` | Effect of `value` |
|------------------|-------------------|
| `0` | Session/ordinal synchronization; a changed value resets ordinal tracking |
| `1` | Set target temperature using the raw 16-bit temperature encoding |
| `2` | Decode the current target in the active units, add signed `value`, and encode/store the result |
| `3` | Set notification interval for record type 3 (`RT_Settings`) |
| `4` | Set notification/status period for record type 4; this is the same internal setting used by CLI `tstprd` |
| `5` | Set notification interval for record type 5 (`RT_Params`) |
| `6` | Direct GPIO 25 duty helper: signed `value <= 0` drives low, `1..99` selects timed duty, and `>= 100` drives high; bypasses kettle states |
| `7` | Post `value` as a Wi-Fi/provisioning `EKG_EVENTS` event ID; not a kettle heat-state event |
| other | Bad request |

Types `3` through `5` call the common `set_notif_interval_ms(type, value)`
path. Type `7` exposes the internal Wi-Fi/provisioning event loop and is
broader than the ordinary temperature-setting operations, but it does not
dispatch kettle heat-state transitions. Type `6` is not an event route at all;
it enters the same GPIO 25 duty helper used by the periodic worker and must not
be treated as a safe heat-on/heat-off state payload.

### `/cli` Protocol

`/cli` accepts only GET. The normal request is:

```text
GET /cli?cmd=<URL-encoded command>
```

The handler converts `+` to spaces, handles the form/newline terminator, and
passes the resulting string to the same `esp_console` command dispatcher used
by the UART CLI. An empty command becomes `help`. It returns `text/html` using
a chunked response containing an HTML command form followed by redirected CLI
and log output.

There is no JSON schema and no command allowlist specific to HTTP: any command
registered in the firmware CLI table can be invoked, including diagnostic,
GPIO, Wi-Fi, BLE, OTA, partition, factory-reset, and firmware-download
commands.

### BLE versus `/api` versus `/cli`

The table separates functions demonstrated by the Codeberg library from
additional BLE paths found only through static firmware analysis.

| Capability | BLE operational GATT | HTTP `/api` | HTTP `/cli` |
|------------|----------------------|-------------|-------------|
| Transport | Local BLE GATT read/write/notify | LAN HTTP GET/POST with binary records | LAN HTTP GET with URL-encoded console text |
| JSON | Not used for operational control | Not accepted | Not accepted |
| Read settings | Read 17-byte `...c4b5...`; library `refresh_state()` | `GET`, `t=3` returns the same 17 bytes | `print <type>`/settings diagnostics |
| Set target temperature | Library `set_target_temperature()`; byte-4-only encoding caveat | `t=3`, mask `0x0002`; or `t=5` types `1`/`2` | `settempF`, `settemp2C`, `settempr` |
| Set units | Library `set_units()` | `t=3`, masks `0x0100`/`0x0200` | `setunitsc`, `setunitsf` |
| Set altitude | Library `set_altitude()` | `t=3`, mask `0x0001` | `setaltitudef`, `setaltitudem` |
| Set clock/mode | `set_clock_time()`, `set_clock_mode()` | `t=3`, masks `0x0010`/`0x0020` | `clock=<h>:<m>` and settings commands |
| Set hold/chime | `set_hold_time()`, `set_chime_volume()` | `t=3`, masks `0x0040`/`0x0080` | Generic settings commands |
| Set pre-boil | `set_pre_boil()` | `t=3`, masks `0x0400`/`0x0800` | `setsettingb`/settings command |
| Set language | `set_language()`; incomplete enum | `t=3`, mask `0x1000` | Generic settings command |
| Schedule | Library attempts enable/mode/time/temp; time/temp and once/daily behavior are unconfirmed | `t=3` reliably exposes enable/value mask; scheduled time/temp have no direct parser branch | `schedtempF`, `schedtemp2C`, plus settings commands |
| Settings notifications | `...c4b5...` notifications; demonstrated for configuration changes | Notification destination/period controlled by query fields and `t=5` types `3-5` | No structured notification protocol |
| 39-byte status | Firmware `...c4b4...` read; absent from library | `GET`, `t=4` | State/diagnostic print commands |
| Eight-byte `RT_Params` | Firmware `...c4b4...` write; absent from library | `t=5`, types `0-7` | Individual console commands where equivalents exist |
| Heat on/off | No guarded state route; c4b4 type 6 exposes quarantined raw GPIO 25 duty | No guarded state route; `t=5` type 6 exposes the same raw duty and type 7 is Wi-Fi/provisioning only | Direct GPIO 27 commands `heaton`, `heatoff` |
| Wi-Fi event/WARM PWM | Firmware `RT_Params` path, not demonstrated by library | `t=5` type `7` injects Wi-Fi/provisioning events; type `6` controls WARM PWM | Low-level diagnostic/control commands |
| Wi-Fi provisioning | Separate Security-1 provisioning flow using PoP `abcd1234` | Not provided | `provreset` and Wi-Fi commands |
| Diagnostics/admin | Not exposed by library | Fixed record/action surface only | Full registered CLI: GPIO, BLE/Wi-Fi, partitions, OTA, factory reset, HTTP tests |
| Replay/change tracking | Byte-16 settings counter; library increments it | Shared BLE/HTTP session plus strictly increasing signed ordinal for `RT_Params`; settings include byte-16 counter | None |
| Authentication scope | Provisioning uses PoP; the operational library performs no app-layer unlock | No local HTTP authentication | No local HTTP authentication |

### Remote Firmware-Service Header Tests

The `httptest` CLI command runs these cases against the remote download
service, not against `/api` or `/cli`:

| Test | Description |
|------|-------------|
| #0 | Send correct full key |
| #1 | Send correct id |
| #2 | Send wrong key |
| #3 | Send wrong id |
| #4 | No headers |
| #5 | Only mac header, no key |

### CLI Commands

| Command | Description |
|---------|-------------|
| `setsettings <key> <value>` | Set device settings (string) |
| `setsettingb <key> <value>` | Set boolean setting |
| `setsettingd <key> <value>` | Set double setting |
| `settempF` / `settemp2C` | Set temperature in °F/°C |
| `settempr` | Set temperature (raw) |
| `schedtempF` / `schedtemp2C` | Schedule temperature |
| `setaltitudef` / `setaltitudem` | Set altitude (new) |
| `setunitsc` / `setunitsf` | Set temperature units (new) |
| `clock=<h>:<m>` | Set device clock |
| `buz <freq> <duty> <dur>` | Run buzzer |
| `heaton` / `heatoff` | Heating control |
| `factory` | Factory reset (new) |
| `eraseotherpart` | Erase non-current OTA partition |
| `provreset` | Reset WiFi provisioning |
| `wifi` | WiFi commands (`wifion`, `wifioff`, `wifista`, `wifisap`, etc.) |
| `bleen` / `bledis` / `blesec` | BLE enable/disable/secure |
| `print <type>` | Print state, settings, firmware info, heap, screenshot, etc. |
| `version` | Show current version |
| `httptest` | Run HTTPS server test suite (new) |
| `httpfw` | Download/install FW via HTTP (new) |
| `httpdwn` | Download file via HTTP (new) |
| `ota` | OTA commands |

## Device State & Settings

### Temperature Control

- PID controller with IRAM-optimized calculations
- Temperature offset calibration (`SID_Offset_Temperature`)
- Boiling point detection (altitude-adjusted)
- Pre-boil mode
- Temperature units: °F / °C
- Schedule windows for automated heating

### Device States

- `HEAT` / `heaton` / `heatoff` — Heating control
- `boil` / `Pre-Boil` — Boiling modes
- `curtempr` — Current temperature reading
- `ble_send_tempr` — BLE temperature broadcast
- `S_Hold` — Hold mode with timer
- Calibration states: `Calibration`, `Calibration Fail`, `Calibration Halted`, `Calibration Aborted`

### Error Screens (embedded PNGs)

- `error screen - add water.png`
- `error screen - Set confirm water.png`
- `error screen - Enable Wireless.png`
- `error screen - cannot turn wifi.png`
- `error screen - Set clock.png`
- `error screen - Calibration in progress.png`
- `error screen - kettle not connected to network.png`
- `error screen - Downloading.png` *(new in v1.1.76)*

### Languages (new in v1.1.76)

| # | Language | Evidence |
|---|----------|----------|
| 1 | English | Default strings |
| 2 | Spanish | `Agregar agua`, `Cancelar`, `cancelada Presione` |
| 3 | Simplified Chinese | `L_Simplified_Chinese` |
| 4 | Traditional Chinese | `L_Traditional_Chinese` |
| 5 | Korean | `L_Korean`, `korean` |
| 6 | Japanese | `L_Japanese`, `japanese` |
| 7 | French / Portuguese | `Langue`, `Idioma` |

Non-English languages may trigger a firmware upgrade if not already present (`Starting FW upgrade for new language`).

## Default Credentials

- **BLE Provisioning PoP**: `abcd1234` (hardcoded; unchanged from v1.1.75)
- **Provisioning security**: ESP-IDF Security 1 (X25519 session establishment,
  followed by AES-CTR encrypted provisioning messages)
- **BLE service key**: `NULL` (ignored for the BLE transport)

## Extracted Segments

| Segment | Size | Load Address | Memory Type | Description |
|---------|------|-------------|-------------|-------------|
| `segment_00` | 563,272 B | 0x3f400020 | DROM | Global data, strings, Google IoT SDK, OTA config |
| `segment_01` | 26,536 B | 0x3ffbdb60 | DRAM | RAM data, TLS certificates (GTS LTSR + GlobalSign ECC R4) |
| `segment_02` | 942,484 B | 0x400d0020 | IROM | Main application code |
| `segment_03` | 4,224 B | 0x3ffc4308 | DRAM | TLSF heap manager data *(new)* |
| `segment_04` | 104,412 B | 0x40080000 | IRAM | Startup + IRAM functions (merged) |
| `segment_05` | 16 B | 0x50000000 | RTC | RTC retained data |
| `segment_06` | 62,864 B | 0x00000000 | PAD | Padding |

## Firmware Image Layout (for Ghidra scripting)

The firmware image follows the ESP32 binary format: the 24-byte image header is
followed by an **8-byte descriptor** (`load_address`, `data_length`) for each
segment and then that segment's data. The application descriptor is data at
the beginning of the first mapped segment, not a 16-byte per-segment header.

### File offset map

| Segment | Descriptor Offset | Data Offset | Data Size | Load Address | Memory Type |
|---------|------------------:|------------:|----------:|-------------:|-------------|
| DROM | `0x00000018` | `0x00000020` | 563,272 B (`0x89848`) | `0x3f400020` | DROM |
| DRAM1 | `0x00089868` | `0x00089870` | 26,536 B (`0x67a8`) | `0x3ffbdb60` | DRAM |
| IROM | `0x00090018` | `0x00090020` | 942,484 B (`0xe6194`) | `0x400d0020` | IROM |
| DRAM2 | `0x001761b4` | `0x001761bc` | 4,224 B (`0x1080`) | `0x3ffc4308` | DRAM |
| IRAM | `0x0017723c` | `0x00177244` | 104,412 B (`0x197dc`) | `0x40080000` | IRAM |
| RTC | `0x00190a20` | `0x00190a28` | 16 B (`0x10`) | `0x50000000` | RTC |

> **Note:** The IROM descriptor is at `0x00090018`; its raw data spans
> `0x00090020` through `0x001761b3`, exactly 942,484 B (`0xe6194`).

### Key details for Ghidra scripts

- **Segment order in file ≠ load address order**: IROM (load `0x400d0020`) appears between DRAM1 (`0x3ffbdb60`) and DRAM2 (`0x3ffc4308`) in the firmware image, despite having a higher load address than both DRAM segments.
- **8-byte segment descriptors** immediately precede each segment's data in
  this image. Do not include the descriptor when extracting a mapped segment.
- The offsets above are contiguous descriptor/data boundaries; the bytes that
  were previously labeled as 8-byte padding are the next segment descriptors.
- **When loading into Ghidra**: Load each segment at its ESP32 load address (not its file offset). The IROM segment is typically loaded first as the primary program, then other segments are added as separate memory blocks at their respective load addresses.


## Source File Structure

```
/home/lenovo/fellow/EKG_Pro/firmware/
├── main/
│   ├── main.cpp            # Application entry
│   ├── kettle.hpp          # Kettle control logic
│   ├── gui.hpp             # LVGL display
│   ├── wifi.hpp            # WiFi management
│   ├── wifi_prov.hpp       # WiFi provisioning (BLE)
│   ├── ble.hpp             # BLE stack
│   ├── ota.hpp             # OTA update handling
│   ├── ota_download.hpp    # OTA download logic
│   ├── cli.hpp             # CLI interface
│   ├── buzzer.hpp          # PWM buzzer
│   ├── timer.hpp           # Timer/scheduler
│   ├── notify.hpp          # BLE notifications
│   ├── https.cpp           # HTTP server with /upload, /uploadfw (new)
│   └── wifi_prov_manager_wrapper.c
├── components/
│   ├── esp-google-iot/       # Google Cloud IoT Core SDK
│   └── lvgl_esp32_drivers/   # LVGL display drivers with PNG support
```

## Certificates

### Embedded in DRAM (segment_01)

1. **GTS LTSR** (Google Trust Services Long Term Self-signed Root) — ECC certificate for TLS to `mqtt.2030.ltsapis.goog`
   - Subject: `C=US, O=Google Trust Services LLC, CN=GTS LTSR`
   - Valid: 2018-11-01 to 2042-11-01
   - Replaced GlobalSign ECC Root CA from v1.1.75

2. **GlobalSign ECC Root CA - R4** — Still present as secondary CA
   - Subject: `OU=GlobalSign ECC Root CA - R4, O=GlobalSign, CN=GlobalSign`
   - Valid: 2012-11-13 to 2038-01-19

### Embedded in OTA Config JSON (segment_00)

3. **Starfield Root Certificate Authority - G2** (RSA) — For OTA firmware signature verification
   - Subject: `C=US, O=Starfield Technologies, Inc., OU=Starfield Class 2 Certification Authority`
   - Used with RSA-PSS to verify `sign` field in OTA config

## Security Notes

- **RSA Code Signing** — v1.1.76 introduces firmware signature verification, preventing installation of unsigned or tampered firmware via OTA
- **Hardcoded BLE Provisioning PoP** — `abcd1234` is embedded in DROM and used
  as the Security 1 proof-of-possession value for every provisioning session;
  it is not generated from the MAC address or loaded from NVS
- **Local Upload Attack Surface** — The new `/uploadfw` endpoint allows local network firmware installation, bypassing cloud OTA but still subject to the same RSA signature verification
- **Unauthenticated Local Control** — `/api`, `/cli`, `/upload`, and
  `/uploadfw` are registered directly with the local HTTP server; no local
  `key`/`id` validation was found. The header tests belong to the outbound
  remote firmware-service client
- **No Secure Boot** — `Secure version: 0`, ESP32 secure boot is not enabled

## Tools Used

- **esptool v5.3.0** — ESP32 firmware parsing/segment extraction
- **strings** — String extraction and diffing
- **openssl** — Certificate parsing

## Exhaustive Interface Audit (2026-08-17)

Follow-up pass answering "is there a path to arbitrary file read?" — result:
**no**. No filesystem (SPIFFS/LittleFS/VFS) is compiled in; persistent storage is
NVS key-value plus OTA partitions only. All externally reachable read surfaces
were enumerated exactly:

### CLI command table (complete)

The CLI dispatch table is a 3-word `{name, desc, handler}` array in DROM:

- **Base** `0x3f40f274` (`reset`), 12-byte stride, **80 entries**, NUL
  terminator at `0x3f40f634` (end `0x3f40f640`).
- The full walk reproduces the live `help` output one-for-one (80/80),
  `reset` … `min_duty`; `1d`/`1u`/`2d`/`2u` are in the table (and in the
  original live capture). `help`, `version`, `factory`, `settempr` are handled
  outside the table.
- **No hidden commands.** No flash-dump, flash-read, memory-read, or file-read
  verb exists anywhere in the binary (`esp_partition_read`,
  `esp_partition_read_raw`, `esp_partition_mmap` appear only as unsymbolized
  IDF library code used by the OTA/NVS internals; no app-level call sites).

### HTTP surface (complete)

The URI registration array at `0x3f404770` (8 structs: 6 unique URIs, `/api`
registered for GET and POST) — referenced from code at `0x400d1324`:

| URI | Method | Handler |
|-----|--------|---------|
| `/` | GET | `0x400dc42c` (upload page) |
| `/cli` | GET | `0x400ea154` |
| `/upload` | GET | `0x400dc390` (page) |
| `/uploadfw` | POST | `0x400dcaa4` |
| `/api` | GET + POST | `0x400dd028` (fixed `t=3/4/5` records) |
| `/upng` | POST | `0x400d717c` |

All are write or fixed-record reads; nothing serves file/flash contents.

### Console/log exposure

- `logprt` (`print small log`) is the CLI method for viewing console output:
  it prints the app's small log ring buffer (see `small_log_print` error path
  at `0x3f40c9cc`).
- A separate stdout-capture mechanism exists: `stdout_output task %p`,
  `ERROR: stdout_output recursion`, `redirect_stdout`, and
  `log_redirect_http_start %d task %p '%s'` — console output is captured by a
  task and can be redirected toward an HTTP target (the string argument is
  plausibly the destination). Live-test candidate: trigger the redirect and
  observe what the LAN HTTP side returns; the URI list above is closed, so the
  stream should surface through `/cli` or a configured outbound target.

### Verdict

Closest real leaks remain the fixed ones already documented: `wifiprt` (stored
Wi-Fi config from NVS over LAN), `/api?t=4` status record, and the log ring
buffer / redirect. Arbitrary file or flash read is not reachable from any
audited surface (HTTP, BLE GATT, CLI, or the Google Cloud/IOTC path, whose
file-tuple direction is device→cloud only).
