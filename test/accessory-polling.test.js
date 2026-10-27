'use strict'

const assert = require('assert')
const { test } = require('node:test')

const plugin = require('../index')

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realFetch = globalThis.fetch

// Payloads as observed on firmware 1.2.26 at GET /temp. The first is a kettle
// switched off on its base: not heating, water at room temperature.
const KETTLE_OFF = '{"temp":30.11,"temp_set":91.11,"state":"S_Off","pwm":-10,"timestamp":1185211212}'
const KETTLE_HEATING = '{"temp":71.5,"temp_set":91.11,"state":"S_Heat","pwm":100,"timestamp":1185241212}'
// Boiled and holding at the setpoint: HomeKit shows this as heating, so it is
// watched at the heating cadence too.
const KETTLE_HOLD = '{"temp":90.89,"temp_set":91.11,"state":"S_Hold","pwm":0,"timestamp":1185251212}'
const KETTLE_UNKNOWN = '{"temp":30.11,"temp_set":91.11,"state":"S_Mystery","pwm":-10,"timestamp":1185211212}'
// The same kettle with the setpoint at 199 °F, which is what the hardware
// stores for a HomeKit target of 93 °C.
const KETTLE_TARGET_199F = '{"temp":71.5,"temp_set":92.7778,"state":"S_Heat","pwm":100,"timestamp":1185241212}'

// The Homebridge API surface this plugin uses. Deliberately minimal, and
// notably hap.Service here has no getValue(), matching the hap-nodejs build
// bundled with Homebridge 2.x: reading a published characteristic back is not
// possible, and doing so used to throw in the middle of every temperature poll,
// which pinned the loop at the heating cadence forever without a warning.
function characteristic(name) {
  return { name, UUID: `uuid-${name}` }
}

const Service = {
  AccessoryInformation: characteristic('AccessoryInformation'),
  Thermostat: characteristic('Thermostat'),
}

const Characteristic = {
  Manufacturer: characteristic('Manufacturer'),
  Model: characteristic('Model'),
  SerialNumber: characteristic('SerialNumber'),
  TargetHeatingCoolingState: characteristic('TargetHeatingCoolingState'),
  CurrentHeatingCoolingState: characteristic('CurrentHeatingCoolingState'),
  TargetTemperature: characteristic('TargetTemperature'),
  CurrentTemperature: characteristic('CurrentTemperature'),
  TemperatureDisplayUnits: characteristic('TemperatureDisplayUnits'),
}

class FakeHandler {
  constructor() {
    this.props = null
    this.getHandler = null
    this.setHandler = null
  }

  setProps(props) { this.props = props; return this }
  onGet(fn) { this.getHandler = fn; return this }
  onSet(fn) { this.setHandler = fn; return this }
}

class FakeService {
  constructor(descriptor, options = {}) {
    this.descriptor = descriptor
    this.failOnPublish = options.failOnPublish === true
    this.published = []
    this.handlers = new Map()
  }

  setCharacteristic() { return this }

  getCharacteristic(descriptor) {
    if (!this.handlers.has(descriptor.UUID)) {
      this.handlers.set(descriptor.UUID, new FakeHandler())
    }
    return this.handlers.get(descriptor.UUID)
  }

  updateCharacteristic(descriptor, value) {
    if (this.failOnPublish) throw new Error('characteristic rejected by HomeKit')
    this.published.push({ name: descriptor.name, value })
  }

  handler(name) {
    return this.getCharacteristic(Characteristic[name])
  }
}

class FakeAccessory {
  constructor(name, uuid, options = {}) {
    this.displayName = name
    this.UUID = uuid
    this.context = {}
    this.options = options
    this.services = new Map([
      [Service.AccessoryInformation.UUID, new FakeService(Service.AccessoryInformation, options)],
    ])
  }

  getService(descriptor) { return this.services.get(descriptor.UUID) }

  addService(descriptor) {
    const service = new FakeService(descriptor, this.options)
    this.services.set(descriptor.UUID, service)
    return service
  }
}

