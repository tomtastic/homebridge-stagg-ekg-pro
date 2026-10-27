'use strict'

const assert = require('assert')
const StaggEKGProClient = require('../lib/stagg-ekg-pro-client')
const { test } = require('node:test')

const STATE_OUTPUT = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (991010) Cli: cmd len 5: 'state'
I (991010) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 85411 numf 1 wgi 1 iot r 0
scrname=wnd
value=50662426
mode=S_Off
tempr=50.491463 C
temprB=99.459999 C
temprT=96.111115 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=205 F
tempsc=192 2C
units=1
clock=12:26
ticks=991020 0 989274
ble conn=0
I (991040) Cli: command 'state' ret 0
`

const STATE_OUTPUT_HEAT = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (1640440) Cli: cmd len 5: 'state'
I (1640440) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=wnd
value=167
mode=S_Heat
tempr=88.157149 C
temprB=99.459999 C
temprT=83.888885 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=183 F
tempsc=192 2C
units=1
clock=12:37
ticks=1640440 0 1638694
ble conn=0
I (1640460) Cli: command 'state' ret 0
`

const STATE_OUTPUT_HOLD = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (1674720) Cli: cmd len 5: 'state'
I (1674720) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=wnd
value=167
mode=S_Hold
tempr=87.158235 C
temprB=99.459999 C
temprT=83.888885 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=183 F
tempsc=192 2C
units=1
clock=12:37
ticks=1674720 0 1672975
ble conn=0
I (1674740) Cli: command 'state' ret 0
`

const STATE_OUTPUT_HOLD_MENU = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (1718160) Cli: cmd len 5: 'state'
I (1718160) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=menu - schedule.png
value=2
mode=S_Hold+menu
tempr=85.851106 C
temprB=99.459999 C
temprT=83.888885 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=183 F
tempsc=192 2C
units=1
clock=12:38
ticks=1718160 0 1716415
ble conn=0
I (1718180) Cli: command 'state' ret 0
`

const STATE_OUTPUT_STARTUP = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>
            I (1826900) Cli: cmd len 5: 'state'
I (1826900) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=wnd
value=0
mode=S_StartupToTempr
tempr=83.071825 C
temprB=99.459999 C
temprT=83.888885 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=183 F
tempsc=192 2C
units=1
clock=12:40
ticks=1826910 1820600 1825164
ble conn=0
I (1826930) Cli: command 'state' ret 0
`

const STATE_OUTPUT_CALIB = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (2307670) Cli: cmd len 5: 'state'
I (2307670) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=error screen - Calibration in progress.png
value=0
mode=S_Calib_Started+menu
tempr=85.524724 C
temprB=98.919998 C
temprT=84.500000 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=169 2C
tempsc=192 2C
units=1
clock=12:48
ticks=2307680 2260820 2305934
ble conn=0
I (2307710) Cli: command 'state' ret 0
`

const STATE_OUTPUT_CALIB_FINISH = `
            <form action="cli" method="GET">
            <label for="x">CLI Command:</label><br>
            <input type="text" id="cli" name="cmd"><br>
            </form>         
            I (2450920) Cli: cmd len 5: 'state'
I (2450920) Main: OTA vd 1 ldt 121 ldr 7 dip 0 waitsec 0 numf 1 wgi 1 iot r 0
scrname=error screen - Calibration in progress.png
value=0
mode=S_Calib_finish+menu
tempr=98.873996 C
temprB=98.919998 C
temprT=84.500000 C
ketl= ho 0 wd 0 nw 0 ipb 0 bf 0 tr 0
temps=169 2C
tempsc=192 2C
units=1
clock=12:50
ticks=2450930 2260820 2449184
ble conn=0
I (2450950) Cli: command 'state' ret 0
`

const client = new StaggEKGProClient('http://kettle.local')

test('parse state from state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT), 0)
})

test('parse state from heating state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_HEAT), 1)
})

test('parse state from hold state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_HOLD), 1)
})

test('parse state from hold+menu state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_HOLD_MENU), 1)
})

test('parse state from startup state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_STARTUP), 1)
})

test('parse state from calibration state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_CALIB), 1)
})

// S_Calib_finish means calibration has run to completion, so the heater is off
// and HomeKit should not show the kettle as heating.
test('parse state from calibration finish state output', () => {
  assert.strictEqual(client.parseState(STATE_OUTPUT_CALIB_FINISH), 0)
})

