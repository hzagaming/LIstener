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
  }])
  assert.equal(requestedUrl.searchParams.get('term'), '周杰伦')
  assert.equal(requestedUrl.searchParams.get('limit'), '5')
  assert.equal(requestedUrl.searchParams.get('country'), 'CN')
})

test('filters results without a playable preview', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ resultCount: 1, results: [{ ...song, previewUrl: undefined }] }),
  })
  assert.deepEqual(await provider.search('test'), [])
})

test('resolves a preview URL through the lookup endpoint', async () => {
  const provider = createAppleProvider({
    fetchImpl: async () => Response.json({ resultCount: 1, results: [song] }),
  })
  assert.equal(await provider.resolve('42'), 'https://audio.example/42.m4a')
})

test('rejects malformed Apple responses', async () => {
  const provider = createAppleProvider({ fetchImpl: async () => Response.json({ results: null }) })
  await assert.rejects(() => provider.search('test'), /invalid Apple search response/)
})
