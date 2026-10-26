'use strict'

const assert = require('assert')
const StaggEKGProClient = require('../lib/stagg-ekg-pro-client')

const TEMP_JSON_OFF = '{"temp":24.86,"temp_set":93.00,"state":"S_Off","pwm":-10,"timestamp":1761500000}'
const TEMP_JSON_HEAT = '{"temp":88.16,"temp_set":83.89,"state":"S_Heat","pwm":50,"timestamp":1761500000}'

// Legacy CLI `state` output from older firmware (trimmed from the parsers.test.js fixtures)
const STATE_OUTPUT_OFF = `
I (991010) Cli: cmd len 5: 'state'
scrname=wnd
mode=S_Off
tempr=50.491463 C
temprB=99.459999 C
temprT=96.111115 C
temps=205 F
units=1
I (991040) Cli: command 'state' ret 0
`

const STATE_OUTPUT_HEAT = `
I (1640440) Cli: cmd len 5: 'state'
scrname=wnd
mode=S_Heat
tempr=88.157149 C
temprB=99.459999 C
temprT=83.888885 C
temps=183 F
units=1
I (1640460) Cli: command 'state' ret 0
`

function stubFetch(routes) {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const key = String(url)
    calls.push(key)
    const route = routes.find(r => key.includes(r.match))
    if (!route) throw new Error(`unstubbed fetch: ${key}`)
    if (route.error) throw new Error(route.error)
    return { status: route.status === undefined ? 200 : route.status, text: async () => route.body }
  }
  return {
    calls,
    restore: () => { globalThis.fetch = originalFetch },
  }
}

let failures = 0
async function run(name, fn) {
  try {
    await fn()
    console.log(`\x1b[32mok\x1b[0m - ${name}`)
  } catch (err) {
    failures += 1
    console.error(`\x1b[31mnot ok\x1b[0m - ${name}`)
    console.error(err)
  }
}

async function main() {
  console.log('\n# read-state.test.js')

  await run('readState returns /temp JSON directly and never hits /cli', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([{ match: '/temp', body: TEMP_JSON_OFF }])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 0)
      assert.strictEqual(state.tempC, 24.86)
      assert.strictEqual(state.targetC, 93)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp'])
    } finally { stub.restore() }
  })

  await run('readState maps /temp S_Heat to isHeating 1', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([{ match: '/temp', body: TEMP_JSON_HEAT }])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 1)
      assert.strictEqual(state.tempC, 88.16)
      assert.strictEqual(state.targetC, 83.89)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp'])
    } finally { stub.restore() }
  })

  await run('readState tolerates the bare nan temp from /temp without hitting the CLI', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', body: '{"temp":nan,"temp_set":33.89,"state":"S_Off","pwm":-10,"timestamp":1761500000}' },
      { match: '/cli', body: STATE_OUTPUT_OFF },
    ])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 0)
      assert.strictEqual(state.tempC, null)
      assert.strictEqual(state.targetC, 33.89)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp'])
    } finally { stub.restore() }
  })

  await run('readState falls back to the CLI state command when /temp 404s', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', status: 404, body: 'not found' },
      { match: '/cli', body: STATE_OUTPUT_OFF },
    ])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 0)
      assert.strictEqual(state.tempC, 50.491463)
      assert.strictEqual(state.targetC, 96.111115)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp', 'http://kettle.local/cli?cmd=state'])
    } finally { stub.restore() }
  })

  await run('readState falls back to the CLI when /temp serves the HTML form', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', body: '<html><form action="cli" method="GET"></form></html>' },
      { match: '/cli', body: STATE_OUTPUT_HEAT },
    ])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 1)
      assert.strictEqual(state.tempC, 88.157149)
      assert.strictEqual(state.targetC, 83.888885)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp', 'http://kettle.local/cli?cmd=state'])
    } finally { stub.restore() }
  })

  await run('readState falls back to the CLI when /temp JSON has no state field', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', body: '{"temp":24.86,"temp_set":93}' },
      { match: '/cli', body: STATE_OUTPUT_OFF },
    ])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 0)
      assert.strictEqual(state.tempC, 50.491463)
      assert.strictEqual(state.targetC, 96.111115)
    } finally { stub.restore() }
  })

  await run('readState falls back to the CLI when the /temp fetch rejects', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', error: '/temp network down' },
      { match: '/cli', body: STATE_OUTPUT_HEAT },
    ])
    try {
      const state = await client.readState()
      assert.strictEqual(state.isHeating, 1)
      assert.strictEqual(state.tempC, 88.157149)
      assert.strictEqual(state.targetC, 83.888885)
    } finally { stub.restore() }
  })

  await run('readState rejects when both /temp and the CLI fetch fail', async () => {
    const client = new StaggEKGProClient('http://kettle.local')
    const stub = stubFetch([
      { match: '/temp', error: '/temp network down' },
      { match: '/cli', error: 'cli network down' },
    ])
    try {
      await assert.rejects(client.readState(), /cli network down/)
      assert.deepStrictEqual(stub.calls, ['http://kettle.local/temp', 'http://kettle.local/cli?cmd=state'])
    } finally { stub.restore() }
  })
}

main().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
  }
})