test('parse temp from state output', () => {
  assert.strictEqual(client.parseTemp(STATE_OUTPUT), 50.491463)
})

test('parse target temp from state output', () => {
  assert.strictEqual(client.parseTargetTemp(STATE_OUTPUT), 96.111115)
})

test('parse temp in F to C', () => {
  assert.strictEqual(client._parseTempLine('tempr=212 F', 'tempr'), 100)
})

test('parse temp rejects observed off-base firmware readings', () => {
  for (const value of [1885156601, 1884991341, 1884222511, 1884222211]) {
    assert.strictEqual(client.parseTemp(`tempr=${value} C`), null)
  }
})

test('parse temp rejects values outside the kettle range', () => {
  assert.strictEqual(client.parseTemp('tempr=-1 C'), null)
  assert.strictEqual(client.parseTemp('tempr=100.1 C'), null)
})

test('parse temp rejects nan without falling back to a firmware timestamp', () => {
  const body = `I (19) Cli: cmd len 5: 'state'\nmode=S_Off\ntempr=nan C\ntemprT=96 C`
  assert.strictEqual(client.parseTemp(body), null)
})

test('parse state from S_Heat string', () => {
  assert.strictEqual(client.parseState('mode=S_Heat'), 1)
})

test('parse first number fallback', () => {
  assert.strictEqual(client._parseFirstNumber('x=-12.5 y=3'), -12.5)
})

// parseTargetTemp returns null when neither temprT nor temps is present
test('parseTargetTemp returns null when no target fields present', () => {
  const body = 'tempr=75.5 C\nmode=S_Heat'
  assert.strictEqual(client.parseTargetTemp(body), null)
})

// parseState must not match "S_Offline" as off — requires \b word boundary on S_Off
test('parseState does not match S_Offline as off', () => {
  assert.strictEqual(client.parseState('mode=S_Offline'), null)
})

// stateForHomeKit uses strict equality — truthy values other than 1 map to S_Off
test('stateForHomeKit: value=true (boolean) maps to S_Off not S_Heat', () => {
  // HomeKit always sends integers, but documents the strict-equality dependency
  assert.strictEqual(client.stateForHomeKit(true), 'S_Off')
  assert.strictEqual(client.stateForHomeKit(1), 'S_Heat')
})

const TEMP_JSON_OFF = '{"temp":24.86,"temp_set":93.00,"state":"S_Off","pwm":-10,"timestamp":1761500000}'
const TEMP_JSON_HEAT = '{"temp":88.16,"temp_set":83.89,"state":"S_Heat","pwm":50,"timestamp":1761500000}'

test('parseTempJson parses the live S_Off payload', () => {
  assert.deepStrictEqual(client.parseTempJson(TEMP_JSON_OFF), { state: 'S_Off', tempC: 24.86, targetC: 93 })
})

test('parseTempJson parses the S_Heat payload for parseState', () => {
  const parsed = client.parseTempJson(TEMP_JSON_HEAT)
  assert.strictEqual(parsed.state, 'S_Heat')
  assert.strictEqual(client.parseState(parsed.state), 1)
  assert.strictEqual(parsed.tempC, 88.16)
  assert.strictEqual(parsed.targetC, 83.89)
})

test('parseTempJson applies the 0-100 C guard to temp', () => {
  assert.strictEqual(client.parseTempJson('{"temp":1885156601,"temp_set":93,"state":"S_Off"}').tempC, null)
  assert.strictEqual(client.parseTempJson('{"temp":-1,"temp_set":93,"state":"S_Off"}').tempC, null)
  assert.strictEqual(client.parseTempJson('{"temp":100.1,"temp_set":93,"state":"S_Off"}').tempC, null)
})

test('parseTempJson treats null and nan temps as unavailable', () => {
  assert.strictEqual(client.parseTempJson('{"temp":null,"temp_set":93,"state":"S_Off"}').tempC, null)
  assert.strictEqual(client.parseTempJson('{"temp":"nan","temp_set":93,"state":"S_Off"}').tempC, null)
})

test('parseTempJson tolerates the bare nan temp emitted by firmware 1.2.26', () => {
  const parsed = client.parseTempJson('{"temp":nan,"temp_set":93.00,"state":"S_Off","pwm":-10,"timestamp":1761500000}')
  assert.strictEqual(parsed.state, 'S_Off')
  assert.strictEqual(client.parseState(parsed.state), 0)
  assert.strictEqual(parsed.tempC, null)
  assert.strictEqual(parsed.targetC, 93)
  const upper = client.parseTempJson('{"temp":NaN,"temp_set":33.89,"state":"S_Off"}')
  assert.strictEqual(upper.tempC, null)
  assert.strictEqual(upper.targetC, 33.89)
})

