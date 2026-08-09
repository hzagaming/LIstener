import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicMusicProvider, publicMusicSources } from './publicMusicProvider.mjs'

const track = (source, id, playback = 'none') => ({
  id,
  title: `${source} title`,
  artist: `${source} artist`,
  album: `${source} album`,
  duration: 180,
  source,
  audioUrl: '',
  cover: 'gold',
  sourceUrl: `https://example.com/${source}/${id}`,
  quality: 'unknown',
  capabilities: { playback, lyrics: false, download: false },
})

const appleTrack = { ...track('apple', '1', 'preview'), audioUrl: 'https://audio-ssl.itunes.apple.com/apple.m4a' }
const fallbackTrack = track('demo', 'fallback', 'full')
const fallback = {
  search: async () => [fallbackTrack],
  searchPage: async () => ({ tracks: [fallbackTrack], page: 1, hasMore: false }),
  resolve: async (item) => item.audioUrl,
  identify: async () => null,
  lookup: async () => { throw new Error('unsupported') },
  lyrics: async () => { throw new Error('unsupported') },
  download: async () => { throw new Error('unsupported') },
  status: async () => ({ online: false, sources: ['demo'], capabilities: {} }),
}
const apple = {
  search: async () => [appleTrack],
  searchPage: async (_query, options = {}) => ({ tracks: [appleTrack], page: options.page ?? 1, hasMore: false }),
  resolve: async () => 'https://audio-ssl.itunes.apple.com/apple.m4a',
  identify: async () => null,
  lookup: async () => appleTrack,
  lyrics: fallback.lyrics,
  download: fallback.download,
  status: async () => ({
    online: true,
    sources: ['apple'],
    capabilities: { apple: { search: true, playback: true, lyrics: false, download: false } },
  }),
}

const audiusFixture = {
  id: 'D7KyD',
  title: 'Hypermantra',
  duration: 193.6,
  user: { name: 'Camoufly' },
  permalink: '/camouflybeats/hypermantra-86216',
  artwork: { '480x480': 'https://audius-nodes.com/content/cover.jpg' },
  stream: {
    url: 'https://val010.open-audio-validator.com/tracks/public.mp3?signature=safe',
    mirrors: ['https://mirror.audius.example'],
  },
  download: { url: 'https://val010.open-audio-validator.com/tracks/public.wav?signature=safe' },
  is_available: true,
  is_streamable: true,
  is_stream_gated: false,
  stream_conditions: null,
  is_downloadable: true,
  is_download_gated: false,
  download_conditions: null,
  access: { stream: true, download: true },
}

const musicBrainzFixture = {
  id: '026fa041-3917-4c73-9079-ed16e36f20f8',
  title: 'Blow Your Mind',
  length: 178_000,
  'artist-credit': [{ name: 'Dua Lipa' }],
  releases: [{ title: 'Future Nostalgia', status: 'Official' }],
}

const wikimediaFixture = {
  pageid: 42,
  title: 'File:Public song.ogg',
  imageinfo: [{
    url: 'https://upload.wikimedia.org/public-song.ogg',
    descriptionurl: 'https://commons.wikimedia.org/?curid=42',
    mime: 'audio/ogg',
    user: 'Open Artist',
  }],
}

const fixtureFetch = (requests, failedOrigin = '') => async (input, options = {}) => {
  const url = new URL(input)
  requests.push({ url, options })
  if (url.origin === failedOrigin) throw new Error('offline')
  if (url.origin === 'https://api.audius.co') {
    return Response.json({ data: url.pathname.endsWith('/search') ? [audiusFixture] : audiusFixture })
  }
  if (url.origin === 'https://musicbrainz.org') {
    return Response.json(url.pathname.endsWith('/') ? { recordings: [musicBrainzFixture] } : musicBrainzFixture)
  }
  if (url.origin === 'https://commons.wikimedia.org') return Response.json({ query: { pages: [wikimediaFixture] } })
  throw new Error(`unexpected request: ${url}`)
}

test('aggregates four keyless browser sources without letting one outage hide the others', async () => {
  const requests = []
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: fixtureFetch(requests, 'https://commons.wikimedia.org'),
    musicBrainzIntervalMs: 0,
  })

  const page = await provider.searchPage('Dua Lipa', { pageSize: 8 })

  assert.deepEqual(page.tracks.map(({ source }) => source), ['apple', 'audius', 'musicbrainz'])
  assert.equal(page.hasMore, false)
  assert.equal(requests.some(({ url }) => url.searchParams.has('api_key')), false)
  assert.equal(requests.some(({ url }) => url.origin === 'https://commons.wikimedia.org'), true)
  assert.equal(page.tracks.find(({ source }) => source === 'audius').capabilities.playback, 'full')
})

test('searches Audius directly with honest pagination, playback, and download capabilities', async () => {
  const requests = []
  const provider = createPublicMusicProvider({ apple, fallback, fetchImpl: fixtureFetch(requests) })

  const page = await provider.searchPage('Hyper', { provider: 'audius', page: 2, pageSize: 5 })
  const [result] = page.tracks

  assert.equal(requests[0].url.href, 'https://api.audius.co/v1/tracks/search?query=Hyper&limit=5&offset=5')
  assert.equal(requests[0].options.headers.Accept, 'application/json')
  assert.equal(result.audioUrl, '')
  assert.equal(result.cover, audiusFixture.artwork['480x480'])
  assert.deepEqual(result.capabilities, { playback: 'full', lyrics: false, download: true })
})