function makeApi(options = {}) {
  const events = {}
  const api = {
    version: '2.4.0',
    Platform: null,
    accessoryOptions: options,
    on(event, fn) { events[event] = fn; return api },
    emit(event) { if (events[event]) events[event](); return api },
    registerPlatform(pluginName, platformName, ctor) { api.Platform = ctor },
    registerPlatformAccessories() {},
    updatePlatformAccessories() {},
    unregisterPlatformAccessories() {},
    // A method shorthand is not constructible, and Homebridge uses
    // `new api.platformAccessory(...)`.
    platformAccessory: function (name, uuid) {
      return new FakeAccessory(name, uuid, api.accessoryOptions)
    },
    hap: {
      uuid: { generate: (value) => `uuid-${value}` },
      Service,
      Characteristic,
      HapStatusError: class HapStatusError extends Error {
        constructor(status, message) {
          super(message || 'communication failure')
          this.status = status
        }
      },
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
    },
  }
  return api
}

// Capture the poll loop's timers so cadence is asserted without waiting, and
// answer the kettle's HTTP endpoints so the accessory can be driven end to end.
function installTimers() {
  const scheduled = []
  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay, cancelled: false }
    scheduled.push(handle)
    return handle
  }
  globalThis.clearTimeout = (handle) => { if (handle) handle.cancelled = true }

  const pending = () => scheduled.filter((handle) => !handle.cancelled).pop()
  return {
    delays: () => scheduled.map((handle) => handle.delay),
    pendingDelay: () => {
      const handle = pending()
      return handle ? handle.delay : null
    },
    async firePending() {
      const handle = pending()
      if (!handle) throw new Error('nothing scheduled')
      handle.cancelled = true
      handle.fn()
      await flush()
    },
  }
}

async function flush() {
  for (let i = 0; i < 25; i++) await Promise.resolve()
  await new Promise(resolve => realSetTimeout(resolve, 0))
  for (let i = 0; i < 25; i++) await Promise.resolve()
}

function restoreGlobals() {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
  globalThis.fetch = realFetch
}

function tempReads(requests) {
  return requests.filter((url) => url.includes('/temp')).length
}

function published(service) {
  return service.published.map((entry) => [entry.name, entry.value])
}

// Boot one accessory the way Homebridge does, and let the first poll settle.
async function startKettle(kettleOverrides = {}, options = {}) {
  const timers = installTimers()
  const requests = []
  const payload = options.tempPayload === undefined ? KETTLE_OFF : options.tempPayload
  globalThis.fetch = async (url) => {
    const href = String(url)
    requests.push(href)
    if (options.fetchFails) throw new Error('ECONNREFUSED')
    if (href.includes('/temp')) {
      // A function payload lets a test change what the kettle reports mid-run.
      const body = typeof payload === 'function' ? payload() : payload
      return { status: 200, text: async () => body }
    }
    return { status: 200, text: async () => 'OK' }
  }

  const logs = { info: [], warn: [], debug: [] }
  const log = {
    info: (message) => logs.info.push(String(message)),
    warn: (message) => logs.warn.push(String(message)),
    error: (message) => logs.warn.push(String(message)),
    debug: (...args) => logs.debug.push(args.join(' ')),
  }

  const api = makeApi(options)
  plugin(api)
  const platform = new api.Platform(log, {
    platform: 'StaggKettle',
    name: 'StaggKettle',
    kettles: [{
      name: 'Kettle',
      url: 'http://192.168.8.196',
      pollIntervalHeating: 10000,
      pollIntervalIdle: 900000,
      ...kettleOverrides,
    }],
  }, api)
  api.emit('didFinishLaunching')
  await flush()

  const accessory = platform.accessories.get('uuid-Kettle')
  return { api, platform, accessory, timers, requests, logs, thermostat: accessory.getService(Service.Thermostat) }
}

test('the accessory publishes on startup and names the cadence it resolved', async () => {
  try {
    const { thermostat, logs } = await startKettle()

    assert.equal(typeof thermostat.getValue, 'undefined', 'the emulated HAP must not offer Service#getValue')
    assert.deepStrictEqual(published(thermostat), [
      ['CurrentTemperature', 30.11],
      ['CurrentHeatingCoolingState', 0],
      ['TargetHeatingCoolingState', 0],
    ])
    assert.ok(logs.info.some((line) => line.includes('every 10000ms') && line.includes('every 900000ms')),
      `startup should log the resolved cadence, got: ${JSON.stringify(logs.info)}`)
    assert.deepStrictEqual(logs.warn, [])
  } finally {
    restoreGlobals()
  }
})

