import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppleProvider } from './apple.mjs'

const song = {
  trackId: 42,
  trackName: '晴天',
  artistName: '周杰伦',
  collectionName: '叶惠美',
  trackTimeMillis: 269747,
  previewUrl: 'https://audio.example/42.m4a',
  artworkUrl100: 'https://img.example/100x100bb.jpg',
  trackViewUrl: 'https://music.apple.com/cn/song/42',
}

test('normalizes Apple search results with playable previews', async () => {
  let requestedUrl
  const provider = createAppleProvider({
    fetchImpl: async (url) => {
      requestedUrl = new URL(url)
      return Response.json({ resultCount: 1, results: [song] })
    },
  })

  assert.deepEqual(await provider.search('  周杰伦  ', 5), [{
    id: '42',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 270,
    source: 'apple',
    audioUrl: 'https://audio.example/42.m4a',
    cover: 'https://img.example/600x600bb.jpg',
    sourceUrl: 'https://music.apple.com/cn/song/42',
    quality: 'standard',
    capabilities: { playback: 'preview', lyrics: false, download: false },
  }])
  assert.equal(requestedUrl.searchParams.get('term'), '周杰伦')
  assert.equal(requestedUrl.searchParams.get('limit'), '5')
  assert.equal(requestedUrl.searchParams.get('offset'), null)
  assert.equal(requestedUrl.searchParams.get('country'), 'CN')
})

test('does not repeat Apple results beyond its single supported search page', async () => {
  let calls = 0
  const provider = createAppleProvider({
    fetchImpl: async () => {
      calls += 1
      return Response.json({ resultCount: 1, results: [song] })
    },
  })

  assert.equal(provider.maxSearchPages, 1)
  assert.deepEqual(await provider.search('周杰伦', 5, undefined, 2), [])
  assert.equal(calls, 0)
})

test('keeps searchable metadata when a playable preview is unavailable', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ resultCount: 1, results: [{ ...song, previewUrl: undefined }] }),
  })
  const [result] = await provider.search('test')
  assert.equal(result.id, '42')
  assert.equal(result.audioUrl, '')
  assert.deepEqual(result.capabilities, { playback: 'none', lyrics: false, download: false })
})

test('normalizes malformed and non-finite Apple durations to zero', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          results: [
            { ...song, trackId: 1, trackTimeMillis: 'invalid' },
            { ...song, trackId: 2, trackTimeMillis: Infinity },
          ],
        }
      },
    }),
  })

  assert.deepEqual((await provider.search('test')).map(({ duration }) => duration), [0, 0])
})

test('resolves a preview URL through the lookup endpoint', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ resultCount: 1, results: [song] }),
  })
  assert.equal(await provider.resolve('42'), 'https://audio.example/42.m4a')
  assert.equal((await provider.lookup('42'))?.title, '晴天')
})

test('looks up valid Apple metadata without requiring a preview', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ results: [{ ...song, previewUrl: undefined }] }),
  })

  const result = await provider.lookup('42')
  assert.equal(result.audioUrl, '')
  assert.equal(result.quality, 'unknown')
  assert.deepEqual(result.capabilities, { playback: 'none', lyrics: false, download: false })
  await assert.rejects(() => provider.resolve('42'), /preview is unavailable/)
})

test('reports missing Apple tracks explicitly', async () => {
  const provider = createAppleProvider({ fetchImpl: async () => Response.json({ results: [] }) })
  await assert.rejects(() => provider.lookup('404'), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    assert.match(error.message, /not found/)
    return true
  })
})

test('rejects lookup results that do not match the requested track ID', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ results: [{ ...song, trackId: 43 }] }),
  })

  await assert.rejects(() => provider.lookup('42'), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    return true
  })
  await assert.rejects(() => provider.resolve('42'), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    return true
  })
})

test('rejects malformed Apple responses', async () => {
  const provider = createAppleProvider({ fetchImpl: async () => Response.json({ results: null }) })
  await assert.rejects(() => provider.search('test'), /invalid Apple search response/)
})
