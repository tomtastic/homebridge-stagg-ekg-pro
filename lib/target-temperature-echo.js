'use strict'

// Half of one integer °F step. The kettle stores its setpoint as whole degrees
// Fahrenheit, so one step is 0.5556 °C and half a step is 0.2778 °C: 0.3
// accepts the setpoint we just commanded while rejecting the adjacent one.
const TARGET_TOLERANCE_C = 0.3

// HomeKit works in °C with 0.1 °C resolution; the kettle holds whole °F. A
// target set from HomeKit therefore comes back quantised (e.g. 93 °C is stored
// as 199 °F and reported as 92.7778 °C), which makes HomeKit show a target the
// user never picked. Remembering the commanded °C and echoing it back while the
// kettle reports the matching quantised setpoint keeps the reported target
// stable without hiding genuine changes made on the kettle itself.
class TargetTemperatureEcho {
    constructor (converter) {
        this.converter = converter;
        this.commandedC = null;
        this.storedC = null;
    }

    // Record a target the caller has just successfully written to the kettle.
    // storedC is the °C the hardware can actually hold, i.e. the setpoint after
    // the °F round-trip, which is what later /temp reports echo against.
    command (celsius) {
        this.commandedC = celsius;
        this.storedC = this.converter.fToC(Math.round(this.converter.cToF(celsius)));
    }

    // Replace the kettle's reported target with the °C we commanded when it
    // matches the quantised setpoint. Anything else is a real change (the dial
    // or the kettle's own UI moved the target), so the echo is dropped and the
    // reported value is passed through.
    //
    // There is deliberately no TTL: the comparison is against the quantised
    // setpoint, so a genuine dial change clears the echo by itself, whereas a
    // timeout would let the quantised value leak back into HomeKit.
    resolve (reportedC) {
        if (this.commandedC === null || this.storedC === null) return reportedC;
        if (!Number.isFinite(reportedC)) return reportedC;
        if (Math.abs(reportedC - this.storedC) <= TARGET_TOLERANCE_C) return this.commandedC;
        this.commandedC = null;
        this.storedC = null;
        return reportedC;
    }
}

module.exports = { TargetTemperatureEcho, TARGET_TOLERANCE_C }
