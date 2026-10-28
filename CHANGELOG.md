# Changelog

## [1.2.5](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.2.5) - 2026-10-28

### Changed

- Declared Homebridge 2.0 readiness: `engines.homebridge` is now `^1.6.0 || ^2.0.0` (was `>=1.3.0 <3.0.0`). This is the range the Homebridge UI readiness check reads for the *ready for Homebridge 2* tick; the plugin already runs on Homebridge 2.x, the metadata now says so.
- `engines.node` is now `^22.12.0 || ^24.0.0 || ^26.0.0` (was `>=20.0.0`). Homebridge 2.x requires Node 22 or newer, so a Node 20 claim could never be satisfied there.

### Added

- README badge linking to the [Homebridge v2 migration guide](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0), plus live npm version and download badges.

## [1.2.4](https://github.com/tomtastic/homebridge-stagg-ekg-pro/releases/tag/v1.2.4) - 2026-10-27

### Fixed

- An idle kettle is no longer polled at the heating cadence forever. `Service#getValue` does not exist in the HAP implementation bundled with Homebridge 2.x, so every temperature poll threw `TypeError: service.getValue is not a function` immediately *after* the `/temp` read succeeded. The error was logged only at debug level, and the poll loop fell back to `pollIntervalHeating` — which is why a switched-off kettle was seen hitting `/temp` every 10 seconds on the network. The heating state last published to HomeKit is now tracked by the plugin instead of read back from the service.
- A poll that fails after a successful read is logged as a warning (once per streak of failures) instead of only at debug level, so a loop stuck at the fast cadence is visible in the Homebridge log. A rejected HomeKit publish can no longer abort the rest of a poll.
- The kettle's resting states are now recognised, above all `S_Standby` — what the kettle reports while sitting switched off on its base. They were previously "unknown", which kept the fast cadence alive. `S_Off`, `S_HeatOff`, `S_Finished`, `S_TIMEOUT`, `S_NoWater`, `S_FAIL`, the menu/clock states, the OTA states and the calibration outcomes are all covered, together with the firmware's `S_` string table.
- A kettle that cannot be read no longer polls fast indefinitely. Unusable reads (unreachable, off its base, or a state this plugin does not know) are retried at `pollIntervalHeating` six times and then rest at `pollIntervalIdle`. The retry budget is now evaluated before the last known heating state, so a kettle that was heating and then dropped off the network also stops polling fast instead of holding the fast cadence on a state it reported minutes ago.
- Switching the kettle off from HomeKit no longer leaves the tile showing *Heating to 91 °F*. `TargetHeatingCoolingState` writes did not publish anything, so the tile kept the previous value, and if the loop happened to be resting it was not refreshed until the whole idle interval had passed. The commanded state is now published as soon as the kettle accepts it, and one confirmation read follows at `pollIntervalHeating`.

### Changed

- The poll cadence follows the HomeKit-visible heating state rather than the heater alone, so `S_Hold` (keep-warm) is polled at `pollIntervalHeating` like `S_Heat`. HomeKit shows a holding kettle as *heating*, and a kettle that has just finished boiling is the one you are most likely to switch off; resting it at the idle interval meant that switch was invisible for up to 15 minutes.
- `S_Calib_finish` is now reported as not heating — calibration has finished by then.
- Switching the kettle on, or setting a setpoint, from HomeKit now publishes *Heating* immediately and switches polling to `pollIntervalHeating`, so the state change and the rising temperature are visible in seconds rather than at the end of the idle interval. The fast cadence holds for up to 30 seconds while the kettle leaves `S_Off`/`S_Standby`, then follows whatever the kettle reports.

### Added

- Each kettle logs its plugin version and resolved polling cadence at startup, e.g. `Kettle: homebridge-stagg-ekg-pro v1.2.4, reading /temp every 10000ms while heating or holding temperature and every 900000ms otherwise.` A stale deployment or an unexpected interval is now visible in the Homebridge log rather than only in a packet capture.
- Accessory-level tests that boot the platform against an emulated Homebridge 2.x HAP (no `Service#getValue`), covering cadence, cached reads, publish failures, bounded retries, keep-warm cadence and the immediate publish plus confirmation read behind a HomeKit switch-off.
- `docs/polling-flow.mmd` and a README section documenting the poll loop as a state machine — `HEATING`/`HOLDING`/`RESTING`/`UNKNOWN`, the transitions between them, the HomeKit command shortcuts, and the timeout applied at each step.
- README section *Measured against the diagram*, recording the cadence measured on the wire with a real kettle: 30 consecutive fast reads at 10.1-10.4 s across the `S_Heat` ramp and the whole `S_Hold` window, one confirmation read 7.4 s after a HomeKit switch-off, and the next `/temp` exactly 900.11 s after the tick that reported `S_Off`.

### Removed

- `test/_harness.js` and the inline runner in `test/read-state.test.js`. Every suite now runs on the built-in `node:test` runner, so `npm test` is a single `node --test test/*.test.js` (95 cases) instead of a chain of `&&`-joined files, and pass/fail is reported by the runner rather than by a hand-rolled `console.log` helper.
- `tools/kettle.sh`, the interactive shell helper with completion for the raw kettle CLI that was used while reverse engineering the firmware. It was never shipped in the package, is referenced by neither the README nor CI, and the command reference lives in the firmware write-ups on the wiki.

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
