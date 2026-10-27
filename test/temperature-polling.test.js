'use strict'

const assert = require('assert')
const { test } = require('node:test')
const { getPollIntervals, startTempPolling } = require('../lib/temperature-polling')

// Let the poll promise chain settle without real timers.
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Records what the loop asks for next, so cadence is asserted without waiting.
function makeTimer() {
  const timer = {
    pending: null,
    cancelled: 0,
    setTimeout(fn, delay) { const handle = { fn, delay }; timer.pending = handle; return handle },
    clearTimeout(handle) { timer.cancelled += 1; if (timer.pending === handle) timer.pending = null },
    delay() { return timer.pending.delay },
    async fire() { const handle = timer.pending; timer.pending = null; handle.fn(); await flush() },
  }
  return timer
}

const quietLog = { debug() {}, warn() {} }

// results is a single value used for every poll, an array of values indexed by
// poll number, or a function of (pollNumber, idleTemperatureDue).
function pollWithResults(results, options = {}) {
  const { pollIntervalHeating, pollIntervalIdle, ...pollingOptions } = options
  const timer = makeTimer()
  const log = { debug() {}, warn: () => { log.warnings += 1 }, warnings: 0 }
  const clock = { value: 0 }
  let polls = 0
  const polling = startTempPolling(log, {
    pollIntervalHeating: pollIntervalHeating === undefined ? 10 : pollIntervalHeating,
    pollIntervalIdle: pollIntervalIdle === undefined ? 1000 : pollIntervalIdle,
  }, async (idleTemperatureDue) => {
    const result = typeof results === 'function'
      ? results(polls, idleTemperatureDue)
      : (Array.isArray(results) ? results[Math.min(polls, results.length - 1)] : results)
    polls += 1
    if (result instanceof Error) throw result
    return result
  }, {
    now: () => clock.value,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    ...pollingOptions,
  })
  return { timer, log, clock, polling, polls: () => polls }
}

test('invalid intervals fall back to defaults', () => {
  assert.deepStrictEqual(getPollIntervals({
    pollIntervalHeating: 0,
    pollIntervalIdle: NaN,
  }), {
    heating: 10000,
    idle: 1800000,
  })
})

test('temperature is due immediately and then at its own interval', async () => {
  const due = []
  const { timer, clock } = pollWithResults((poll, idleTemperatureDue) => {
    due.push(idleTemperatureDue)
    return { heating: false, temperatureUpdated: idleTemperatureDue }
  })

  await flush()
  assert.deepStrictEqual(due, [true])
  assert.strictEqual(timer.delay(), 1000)

  clock.value = 1000
  await timer.fire()
  assert.deepStrictEqual(due, [true, true])
  assert.strictEqual(timer.delay(), 1000)
})

test('the loop runs at the heating cadence only while the heater is running', async () => {
  const { timer } = pollWithResults([
    { heating: true, temperatureUpdated: true },
    { heating: true, temperatureUpdated: true },
    { heating: false, temperatureUpdated: true },
  ])

  await flush()
  assert.strictEqual(timer.delay(), 10)
  await timer.fire()
  assert.strictEqual(timer.delay(), 10)
  await timer.fire()
  assert.strictEqual(timer.delay(), 1000)
})

// S_Off / S_Standby map to heating false in the client; a kettle nobody
// is using must not be read at the heating interval.
test('an at-rest kettle is read once and then at the idle interval', async () => {
  const { timer, polls } = pollWithResults({ heating: false, temperatureUpdated: true })

  await flush()
  for (let i = 0; i < 4; i++) await timer.fire()
  assert.strictEqual(polls(), 5)
  assert.strictEqual(timer.delay(), 1000)
})

test('an unrecognised state retries at the heating cadence and then rests', async () => {
  const { timer } = pollWithResults({
    heating: null,
    temperatureUpdated: false,
    temperatureAvailable: false,
  })

  const delays = []
  await flush()
  delays.push(timer.delay())
  for (let i = 0; i < 6; i++) {
    await timer.fire()
    delays.push(timer.delay())
  }
  assert.deepStrictEqual(delays, [10, 10, 10, 10, 10, 10, 1000])
})

test('failing reads retry at the heating cadence, warn once, then rest', async () => {
  const { timer, log } = pollWithResults(new Error('kettle offline'))

  const delays = []
  await flush()
  delays.push(timer.delay())
  for (let i = 0; i < 6; i++) {
    await timer.fire()
    delays.push(timer.delay())
  }
  assert.deepStrictEqual(delays, [10, 10, 10, 10, 10, 10, 1000])
  assert.strictEqual(log.warnings, 1)
})

// The reported bug: a kettle at rest was read on the heating cadence, so a boil
// started from HomeKit waited on a loop that was never going to hurry.
test('markHeating shortens a pending idle read', async () => {
  const { timer, polling } = pollWithResults({ heating: false, temperatureUpdated: true })

  await flush()
  assert.strictEqual(timer.delay(), 1000)

  polling.markHeating()
  assert.strictEqual(timer.cancelled, 1, 'the idle sleep was cancelled')
  assert.strictEqual(timer.delay(), 10, 'the next read is at the heating cadence')
})

test('a local start keeps the fast cadence until the kettle confirms heating', async () => {
  const { timer, polling } = pollWithResults([
    { heating: false, temperatureUpdated: true },   // before the command
    { heating: false, temperatureUpdated: true },    // still settling
    { heating: true, temperatureUpdated: true },     // confirmed
    { heating: false, temperatureUpdated: true },    // done holding cadence
  ])

  await flush()
  assert.strictEqual(timer.delay(), 1000)

  polling.markHeating()
  assert.strictEqual(timer.cancelled, 1)
  assert.strictEqual(timer.delay(), 10)

  await timer.fire()
  assert.strictEqual(timer.delay(), 10, 'unconfirmed command keeps the fast cadence')
  await timer.fire()
  assert.strictEqual(timer.delay(), 10, 'confirmed heating keeps the fast cadence')
  await timer.fire()
  assert.strictEqual(timer.delay(), 1000)
})

