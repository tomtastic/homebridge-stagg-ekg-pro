# EKG Pro Firmware Analysis — v1.1.75SSP

## Overview

| Field | Value |
|-------|-------|
| **Device** | Fellow EKG Pro (smart electric kettle) |
| **Chip** | ESP32 - https://www.espboards.dev/esp32/esp32-wroom/ |
| **SDK** | ESP-IDF v4.4 |
| **Firmware Version** | 1.1.75SSP |
| **Build Date** | May 9, 2024 14:03:33 |
| **Source Path** | `/home/lenovo/fellow/EKG_Pro/firmware/` |
| **Flash** | 8MB, 40MHz, DIO mode |
| **File Size** | 1,576,960 bytes (0x181000) |
| **ELF SHA256** | `f78102e3afe62e9f7d9aa3b7bd5aabe11dd11af0825f7bd63414c2c02b9877d6` |

## Architecture

- **HTTP Server** — Local control API with `/api` and `/cli` endpoints
- **Google Cloud IoT Core** — MQTT over TLS for cloud connectivity
- **BLE Provisioning** — WiFi credentials provisioned via BLE (protocomm)
- **OTA Updates** — Firmware updates via Google IoT + HTTP download
- **LVGL** — Touch display UI (TFT via SPI)
- **PID Temperature Control** — PID loop for precise water heating
- **Buzzer** — PWM-driven audio alerts
- **NVS** — Non-volatile storage for device settings

## Cloud Connectivity

### MQTT Broker
- **Hostname**: `mqtt.2030.ltsapis.goog` (Google Cloud IoT Core)
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

### IoT Config Keys (NVS)
| Key | Description |
|-----|-------------|
| `iotkey` | Device private key for JWT signing |
| `iotprj` | Google Cloud project ID |
| `iotrgn` | Google Cloud region |
| `iotreg` | Device registry ID |

## HTTP API (Local)

The device runs an HTTP server with at least:
- `/api` — JSON API for device state and control
- `/cli` — Web-based CLI interface (HTML form with command input)

### HTTP Auth
The firmware validates requests with `key` and `id` headers (seen in HTTP test log messages).

### CLI Commands (observed)
- `setsettings <key> <value>` — Set device settings
- `clock=<h>:<m>` — Set device clock
- Temperature settings: `settempF`, `settemp2C`, `schedtempF`, `schedtemp2C`

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
- Calibration states: `Calibration`, `Calibration Fail`, `Calibration Halted`, `Calibration Aborted`

### Error Screens (embedded PNGs)
- `error screen - add water.png`
- `error screen - Set confirm water.png`
- `error screen - Enable Wireless.png`
- `error screen - cannot turn wifi.png`
- `error screen - Set clock.png`
- `error screen - Calibration in progress.png`
- `error screen - kettle not connected to network.png`
- `Downloading.png`

### BLE GATT
- Custom characteristic for provisioning (`gatt_svr_chr_access_sec_prov`)
- Temperature notifications (`ble_send_tempr`)
- Device name format: `EKG-%02x-%02x-%02x` (MAC-derived)

## Default Credentials

- **BLE Provisioning Password**: `abcd1234` (default seen in firmware)

## Extracted Segments

| Segment | Size | Load Address | Memory Type | Description |
|---------|------|-------------|-------------|-------------|
| `segment_00` | 484,976 B | 0x3f400020 | DROM | Global data, strings, Google IoT SDK |
| `segment_01` | 30,760 B | 0x3ffbdb60 | DRAM | RAM data, GlobalSign CA cert |
| `segment_02` | 8,528 B | 0x40080000 | IRAM | Startup/entry code |
| `segment_03` | 942,332 B | 0x400d0020 | IROM | Main application code |
| `segment_04` | 95,884 B | 0x40082150 | IRAM | IRAM functions |
| `segment_05` | 16 B | 0x50000000 | RTC | RTC retained data |
| `segment_06` | 10,240 B | 0x00000000 | PAD | Padding |

## Source File Structure

```
/home/lenovo/fellow/EKG_Pro/firmware/
├── main/
│   ├── main.cpp          # Application entry
│   ├── kettle.hpp         # Kettle control logic
│   ├── gui.hpp            # LVGL display
│   ├── wifi.hpp           # WiFi management
│   ├── wifi_prov.hpp      # WiFi provisioning (BLE)
│   ├── ble.hpp            # BLE stack
│   ├── ota.hpp            # OTA update handling
│   ├── ota_download.hpp   # OTA download logic
│   ├── cli.hpp            # CLI interface
│   ├── buzzer.hpp         # PWM buzzer
│   ├── timer.hpp          # Timer/scheduler
│   ├── notify.hpp         # BLE notifications
│   └── wifi_prov_manager_wrapper.c
├── components/
│   ├── esp-google-iot/    # Google Cloud IoT Core SDK
│   └── lvgl_esp32_drivers/ # LVGL display drivers
```

## Certificates

- **GlobalSign ECC Root CA** — Embedded in segment 1 (DR) for TLS verification

## Tools & Packages Installed

Installed via `uv` in the project's virtual environment:
- **esptool** — ESP32 firmware parsing/extraction
- **capstone** — CPU disassembly (for deeper analysis)
- **pwntools** — Binary exploitation utilities
- **pyelftools** — ELF file parsing
- **python-magic** — File type detection
- **zstandard** — Zstd decompression
- **construct** — Binary data parsing
- **cryptography** — Crypto primitives
- **rich** / **ipython** — Interactive exploration
