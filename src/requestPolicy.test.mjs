import assert from 'node:assert/strict'
import test from 'node:test'
import { abortableDelay, createRequestSignal } from './requestPolicy.mjs'

test('propagates caller cancellation into a timed request signal', () => {
  const controller = new AbortController()
  const reason = new Error('view changed')
  const signal = createRequestSignal(controller.signal, 1_000)

  controller.abort(reason)

  assert.equal(signal.aborted, true)
  assert.equal(signal.reason, reason)
})

test('creates an independent timeout signal when no caller signal exists', () => {
  const signal = createRequestSignal(undefined, 1_000)

  assert.equal(signal instanceof AbortSignal, true)
  assert.equal(signal.aborted, false)
})

test('cancels a pending delay with the caller reason', async () => {
  const controller = new AbortController()
  const reason = new Error('search replaced')
  const pending = abortableDelay(1_000, controller.signal)

  controller.abort(reason)

  await assert.rejects(pending, (error) => error === reason)
})

test('rejects a delay that starts with an aborted signal', async () => {
  const controller = new AbortController()
  const reason = new Error('view already closed')
  controller.abort(reason)

  await assert.rejects(abortableDelay(1_000, controller.signal), (error) => error === reason)
})

test('resolves a delay when it is not cancelled', async () => {
  await abortableDelay(1)
})