test('resolves only byte-verified Audius streams and returns explicitly authorized downloads', async () => {
  const requests = []
  let streamAttempts = 0
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    now: () => 123456,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(input)
      requests.push({ url, options })
      if (url.pathname.endsWith('/stream')) {
        streamAttempts += 1
        return streamAttempts === 1
          ? new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } })
          : {
            ok: true,
            status: 206,
            url: 'https://media.audius.example/Hypermantra.mp3?signature=safe',
            headers: new Headers({ 'content-type': 'audio/mpeg' }),
            body: { cancel: async () => undefined },
          }
      }
      return Response.json({ data: audiusFixture })
    },
  })
  const stale = { ...track('audius', 'D7KyD', 'full'), capabilities: { playback: 'full', lyrics: false, download: true } }

  assert.equal(await provider.resolve(stale), 'https://media.audius.example/Hypermantra.mp3?signature=safe')
  assert.deepEqual(await provider.download(stale), { url: audiusFixture.download.url, filename: 'Hypermantra.wav' })
  assert.equal(requests.filter(({ url }) => url.pathname.endsWith('/stream')).length, 2)
  assert.equal(requests.some(({ url }) => url.searchParams.has('api_key')), false)

  const gated = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: async () => Response.json({ data: { ...audiusFixture, access: { stream: false, download: false } } }),
  })
  await assert.rejects(() => gated.resolve(stale), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
  await assert.rejects(() => gated.download(stale), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
})

test('bounds aggregate public search so one stalled source cannot delay healthy results', async () => {
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    requestTimeoutMs: 100,
    musicBrainzIntervalMs: 0,
    fetchImpl: async (_input, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })

  const result = await Promise.race([
    provider.searchPage('fast result', { pageSize: 5 }),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 500)),
  ])

  assert.notEqual(result, 'still-pending')
  assert.deepEqual(result.tracks, [appleTrack])
})

test('normalizes MusicBrainz metadata and Wikimedia open audio while rejecting unsafe media fields', async () => {
  const requests = []
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: fixtureFetch(requests),
    musicBrainzIntervalMs: 0,
  })

  const musicBrainz = await provider.searchPage('Dua', { provider: 'musicbrainz', pageSize: 3 })
  const wikimedia = await provider.searchPage('Public', { provider: 'wikimedia', pageSize: 3 })

  assert.equal(musicBrainz.tracks[0].artist, 'Dua Lipa')
  assert.equal(musicBrainz.tracks[0].capabilities.playback, 'none')
  assert.equal(wikimedia.tracks[0].audioUrl, wikimediaFixture.imageinfo[0].url)
  assert.deepEqual(wikimedia.tracks[0].capabilities, { playback: 'full', lyrics: false, download: true })
  const commonsRequest = requests.find(({ url }) => url.origin === 'https://commons.wikimedia.org').url
  assert.equal(commonsRequest.searchParams.get('origin'), '*')
  assert.equal(commonsRequest.searchParams.get('gsrnamespace'), '6')

  const unsafe = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: async () => Response.json({ query: { pages: [{
      ...wikimediaFixture,
      imageinfo: [{ ...wikimediaFixture.imageinfo[0], url: 'https://attacker.example/audio.ogg' }],
    }] } }),
  })
  assert.deepEqual((await unsafe.searchPage('unsafe', { provider: 'wikimedia' })).tracks, [])
})

test('recognizes every platform locally and looks up supported public IDs', async () => {
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: fixtureFetch([]),
    musicBrainzIntervalMs: 0,
  })

  assert.deepEqual(await provider.identify('https://music.163.com/#/song?id=25906124'), {
    source: 'netease', id: '25906124', canonicalUrl: 'https://music.163.com/#/song?id=25906124',
  })
  assert.deepEqual(await provider.identify('026fa041-3917-4c73-9079-ed16e36f20f8', 'musicbrainz'), {
    source: 'musicbrainz',
    id: '026fa041-3917-4c73-9079-ed16e36f20f8',
    canonicalUrl: 'https://musicbrainz.org/recording/026fa041-3917-4c73-9079-ed16e36f20f8',
  })
  assert.equal((await provider.lookup({ source: 'musicbrainz', id: musicBrainzFixture.id })).title, 'Blow Your Mind')
})

test('reports only responsive public sources and respects the MusicBrainz one-request-per-second rule', async () => {
  let timestamp = 0
  const waits = []
  const requests = []
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    fetchImpl: fixtureFetch(requests, 'https://commons.wikimedia.org'),
    now: () => timestamp,
    waitImpl: async (milliseconds) => { waits.push(milliseconds); timestamp += milliseconds },
  })

  await provider.searchPage('first', { provider: 'musicbrainz' })
  await provider.searchPage('second', { provider: 'musicbrainz' })
  assert.deepEqual(waits, [1_000])

  const status = await provider.status()
  assert.deepEqual(status.sources, ['apple', 'audius', 'musicbrainz'])
  assert.equal(status.capabilities.audius.download, true)
  assert.equal(status.capabilities.musicbrainz.playback, false)
  assert.deepEqual(publicMusicSources, ['apple', 'audius', 'musicbrainz', 'wikimedia'])
})

test('bounds the whole status probe so one stalled source cannot hold the UI open', async () => {
  const provider = createPublicMusicProvider({
    apple,
    fallback,
    statusTimeoutMs: 10,
    fetchImpl: async (_input, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })

  const result = await Promise.race([
    provider.status(),
    new Promise((resolve) => setTimeout(() => resolve('still-pending'), 100)),
  ])

  assert.notEqual(result, 'still-pending')
  assert.deepEqual(result.sources, ['apple'])
})