test('a switched-off kettle reads /temp once and then waits for the idle interval', async () => {
  try {
    const { requests, timers, logs } = await startKettle()

    assert.equal(tempReads(requests), 1)
    assert.equal(timers.pendingDelay(), 900000,
      'a resting kettle must not be polled at the heating cadence')
    assert.deepStrictEqual(logs.warn, [])
  } finally {
    restoreGlobals()
  }
})

test('an actively heating kettle keeps the fast cadence', async () => {
  try {
    const { timers, thermostat } = await startKettle({}, { tempPayload: KETTLE_HEATING })

    assert.equal(timers.pendingDelay(), 10000)
    assert.deepStrictEqual(published(thermostat), [
      ['CurrentTemperature', 71.5],
      ['CurrentHeatingCoolingState', 1],
      ['TargetHeatingCoolingState', 1],
    ])
  } finally {
    restoreGlobals()
  }
})

test('a kettle holding at the setpoint keeps the fast cadence', async () => {
  try {
    const { timers, thermostat } = await startKettle({}, { tempPayload: KETTLE_HOLD })

    assert.equal(timers.pendingDelay(), 10000,
      'a kettle HomeKit shows as heating must not rest at the idle interval')
    assert.deepStrictEqual(published(thermostat), [
      ['CurrentTemperature', 90.89],
      ['CurrentHeatingCoolingState', 1],
      ['TargetHeatingCoolingState', 1],
    ])
  } finally {
    restoreGlobals()
  }
})

test('switching the kettle off from HomeKit reports it without waiting for a poll', async () => {
  try {
    const { requests, thermostat } = await startKettle({}, { tempPayload: KETTLE_HEATING })
    assert.deepStrictEqual(published(thermostat).slice(-2), [
      ['CurrentHeatingCoolingState', 1],
      ['TargetHeatingCoolingState', 1],
    ])
    thermostat.published.length = 0

    await thermostat.handler('TargetHeatingCoolingState').setHandler(0)
    await flush()

    assert.ok(requests.some((url) => url.includes('cmd=setstate+S_Off')),
      `expected a stop command, got: ${JSON.stringify(requests)}`)
    assert.deepStrictEqual(published(thermostat), [
      ['CurrentHeatingCoolingState', 0],
      ['TargetHeatingCoolingState', 0],
    ], 'the tile should flip to off as soon as the kettle accepts the command')
    assert.equal(await thermostat.handler('CurrentHeatingCoolingState').getHandler(), 0)
    assert.equal(await thermostat.handler('TargetHeatingCoolingState').getHandler(), 0)
  } finally {
    restoreGlobals()
  }
})

// The reported bug: the kettle had finished boiling and was holding, polling had
// settled back to the idle interval, and a switch-off from HomeKit left the tile
// reading "Heating to 91.0 °F" for the rest of the idle interval.
test('a switch-off while the loop is resting is confirmed at the heating cadence', async () => {
  try {
    let payload = KETTLE_HEATING
    const { timers, thermostat } = await startKettle({}, { tempPayload: () => payload })
    assert.equal(timers.pendingDelay(), 10000)

    // The kettle stops answering while heating (off its base, Wi-Fi drop). The
    // retry budget expires and the loop rests, with HomeKit still showing heating.
    payload = KETTLE_UNKNOWN
    for (let i = 0; i < 7; i++) await timers.firePending()
    assert.equal(timers.pendingDelay(), 900000)

    payload = KETTLE_OFF
    await thermostat.handler('TargetHeatingCoolingState').setHandler(0)
    await flush()

    assert.deepStrictEqual(published(thermostat).slice(-2), [
      ['CurrentHeatingCoolingState', 0],
      ['TargetHeatingCoolingState', 0],
    ])
    assert.equal(timers.pendingDelay(), 10000, 'the confirmation read is scheduled at the heating cadence')

    await timers.firePending()
    assert.equal(timers.pendingDelay(), 900000, 'the confirmed off kettle rests at the idle interval')
  } finally {
    restoreGlobals()
  }
})

