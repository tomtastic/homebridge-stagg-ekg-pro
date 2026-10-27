'use strict'

const { version } = require('./package.json')
const StaggEKGProClient = require('./lib/stagg-ekg-pro-client')
const { getPollIntervals, startTempPolling } = require('./lib/temperature-polling')
const { TargetTemperatureEcho } = require('./lib/target-temperature-echo')

module.exports = (api) => {
    api.registerPlatform('homebridge-stagg-ekg-pro', 'StaggKettle', StaggKettlePlatform);
}

class StaggKettlePlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = new Map();

        api.on('didFinishLaunching', () => this._discoverDevices());
    }

    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }

    _discoverDevices() {
        const kettles = this.config.kettles || [];
        if (kettles.length === 0) {
            this.log.warn('No kettles configured — add at least one entry under "kettles" in the platform config.');
        }
        const seen = new Set();

        for (const config of kettles) {
            const uuid = this.api.hap.uuid.generate(config.name);
            seen.add(uuid);

            let accessory = this.accessories.get(uuid);
            if (accessory) {
                accessory.context.config = config;
                this.api.updatePlatformAccessories([accessory]);
            } else {
                accessory = new this.api.platformAccessory(config.name, uuid);
                accessory.context.config = config;
                this.api.registerPlatformAccessories('homebridge-stagg-ekg-pro', 'StaggKettle', [accessory]);
                this.accessories.set(uuid, accessory);
            }
            this._setupAccessory(accessory);
        }

        for (const [uuid, accessory] of this.accessories) {
            if (!seen.has(uuid)) {
                this.api.unregisterPlatformAccessories('homebridge-stagg-ekg-pro', 'StaggKettle', [accessory]);
                this.accessories.delete(uuid);
            }
        }
    }

    _setupAccessory(accessory) {
        const config = accessory.context.config;
        const { Service, Characteristic, HapStatusError, HAPStatus } = this.api.hap;
        new StaggEKGProWifiHandler(
            this.log,
            config,
            accessory,
            Service,
            Characteristic,
            HapStatusError,
            HAPStatus,
        );
    }
}

