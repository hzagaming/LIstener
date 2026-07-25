import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { createRequestScheduler } from './rateLimit.mjs'

test('handles an already-aborted request without an internal unhandled rejection', async () => {
  const moduleUrl = new URL('./rateLimit.mjs', import.meta.url).href
  const script = `
    import { createRequestScheduler } from ${JSON.stringify(moduleUrl)}
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await createRequestScheduler()(() => {}, controller.signal).catch(() => {})
    await new Promise((resolve) => setImmediate(resolve))
  `
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore' })
    child.on('exit', resolve)
  })
  assert.equal(exitCode, 0)
})

test('does not start an operation cancelled after it receives a permit', async () => {
  let ran = false
  const controller = new AbortController()
  const scheduled = createRequestScheduler()(() => { ran = true }, controller.signal)
  queueMicrotask(() => controller.abort(new Error('cancelled')))

  await assert.rejects(() => scheduled, /cancelled/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(ran, false)
})

test('spaces request starts without waiting for earlier operations to finish', async () => {
  let timestamp = 0
  let releaseFirst
  const starts = []
  const schedule = createRequestScheduler({
    minIntervalMs: 100,
    now: () => timestamp,
    waitImpl: async (milliseconds) => { timestamp += milliseconds },
  })
  const first = schedule(() => {
    starts.push(timestamp)
    return new Promise((resolve) => { releaseFirst = resolve })
  }, new AbortController().signal)
  const second = schedule(() => {
    starts.push(timestamp)
    return 'second'
  }, new AbortController().signal)

  try {
    const outcome = await Promise.race([
      second,
      new Promise((resolve) => setImmediate(() => resolve('blocked'))),
    ])
    assert.equal(outcome, 'second')
    assert.deepEqual(starts, [0, 100])
  } finally {
    releaseFirst?.('first')
    await first
  }
})

test('rejects an aborted queued request before an earlier operation finishes', async () => {
  let releaseFirst
  let markStarted
  let secondRan = false
  const schedule = createRequestScheduler()
  const started = new Promise((resolve) => { markStarted = resolve })
  const first = schedule(() => new Promise((resolve) => {
    releaseFirst = resolve
    markStarted()
  }), new AbortController().signal)
  await started
  const controller = new AbortController()
  const second = schedule(() => { secondRan = true }, controller.signal)
  controller.abort(new Error('cancelled'))

  try {
    const outcome = await Promise.race([
      second.then(() => 'ran', (error) => error.message),
      new Promise((resolve) => setImmediate(() => resolve('pending'))),
    ])
    assert.equal(outcome, 'cancelled')
    assert.equal(secondRan, false)
  } finally {
    releaseFirst?.()
    await first
    await assert.rejects(() => second, /cancelled/)
  }
})

test('continues scheduling after an operation rejects', async () => {
  let timestamp = 0
  const starts = []
  const schedule = createRequestScheduler({
    minIntervalMs: 50,
    now: () => timestamp,
    waitImpl: async (milliseconds) => { timestamp += milliseconds },
  })
  const signal = new AbortController().signal
  const failed = schedule(() => {
    starts.push(timestamp)
    throw new Error('failed')
  }, signal)
  const recovered = schedule(() => {
    starts.push(timestamp)
    return 'ok'
  }, signal)

  await assert.rejects(() => failed, /failed/)
  assert.equal(await recovered, 'ok')
  assert.deepEqual(starts, [0, 50])
})

test('rejects unsafe request intervals before scheduling', () => {
  for (const minIntervalMs of [-1, Infinity, Number.NaN, 2_147_483_648]) {
    assert.throws(() => createRequestScheduler({ minIntervalMs }), /valid request interval/)
  }
})

test('releases the queue when an injected wait ignores cancellation', async () => {
  let timestamp = 0
  let waitCalls = 0
  let markWaiting
  const waiting = new Promise((resolve) => { markWaiting = resolve })
  const schedule = createRequestScheduler({
    minIntervalMs: 100,
    now: () => timestamp,
    waitImpl: async (milliseconds) => {
      waitCalls += 1
      if (waitCalls === 1) {
        markWaiting()
        return new Promise(() => {})
      }
      timestamp += milliseconds
    },
  })
  const signal = new AbortController().signal
  assert.equal(await schedule(() => 'first', signal), 'first')

  const controller = new AbortController()
  const cancelled = schedule(() => 'cancelled', controller.signal)
  await waiting
  controller.abort(new Error('cancelled'))
  await assert.rejects(() => cancelled, /cancelled/)

  const recovered = schedule(() => 'recovered', signal)
  const outcome = await Promise.race([
    recovered,
    new Promise((resolve) => setImmediate(() => resolve('blocked'))),
  ])
  assert.equal(outcome, 'recovered')
  assert.equal(timestamp, 100)
})
