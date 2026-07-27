import assert from 'node:assert/strict'
import test from 'node:test'
import { createStructuredLogger, redactLogValue } from './logger.mjs'

test('redacts nested secrets, headers, and signed URL query values', () => {
  const redacted = redactLogValue({
    authorization: 'Bearer abc',
    nested: { apiKey: 'secret', safe: 'ok' },
    cookie: 'session=private',
    url: 'https://cdn.example/audio.mp3?token=abc&expires=123&X-Amz-Credential=user&Policy=encoded&quality=high',
  })

  assert.deepEqual(redacted, {
    authorization: '[REDACTED]',
    nested: { apiKey: '[REDACTED]', safe: 'ok' },
    cookie: '[REDACTED]',
    url: 'https://cdn.example/audio.mp3?token=%5BREDACTED%5D&expires=%5BREDACTED%5D&X-Amz-Credential=%5BREDACTED%5D&Policy=%5BREDACTED%5D&quality=high',
  })
})

test('writes one structured JSON event without leaking secrets', () => {
  const entries = []
  const logger = createStructuredLogger({ sink: (line) => entries.push(JSON.parse(line)) })
  logger.info('provider_request', { provider: 'fixture', token: 'hidden', resultCount: 2 })

  assert.equal(entries.length, 1)
  assert.equal(entries[0].level, 'info')
  assert.equal(entries[0].event, 'provider_request')
  assert.equal(entries[0].token, '[REDACTED]')
  assert.equal(entries[0].resultCount, 2)
  assert.equal(typeof entries[0].timestamp, 'string')
})

test('redacts credentials embedded in error messages', () => {
  const value = redactLogValue(new Error('request failed: Authorization=Bearer abc token=hidden'))
  assert.equal(JSON.stringify(value).includes('abc'), false)
  assert.equal(JSON.stringify(value).includes('hidden'), false)
})
