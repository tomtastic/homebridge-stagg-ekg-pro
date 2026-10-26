'use strict'

// Thrown when the kettle's state cannot be determined from either the /temp
// endpoint or the legacy CLI. On firmware 1.2.26 the `state` CLI no longer
// prints a state (it serves the HTML form), so this is reached after a
// transient /temp failure. Consumers should treat it as a temporary
// communication problem, not a programming error.
class StateUnavailableError extends Error {
    constructor (message) {
        super(message);
        this.name = 'StateUnavailableError';
    }
}

class StaggEKGProClient {
    // `timeZone` is an IANA zone name (e.g. "Europe/London") used for the
    // `setclock` command. When omitted the host's local time is used, which is
    // UTC in a default Docker container — see the README.
    constructor (url, { timeZone } = {}) {
        let baseUrl = (url || "").replace(/\?.*$/, "");
        if (baseUrl.endsWith("/cli")) {
            baseUrl = baseUrl.slice(0, -"/cli".length);
        }
        baseUrl = baseUrl.replace(/\/+$/, "");
        this.cliUrl = baseUrl + "/cli";
        this.tempUrl = baseUrl + "/temp";
        this._inflight = new Map();
        this.timeZone = typeof timeZone === "string" && timeZone.trim() !== ""
            ? timeZone.trim()
            : null;
    }

