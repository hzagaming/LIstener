import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createAudioDownloader, pipeAudioDownload } from './audioDownload.mjs'

test('streams authorized Wikimedia audio without buffering it in the application', async () => {
  const calls = []
  const download = createAudioDownloader({
    maxBytes: 4,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'audio/ogg', 'content-length': '3' },
      })
    },
  })
  const upstream = await download({
    source: 'wikimedia',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/audio.ogg',
  })
  const output = new PassThrough()
  const chunks = []
  output.on('data', (chunk) => chunks.push(chunk))
  await pipeAudioDownload(upstream, output)

  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(upstream.contentType, 'audio/ogg')
  assert.equal(upstream.contentLength, 3)
  assert.deepEqual([...Buffer.concat(chunks)], [1, 2, 3])
})

test('streams licensed Internet Archive audio across official download hosts', async () => {
  const calls = []
  const download = createAudioDownloader({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://ia801.example.us.archive.org/file.mp3' } })
      }
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg', 'content-length': '1' } })
    },
  })

  const upstream = await download({ source: 'internetarchive', url: 'https://archive.org/download/open/file.mp3' })

  assert.equal(upstream.contentType, 'audio/mpeg')
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://archive.org/download/open/file.mp3',
    'https://ia801.example.us.archive.org/file.mp3',
  ])
  assert.equal(calls[1].options.headers['User-Agent'], 'Listener/1.2.0 (+https://github.com/hzagaming/LIstener)')
})

test('rejects unsafe hosts, redirects, MIME types, and oversized audio', async () => {
  const download = createAudioDownloader({
    maxBytes: 3,
    fetchImpl: async (url) => {
      if (String(url).includes('redirect')) {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
      }
      if (String(url).includes('text')) return new Response('no', { headers: { 'content-type': 'text/plain' } })
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg' } })
    },
  })

  await assert.rejects(download({ source: 'wikimedia', url: 'http://127.0.0.1/a.mp3' }), /not allowed/)
  await assert.rejects(download({ source: 'wikimedia', url: 'https://upload.wikimedia.org/redirect' }), /not allowed/)
  await assert.rejects(download({ source: 'wikimedia', url: 'https://upload.wikimedia.org/text' }), /audio/)
  const upstream = await download({ source: 'wikimedia', url: 'https://upload.wikimedia.org/large' })
  await assert.rejects(pipeAudioDownload(upstream, new PassThrough()), /too large/)
})

test('times out a stalled upstream audio download', async () => {
  const download = createAudioDownloader({
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  })
  const guard = new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 100))

  await assert.rejects(Promise.race([
    download({ source: 'wikimedia', url: 'https://upload.wikimedia.org/stalled.ogg' }),
    guard,
  ]), /timeout/i)
})
