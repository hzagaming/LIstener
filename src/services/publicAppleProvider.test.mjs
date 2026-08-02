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

test('public Apple provider identifies supported Apple URLs and source-qualified IDs', async () => {
  const provider = createPublicAppleProvider({ fallback, fetchImpl: async () => Response.json({ results: [] }) })

  assert.deepEqual(await provider.identify('https://music.apple.com/cn/album/test/123?i=456'), {
    source: 'apple', id: '456', canonicalUrl: 'https://music.apple.com/cn/song/456',
  })
  assert.deepEqual(await provider.identify(' １２３ ', 'apple'), {
    source: 'apple', id: '123', canonicalUrl: 'https://music.apple.com/cn/song/123',
  })
  assert.equal(await provider.identify('https://music.apple.com.evil.example/cn/song/test/123'), null)
})

test('public Apple provider bounds response bodies and validates country configuration', async () => {
  assert.throws(() => createPublicAppleProvider({ fallback, country: '../evil' }), /valid Apple country/)

  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => new Response('{"results":[]}', {
      headers: { 'content-length': '3000000', 'content-type': 'application/json' },
    }),
  })
  await assert.rejects(() => provider.search('oversized'), (error) => {
    assert.deepEqual(searchFallbackTracks(error), [fallbackTrack])
    return true
  })
})

test('public Apple status probes the browser endpoint and falls back when offline', async () => {
  let request
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ results: [] })
    },
  })

  assert.deepEqual(await provider.status(), {
    online: true,
    sources: ['apple'],
    capabilities: { apple: { search: true, playback: true, lyrics: false, download: false } },
  })
  assert.equal(request.url.origin, 'https://itunes.apple.com')
  assert.equal(request.options.method, undefined)

  const offline = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.deepEqual(await offline.status(), await fallback.status())
})

test('public Apple search retries one transient failure before degrading', async () => {
  let calls = 0
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) throw new TypeError('temporary network failure')
      return Response.json({ results: [{ trackId: 789, trackName: 'Recovered', artistName: 'Artist' }] })
    },
  })

  assert.equal((await provider.search('recovered'))[0].title, 'Recovered')
  assert.equal(calls, 2)
})

test('public Apple search retries service failures but not ordinary client errors', async () => {
  let serviceCalls = 0
  const delays = []
  const serviceRecovery = createPublicAppleProvider({
    fallback,
    randomImpl: () => 0.5,
    waitImpl: async (milliseconds) => { delays.push(milliseconds) },
    fetchImpl: async () => ++serviceCalls === 1
      ? new Response('', { status: 503 })
      : Response.json({ results: [{ trackId: 790, trackName: 'Recovered service', artistName: 'Artist' }] }),
  })
  assert.equal((await serviceRecovery.search('service'))[0].title, 'Recovered service')
  assert.equal(serviceCalls, 2)
  assert.deepEqual(delays, [100])

  let clientCalls = 0
  const invalidRequest = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => {
      clientCalls += 1
      return new Response('', { status: 400 })
    },
  })
  await assert.rejects(() => invalidRequest.search('invalid'), (error) => searchFallbackTracks(error) !== null)
  assert.equal(clientCalls, 1)

  let serverCalls = 0
  const serverError = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => { serverCalls += 1; return new Response('', { status: 500 }) },
  })
  await assert.rejects(() => serverError.search('server'), (error) => searchFallbackTracks(error) !== null)
  assert.equal(serverCalls, 1)
})

test('public Apple search cancels an undeclared streaming body above the byte limit', async () => {
  let reads = 0
  let cancelled = false
  const chunk = new Uint8Array(1_048_576)
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => reads++ < 3 ? { done: false, value: chunk } : { done: true },
          cancel: async () => { cancelled = true },
        }),
      },
      text: async () => { throw new Error('streaming response must not use text()') },
    }),
  })

  await assert.rejects(() => provider.search('oversized stream'), (error) => searchFallbackTracks(error) !== null)
  assert.equal(cancelled, true)
  assert.equal(reads, 3)
})

test('public Apple search checks the US storefront when the configured country is empty', async () => {
  const countries = []
  const provider = createPublicAppleProvider({
    fallback,
    fetchImpl: async (url) => {
      const country = new URL(url).searchParams.get('country')
      countries.push(country)
      return Response.json({ results: country === 'US'
        ? [{ trackId: 987, trackName: 'Global result', artistName: 'Artist' }]
        : [] })
    },
  })

  assert.equal((await provider.search('global'))[0].title, 'Global result')
  assert.deepEqual(countries, ['CN', 'US'])
})