    // True when `name` is a zone this runtime understands. Falsy and blank names
    // return false so callers can pass a config value straight through.
    static isValidTimeZone (name) {
        if (!name || typeof name !== "string") return false;
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: name.trim() });
            return true;
        } catch {
            return false;
        }
    }

    _encode (cmd) {
        return String(cmd).split(" ").map(encodeURIComponent).join("+");
    }

    commandAsync (cmd) {
        if (!this.cliUrl || this.cliUrl === "/cli") {
            return Promise.reject(new Error("Missing kettle url; set config.url to the kettle base URL."));
        }
        if (this._inflight.has(cmd)) return this._inflight.get(cmd);
        const encoded = this._encode(cmd);
        const promise = fetch(`${this.cliUrl}?cmd=${encoded}`, { signal: AbortSignal.timeout(5000) })
            .then(res => res.text())
            .finally(() => this._inflight.delete(cmd));
        this._inflight.set(cmd, promise);
        return promise;
    }

    command (cmd, callback) {
        this.commandAsync(cmd).then(body => callback(null, body)).catch(err => callback(err));
    }

    // Firmware 1.2.26+ no longer prints the `state` CLI output; it serves the
    // kettle state as JSON at GET /temp, e.g.
    //   {"temp":24.86,"temp_set":93.00,"state":"S_Off","pwm":-10,"timestamp":...}
    // parseTempJson returns { state, tempC, targetC } for such payloads, or
    // null for anything that is not the expected shape. tempC uses the same
    // 0-100 C guard as parseTemp; targetC is not range-guarded, matching
    // parseTargetTemp.
    parseTempJson (text) {
        let data;
        try {
            data = JSON.parse(this._sanitizeNonJsonTokens(text));
        } catch {
            return null;
        }
        if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.state !== "string") {
            return null;
        }
        const tempC = this._parseJsonTemp(data.temp);
        const targetC = this._parseJsonTemp(data.temp_set);
        return {
            state: data.state,
            tempC: tempC !== null && tempC >= 0 && tempC <= 100 ? tempC : null,
            targetC,
        };
    }

    _parseJsonTemp (value) {
        if (value === null || value === undefined) return null;
        if (typeof value === "string") {
            if (value.trim().toLowerCase() === "nan") return null;
            value = Number(value.trim());
        }
        return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    // Firmware 1.2.26 emits a bare `nan` (not valid JSON) when the sensor
    // has no reading, e.g. the kettle is lifted off its base:
    //   {"temp":nan,"temp_set":93.00,"state":"S_Off",...}
    // Without this, JSON.parse throws and the whole payload — including the
    // still-usable state and temp_set fields — is lost, and readState falls
    // back to the legacy CLI `state` command, which 1.2.26 no longer serves.
    // Replace the bare non-numeric value tokens with null so the object
    // parses; _parseJsonTemp already turns null into an unavailable reading.
    _sanitizeNonJsonTokens (text) {
        return String(text).replace(
            /([:,]\s*)(-?(?:nan|NaN|NAN|infinity|Infinity))(\s*[,\}\]])/g,
            '$1null$3',
        );
    }

    // Read kettle state, preferring the /temp JSON endpoint (firmware 1.2.26+)
    // and falling back to the legacy `state` CLI text for older firmware.
    // Rejects only when the legacy CLI fetch itself fails.
    async readState () {
        try {
            const res = await fetch(this.tempUrl, { signal: AbortSignal.timeout(5000) });
            if (res.status === 200) {
                const parsed = this.parseTempJson(await res.text());
                if (parsed) {
                    return {
                        isHeating: this.parseState(parsed.state),
                        tempC: parsed.tempC,
                        targetC: parsed.targetC,
                    };
                }
            }
        } catch {
            // fall through to the legacy CLI endpoint
        }
        const body = await this.commandAsync("state");
        const isHeating = this.parseState(body);
        if (isHeating === null) {
            // Firmware 1.2.26 answers the legacy `state` command with the HTML
            // form, so a /temp hiccup that reaches this point is a transient
            // kettle communication failure rather than a new state.
            throw new StateUnavailableError('kettle state unavailable from /temp and the state CLI');
        }
        return {
            isHeating,
            tempC: this.parseTemp(body),
            targetC: this.parseTargetTemp(body),
        };
    }

    clockCommand (date = new Date()) {
        if (this.timeZone) {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: this.timeZone,
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }).formatToParts(date);
            const field = (type) => {
                const part = parts.find((p) => p.type === type);
                return Number.parseInt(part ? part.value : "0", 10) || 0;
            };
            // hour12: false reports midnight as 24 on some ICU builds; the
            // kettle expects an hour cycle of 0-23.
            return `setclock ${field("hour") % 24} ${field("minute")} ${field("second")}`;
        }
        return `setclock ${date.getHours()} ${date.getMinutes()} ${date.getSeconds()}`;
    }

    syncClock (date = new Date()) {
        return this.commandAsync(this.clockCommand(date));
    }

    parseState (body) {
        const text = (body || "").trim();
        if (/\bS_(Heat|Hold|StartupToTempr|Calib_(Started|finish))\b/i.test(text)) {
            return 1;
        }
        if (/\bS_Off\b/i.test(text)) {
            return 0;
        }
        return null;
    }

    stateForHomeKit (value) {
        return value === 1 ? "S_Heat" : "S_Off";
    }

    parseTemp (body) {
        const labeled = this._parseTempLine(body, "tempr");
        // A structured state response can explicitly report `tempr=nan` when
        // no sensor reading is available. In that case, do not fall back to a
        // timestamp or another unrelated number elsewhere in the response.
        const hasTempField = /\btempr\s*=/i.test(body || "");
        const value = labeled !== null
            ? labeled
            : (hasTempField ? null : this._parseFirstNumber(body));

        // The firmware reports a large sentinel-like value when the kettle is
        // lifted from its base. Do not pass impossible readings to HomeKit,
        // whose CurrentTemperature characteristic only accepts up to 100 C.
        return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    }

    parseTargetTemp (body) {
        const target = this._parseTempLine(body, "temprT");
        if (target !== null) return target;
        return this._parseTempLine(body, "temps");
    }

    fToC (f) {
        return (f - 32) / 1.8;
    }

    cToF (c) {
        return (c * 1.8) + 32;
    }

    _parseTempLine (body, label) {
        const re = new RegExp(`\\b${label}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*([CF])?`, "i");
        const match = (body || "").match(re);
        if (!match) return null;
        const value = parseFloat(match[1]);
        const unit = (match[2] || "C").toUpperCase();
        return unit === "F" ? this.fToC(value) : value;
    }

    _parseFirstNumber (body) {
        const match = (body || "").match(/-?\d+(?:\.\d+)?/);
        return match ? parseFloat(match[0]) : null;
    }
}

module.exports = StaggEKGProClient
module.exports.StateUnavailableError = StateUnavailableError