test('parseTempJson returns null targetC when temp_set is missing or null', () => {
  assert.strictEqual(client.parseTempJson('{"temp":24.86,"state":"S_Off"}').targetC, null)
  assert.strictEqual(client.parseTempJson('{"temp":24.86,"temp_set":null,"state":"S_Off"}').targetC, null)
})

test('parseTempJson returns null for malformed JSON, non-objects, or missing state', () => {
  assert.strictEqual(client.parseTempJson('<html><form action="cli"></form></html>'), null)
  assert.strictEqual(client.parseTempJson('{"temp":24.86,"temp_set":93}'), null)
  assert.strictEqual(client.parseTempJson('24.86'), null)
  assert.strictEqual(client.parseTempJson('[1,2,3]'), null)
  assert.strictEqual(client.parseTempJson(''), null)
})

test('constructor derives /temp from a bare base URL', () => {
  const c = new StaggEKGProClient('http://kettle.local')
  assert.strictEqual(c.cliUrl, 'http://kettle.local/cli')
  assert.strictEqual(c.tempUrl, 'http://kettle.local/temp')
})

test('constructor derives /temp when the config URL points at /cli', () => {
  for (const url of ['http://kettle.local/cli', 'http://kettle.local/cli?x=1']) {
    const c = new StaggEKGProClient(url)
    assert.strictEqual(c.cliUrl, 'http://kettle.local/cli')
    assert.strictEqual(c.tempUrl, 'http://kettle.local/temp')
  }
})

// The kettle reports one of the S_ names recovered from the firmware image.
// Anything with the heater running or keeping the water hot reads as heating to
// HomeKit, and that same classification sets the poll cadence. Everything else
// — including S_Standby, the ordinary "powered off, sitting on its base" state —
// reads as at rest. Nothing here may depend on a substring match: S_HeatOff is
// not heating, and S_Offline is not S_Off.
const HEATING = ['S_Heat', 'S_StartupToTempr', 'S_Hold', 'S_Calib_Started']
const AT_REST = [
  'S_Off', 'S_OnOff', 'S_Standby', 'S_HeatOff', 'S_Finished', 'S_TIMEOUT',
  'S_NoWater', 'S_FAIL', 'S_MenuExitToTempr', 'S_Temperature', 'S_Time',
  'S_Set_clock', 'S_clocK_menu', 'S_StartupMenu', 'S_StartupToMenu',
  'S_Check_Wireless_setup', 'S_OTA', 'S_OTA_Start', 'S_OTA_Abort',
  'S_Calib_Halted', 'S_Calib_aborted', 'S_Calib_finish',
]

test('every heating state reports HomeKit heating', () => {
  for (const state of HEATING) {
    assert.strictEqual(client.parseState(`mode=${state}`), 1, state)
  }
})

test('every resting state reports HomeKit off', () => {
  for (const state of AT_REST) {
    assert.strictEqual(client.parseState(`mode=${state}`), 0, state)
  }
})

// The poll cadence is driven by parseState itself: whatever HomeKit shows as
// heating is watched at the heating interval, so a kettle that has settled into
// a hold window still notices being switched off. For that to be predictable the
// two tables must stay a partition of the firmware's state names.
test('the heating and resting tables do not overlap', () => {
  for (const state of HEATING) {
    assert.ok(!AT_REST.includes(state), `${state} is classified as both heating and at rest`)
  }
})

test('parseStateName strips the +menu suffix the CLI appends', () => {
  assert.strictEqual(client.parseStateName('mode=S_Hold+menu'), 'S_Hold')
  assert.strictEqual(client.parseStateName('mode=S_Calib_finish+menu'), 'S_Calib_finish')
  assert.strictEqual(client.parseStateName('mode=S_Off'), 'S_Off')
})

test('S_HeatOff is not mistaken for a heating state', () => {
  assert.strictEqual(client.parseState('mode=S_HeatOff'), 0)
})

test('a state outside the firmware table stays unknown', () => {
  for (const body of ['mode=S_Offline', 'S_Mystery', 'no state here', '']) {
    assert.strictEqual(client.parseState(body), null, body)
  }
})
