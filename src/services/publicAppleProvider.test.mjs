import assert from 'node:assert/strict'
import test from 'node:test'
import { searchFallbackTracks } from '../searchLogic.mjs'
import { createPublicAppleProvider } from './publicAppleProvider.mjs'

const fallbackTrack = {
  id: 'demo-1', title: 'Fallback', artist: 'Listener', album: 'Demo', duration: 0,
  source: 'demo', audioUrl: 'https://audio.example/demo.mp3', cover: 'gold',
  sourceUrl: 'https://audio.example/demo.mp3', quality: 'standard',
  capabilities: { playback: 'full', lyrics: false, download: false },
}

const fallback = {
  search: async () => [fallbackTrack],
  resolve: async (track) => track.audioUrl,
  identify: async () => null,
  lookup: async () => fallbackTrack,
  lyrics: async () => { throw new Error('unsupported') },
  download: async () => { throw new Error('unsupported') },
  status: async () => ({ online: false, sources: ['demo'], capabilities: {} }),
}

test('public Apple search returns normalized playable tracks from the browser-safe API', async () => {
  let request
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ results: [{
        trackId: 123,
        trackName: '晴天',
        artistName: '周杰伦',
        collectionName: '叶惠美',
        trackTimeMillis: 269_000,
        previewUrl: 'https://audio-ssl.itunes.apple.com/example.m4a',
        artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
        trackViewUrl: 'https://music.apple.com/cn/song/123',
      }] })
    },
  })

  const tracks = await provider.search(' 周杰伦 ')

  assert.equal(request.url.origin, 'https://itunes.apple.com')
  assert.equal(request.url.pathname, '/search')
  assert.equal(request.url.searchParams.get('term'), '周杰伦')
  assert.equal(request.url.searchParams.get('entity'), 'song')
  assert.equal(request.options.headers.Accept, 'application/json')
  assert.deepEqual(tracks, [{
    id: '123', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269,
    source: 'apple', audioUrl: 'https://audio-ssl.itunes.apple.com/example.m4a',
    cover: 'https://is1-ssl.mzstatic.com/image/600x600bb.jpg',
    sourceUrl: 'https://music.apple.com/cn/song/123', quality: 'standard',
    capabilities: { playback: 'preview', lyrics: false, download: false },
  }])
})

test('public Apple search rejects unsafe media fields without dropping metadata', async () => {
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => Response.json({ results: [{
      trackId: 456,
      trackName: 'Metadata only',
      artistName: 'Artist',
      previewUrl: 'https://attacker.example/audio.mp3',
      artworkUrl100: 'javascript:alert(1)',
      trackViewUrl: 'https://attacker.example/track',
    }] }),
  })

  assert.deepEqual(await provider.search('metadata'), [{
    id: '456', title: 'Metadata only', artist: 'Artist', album: '未知专辑', duration: 0,
    source: 'apple', audioUrl: '', cover: 'gold',
    sourceUrl: 'https://music.apple.com/cn/song/456', quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }])
})

test('public Apple search exposes demo results only as an explicit degraded fallback', async () => {
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => { throw new Error('offline') },
  })

  await assert.rejects(() => provider.search('anything'), (error) => {
    assert.deepEqual(searchFallbackTracks(error), [fallbackTrack])
    return true
  })
})
