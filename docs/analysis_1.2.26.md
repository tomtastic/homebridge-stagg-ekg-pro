# EKG Pro Firmware Analysis — v1.2.26

## Overview

| Field | Value |
|-------|-------|
| **Device** | Fellow EKG Pro (smart electric kettle) |
| **Chip** | ESP32 (WROOM); image declares chip-revision range v3.0–v3.99 |
| **SDK** | ESP-IDF v4.4.8-1-ga9d0f22193 (up from v4.4) |
| **Firmware Version** | 1.2.26 |
| **Build Date** | October 8, 2026 17:50:37 |
| **Source Path** | `/project/firmware/` (was `/home/lenovo/fellow/EKG_Pro/firmware/`) |
| **Flash** | 8MB, 40MHz, DIO mode |
| **Entry Point** | 0x400817b8 |
| **File Size** | 1,904,640 bytes (0x1D1000) |
| **Firmware image SHA256** | `71f7cacddcc40b22e122c4f77c5493e0631cc15ae4f863877af2846824a44e9b` |
| **Embedded ELF SHA256** | `2e68573d1b431aa008b3a5b68f51c11a4c2fd469671404b9960f3e93112be641` |
| **Validation Hash** | `7aecb485cbfb833e3f03bec38fdb7a346239ea150d33252c55cf8548c4302702` (valid) |
| **Secure Boot** | none (`Secure version: 0`) |
| **Prev Version** | [v1.1.76SSP](./analysis_1.1.76SSP.md) |

## Changes from v1.1.76SSP

v1.2.26 is a **major architectural shift**. The Google Cloud IoT Core stack is removed
entirely — the device's only remote dependency is now the Fellow OTA server
(`qhderznbzup.firmware.fellowproducts.com`), which also receives session telemetry.
On the hardware side the firmware adds a triac thermal model, plateau/fast-rise
boil heuristics, user tunable calibration, a low-power bench suite (internal
tickets EKG-103 / EKG-115), and new direct-HTTP heater-test and PWM-period
endpoints. BLE identity, the `/api` record protocol, and RSA-signed OTA are
unchanged.

### Removed: Google Cloud IoT Core

- The entire `components/esp-google-iot/iot-device-sdk-embedded-c` tree is gone
  (all ~40 `iotc_*` source paths, `libiotc` internals, and MQTT parser/serializer
  strings are absent from DROM).
- `mqtt.2030.ltsapis.goog` appears nowhere; the MQTT topic templates
  `/devices/%s/config`, `/devices/%s/commands/#`, `/devices/%s/state`,
  `/devices/%s/events` are removed.
- The NVS keys `iotkey`, `iotprj`, `iotrgn`, `iotreg` (device JWT private key /
  project / region / registry) are removed, and the `iot` CLI command is removed
  from the dispatch table.
- The GTS LTSR TLS root (Google Trust Services Long Term Self-signed Root) is
  removed with the stack.

### Added: telemetry to the OTA server

New `send_metrics` endpoint and session telemetry:

- `POST https://qhderznbzup.firmware.fellowproducts.com/send_metrics`
- Session-end JSON payload (embedded format string, DROM file `0x74fd`, VA `0x3f40751d`):

  ```json
  {"device_name":"%s","fw_version":"%s","mode":"%s","target_temp_c":%.2f,
   "time_to_relay_ms":%u,"time_to_target_ms":%u,"overshoot_c":%.2f,
   "triac_temp_c":%.1f,"temp_noise_c":%.2f,"calibration_c":%.2f,
   "altitude_raw":%d,"no_water_events":%d,"session_duration_ms":%u,
   "uptime_s":%u,"heap_free":%d,"heap_min_free":%d,"heap_largest_block":%d,
   "reset_reason":"%s","wifi_rssi":%d,"start_temp_c":%.2f,"volume_ml":%d,
   "fast_rise_max_c":%.2f,"fast_rise_raw_max_c":%.2f}
  ```

- Periodic/sample format strings: `{"temp":%.2f,"temp_set":%.2f,"state":"%s","pwm":%d,"timestamp":%u}`
  and `{"ADC":%d,"T":%lf,"mV":%lf}`.
- Outbound HTTP headers on the OTA client: `id`, `mac`, `fwv` (firmware version),
  plus **new** `ota-enabled` (`true`/`false`/`unknown`) and **new** `region`
  (derived from the `SID_Language` setting; out-of-range values report
  `region=unknown` — "SID_Language out of range (%d); reporting region=unknown").
- Failure logs: "http init failed, dropping metrics", "set_identity_headers
  failed: %s, dropping metrics", "open failed: %s (0x%x)".
- The `region` mapping implies per-language market routing (the exact
  language→region table is recoverable in Ghidra).

### Added: HTTP heater-test and PWM-period control

- `GET /htest?pwm=<0-100>&target=<C>` — "Heater test mode ON: pwm=%d%%
  target=%.1fC temp=%.1fC"; `GET /htest?off=1` — "Heater test mode OFF".
  Direct heater test over the local HTTP surface (quarantine class, same as the
  CLI `warmon`/`heaton` paths).
- `GET /hperiod?sec=<2|4|8>` — sets the PWM switching period
  ("Period: pwm_period=%d (~%ds at 50Hz, ~%.2fs at 60Hz)"; invalid values →
  "Error: sec must be 2, 4, or 8"). The CLI `set_period` now reads "set pwm
  period in seconds".
- `triactrace 1|0` CLI — toggles a 2-second CSV thermal trace:
  `TTRACE,ms,out,pwm,phase,triac_c,base_c,ot,E`.

### Added: triac thermal model and boil heuristics

- Triac temperature estimate + protection: "Triac thermal: est=%.1f°C pwm=%d%%
  %s", "Triac overtemp %.1f", "Triac cooled to %.1f", `BASE=%.1f` / `MAX=%.1f` /
  `MIN=%.1f`, "HOT-capping".
- **Plateau detection** (end-of-boil heuristic): `set_plateau_params <window_s>
  [<delta_c>] [<arm_suppress_s>]` (defaults 20/1.5/10); logs "Plateau add-water
  trip consumed by Kettle" / "Plateau add-water: %.2f".