class StaggEKGProWifiHandler {
    constructor(log, config, accessory, Service, Characteristic, HapStatusError, HAPStatus) {
        const timeZone = resolveTimeZone(log, config);
        const client = new StaggEKGProClient(config.url, { timeZone });
        const minTemp = typeof config.minTemp === 'number' ? config.minTemp : 40;
        const maxTemp = typeof config.maxTemp === 'number' ? config.maxTemp : 100;

        let initialClockSync;
        if (config.syncTime === true) {
            const syncClock = () => client.syncClock()
                .then(() => log.info(`Synced ${config.name || 'kettle'} clock to local time.`))
                .catch(err => log.warn(`Could not sync ${config.name || 'kettle'} clock: ${err.message}`));

            initialClockSync = syncClock();
            this.clockSyncInterval = setInterval(syncClock, 24 * 60 * 60 * 1000);
            this.clockSyncInterval.unref?.();
        }

        accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Fellow')
            .setCharacteristic(Characteristic.Model, 'Stagg EKG Pro')
            .setCharacteristic(Characteristic.SerialNumber, '123-456-789');

        const service = accessory.getService(Service.Thermostat)
            || accessory.addService(Service.Thermostat);

        // The poll loop refreshes these at the heating or idle cadence;
        // characteristic reads are served from the cache so a HomeKit read
        // never has to wait on the kettle, which serializes /temp requests
        // and can push a read past Homebridge's slow-handler threshold. A
        // live read only happens before the first successful poll.
        let lastState = null;
        let lastTempC = null;
        let temperaturePolling;
        // What this handler last published for the heating state. HAP's Service has
        // no synchronous getter — Service#getValue is absent from the Homebridge 2.x
        // HAP — so the previous value is tracked here instead of read back.
        let publishedHeatingState = null;

        // The kettle stores its setpoint in whole °F, so a °C target set from
        // HomeKit comes back quantised (93 °C is stored as 199 °F and reported
        // as 92.7778 °C). The echo reports the commanded °C while the kettle
        // confirms that same setpoint, and gets out of the way as soon as the
        // reported target moves somewhere else.
        const targetEcho = new TargetTemperatureEcho(client);

        // Publish to HomeKit without letting a rejected update abort the poll. The
        // poller needs the poll's result to choose the next interval, so a failing
        // characteristic is logged (once per streak) instead of thrown, which would
        // silently look like a kettle that never stops asking for fast polls.
        let publishFailures = 0;
        const publish = (name, characteristic, value) => {
            try {
                service.updateCharacteristic(characteristic, value);
                publishFailures = 0;
            } catch (err) {
                if (publishFailures === 0) {
                    log.warn(`Could not publish ${name} to HomeKit: ${err.message}`);
                } else {
                    log.debug(`Could not publish ${name} to HomeKit: ${err.message}`);
                }
                publishFailures += 1;
            }
        };

        // Push a heating state we already know: the kettle reported it, or HomeKit
        // just commanded it. Both characteristics move together, matching what the
        // read handlers return, and the cached state is patched to agree, so the
        // tile flips the moment the user acts instead of at the next /temp read.
        const publishHeatingState = (value) => {
            publish('CurrentHeatingCoolingState', Characteristic.CurrentHeatingCoolingState, value);
            publish('TargetHeatingCoolingState', Characteristic.TargetHeatingCoolingState, value);
            publishedHeatingState = value;
            if (lastState) lastState = { ...lastState, isHeating: value };
        };

        const readState = async () => {
            if (lastState) return lastState;
            try {
                lastState = await client.readState();
            } catch (err) {
                // Surface a communication failure so HomeKit keeps the last
                // known values instead of logging a plugin error for every
                // read. Transient /temp failures are expected whenever the
                // kettle is off its base, so keep those at info level.
                const logLevel = err instanceof StaggEKGProClient.StateUnavailableError ? 'info' : 'warn';
                log[logLevel](`Kettle state unavailable, is the kettle off its base or unreachable? ${err.message}`);
                throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
            }
            return lastState;
        };

        service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(async () => {
                const { isHeating } = await readState();
                return isHeating;
            })
            .onSet(async (value) => {
                try {
                    await client.commandAsync(`setstate ${client.stateForHomeKit(value)}`);
                    // Report the commanded state straight away, then read once at
                    // the heating cadence to confirm the kettle obeyed. Without
                    // that read, a kettle that was resting at the idle interval
                    // would leave HomeKit showing the previous state until the
                    // interval elapsed, which is what made a switched-off kettle
                    // look like it was still heating.
                    publishHeatingState(value);
                    if (value === 1) {
                        temperaturePolling?.markHeating();
                    } else {
                        temperaturePolling?.refreshSoon();
                    }
                } catch (err) {
                    log.warn(`Failed to set kettle state: ${err.message}`);
                    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
            });

        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(async () => {
                const { isHeating } = await readState();
                return isHeating;
            });

        service.getCharacteristic(Characteristic.TargetTemperature)
            .setProps({ minValue: minTemp, maxValue: maxTemp })
            .onGet(async () => {
                const { targetC } = await readState();
                if (targetC === null) {
                    log.info(`Kettle target temp unavailable, is the kettle off its base or unreachable?`);
                    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return targetEcho.resolve(targetC);
            })
            .onSet(async (value) => {
                try {
                    const targetF = Math.round(client.cToF(value));
                    await Promise.all([
                        client.commandAsync(`setsetting settempr ${targetF}`),
                        client.commandAsync(`setstate S_Heat`),
                    ]);
                    // Only echo a target the kettle actually accepted.
                    targetEcho.command(value);
                    publishHeatingState(1);
                    temperaturePolling?.markHeating();
                } catch (err) {
                    log.warn(`Failed to set kettle temperature: ${err.message}`);
                    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
            });

        service.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({ minValue: 0, maxValue: 100 })
            .onGet(async () => {
                if (lastTempC === null) {
                    const { tempC } = await readState();
                    if (tempC === null) {
                        temperaturePolling?.markTemperatureUnavailable();
                        log.info('No temp data, is kettle off its base?');
                        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                    lastTempC = tempC;
                }
                return lastTempC;
            });

        // Periodic polling with configurable intervals for heating vs idle
        temperaturePolling = startTempPolling(log, config, async (idleTemperatureDue) => {
            const state = await client.readState();
            const { isHeating, tempC } = state;
            lastState = state;
            if (tempC !== null) lastTempC = tempC;
            let temperatureUpdated = false;
            if (tempC !== null && (isHeating === 1 || idleTemperatureDue)) {
                publish('CurrentTemperature', Characteristic.CurrentTemperature, tempC);
                temperatureUpdated = true;
            }
            if (isHeating !== null && isHeating !== publishedHeatingState) {
                // The kettle changed state on its own: started at the dial,
                // finished boiling, moved into or out of a hold, or powered off.
                publishHeatingState(isHeating);
            }
            return {
                // The HomeKit-visible heating state, S_Hold included: if the tile
                // reads heating, the loop keeps watching at the heating cadence.
                heating: isHeating === null ? null : isHeating === 1,
                temperatureUpdated,
                temperatureAvailable: tempC !== null,
            };
        }, {
            // The kettle serializes HTTP requests, so let the first /temp
            // read happen only after the initial setclock has finished.
            beforeFirstPoll: initialClockSync,
        });

        // Say what this instance is doing: the version and the resolved cadence
        // make a wrong or stale deployment obvious from the Homebridge log
        // instead of a packet capture.
        const { heating, idle } = getPollIntervals(config);
        log.info(`${config.name || 'Kettle'}: homebridge-stagg-ekg-pro v${version}, reading /temp every `
            + `${heating}ms while heating or holding temperature and every ${idle}ms otherwise.`);

        service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(async () => 0)
            .onSet(async () => {});
    }
}

// Validate the configured IANA zone once per accessory so a typo is reported
// once at startup instead of on every clock sync. Returns null to mean "use the
// Homebridge host timezone".
function resolveTimeZone(log, config) {
    const name = typeof config.timeZone === 'string' ? config.timeZone.trim() : '';
    if (!name) return null;
    if (!StaggEKGProClient.isValidTimeZone(name)) {
        log.warn(`Unrecognised timeZone "${name}" for ${config.name || 'kettle'} — using the Homebridge host timezone.`);
        return null;
    }
    return name;
}
