'use strict'

function positiveInterval(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getPollIntervals(config) {
    return {
        heating: positiveInterval(config.pollIntervalHeating, 10000),
        idle: positiveInterval(config.pollIntervalIdle, 1800000),
    };
}

function startTempPolling(log, config, updateTempFn, options = {}) {
    const { heating, idle } = getPollIntervals(config);
    const schedule = options.setTimeout || setTimeout;
    const now = options.now || Date.now;
    let lastIdleTemperatureUpdate = null;
    // Unknown at startup: the first poll runs immediately and the cadence
    // follows its result; default to the heating interval so the first state
    // check is quick.
    let lastIsHeating = 1;
    const markTemperatureUnavailable = () => {
        lastIdleTemperatureUpdate = null;
    };

    function poll() {
        const idleTemperatureDue = lastIdleTemperatureUpdate === null
            || now() - lastIdleTemperatureUpdate >= idle;

        Promise.resolve(updateTempFn(idleTemperatureDue)).then(({
            isHeating,
            temperatureUpdated,
            temperatureAvailable,
        }) => {
            if (temperatureAvailable === false) {
                // Forget the previous idle update when the kettle is off its
                // base. The first valid reading after it is returned will then
                // be published on the next state poll instead of waiting for
                // the full idle interval.
                markTemperatureUnavailable();
            } else if (isHeating !== 1 && idleTemperatureDue && temperatureUpdated) {
                lastIdleTemperatureUpdate = now();
            }
            if (isHeating !== null) {
                lastIsHeating = isHeating;
            }

            // While heating, poll at the heating cadence so temperature stays
            // fresh; while idle, wait the full idle interval (a kettle started
            // on the device is picked up at the next idle poll).
            schedule(poll, lastIsHeating === 1 ? heating : idle);
        }).catch((err) => {
            log.debug('Temperature poll failed:', err.message);
            schedule(poll, lastIsHeating === 1 ? heating : idle);
        });
    }

    if (options.beforeFirstPoll) {
        // e.g. wait for the initial kettle clock sync: the kettle serializes
        // HTTP requests, so issuing the first /temp read while a setclock is
        // in flight would queue it and trip Homebridge's slow-read warning.
        Promise.resolve(options.beforeFirstPoll).then(poll, poll);
    } else {
        poll();
    }

    return { markTemperatureUnavailable };
}

module.exports = { getPollIntervals, startTempPolling }