- **Fast-rise** phase: `set_fast_rise_params <window_s> [<threshold_c>]
  [<arm_suppress_s>]` (defaults 2/8.0/3); "Fast-rise add-water: %.1f".
- **Calibration**: `set_calib_params <stability_target_s>` (default 5);
  `calib_stability_target=%d`; user-facing calibration flow (`user_facing_calib`,
  `start_calib_result_timer`, "Calibration success", "Aborting calibration,
  button|!kettle" / "Too hot" / "starting temp too hot"); new multilingual
  "calibration failed" UI strings (Spanish *Fallo de calibración*, Simplified
  Chinese 校准失败, Traditional Chinese 校准失敗, Korean 교정 실패, Japanese 校正失敗).
- **Thermal-mass detection**: "Thermal mass detection: crossed lower threshold
  %.1f", "Thermal mass detection skipped: kettle already at %.1f", "Thermal mass
  thresholds: measuring %.0f-%.0f".
- **PID volume classes**: "PID volume thresholds: LOW<=%d ms, MEDIUM=%d-%d ms,
  HIGH>=%d ms, default=%d ms" (LOW/MEDIUM/HIGH).
- Boil tracking: "boiling_point: %f", "boiling ended %u ms", "cap->%d%%",
  "window=%.1f-%.1f", "est=%.1f", "diff:%f".
- Fallback mode: "relay bang-bang mode, accuracy reduced".
- Hold/reheat: "Hold temp dropped %.1f°C below target %.1f°C -> S_Heat
  (reheat)".
- Boil modes reported in telemetry `mode`: `guided`, `schedule`, `normal`,
  `pre-boil`.
- 50/60 Hz mains awareness in period logs.

### Added: low-power bench suite (EKG-103 / EKG-115)

Six new bench commands; the names reference internal ticket numbers:

| Command | Usage | Purpose |
|---|---|---|
| `lpsleep` | `[N]` | light sleep N sec (default 10), dial press wakes |
| `lpclock` | `<cycles> [sec]` / read | LP clock-cycle bench; "good=%d gpio=%d rejected=%d" |
| `rtcdrift` | `<sec>` / read | RTC drift measurement |
| `lpdiag` | — | "print CPU MHz / WiFi state captured at last wake" |
| `lpnow` | — | "request autonomous low-power entry now (if idle + clock off)" |
| `lpwhy` | — | "print low-power entry guards + enter/skip verdict" |

Supporting strings: `lpwhy guards: idle=%d(ks=%d) clock_off=%d wifi_off=%d
no_sched=%d not_bricky=%d not_selftest=%d not_ota=%d no_ble=%d`, `lpsleep: woke
after %d.%03d s cause=%d (7=GPIO 4=TIMER)`, `deepsleep` as a reset reason (also
reported in telemetry `reset_reason`), `esp_sleep_isolate_digital_gpio`.

### Added: CORS on the upload path

- New headers on the upload endpoints: `Access-Control-Allow-Origin`,
  `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers`.
- A new `OPTIONS` handler is registered on `/uploadfw` (raw method value 6) for
  browser preflight; the upload page HTML is now embedded from
  `main/files/upload_script.html` (`MAX_FILE_SIZE 0x200000` = 2 MB unchanged).
- `204 No Content` responses on upload completion paths.

### OTA changes (same server, new behavior)

- The embedded OTA config JSON is **byte-identical** to v1.1.76: `fwp 0.0.76`,
  same `fwurl`, same Starfield Root CA G2 `fwcert`, same RSA-PSS `sign`.
- RSA-PSS verification intact: "OTA config OK. time: hash: %d us read sign: %d
  verif rsa: %d rsa_pss_verify: %d us total: %d us", "ets_rsa_pss_verify
  failed", "Bad sign string", "No sign in iot config", "New firmware corrupted".
- New version dedupe: "New version is the same as invalid version %s - abort
  update", "New version is the same as previous version %s - abort update".
- New `otadis` setting (OTA-disable flag) reported to the server as the
  `ota-enabled` header.
- "AUTO REBOOT DEVICE after 1 min" — one-minute auto-reboot timer after
  firmware install.
- "OTA failed - exiting silently to menu" — new failure UX.
- Companion app branding: "*****Connect to EKG Updater app*****" — the local
  upload app is now branded **EKG Updater**.

### SDK and stack updates

- ESP-IDF v4.4 → **v4.4.8-1-ga9d0f22193**.
- wpa_supplicant gained WPA3 SAE: `WIFI_AUTH_MODE__WPA3_PSK`,
  `WIFI_AUTH_MODE__WPA2_WPA3_PSK`, `WPA3-ENT-192`, `x25519`, `pbkdf2_sha1`,
  `sta.sae_h2e`.
- Component path churn: `esp_adc_cal` (new path `esp32/esp_adc_cal.c`),
  `esp_hw_support/sleep_gpio.c`, `esp_phy`, `esp_efuse/esp32`, heap TLSF
  `multi_heap_*`/`heap_caps_*`, `nvs_flash` C++ rewrite (`nvs_page.cpp`,
  `nvs_pagemanager.cpp`, `nvs_storage.cpp`), `driver/ledc.c`, `driver/uart.c`,
  `pthread/pthread.c`.
- TLS trust store changed from two hand-picked roots in DRAM to a large embedded
  DER **CA bundle** in DROM (file ~0xA2800–0xB4B00, ~66 KB; 106 RSA public-key
  markers, ~128 CN fields; subjects include Amazon Root CA 1, DigiCert,
  GlobalSign, Google Trust Services, IdenTrust, Entrust, Trustwave, SecureTrust,
  D-Trust, Certigna, TUBITAK, TeliaSonera, WISeKey, XRamp, …).

### UI changes

- Three new embedded PNGs (46 → 49 total): `Wireless/1-01.png`,
  `Wireless/2-01.png`, `gmenu - about.png`.
- `gmenu` screen set: `gmenu - Calibration.png`, `gmenu - about.png` (new),
  `gmenu - clock.png`, `gmenu - language.png`, `gmenu - wireless.png`.
- Language migration logic: "Language migration: '%s' -> Japanese", "-> Korean",
  "NV=4, left as Traditional Chinese"; new `langmig` setting; updated
  "*FW UPGRADE NEEDED FOR NEW LANG. NEW LANG %d prev_language:%d, maxlang : %d"
  (and the NOT-NEEDED counterpart).
- New log/state strings: "Returning to Hold (was in Hold before Standby)",
  "Temperature climbing: %f - %f", "Temperature !climbing: %f - %f",
  "menu_mode_enter set", "dial_long_press - enter timer mode".
- GUI source split: `gui.hpp` → `gui_game.hpp` + `gui_system.hpp` +
  `gui_tasks.hpp`; `wifi.hpp` → `wifi.cpp`.

### Settings / NVS changes

| Key | v1.1.76 | v1.2.26 |
|-----|---------|---------|
| `iotkey` / `iotprj` / `iotrgn` / `iotreg` | BLOB (Google IoT) | **removed** |
| `otadis` | — | **new** (OTA-disable flag) |
| `langmig` | — | **new** (language-migration flag) |
| existing settings (`clockmode`, `language`, `schedon`, `schtime`, `schtempr`, `wifimode`, `wificoun`, `wifiwascn`, `instfc`, `offset_temp`, `Repeat_sched`, altitude, units, chime, hold, guide, pre-boil) | present | present |

### Certificate changes

| Purpose | v1.1.76 | v1.2.26 |
|---------|---------|---------|
| Cloud TLS root | GTS LTSR (Google Trust Services) | **removed** (no cloud stack) |
| Secondary TLS root | GlobalSign ECC Root CA R4 (DRAM) | **removed** from app store |
| General TLS trust store | 2 roots in DRAM | **embedded CA bundle** (~66 KB, DROM, ~100+ roots) |
| OTA signature CA | Starfield Root CA G2 (OTA JSON `fwcert`) | unchanged (same base64 + `sign`) |

### Segment changes

| Segment | Load Address | v1.1.76 | v1.2.26 | Delta | Notes |
|---------|-------------|---------|---------|-------|-------|
| DROM | 0x3f400020 | 563,272 B | 793,784 B | **+230,512** | CA bundle, telemetry, new strings/UI |
| RTC_DRAM | **0x3ff80000** | *(none)* | 4 B | **new** | replaces v1.1.76 RTC_DATA |
| DRAM | 0x3ffbdb60 | 26,536 B | 29,344 B | +2,808 | |
| DRAM | 0x3ffc4308 | 4,224 B | *(none)* | −4,224 | TLSF heap segment folded |
| IROM | 0x400d0020 | 942,484 B | 925,900 B | **−16,584** | IoT SDK removal > new code |
| IRAM | 0x40080000 | 104,412 B | 28,804 B | −75,608 | split… |
| IRAM | **0x40087084** | *(none)* | 75,060 B | **new** | …into second IRAM segment |
| RTC_DATA | 0x50000000 | 16 B | *(none)* | −16 | |
| PAD | 0x00000000 | 62,864 B | 47,520 B | −15,344 | |
| **Total** | | **1,703,808 B** | **1,900,416 B** | **+196,608** | +11.5% |

File size 1,708,032 → 1,904,640 bytes (+196,608).

### New UI assets (embedded PNGs)

| Asset | Purpose |
|-------|---------|
| `Wireless/1-01.png` | New Wireless settings screen |
| `Wireless/2-01.png` | New Wireless settings screen (second page) |
| `gmenu - about.png` | New About screen in the GUI menu |

## BLE Interfaces

Firmware v1.2.26 exposes the same two BLE mechanisms as v1.1.76:

1. **ESP-IDF Wi-Fi provisioning** uses protocomm Security 1 and the hardcoded
   proof-of-possession value `abcd1234`.
2. **Operational GATT configuration** exposes kettle settings and status after
   an ordinary BLE connection. This is the interface implemented by the
   third-party
   [`ekg-pro-ble-lib`](https://codeberg.org/breiflabb/ekg-pro-ble-lib/src/branch/main),
   as audited in the v1.1.76 analysis.

The UUID set is byte-identical to v1.1.76 (same three services, same nine
`2291c4bX` characteristics, same five legacy provisioning characteristics).
Only storage location and offsets changed, so the characteristic-role mapping
from the v1.1.76 live capture is expected to carry over; it was **not**
re-verified on a live v1.2.26 device (no hardware audit was performed for
this release).

### Wi-Fi provisioning and PoP

The provisioning PoP `abcd1234` is present at DROM file `0x5829`
(VA `0x3f405849`), sitting between the debug string
`/project/firmware/main/wifi_prov.hpp` and the call annotation
`ekg_wifi_prov_mgr_start_provisioning(security, pop, service_name,
service_key)`. It is not a BLE pairing PIN, an operational GATT password, or a
dynamically generated per-device credential. Unchanged from v1.1.76 (which
held it at DROM file `0x4dd8`, VA `0x3f404df8`).

The device/service name format `EKG-%02x-%02x-%02x` (last three MAC octets) is
unchanged (DROM file `0x575c`). The `blesec` CLI command is unchanged.

New in v1.2.26: the startup log enumerates the build flags
`USE_BLE_SECURITY_MAX defined` and `USE_BLE_SECURITY_NORMAL defined`
(DROM file `0xad0c` / `0xad35`).

### Static GATT UUID table

All 16 static GATT UUID entries sit contiguously in DROM at file
`0x96c5e`–`0x96d9a` (VA `0x3f496c5e`–`0x3f496d9a`). Each entry is
`[name string, NUL-terminated, optional][flag byte 0x80][16-byte fully
byte-reversed UUID]`; the name precedes the flag and varies in length, so
unnamed entries are 17 bytes.

| UUID | Name in table | DROM file | DROM VA |
|------|---------------|-----------|---------|
| `021aff54-0382-4aea-bff4-6b3f1c5adfb4` | *(none)* | 0x96c5f | 0x3f496c5f |
| `021aff53-0382-4aea-bff4-6b3f1c5adfb4` | `proto-ver` | 0x96c7a | 0x3f496c7a |
| `021aff52-0382-4aea-bff4-6b3f1c5adfb4` | `prov-config` | 0x96c97 | 0x3f496c97 |
| `021aff51-0382-4aea-bff4-6b3f1c5adfb4` | `prov-session` | 0x96cb5 | 0x3f496cb5 |
| `021aff50-0382-4aea-bff4-6b3f1c5adfb4` | `prov-scan` | 0x96cd0 | 0x3f496cd0 |
| `021a9004-0382-4aea-bff4-6b3f1c5adfb4` (service) | *(none)* | 0x96ce1 | 0x3f496ce1 |
| `2291c4b9-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96cf2 | 0x3f496cf2 |
| `2291c4b8-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d03 | 0x3f496d03 |
| `2291c4b7-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d14 | 0x3f496d14 |
| `2291c4b6-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d25 | 0x3f496d25 |
| `2291c4b5-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d36 | 0x3f496d36 |
| `2291c4b4-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d47 | 0x3f496d47 |
| `2291c4b3-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d58 | 0x3f496d58 |
| `2291c4b2-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d69 | 0x3f496d69 |
| `2291c4b1-5d7f-4477-a88b-b266edb97142` | *(none)* | 0x96d7a | 0x3f496d7a |
| `7aebf330-6cb1-46e4-b23b-7cc2262c605e` (service) | *(none)* | 0x96d8b | 0x3f496d8b |

Followed by the orphan label `prov_cst` (file `0x96d9b`) and a u32 array
(`1,8,8,8,4,4,2,2,1, 8,8,4,4,2,2,1, 0,0,0,0, 4,0,2,0, 1,0,0,0, 0,0`) — both
byte-identical to the v1.1.76 placements (file `0x6ae43` and following).

- **v1.1.76 counterpart**: DROM file `0x6ad06`–`0x6ae42` — the same 16
  entries, same names, same layout, at different offsets.
- v1.1.76 additionally carried a runtime NimBLE attribute table in DRAM
  `0x3ffbeff8`–`0x3ffbf068` (shared access callback `0x400d6bbc`). The
  `021affXX` UUIDs are absent from v1.2.26 DRAM; the static DROM table is the
  only occurrence.
- The UUIDs are stored fully byte-reversed (16-byte reversal of the canonical
  16-byte UUID), not as little-endian 32-bit fields. Scan for the reversed
  16-byte pattern, not the canonical byte order.

### Operational GATT service

Service `7aebf330-6cb1-46e4-b23b-7cc2262c605e` with characteristics
`2291c4b1`–`2291c4b9` (offsets in the table above). The record-machinery
strings are unchanged from v1.1.76:

- `RT_Settings` (DROM file `0x6ba8`)
- `RT_Params` (DROM file `0x6aa2`)
- `wifins::WiFi::copy_status_to_record` (DROM file `0x99296`)
- `EKG_EVENTS` / "post EKG_EVENTS %d" (DROM file `0x6b4d`)
- "RT_Params ignore ordinal %d vs prev %d"

Roles from the v1.1.76 live capture — `c4b5` = 17-byte settings record
read/write/notify, `c4b4` = 39-byte status read / 8-byte `RT_Params` write —
are expected to carry over; no live v1.2.26 capture was performed.

### Wi-Fi provisioning GATT service

The protocomm service `1775244d-6b43-439b-877c-060f2d9bed07` static entry is
at DROM file `0x9dcf0` (VA `0x3f49dcf0`) with flag byte `0x00`, followed by
six IROM function pointers — `0x400f243c`, `0x400daa9c`, `0x400f2404`,
`0x400f2540`, `0x400f24e4`, `0x400f2301` — terminated by two zero dwords.
This handler-pointer table is new relative to v1.1.76, where the service
entry sat at DROM file `0x6eb18` without adjacent pointers. The runtime
endpoint characteristics `1775ff50`–`1775ff53`
(`prov-scan`/`prov-session`/`prov-config`/`proto-ver`) have no static 16-byte
entries in this image (nor in v1.1.76).

The legacy provisioning service
`021a9004-0382-4aea-bff4-6b3f1c5adfb4` and its five characteristics
(`021aff50`–`021aff54`) keep the mapping recovered in the v1.1.76 audit:
`prov-scan`, `prov-session`, `prov-config`, `proto-ver`, and `prov_cst`
(the station-password field; its label sits after the table end). Static
placement is DROM-only in both versions.

## Architecture

- **HTTP Server** — Local control API: `/`, `/temp`, `/cli`, `/upload`,
  `/uploadfw`, `/api`, `/upng`, plus new `/htest` and `/hperiod`; CORS headers
  and an `OPTIONS` preflight on the upload path
- **Fellow OTA Server** — The only remote dependency (Google Cloud IoT Core
  removed): firmware download, install confirmation, time sync, session
  telemetry
- **BLE Provisioning** — WiFi credentials provisioned via BLE (protocomm
  Security 1, PoP `abcd1234`)
- **BLE Operational GATT** — Nine-characteristic service `7aebf330-…` for
  settings/status records
- **OTA Updates** — RSA-PSS-signed OTA via the Fellow server; local upload via
  `/uploadfw`; companion app branded "EKG Updater"
- **LVGL** — Touch display UI (TFT via SPI) with PNG decoding; GUI split into
  `gui_game` / `gui_system` / `gui_tasks`
- **PID Temperature Control** — PID loop plus a triac thermal model,
  plateau/fast-rise boil heuristics, thermal-mass detection, volume-class
  PID thresholds, and reheat from hold
- **Low-Power Manager** — Autonomous light-sleep entry with a bench suite
  (internal tickets EKG-103 / EKG-115)
- **Buzzer** — PWM-driven audio alerts
- **NVS** — Non-volatile storage for device settings (Google IoT keys removed)

## Cloud Connectivity

### Google Cloud IoT Core (removed)

- No MQTT broker string (`mqtt.2030.ltsapis.goog` absent), no JWT/device-path
  templates, no `/devices/%s/…` topic strings, no `iotc_*` SDK sources.
- NVS keys `iotkey`, `iotprj`, `iotrgn`, `iotreg` removed; the `iot` CLI
  command removed from the dispatch table.
- The GTS LTSR TLS root was removed with the stack.
- The provisioning JSON no longer carries IoT fields; only Wi-Fi fields remain.

### Firmware OTA Server

- **Base URL**: `https://qhderznbzup.firmware.fellowproducts.com`
- **Endpoints**:
  - `GET /get_ota_device_firmware` — Download firmware (URL taken from the
    embedded OTA JSON `fwurl`; requires `id`, `mac`, `fwv`, `User-Agent`
    headers, now also `ota-enabled` and `region`)
  - `POST /confirm_firmware_install` — Confirm successful OTA install
  - `POST /set_firmware_time` — Sync device clock
  - `POST /send_metrics` — **new**: session telemetry

### OTA Config JSON (embedded)

The embedded OTA config is **byte-identical** to v1.1.76
(SHA256 `9a020049699746dd6007abc8fb2bf4248f8071f82d5ae91facaba38efd8b0b65`,
1791 bytes):

```json
{
  "fwp": "0.0.76",
  "fwurl": "https://qhderznbzup.firmware.fellowproducts.com/get_ota_device_firmware",
  "fwcert": "<base64 Starfield Root CA G2 (RSA), 1150 chars>",
  "sign": "<RSA-PSS signature block, 520 chars>"
}
```

- v1.2.26 location: DRAM file `0x15ed` (VA `0x3ffbf14d`)
- v1.1.76 location: DRAM file `0x15dd` (VA `0x3ffbf13d`) — same DRAM segment,
  shifted +16 bytes

RSA-PSS verification is intact (log strings unchanged): "OTA config OK.
time: hash…", "ets_rsa_pss_verify failed", "Bad sign string", "No sign in iot
config", "New firmware corrupted".

### Telemetry (new)

- **Endpoint**: `POST /send_metrics` on the OTA server.
- **Session payload** (embedded format string, DROM file `0x74fd`, VA
  `0x3f40751d`):

  ```json
  {"device_name":"%s","fw_version":"%s","mode":"%s","target_temp_c":%.2f,
   "time_to_relay_ms":%u,"time_to_target_ms":%u,"overshoot_c":%.2f,
   "triac_temp_c":%.1f,"temp_noise_c":%.2f,"calibration_c":%.2f,
   "altitude_raw":%d,"no_water_events":%d,"session_duration_ms":%u,
   "uptime_s":%u,"heap_free":%d,"heap_min_free":%d,"heap_largest_block":%d,
   "reset_reason":"%s","wifi_rssi":%d,"start_temp_c":%.2f,"volume_ml":%d,
   "fast_rise_max_c":%.2f,"fast_rise_raw_max_c":%.2f}
  ```

- **Sample payloads**: `{"temp":%.2f,"temp_set":%.2f,"state":"%s","pwm":%d,
  "timestamp":%u}` (DROM file `0x9940f`, adjacent to the CORS header strings)
  and `{"ADC":%d,"T":%lf,"mV":%lf}` (DROM file `0x643c`).
- **Outbound headers**: `id`, `mac`, `fwv`, `ota-enabled` (`true`/`false`/
  `unknown`), `region` (derived from the `SID_Language` setting; out-of-range
  values report `region=unknown`), `User-Agent: ESP32 HTTP Client/1.0`.
- **Failure logs**: "http init failed, dropping metrics", "set_identity_headers
  failed: %s, dropping metrics", "open failed: %s (0x%x)".
- Boil `mode` values reported: `guided`, `schedule`, `normal`, `pre-boil`.

## HTTP API (Local)

### Endpoints

Two static URI arrays of 16-byte `httpd_uri_t`
(`{uri, method, handler, user_ctx}`) are registered with the local HTTP
server:

- Array 1 at DROM file `0x99d74` (VA `0x3f499d74`)
- Array 2 at DROM file `0x99d94` (VA `0x3f499d94`)

The URI strings live in a single DROM pool at file `0x99d38`–`0x99d72`. Full
registration (11 entries):

| Endpoint | Method (raw) | Handler | Status |
|----------|--------------|---------|--------|
| `/` | 1 (GET) | 0x400ef3f4 | unchanged |
| `/temp` | 1 (GET) | 0x400ef08 | **new** |
| `/cli` | 1 (GET) | 0x400ef870 | unchanged |
| `/upload` | 1 (GET) | 0x400ef454 | unchanged |
| `/uploadfw` | 3 (POST) | 0x400efe8c | unchanged |
| `/uploadfw` | 6 | 0x400eef7c | **new** (inferred `OPTIONS`/CORS preflight) |
| `/api` | 1 (GET) | 0x400ef958 | unchanged |
| `/api` | 3 (POST) | 0x400ef958 | unchanged |
| `/upng` | 3 (POST) | 0x400eefbc | unchanged |
| `/htest` | 1 (GET) | 0x400ef174 | **new** |
| `/hperiod` | 1 (GET) | 0x400ef2d0 | **new** |

Method encoding carries over from v1.1.76 (`1` = GET, `3` = POST, identical
`/api` and `/upng` registrations). Raw method `6` is new; it is registered
only on `/uploadfw` alongside `Access-Control-Allow-Methods: POST, OPTIONS`,
so it is inferred to be the CORS `OPTIONS` preflight handler.

### `/temp` (new)

`GET /temp` returns a JSON sample:

```json
{"temp":%.2f,"temp_set":%.2f,"state":"%s","pwm":%d,"timestamp":%u}
```

(format string at DROM file `0x9940f`, VA `0x3f49942f`). Unauthenticated; the
same sample shape is used for telemetry reporting.

### `/htest` and `/hperiod` (new)

- `GET /htest?pwm=<0-100>&target=<C>` — "Heater test mode ON: pwm=%d%%
  target=%.1fC temp=%.1fC"; `GET /htest?off=1` — "Heater test mode OFF".
  Usage string: `Usage: /htest?pwm=<0-100>&target=<C>  enable`.
- `GET /hperiod?sec=<2|4|8>` — sets the PWM switching period ("Period:
  pwm_period=%d (~%ds at 50Hz, ~%.2fs at 60Hz)"; invalid values → "Error:
  sec must be 2, 4, or 8"). Usage string: `Usage: /hperiod?sec=<2|4|8>`.

Both are unauthenticated HTTP actuator-plane routes in the same quarantine
class as the CLI `heaton`/`warmon` paths.

### Authentication Scope

No `key`, `id`, authorization-header, or other authentication check occurs in
the local handlers before commands are dispatched — unchanged from v1.1.76.
The `httptest` cases involving `key` and `id` exercise the **outbound client
for the remote firmware-download service**, not the local server. The local
endpoints should therefore be treated as unauthenticated LAN control
surfaces.

### `/api` Wire Protocol

Unchanged from v1.1.76. Requests use five ordered, base-10 query fields and,
for writes, a packed little-endian binary body:

```text
GET /api?i=<ip>,p=<port>,d=<duration>,t=<record-type>,s=<session>
```

| `t` | GET behavior | POST/write behavior |
|-----|--------------|---------------------|
| `-1` | No record; refreshes destination/session timing, returns `OK` | Same |
| `3` | Returns the 17-byte `RT_Settings` record | Requires exactly 17 bytes; applies fields selected by its change mask |
| `4` | Returns a 39-byte status snapshot | Rejected |
| `5` | Processes an `RT_Params` body | Processes an `RT_Params` body (8-byte `{type, ordinal, value}`, types 0–7) |
| other | Bad request | Bad request |

The `RT_Settings` builder/parser and the `RT_Params` ordinal/session logic
are the same code paths shared with BLE characteristics `c4b5`/`c4b4` (see
"Operational GATT findings" in the v1.1.76 analysis for the full byte-level
spec).

### `/cli` Protocol

`GET /cli?cmd=<URL-encoded command>` — unchanged from v1.1.76: the handler
converts `+` to spaces, passes the string to the `esp_console` dispatcher
shared with the UART CLI, and returns `text/html` with the command form plus
CLI/log output. Any registered command can be invoked over HTTP.

The command table is at DROM file `0xf144` (VA `0x3f40f144`): **89 entries**
of 12 bytes `{name, desc, handler}` (v1.1.76: 80). As in v1.1.76,
`help`, `version`, `factory`, and `settempr` resolve outside the table
(strings present, same dispatch path).

### CLI Commands

New in v1.2.26 (10):

| Command | Description |
|---------|-------------|
| `set_calib_params <stability_target_s>` | Calibration stability target (default 5) |
| `set_fast_rise_params <window_s> [<threshold_c>] [<arm_suppress_s>]` | Fast-rise phase (defaults 2 / 8.0 / 3) |
| `set_plateau_params <window_s> [<delta_c>] [<arm_suppress_s>]` | Plateau end-of-boil heuristic (defaults 20 / 1.5 / 10) |
| `triactrace 1\|0` | Toggle 2-second CSV triac thermal trace (`TTRACE,ms,out,pwm,phase,triac_c,base_c,ot,E`) |
| `lpsleep [N]` | EKG-103 bench: light sleep N sec (default 10), dial press wakes |
| `lpclock <cycles> [sec]` / read | EKG-103 bench: LP clock-cycle bench + stats |
| `rtcdrift <sec>` / read | EKG-103 bench: RTC drift measurement |
| `lpdiag` | EKG-103 bench: print CPU MHz / WiFi state captured at last wake |
| `lpnow` | EKG-103: request autonomous low-power entry now (if idle + clock off) |
| `lpwhy` | EKG-115: print low-power entry guards + enter/skip verdict |

Removed (1): `iot` (Google IoT stack removed).

Unchanged quarantined set: `heaton`/`heatoff` (GPIO HEAT relay),
`warmon`/`warmoff`/`warmduty` (GPIO WARM triac), `set_period` (now described
as "set pwm period in seconds"), `max_duty`/`min_duty`, `gpioset`.

### BLE versus `/api` versus `/cli`

The v1.1.76 comparison table applies unchanged: BLE `c4b5`/`c4b4` and
`/api` records `t=3`/`t=4`/`t=5` are two transports over the same
`RT_Settings`/status/`RT_Params` code paths; `/cli` exposes the full console
including quarantined GPIO routes. v1.2.26 adds an HTTP-only surface
(`/temp` read, `/htest`/`hperiod` actuator control) that has no equivalent
BLE characteristic, while the new CLI commands cover the same thermal-model
tuning over the console.

## Device State & Settings

### Temperature Control

- PID controller plus **triac thermal model** (estimate, overtemp
  protection, cooling, "HOT-capping")
- **Plateau** end-of-boil heuristic and **fast-rise** phase detection, both
  user-tunable via CLI
- **Thermal-mass detection** and volume-class PID thresholds (LOW/MEDIUM/HIGH)
- **Reheat**: hold temp dropping below target returns to `S_Heat` ("Hold temp
  dropped %.1f°C below target %.1f°C -> S_Heat (reheat)")
- Altitude-adjusted boiling point, pre-boil mode, units °F/°C, schedule
  windows, no-water detection (unchanged)
- Fallback "relay bang-bang mode, accuracy reduced" when the thermal model
  cannot run

### Device States

Static `S_` strings (DROM), same set as v1.1.76: `S_Heat`, `S_HeatOff`,
`S_Hold`, `S_Calib_Started`, `S_Calib_Halted`, `S_Calib_aborted`,
`S_Calib_finish`, `S_Check_Wireless_setup`, `S_FAIL`, `S_Finished`,
`S_MenuExitToTempr`, `S_NoWater`, `S_OTA`, `S_OTA_Abort`, `S_OTA_Start`,
`S_Off`, `S_OnOff`, `S_Set_clock`, `S_Standby`, `S_StartupMenu`,
`S_StartupToMenu`, `S_StartupToTempr`, `S_Temperature`, `S_Time`,
`S_TIMEOUT`, `S_clocK_menu`.

New user-facing behavior around these states: reheat from hold, and boil
modes `guided` / `schedule` / `normal` / `pre-boil` (reported in telemetry
`mode`).

### Languages

Seven languages (English, French, Spanish, Simplified Chinese, Traditional
Chinese, Korean, Japanese — string pool at DROM file `0xee00`–`0xf000`), with
new **language-migration** logic in v1.2.26: "Language migration: '%s' ->
Japanese" / "-> Korean", "NV=4, left as Traditional Chinese", and the new
`langmig` setting. The "FW UPGRADE NEEDED FOR NEW LANG" path is retained.

## Default Credentials

- **BLE Provisioning PoP**: `abcd1234` (hardcoded in DROM; unchanged since
  v1.1.75)
- **Provisioning security**: ESP-IDF Security 1 (X25519 session establishment,
  followed by AES-CTR encrypted provisioning messages)
- **BLE service key**: `NULL` (ignored for the BLE transport)
- **Local HTTP authentication**: none
- **Secure Boot**: none (`Secure version: 0`)

## Extracted Segments

Segments extracted with esptool to `/private/tmp/ekg26/extracted/`:

| Segment | Size | Load Address | Memory Type | Description |
|---------|------|-------------|-------------|-------------|
| `segment_00` | 793,784 B | 0x3f400020 | DROM | Global data, strings, CA bundle, UI assets, static GATT/URI/CLI tables |
| `segment_01` | 4 B | 0x3ff80000 | RTC_DRAM | *(new)* replaces v1.1.76's 16 B RTC_DATA at 0x50000000 |
| `segment_02` | 29,344 B | 0x3ffbdb60 | DRAM | RAM data; embedded OTA config JSON at VA `0x3ffbf14d` |
| `segment_03` | 28,804 B | 0x40080000 | IRAM | Startup + IRAM functions |
| `segment_04` | 925,900 B | 0x400d0020 | IROM | Main application code |
| `segment_05` | 75,060 B | 0x40087084 | IRAM | *(new)* second IRAM segment (v1.1.76 had one 104,412 B segment) |
| `segment_06` | 47,520 B | 0x00000000 | PAD | Padding (0xFF) |

## Firmware Image Layout (for Ghidra scripting)

The v1.2.26 image uses the **esptool v5 segment format**: after the 24-byte
image header, each segment is preceded by an **8-byte in-file descriptor**
(`load_address` LE, `data_length` LE). `esptool image-info` reports
`File offs` pointing at the **descriptor**, so segment data starts at
`File offs + 8`.

### File offset map (image file offsets)

| Segment | Descriptor | Data | Data Size | Load Address | Memory Type |
|---------|-----------:|-----:|----------:|-------------:|-------------|
| DROM | `0x00000018` | `0x00000020` | 793,784 B (`0xc1cb8`) | `0x3f400020` | DROM |
| RTC_DRAM | `0x000c1cd8` | `0x000c1ce0` | 4 B (`0x4`) | `0x3ff80000` | RTC_DRAM |
| DRAM | `0x000c1ce4` | `0x000c1cec` | 29,344 B (`0x72a0`) | `0x3ffbdb60` | DRAM |
| IRAM | `0x000c8f8c` | `0x000c8f94` | 28,804 B (`0x7084`) | `0x40080000` | IRAM |
| IROM | `0x000d0018` | `0x000d0020` | 925,900 B (`0xe20cc`) | `0x400d0020` | IROM |
| IRAM 2 | `0x001b20ec` | `0x001b20f4` | 75,060 B (`0x12534`) | `0x40087084` | IRAM |
| PAD | `0x001c4628` | `0x001c4630` | 47,520 B (`0xb9a0`) | `0x00000000` | PADDING |

Footer: single-byte checksum `0xf8` (valid) at `0x1CFFDC`; SHA-256
validation hash (`7aecb485…c4302702`, valid) at `0x1CFFE0`–`0x1D000F`;
`0xFF` pad from `0x1D0010` to `0x1D0FFF`.

### Address mappings (image file offset → VA)

- **DROM**: `VA = 0x3f400000 + file` (data at file `0x20` maps to VA `0x3f400020`)
- **IROM**: `VA = 0x40000000 + file` (data at file `0xd0020` maps to VA `0x400d0020`)
- **DRAM**: `VA = 0x3ffbdb60 + (file − 0xc1cec)`
- **IRAM**: `VA = 0x40080000 + (file − 0xc8f94)`
- **IRAM 2**: `VA = 0x40087084 + (file − 0x1b20f4)`
- **RTC_DRAM**: `VA = 0x3ff80000 + (file − 0xc1ce0)`

> **Note:** The v1.1.76 images had no per-segment descriptors (segment data
> began directly at `File offs`), so the older file-offset mappings are off
> by 8 bytes for this image. Use the table above for v1.2.26-only offsets.

**When loading into Ghidra**: load each segment at its ESP32 load address
(not its file offset), skipping the 8-byte descriptor. IROM is typically
loaded first as the primary program; the other segments are added as
separate memory blocks at their load addresses.

## Source File Structure

Build root moved from `/home/lenovo/fellow/EKG_Pro/firmware/` to
`/project/firmware/` (per compiler debug strings in DROM):

```
/project/firmware/
├── main/
│   ├── main.cpp                 # Application entry
│   ├── kettle.hpp               # Kettle control logic
│   ├── gui_game.hpp             # LVGL UI: menu/game screens (was gui.hpp)
│   ├── gui_system.hpp           # LVGL UI: system screens
│   ├── gui_tasks.hpp            # LVGL UI: task/boil screens
│   ├── wifi.cpp                 # WiFi management (was wifi.hpp)
│   ├── wifi_prov.hpp            # WiFi provisioning (BLE)
│   ├── wifi_prov_manager_wrapper.c
│   ├── ble.hpp                  # BLE stack interface
│   ├── ble_impl.hpp             # BLE stack implementation
│   ├── ota.hpp                  # OTA update handling
│   ├── ota_download.hpp         # OTA download logic
│   ├── cli.hpp                  # CLI interface
│   ├── notify.hpp               # BLE/HTTP notifications
│   ├── notify_impl.hpp
│   ├── timer.hpp                # Timer/scheduler
│   ├── buzzer.hpp               # PWM buzzer
│   └── files/
│       └── upload_script.html   # Embedded /upload page (MAX_FILE_SIZE 0x200000 = 2 MB)
├── components/
│   └── lvgl_esp32_drivers/      # LVGL display drivers with PNG support
│       ├── lvgl_helpers.c
│       └── lvgl_tft/disp_spi.c
```

`components/esp-google-iot/` (Google Cloud IoT Core SDK) is **removed**.
`upload_script.html` is not a compiled unit (no compiler debug string), but
its HTML is embedded verbatim in DROM, including the source comment
`//#define MAX_FILE_SIZE 0x200000 // Max ekg-firmware.bin size…`.

## Certificates

### Embedded DER CA bundle (new, DROM)

A Mozilla-style root certificate store is embedded as **DER** binary in DROM,
spanning file `0xa4788`–`0xb3f21` (VA `0x3f4a47a8`–`0x3f4b3f41`, ~50 KB):

- **106 RSA** SubjectPublicKeyInfo OID markers
  (`06 09 2a 86 48 86 f7 0d 01 01 01`); plus ECC roots not covered by that
  marker
- **82 CommonName fields (79 unique)** recovered, including: Amazon Root CA
  1–4, DST Root CA X3, GTS Root R1–R4, GlobalSign (Root CA, R3, R46, E46),
  DigiCert (Global G2/G3/G4, Assured ID Root CA/G2/G3, High Assurance EV,
  Trusted Root G4), ISRG Root X1/X2 (Let's Encrypt), Entrust (Root
  Certification Authority, .net (2048), G2, G4, EC1), Trustwave Global ECC
  P256/P384, COMODO (RSA/ECC/Certification Authority), Go Daddy Root G2,
  Baltimore CyberTrust Root, IdenTrust (Commercial/Public Sector), SecureTrust
  CA, QuoVadis (Root CA 2/3, 1/2/3 G3), SwissSign Gold/Silver G2, Certum
  (Trusted Root CA, Trusted Network CA/2, EC-384), TWCA Global Root CA,
  CA Disig Root R2, emSign (Root CA C1/G1, ECC C3/G3), Hellenic Academic and
  Research Institutions (2011, 2015, ECC 2015), TUBITAK Kamu SM SSL, XRamp
  Global, Microsoft RSA/ECC Root 2017, Network Solutions CA, OISTE WISeKey
  Global Root GB/GC, vTrus (Root CA, ECC), Hongkong Post Root CA 1/3,
  GLOBALTRUST 2020, ANF Secure Server, SecureSign RootCA11, USERTrust
  RSA/ECC, **Starfield Root CA G2** and Starfield Services G2

The store includes the Starfield G2 root used for OTA signature verification.

### OTA signature CA (unchanged)

Starfield Root Certificate Authority G2 (RSA) remains the OTA-signing CA,
carried in the byte-identical OTA config JSON (`fwcert` + `sign`, RSA-PSS).

### Removed

The two app-specific DRAM roots of v1.1.76 — **GTS LTSR** (Google Trust
Services Long Term Self-signed Root, pinned for `mqtt.2030.ltsapis.goog`) and
**GlobalSign ECC Root CA R4** — are gone with the cloud stack. General TLS
verification now uses the embedded CA bundle above.

## Security Notes

- **Cloud attack surface removed** — no MQTT broker, JWT, or per-device cloud
  keys; the only remote dependency is the OTA server (HTTPS against the
  embedded CA bundle; firmware still RSA-PSS-signed)
- **Telemetry privacy** — session JSON carries `device_name` (BLE name
  `EKG-xx-xx-xx`), `fw_version`, `wifi_rssi`, `reset_reason`, heap statistics,
  `region`, and thermal/session data, sent with `id`/`mac` device-identity
  headers; no Wi-Fi SSID observed in the payload
- **New unauthenticated actuator routes** — `GET /htest` (heater PWM test)
  and `GET /hperiod` (PWM switching period) are HTTP actuator-plane routes in
  the same quarantine class as the CLI `heaton`/`warmon` paths
- **CORS + OPTIONS on `/uploadfw`** — LAN browser pages can preflight and
  POST a firmware binary; the embedded upload page (branded "EKG Updater")
  makes this a first-class LAN path. RSA-PSS signature verification still
  gates installation, but the transport no longer requires the CLI
- **Hardcoded BLE provisioning PoP** — `abcd1234` remains embedded and is used
  for every Security-1 provisioning session; not derived from the MAC or
  loaded from NVS
- **No Secure Boot** — `Secure version: 0`; ESP32 secure boot is not enabled
- **Bench/low-power CLI exposure** — `lpsleep`/`lpnow`/`lpclock` and friends
  are reachable over unauthenticated `/cli` and can force light-sleep entry;
  `wifion`/`wifioff` toggle Wi-Fi
- **Clock sync** — `POST /set_firmware_time` means a compromise of the OTA
  server (TLS-validated by the CA bundle, no issuer pinning) can skew device
  time, which feeds schedule and telemetry `timestamp` fields

## Tools Used

- **esptool v5.3.0** (`/Users/trcm/.local/bin/esptool`) — image parsing,
  segment extraction
- **Python 3** — byte-level segment extraction, static GATT/URI/CLI table
  scans, string diffing
- **strings + diff** — DROM string diff vs v1.1.76: 862 new / 830 removed
  unique strings
- **openssl** — certificate/CA-bundle structure analysis

> **Note:** Static analysis only. Unlike the v1.1.76 document (which includes
> the 2026-08-17 exhaustive live interface audit), no live hardware, BLE, or
> network audit was performed for v1.2.26. The operational GATT characteristic
> roles (expected to match v1.1.76) and the `OPTIONS` inference for raw
> method `6` are static expectations and should be confirmed on hardware.
