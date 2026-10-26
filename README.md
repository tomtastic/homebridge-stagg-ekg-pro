# homebridge-stagg-ekg-pro

Homebridge plugin for the Fellow Stagg EKG Pro, talking to the kettle over Wi-Fi via its built-in HTTP CLI API.

Fork of [calvinmclean/homebridge-kettle](https://github.com/calvinmclean/homebridge-kettle).

## Install

```
npm install -g homebridge-stagg-ekg-pro
```

## Config

```json
"platforms": [
    {
        "platform": "StaggKettle",
        "name": "Kettles",
        "kettles": [
            {
                "name": "Kettle",
                "url": "http://192.168.1.32",
                "minTemp": 40,
                "maxTemp": 100,
                "pollIntervalHeating": 10000,
                "pollIntervalIdle": 1800000,
                "syncTime": true
            }
        ]
    }
]
```

Each entry in `kettles` becomes one accessory in HomeKit.

| Field | Required | Description |
|---|---|---|
| `name` | yes | Name shown in HomeKit |
| `url` | yes | Base URL of the kettle. No trailing slash. |
| `minTemp` | no | Minimum target temp in °C (default: 40) |
| `maxTemp` | no | Maximum target temp in °C (default: 100) |
| `pollIntervalHeating` | no | Temperature polling interval while heating, in milliseconds (default: 10000 / 10 seconds) |
| `pollIntervalIdle` | no | Temperature polling interval while idle, in milliseconds (default: 1800000 / 30 minutes) |
| `syncTime` | no | Set the kettle clock to the host system's local time when Homebridge starts and once per day (default: `false`) |

The plugin checks kettle state every `pollIntervalHeating` so it detects heating
promptly. It publishes temperatures at that interval while heating and at
`pollIntervalIdle` while idle. These settings are configured separately for each
kettle.

## Wi-Fi CLI

Talks directly to the EKG Pro's built-in HTTP CLI (`/cli?cmd=...`). Requires firmware that supports `setstate` and `setsetting settempr`.

Firmware 1.2.26+ no longer prints `state` output from the CLI endpoint and instead serves the kettle state as JSON at `GET /temp` (e.g. `{"temp":24.86,"temp_set":93.0,"state":"S_Off"}` with °C values and the same `S_*` state tokens). The plugin reads `/temp` first and falls back to the legacy `state` CLI text for older firmware, so both are supported. Control commands (`setstate`, `setsetting`) are unchanged.

The firmware emits a bare `nan` for `temp` (invalid JSON) when the sensor has no reading, for example while the kettle is powered off. The plugin sanitizes this and keeps reporting the last known temperature; the kettle state and target remain available in that situation.

Set `syncTime` to `true` to synchronize the kettle clock with the local time of the system running Homebridge during module initialization and once every 24 hours. The plugin uses the kettle's `setclock` CLI command.

## Homebridge UI

A config schema is included — use the graphical form in Homebridge Config UI X to configure the plugin.
