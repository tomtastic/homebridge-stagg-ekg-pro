'use strict'

const assert = require('assert')
const { test } = require('node:test')
const StaggEKGProClient = require('../lib/stagg-ekg-pro-client')
const { TargetTemperatureEcho, TARGET_TOLERANCE_C } = require('../lib/target-temperature-echo')

// Same conversion the kettle client uses: the hardware stores whole °F, so a
// 93 °C command is held as 199 °F and reported back as 92.7778 °C.
const converter = {
  cToF: (c) => (c * 1.8) + 32,
  fToC: (f) => (f - 32) / 1.8,
}
const REPORTED_93C = converter.fToC(199)

test('the quantised setpoint is echoed as the commanded °C', () => {
  const echo = new TargetTemperatureEcho(converter)
  echo.command(93)
  assert.strictEqual(echo.storedC, REPORTED_93C)
  assert.strictEqual(echo.resolve(REPORTED_93C), 93)
})

test('a target that round-trips exactly is still echoed', () => {
  const echo = new TargetTemperatureEcho(converter)
  echo.command(93)
  assert.strictEqual(echo.resolve(93), 93)
})

test('the kettle client satisfies the converter interface', () => {
  const echo = new TargetTemperatureEcho(new StaggEKGProClient('http://kettle.local'))
  echo.command(93)
  assert.strictEqual(echo.storedC, REPORTED_93C)
  assert.strictEqual(echo.resolve(REPORTED_93C), 93)
})

test('a dial change clears the echo', () => {
  const echo = new TargetTemperatureEcho(converter)
  echo.command(93)
  assert.strictEqual(echo.resolve(85), 85)
  // Cleared: subsequent reports pass through unfiltered.
  assert.strictEqual(echo.resolve(85), 85)
  assert.strictEqual(echo.resolve(REPORTED_93C), REPORTED_93C)
})

test('unavailable readings pass through and keep the echo', () => {
  const echo = new TargetTemperatureEcho(converter)
  echo.command(93)
  assert.strictEqual(echo.resolve(null), null)
  assert.ok(Number.isNaN(echo.resolve(NaN)))
  assert.strictEqual(echo.resolve(REPORTED_93C), 93)
})

test('without a pending command the reported target passes through', () => {
  const echo = new TargetTemperatureEcho(converter)
  assert.strictEqual(echo.resolve(88), 88)
  assert.strictEqual(echo.resolve(null), null)
})

test('the neighbouring setpoint is a real change, not an echo', () => {
  // Half of one integer °F step is 0.2778 °C, so the tolerance sits between
  // that and a full step of 0.5556 °C.
  assert.ok(TARGET_TOLERANCE_C > 0.2778 && TARGET_TOLERANCE_C < 0.5556)
  const echo = new TargetTemperatureEcho(converter)
  echo.command(93)
  // 92.2 °C is 0.58 °C off the stored 199 °F setpoint — further than our own
  // round-trip can explain, so it must be the dial moving to 92 °C (198 °F).
  assert.strictEqual(echo.resolve(92.2), 92.2)
  assert.strictEqual(echo.resolve(REPORTED_93C), REPORTED_93C)
})