test('the fast cadence expires if the kettle never starts heating', async () => {
  const { timer, polling, clock } = pollWithResults(
    { heating: false, temperatureUpdated: true },
    { heatConfirmTimeout: 40 },
  )

  await flush()
  assert.strictEqual(timer.delay(), 1000)

  polling.markHeating()
  assert.strictEqual(timer.delay(), 10)

  clock.value = 10
  await timer.fire()
  assert.strictEqual(timer.delay(), 10)

  clock.value = 30
  await timer.fire()
  assert.strictEqual(timer.delay(), 10)

  clock.value = 70
  await timer.fire()
  assert.strictEqual(timer.delay(), 1000, 'gave up on the command and went back to idle')
})

// A kettle that was heating and then stopped answering — lifted off its base
// mid-boil, or Wi-Fi dropping — must not stay at the fast cadence forever on the
// last state it was known to be in.
test('the fast cadence expires when a heating kettle becomes unreadable', async () => {
  const { timer } = pollWithResults([
    { heating: true, temperatureUpdated: true, temperatureAvailable: true },
    { heating: null, temperatureUpdated: false, temperatureAvailable: false },
  ])

  const delays = []
  await flush()
  delays.push(timer.delay())
  for (let i = 0; i < 7; i++) {
    await timer.fire()
    delays.push(timer.delay())
  }
  assert.deepStrictEqual(delays, [10, 10, 10, 10, 10, 10, 10, 1000])
})

// What a switch-off from HomeKit asks for: one read at the heating cadence to
// confirm the kettle obeyed, then straight back to rest. No confirmation window,
// so a kettle that is off is not watched at the fast interval.
test('refreshSoon confirms a switch-off once, then rests', async () => {
  const { timer, polling } = pollWithResults({ heating: false, temperatureUpdated: true })

  await flush()
  assert.strictEqual(timer.delay(), 1000)

  polling.refreshSoon()
  assert.strictEqual(timer.cancelled, 1, 'the idle sleep was cancelled')
  assert.strictEqual(timer.delay(), 10, 'the switch-off is confirmed at the heating cadence')

  await timer.fire()
  assert.strictEqual(timer.delay(), 1000, 'a kettle confirmed off goes back to the idle interval')
})

test('refreshSoon leaves a pending heating read alone', async () => {
  const { timer, polling } = pollWithResults({ heating: true, temperatureUpdated: true })

  await flush()
  assert.strictEqual(timer.delay(), 10)
  polling.refreshSoon()
  assert.strictEqual(timer.cancelled, 0)
  assert.strictEqual(timer.delay(), 10)
})

test('markHeating leaves a pending heating read alone', async () => {
  const { timer, polling } = pollWithResults({ heating: true, temperatureUpdated: true })

  await flush()
  assert.strictEqual(timer.delay(), 10)
  polling.markHeating()
  assert.strictEqual(timer.cancelled, 0)
  assert.strictEqual(timer.delay(), 10)
})

test('temperature is due immediately after an off-base reading', async () => {
  const due = []
  const { timer, clock } = pollWithResults((poll, idleTemperatureDue) => {
    due.push(idleTemperatureDue)
    const results = [
      { heating: false, temperatureUpdated: true, temperatureAvailable: true },
      { heating: false, temperatureUpdated: false, temperatureAvailable: false },
      { heating: false, temperatureUpdated: true, temperatureAvailable: true },
    ]
    return results[Math.min(poll, results.length - 1)]
  }, { pollIntervalIdle: 1800000 })

  await flush()
  assert.deepStrictEqual(due, [true])

  clock.value = 10
  await timer.fire()
  assert.deepStrictEqual(due, [true, false])

  clock.value = 20
  await timer.fire()
  assert.deepStrictEqual(due, [true, false, true])
})

test('a HomeKit off-base error makes temperature due on the next poll', async () => {
  const due = []
  const { timer, clock, polling } = pollWithResults((poll, idleTemperatureDue) => {
    due.push(idleTemperatureDue)
    return { heating: false, temperatureUpdated: idleTemperatureDue, temperatureAvailable: true }
  }, { pollIntervalIdle: 1800000 })

  await flush()
  assert.deepStrictEqual(due, [true])

  polling.markTemperatureUnavailable()
  clock.value = 10
  await timer.fire()
  assert.deepStrictEqual(due, [true, true])
})

test('the first poll waits for the beforeFirstPoll promise', async () => {
  let releaseFirstPoll
  const firstPoll = new Promise(resolve => { releaseFirstPoll = resolve })
  const { timer, polls } = pollWithResults({ heating: false, temperatureUpdated: true }, {
    beforeFirstPoll: firstPoll,
  })

  await flush()
  assert.strictEqual(polls(), 0)
  assert.strictEqual(timer.pending, null)

  releaseFirstPoll()
  await flush()
  assert.strictEqual(polls(), 1)
  assert.strictEqual(timer.delay(), 1000)
})

test('a rejected beforeFirstPoll promise does not stop polling', async () => {
  const { timer, polls } = pollWithResults({ heating: false, temperatureUpdated: true }, {
    beforeFirstPoll: Promise.reject(new Error('clock sync failed')),
  })

  await flush()
  assert.strictEqual(polls(), 1)
  assert.strictEqual(timer.delay(), 1000)
})
