'use strict'

const assert = require('assert')
const { test } = require('node:test')
const { getPollIntervals, startTempPolling } = require('../lib/temperature-polling')

test('invalid intervals fall back to defaults', () => {
  assert.deepStrictEqual(getPollIntervals({
    pollIntervalHeating: 0,
    pollIntervalIdle: NaN,
  }), {
    heating: 10000,
    idle: 1800000,
  })
})

test('idle temperature is published immediately and then at its own interval', async () => {
  let time = 0
  let scheduled
  const idleTemperatureDue = []
  const update = async (idleDue) => {
    idleTemperatureDue.push(idleDue)
    return { isHeating: 0, temperatureUpdated: idleDue }
  }

  startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 30,
  }, update, {
    now: () => time,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
  })

  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true])
  // An idle kettle waits the full idle interval for the next poll.
  assert.strictEqual(scheduled.delay, 30)

  time = 30
  scheduled.fn()
  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true, true])
  assert.strictEqual(scheduled.delay, 30)
})

test('state is polled at the heating interval while heating and the idle interval while idle', async () => {
  let scheduled
  let polls = 0
  const states = [1, 1, 0]

  startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 30,
  }, async () => ({
    isHeating: states[polls++],
    temperatureUpdated: true,
  }), {
    now: () => 0,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
  })

  await Promise.resolve()
  assert.strictEqual(scheduled.delay, 10)
  scheduled.fn()
  await Promise.resolve()
  assert.strictEqual(polls, 2)
  assert.strictEqual(scheduled.delay, 10)
  scheduled.fn()
  await Promise.resolve()
  assert.strictEqual(polls, 3)
  assert.strictEqual(scheduled.delay, 30)
})

test('temperature is due immediately after an off-base reading', async () => {
  let time = 0
  let scheduled
  const idleTemperatureDue = []
  const results = [
    { isHeating: 0, temperatureUpdated: true, temperatureAvailable: true },
    { isHeating: 0, temperatureUpdated: false, temperatureAvailable: false },
    { isHeating: 0, temperatureUpdated: true, temperatureAvailable: true },
  ]

  startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 1800000,
  }, async (idleDue) => {
    idleTemperatureDue.push(idleDue)
    return results.shift()
  }, {
    now: () => time,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
  })

  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true])

  time = 10
  scheduled.fn()
  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true, false])

  time = 20
  scheduled.fn()
  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true, false, true])
})

test('a HomeKit off-base error makes temperature due on the next poll', async () => {
  let time = 0
  let scheduled
  const idleTemperatureDue = []

  const polling = startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 1800000,
  }, async (idleDue) => {
    idleTemperatureDue.push(idleDue)
    return {
      isHeating: 0,
      temperatureUpdated: idleDue,
      temperatureAvailable: true,
    }
  }, {
    now: () => time,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
  })

  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true])

  polling.markTemperatureUnavailable()
  time = 10
  scheduled.fn()
  await Promise.resolve()
  assert.deepStrictEqual(idleTemperatureDue, [true, true])
})

test('the first poll waits for the beforeFirstPoll promise', async () => {
  const tick = () => new Promise(resolve => process.nextTick(resolve))
  let scheduled
  let releaseFirstPoll
  const firstPoll = new Promise(resolve => { releaseFirstPoll = resolve })
  let polls = 0

  startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 30,
  }, async () => {
    polls++
    return { isHeating: 0, temperatureUpdated: true }
  }, {
    now: () => 0,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
    beforeFirstPoll: firstPoll,
  })

  await tick()
  assert.strictEqual(polls, 0)
  assert.strictEqual(scheduled, undefined)

  releaseFirstPoll()
  await tick()
  assert.strictEqual(polls, 1)
  assert.strictEqual(scheduled.delay, 30)

  scheduled.fn()
  await tick()
  assert.strictEqual(polls, 2)
})

test('a rejected beforeFirstPoll promise does not stop polling', async () => {
  const tick = () => new Promise(resolve => process.nextTick(resolve))
  let scheduled
  let polls = 0

  startTempPolling({ debug() {} }, {
    pollIntervalHeating: 10,
    pollIntervalIdle: 30,
  }, async () => {
    polls++
    return { isHeating: 0, temperatureUpdated: true }
  }, {
    now: () => 0,
    setTimeout: (fn, delay) => { scheduled = { fn, delay } },
    beforeFirstPoll: Promise.reject(new Error('clock sync failed')),
  })

  await tick()
  assert.strictEqual(polls, 1)
  assert.strictEqual(scheduled.delay, 30)
})
