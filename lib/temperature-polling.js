'use strict'

// Consecutive reads that give us no usable state (kettle unreachable, still
// joining Wi-Fi, or in a state this plugin does not recognise) that are retried
// at the fast cadence before the loop falls back to the idle interval. Keeps
// Homebridge startup responsive without letting an unreadable kettle poll at the
// heating cadence forever.
const UNKNOWN_RETRY_LIMIT = 6;

// How long to hold the fast cadence after a start-heating command we sent
// ourselves: the kettle takes a moment to leave S_Off/S_Standby, and HomeKit is
// waiting for the state change plus the rising temperature that follows it.
const HEAT_CONFIRM_TIMEOUT = 30000;

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
    const cancelSchedule = options.clearTimeout || clearTimeout;
    const now = options.now || Date.now;
    const unknownRetryLimit = positiveInterval(options.unknownRetryLimit, UNKNOWN_RETRY_LIMIT);
    const heatConfirmTimeout = positiveInterval(options.heatConfirmTimeout, HEAT_CONFIRM_TIMEOUT);

    let lastIdleTemperatureUpdate = null;
    // The loop keeps the fast cadence while HomeKit shows the kettle as heating,
    // which covers the heater running (S_Heat, ramping to the setpoint) and
    // holding temperature (S_Hold). Being off, standing by or sitting in a menu
    // rest at the idle interval, and unrecognised reads get the bounded retries
    // instead — nothing pins the fast cadence indefinitely. Watching what HomeKit
    // displays, rather than the heater alone, is what stops a kettle that has
    // settled into a hold window from going out of contact for 15 minutes.
    let kettleHeating = false;
    let heatCommandedAt = null;
    let unknownReads = 0;
    let timer = null;
    let pendingDelay = 0;
    let sleeping = false;

    const markTemperatureUnavailable = () => {
        lastIdleTemperatureUpdate = null;
    };

    // Called after a command that starts heating. Shorten a pending idle sleep so
    // a boil started from HomeKit is visible at the heating cadence instead of at
    // the end of the idle interval.
    const markHeating = () => {
        heatCommandedAt = now();
        if (sleeping && pendingDelay > heating) {
            cancelSchedule(timer);
            arm(heating);
        }
    };

    // Called after a command that does not start heating, above all switching the
    // kettle off. One read at the heating cadence confirms the kettle obeyed, and
    // the loop then rests: unlike markHeating this opens no confirmation window,
    // so a kettle switched off goes back to the idle interval.
    const refreshSoon = () => {
        if (sleeping && pendingDelay > heating) {
            cancelSchedule(timer);
            arm(heating);
        }
    };

    function nextDelay() {
        // The retry budget is checked first so it bounds the fast cadence in every
        // case. A kettle that was heating and then stopped answering — lifted off
        // its base mid-boil, or Wi-Fi dropping — would otherwise stay on the last
        // known heating state and be polled at the fast interval indefinitely.
        if (unknownReads > unknownRetryLimit) return idle;
        if (kettleHeating) return heating;
        if (heatCommandedAt !== null && now() - heatCommandedAt < heatConfirmTimeout) return heating;
        if (unknownReads > 0) return heating;
        return idle;
    }

    function arm(delay) {
        pendingDelay = delay;
        sleeping = true;
        timer = schedule(poll, delay);
    }

    function poll() {
        sleeping = false;
        timer = null;
        pendingDelay = 0;

        const idleTemperatureDue = lastIdleTemperatureUpdate === null
            || now() - lastIdleTemperatureUpdate >= idle;

        Promise.resolve(updateTempFn(idleTemperatureDue)).then((result) => {
            const { heating: kettleReported, temperatureUpdated, temperatureAvailable } = result || {};

            if (temperatureAvailable === false) {
                // Forget the previous idle update when the kettle is off its base. The
                // first valid reading after it is returned will then be published on the
                // next state poll instead of waiting for the full idle interval.
                lastIdleTemperatureUpdate = null;
            } else if (kettleReported !== true && idleTemperatureDue && temperatureUpdated) {
                lastIdleTemperatureUpdate = now();
            }

            if (kettleReported === true) {
                kettleHeating = true;
                heatCommandedAt = null;
                unknownReads = 0;
            } else if (kettleReported === false) {
                kettleHeating = false;
                unknownReads = 0;
            } else {
                unknownReads += 1;
            }
            // A read that was already in flight when we commanded a start cannot
            // confirm or deny that command, so the pending window is closed by its
            // own timeout rather than by the next result.
            if (heatCommandedAt !== null && now() - heatCommandedAt >= heatConfirmTimeout) {
                heatCommandedAt = null;
            }

            arm(nextDelay());
        }).catch((err) => {
            // A poll that fails after the /temp read succeeded (a rejected publish,
            // say) used to be logged at debug level only, which made a loop stuck on
            // the fast cadence invisible. Warn once per streak of failures.
            if (unknownReads === 0) {
                log.warn(`Temperature poll failed, retrying at the ${heating}ms cadence `
                    + `for up to ${unknownRetryLimit} reads: ${err.message}`);
            } else {
                log.debug('Temperature poll failed:', err.message);
            }
            unknownReads += 1;
            arm(nextDelay());
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

    return { markTemperatureUnavailable, markHeating, refreshSoon };
}

module.exports = { getPollIntervals, startTempPolling }
