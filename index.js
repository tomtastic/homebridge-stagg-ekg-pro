'use strict'

const StaggEKGProClient = require('./lib/stagg-ekg-pro-client')
const { startTempPolling } = require('./lib/temperature-polling')

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
        const client = new StaggEKGProClient(config.url);
        const minTemp = typeof config.minTemp === 'number' ? config.minTemp : 40;
        const maxTemp = typeof config.maxTemp === 'number' ? config.maxTemp : 100;

        if (config.syncTime === true) {
            const syncClock = () => client.syncClock()
                .then(() => log.info(`Synced ${config.name || 'kettle'} clock to local time.`))
                .catch(err => log.warn(`Could not sync ${config.name || 'kettle'} clock: ${err.message}`));

            syncClock();
            this.clockSyncInterval = setInterval(syncClock, 24 * 60 * 60 * 1000);
            this.clockSyncInterval.unref?.();
        }

        accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Fellow')
            .setCharacteristic(Characteristic.Model, 'Stagg EKG Pro')
            .setCharacteristic(Characteristic.SerialNumber, '123-456-789');

        const service = accessory.getService(Service.Thermostat)
            || accessory.addService(Service.Thermostat);

        service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(async () => {
                const { isHeating } = await client.readState();
                if (isHeating === null) throw new Error('unrecognised state');
                return isHeating;
            })
            .onSet(async (value) => {
                await client.commandAsync(`setstate ${client.stateForHomeKit(value)}`);
            });

        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .setProps({ validValues: [0, 1] })
            .onGet(async () => {
                const { isHeating } = await client.readState();
                if (isHeating === null) throw new Error('unrecognised state');
                return isHeating;
            });

        service.getCharacteristic(Characteristic.TargetTemperature)
            .setProps({ minValue: minTemp, maxValue: maxTemp })
            .onGet(async () => {
                const { targetC } = await client.readState();
                if (targetC === null) throw new Error('could not parse target temp');
                return targetC;
            })
            .onSet(async (value) => {
                const targetF = Math.round(client.cToF(value));
                await Promise.all([
                    client.commandAsync(`setsetting settempr ${targetF}`),
                    client.commandAsync(`setstate S_Heat`),
                ]);
            });

        let temperaturePolling;
        service.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({ minValue: 0, maxValue: 100 })
            .onGet(async () => {
                const { tempC } = await client.readState();
                if (tempC === null) {
                    temperaturePolling?.markTemperatureUnavailable();
                    log.info('No temp data, is kettle off its base?');
                    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                }
                return tempC;
            });

        // Periodic polling with configurable intervals for heating vs idle
        temperaturePolling = startTempPolling(log, config, async (idleTemperatureDue) => {
            const { isHeating, tempC } = await client.readState();
            let temperatureUpdated = false;
            if (isHeating === 1 || idleTemperatureDue) {
                if (tempC !== null) {
                    service.updateCharacteristic(Characteristic.CurrentTemperature, tempC);
                    temperatureUpdated = true;
                }
            }
            if (isHeating !== null && isHeating !== service.getValue(Characteristic.CurrentHeatingCoolingState)) {
                // The kettle changed state (started on the device, finished
                // boiling, or was powered off). Push both states so HomeKit
                // clients do not keep showing the stale heating state; the
                // target mirrors the current state, matching what the read
                // handlers return.
                service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, isHeating);
                service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, isHeating);
            }
            return {
                isHeating,
                temperatureUpdated,
                temperatureAvailable: tempC !== null,
            };
        });

        service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(async () => 0)
            .onSet(async () => {});
    }
}