test('a rejected HomeKit publish does not derail the cadence', async () => {
  try {
    const { timers, requests, logs } = await startKettle({}, { failOnPublish: true })

    assert.equal(timers.pendingDelay(), 900000,
      'a publish failure must not fall back to the heating cadence')
    assert.equal(tempReads(requests), 1)
    assert.ok(logs.warn.some((line) => line.includes('Could not publish')),
      `a publish failure should be logged, got: ${JSON.stringify(logs.warn)}`)
  } finally {
    restoreGlobals()
  }
})

test('HomeKit reads are answered from the cache without touching the kettle', async () => {
  try {
    const { requests, thermostat } = await startKettle()
    const before = requests.length

    assert.equal(await thermostat.handler('CurrentTemperature').getHandler(), 30.11)
    assert.equal(await thermostat.handler('CurrentHeatingCoolingState').getHandler(), 0)
    assert.equal(await thermostat.handler('TargetHeatingCoolingState').getHandler(), 0)
    assert.equal(requests.length, before, 'reads should be served from the last poll')
    assert.equal(thermostat.handler('TargetTemperature').props.minValue, 40)
  } finally {
    restoreGlobals()
  }
})

test('starting the kettle from HomeKit switches the loop to the heating cadence', async () => {
  try {
    const { requests, timers, thermostat } = await startKettle()
    assert.equal(timers.pendingDelay(), 900000)

    await thermostat.handler('TargetHeatingCoolingState').setHandler(1)
    await flush()

    assert.ok(requests.some((url) => url.includes('cmd=setstate+S_Heat')),
      `expected a start command, got: ${JSON.stringify(requests)}`)
    assert.deepStrictEqual(timers.delays(), [900000, 10000])
  } finally {
    restoreGlobals()
  }
})

test('setting a target temperature starts the heater and keeps the commanded setpoint', async () => {
  try {
    const { requests, timers, thermostat } = await startKettle({}, { tempPayload: KETTLE_TARGET_199F })

    await thermostat.handler('TargetTemperature').setHandler(93)
    await flush()

    assert.ok(requests.some((url) => url.includes('cmd=setsetting+settempr+199')),
      `expected the setpoint write, got: ${JSON.stringify(requests)}`)
    assert.ok(requests.some((url) => url.includes('cmd=setstate+S_Heat')))
    assert.equal(timers.pendingDelay(), 10000)
    // The kettle stores 199 °F and reports 92.7778 °C; the echo keeps HomeKit
    // showing the 93 °C that was actually commanded.
    assert.equal(await thermostat.handler('TargetTemperature').getHandler(), 93)
  } finally {
    restoreGlobals()
  }
})

test('a setpoint changed on the kettle overrides an earlier command', async () => {
  try {
    const { thermostat } = await startKettle()

    await thermostat.handler('TargetTemperature').setHandler(93)
    await flush()

    // The kettle now reports 196 °F, somewhere the command never pointed, so
    // HomeKit gets the kettle's own target back instead of the stale echo.
    assert.equal(await thermostat.handler('TargetTemperature').getHandler(), 91.11)
  } finally {
    restoreGlobals()
  }
})

test('an unrecognised state retries a bounded number of times, then rests', async () => {
  try {
    const { timers, logs } = await startKettle({}, { tempPayload: KETTLE_UNKNOWN })

    // Six fast retries are allowed for a state the plugin cannot classify...
    for (let i = 0; i < 5; i++) await timers.firePending()
    assert.equal(timers.pendingDelay(), 10000)

    // ...and the seventh gives up on the fast cadence and waits the idle
    // interval instead of hammering /temp forever.
    await timers.firePending()
    assert.equal(timers.pendingDelay(), 900000)
    assert.deepStrictEqual(logs.warn, [])
  } finally {
    restoreGlobals()
  }
})

test('an unreachable kettle is retried and reported once per streak', async () => {
  try {
    const { timers, requests, logs } = await startKettle({}, { fetchFails: true })

    assert.ok(tempReads(requests) >= 1)
    assert.equal(timers.pendingDelay(), 10000)
    await timers.firePending()
    await timers.firePending()
    assert.equal(logs.warn.filter((line) => line.includes('Temperature poll failed')).length, 1,
      'repeated failures should warn once, then stay quiet')

    await timers.firePending()
    await timers.firePending()
    await timers.firePending()
    await timers.firePending()
    assert.equal(timers.pendingDelay(), 900000, 'an unreachable kettle must stop polling fast')
  } finally {
    restoreGlobals()
  }
})
