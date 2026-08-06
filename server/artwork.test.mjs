import assert from 'node:assert/strict'
import test from 'node:test'
import { createArtworkDownloader } from './artwork.mjs'

test('downloads bounded artwork only from source-specific trusted hosts', async () => {
  const calls = []
  const download = createArtworkDownloader({
    fetchImpl: async (url) => {
      calls.push(String(url))
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
    },
  })
  const result = await download({
    source: 'apple',
    url: 'https://is1-ssl.mzstatic.com/image/thumb/cover.jpg',
    title: 'A/B',
  })

  assert.deepEqual(calls, ['https://is1-ssl.mzstatic.com/image/thumb/cover.jpg'])
  assert.equal(result.contentType, 'image/jpeg')
  assert.equal(result.filename, 'A_B-cover.jpg')
  assert.deepEqual([...result.bytes], [1, 2, 3])
})

test('downloads YouTube thumbnails only from the official image host', async () => {
  const calls = []
  const download = createArtworkDownloader({
    fetchImpl: async (url) => {
      calls.push(String(url))
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } })
    },
  })

  await download({ source: 'youtube', url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', title: 'Video' })
  assert.deepEqual(calls, ['https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'])
  await assert.rejects(
    download({ source: 'youtube', url: 'https://evil.example/cover.jpg', title: 'Video' }),
    /not allowed/,
  )
})

test('rejects SSRF targets, non-images, redirects to untrusted hosts, and oversized artwork', async () => {
  const download = createArtworkDownloader({
    maxBytes: 3,
    fetchImpl: async (url) => {
      if (String(url).includes('redirect')) {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
      }
      if (String(url).includes('text')) return new Response('no', { headers: { 'content-type': 'text/plain' } })
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/png' } })
    },
  })

  await assert.rejects(download({ source: 'apple', url: 'http://127.0.0.1/a.jpg', title: 'x' }), /not allowed/)
  await assert.rejects(download({ source: 'apple', url: 'https://is1-ssl.mzstatic.com/redirect', title: 'x' }), /not allowed/)
  await assert.rejects(download({ source: 'netease', url: 'https://p1.music.126.net/text', title: 'x' }), /image/)
  await assert.rejects(download({ source: 'netease', url: 'https://p1.music.126.net/large', title: 'x' }), /too large/)
})

test('times out a stalled upstream artwork download', async () => {
  const download = createArtworkDownloader({
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  })
  const guard = new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 100))

  await assert.rejects(Promise.race([
    download({ source: 'apple', url: 'https://is1-ssl.mzstatic.com/stalled.jpg', title: 'x' }),
    guard,
  ]), /timeout/i)
})
