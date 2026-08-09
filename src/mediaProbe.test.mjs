import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyPublicAudioUrl } from './mediaProbe.mjs'

const response = ({ ok, status, url, type }) => {
  let cancelled = false
  return {
    ok,
    status,
    url,
    headers: new Headers({ 'content-type': type }),
    body: { cancel: async () => { cancelled = true } },
    cancelled: () => cancelled,
  }
}

test('retries an Audius gateway and returns only a verified final audio URL', async () => {
  const requests = []
  const responses = [
    response({ ok: false, status: 403, url: 'https://blocked.audius.example/audio', type: 'text/plain' }),
    response({ ok: true, status: 206, url: 'https://media.audius.example/audio.mp3?signature=safe', type: 'audio/mpeg' }),
  ]
  const result = await verifyPublicAudioUrl('https://api.audius.co/v1/tracks/D7KyD/stream?skip_play_count=true', {
    attempts: 2,
    now: () => 123456,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options })
      return responses[requests.length - 1]
    },
  })

  assert.equal(result, 'https://media.audius.example/audio.mp3?signature=safe')
  assert.deepEqual(requests.map(({ url }) => url.searchParams.get('_probe')), ['123456-0', '123456-1'])
  assert.equal(requests.every(({ options }) => options.headers.Accept === 'audio/*,application/ogg,application/octet-stream'), true)
  assert.equal(requests.every(({ options }) => options.headers.Range === 'bytes=0-1023'), true)
  assert.equal(requests.every(({ options }) => options.credentials === 'omit' && options.redirect === 'follow'), true)
  assert.equal(responses.every((item) => item.cancelled()), true)
})

test('rejects unsafe, non-audio, and exhausted media candidates', async () => {
  await assert.rejects(() => verifyPublicAudioUrl('http://api.audius.co/stream'), /valid HTTPS media URL/)
  await assert.rejects(() => verifyPublicAudioUrl('https://api.audius.co/v1/tracks/D7KyD/stream', {
    attempts: 1,
    fetchImpl: async () => response({ ok: true, status: 200, url: 'https://media.audius.example/error', type: 'text/html' }),
  }), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
  await assert.rejects(() => verifyPublicAudioUrl('https://api.audius.co/v1/tracks/D7KyD/stream', {
    attempts: 1,
    fetchImpl: async () => response({ ok: true, status: 204, url: 'https://media.audius.example/empty.mp3', type: 'audio/mpeg' }),
  }), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
  await assert.rejects(() => verifyPublicAudioUrl('https://api.audius.co/v1/tracks/D7KyD/stream', {
    attempts: 2,
    fetchImpl: async () => { throw new TypeError('offline') },
  }), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
})
