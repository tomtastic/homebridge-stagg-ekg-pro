# Changelog

## [1.2.3](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.2.3) - 2026-10-26

### Fixed

- `TargetTemperature` no longer drifts to the kettle's quantised setpoint after a HomeKit write. The kettle stores whole degrees Fahrenheit, so setting 93 °C came back as 92.7778 °C and HomeKit displayed the quantised value. The plugin now reports the °C it commanded while the kettle confirms the matching stored setpoint, and reports the kettle's own target as soon as it moves elsewhere (e.g. turned on the dial).
- Clock sync (`syncTime`) no longer silently uses UTC when Homebridge runs in a container that has no local timezone configured.

### Added

- Optional per-kettle `timeZone` — an IANA zone name such as `Europe/London` — that `syncTime` uses to set the kettle clock. Blank (the default) keeps using the Homebridge host timezone. An unrecognised zone is logged once during startup and clock sync falls back to the host timezone.

## [1.2.2](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.2.2) - 2026-10-26

### Fixed

- When `syncTime` is enabled, the first temperature poll now waits for the initial kettle clock sync to finish, so it no longer queues behind the `setclock` command on the kettle's serial HTTP server and triggers a one-off slow-read warning at Homebridge startup.

## [1.2.0](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.2.0) - 2026-10-26

### Added

- `supports-hap` package keyword.

### Changed

- Supports Node `>=20` and CI tests Node v20/v22/v24, covering all supported LTS versions per the Homebridge verified plugin requirements.
- Fixed the stale `pollIntervalIdle` description in the config schema.

### Fixed

- Every kettle read failure now surfaces as a HomeKit communication failure (with a log message) instead of throwing unhandled errors from the characteristic handlers.
- Command failures from the `TargetHeatingCoolingState` and `TargetTemperature` set handlers are now logged and reported to HomeKit as a communication failure.

## [1.1.3](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.1.3) - 2026-10-26

### Changed

- The kettle is now polled at `pollIntervalIdle` while idle and at `pollIntervalHeating` while heating, instead of always polling at the heating cadence — an idle kettle only touches `/temp` at the idle interval.
- HomeKit characteristic reads are served from the last poll (a live read only happens before the first successful poll), so reads no longer queue behind poll requests on the kettle's serial HTTP server and trigger slow-read-handler warnings.

## [1.1.2](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.1.2) - 2026-10-26

### Fixed

- When the kettle state cannot be read at all (a transient `/temp` failure on firmware 1.2.26, whose legacy `state` CLI no longer prints anything), the plugin now reports a HomeKit communication failure instead of throwing `unrecognised state` / `could not parse target temp` plugin errors. HomeKit keeps the last known values until the next successful poll.

## [1.1.1](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.1.1) - 2026-10-26

### Fixed

- Firmware 1.2.26 emits a bare `nan` for `temp` (invalid JSON) when the sensor has no reading, e.g. while the kettle is off its base. The payload is now sanitized so the state and target temperature remain available and HomeKit keeps the last known temperature instead of the plugin throwing `unrecognised state`.
- `CurrentHeatingCoolingState` / `TargetHeatingCoolingState` are pushed when the kettle's state changes, so HomeKit clients stop showing a stale heating state.

## [1.1.0](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.1.0) - 2026-10-26

First release of `homebridge-stagg-ekg-pro` (successor to `homebridge-kettle-pro`, Fellow Stagg EKG Pro only).

### Added

- Support for firmware 1.2.26: the kettle no longer prints `state` output from the CLI endpoint, so the plugin now reads state from `GET /temp` (JSON: `temp`, `temp_set`, `state`) and falls back to the legacy `state` CLI text for older firmware. Control commands (`setstate`, `setsetting`) are unchanged.
- Adaptive temperature polling (`pollIntervalHeating` / `pollIntervalIdle`).
- Optional daily kettle clock synchronization (`syncTime`).

### Removed

- The EKG+ BLE bridge support.
