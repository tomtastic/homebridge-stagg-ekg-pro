'use strict'

const assert = require('assert')
const StaggEKGProClient = require('../lib/stagg-ekg-pro-client')
const { test, banner } = require('./_harness')

banner('cli.test.js')
const client = new StaggEKGProClient('http://kettle.local')

test('encode: state', () => {
  assert.strictEqual(client._encode('state'), 'state')
})

test('encode: setstate S_Heat', () => {
  assert.strictEqual(client._encode('setstate S_Heat'), 'setstate+S_Heat')
})

test('encode: setsetting settempr 205', () => {
  assert.strictEqual(client._encode('setsetting settempr 205'), 'setsetting+settempr+205')
})

test('encode: ss S_StartupToTempr', () => {
  assert.strictEqual(client._encode('ss S_StartupToTempr'), 'ss+S_StartupToTempr')
})

banner('edge cases')

// _encode now uses encodeURIComponent per token
test('encode: ampersand is percent-encoded', () => {
  assert.strictEqual(client._encode('cmd&extra=bad'), 'cmd%26extra%3Dbad')
})

test('encode: equals sign is percent-encoded', () => {
  assert.strictEqual(client._encode('setsetting key=val'), 'setsetting+key%3Dval')
})

test('clock command uses the system local time', () => {
    const date = new Date(2026, 7, 14, 9, 5, 3)
    assert.strictEqual(client.clockCommand(date), 'setclock 9 5 3')
})

banner('time zone aware clock sync')

// One instant, two zones: 11:00:45 UTC is 12:00:45 in London (BST) and
// 07:00:45 in New York (EDT).
const SUMMER_UTC = new Date('2026-08-14T11:00:45Z')

test('clock command honours the configured time zone', () => {
    const london = new StaggEKGProClient('http://kettle.local', { timeZone: 'Europe/London' })
    const newYork = new StaggEKGProClient('http://kettle.local', { timeZone: 'America/New_York' })
    assert.strictEqual(london.clockCommand(SUMMER_UTC), 'setclock 12 0 45')
    assert.strictEqual(newYork.clockCommand(SUMMER_UTC), 'setclock 7 0 45')
})

test('midnight in the target zone is hour 0, not 24', () => {
    const london = new StaggEKGProClient('http://kettle.local', { timeZone: 'Europe/London' })
    assert.strictEqual(london.clockCommand(new Date('2026-08-14T23:00:00Z')), 'setclock 0 0 0')
})

test('standard time offsets are applied too', () => {
    const london = new StaggEKGProClient('http://kettle.local', { timeZone: 'Europe/London' })
    const newYork = new StaggEKGProClient('http://kettle.local', { timeZone: 'America/New_York' })
    const winterUtc = new Date('2026-01-15T00:30:00Z')
    assert.strictEqual(london.clockCommand(winterUtc), 'setclock 0 30 0')
    assert.strictEqual(newYork.clockCommand(winterUtc), 'setclock 19 30 0')
})

test('a blank or absent time zone keeps the host local time', () => {
    const blank = new StaggEKGProClient('http://kettle.local', { timeZone: '   ' })
    assert.strictEqual(blank.timeZone, null)
    assert.strictEqual(new StaggEKGProClient('http://kettle.local').timeZone, null)
    assert.strictEqual(blank.clockCommand(new Date(2026, 7, 14, 9, 5, 3)), 'setclock 9 5 3')
})

test('isValidTimeZone accepts IANA zones and rejects the rest', () => {
    assert.strictEqual(StaggEKGProClient.isValidTimeZone('Europe/London'), true)
    assert.strictEqual(StaggEKGProClient.isValidTimeZone('UTC'), true)
    assert.strictEqual(StaggEKGProClient.isValidTimeZone('Not/AZone'), false)
    assert.strictEqual(StaggEKGProClient.isValidTimeZone(''), false)
    assert.strictEqual(StaggEKGProClient.isValidTimeZone(undefined), false)
})
