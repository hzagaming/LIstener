import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestSignal } from './requestPolicy.mjs'

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
