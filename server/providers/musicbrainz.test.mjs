import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicBrainzProvider } from './musicbrainz.mjs'

const recording = {
  id: '026fa041-3917-4c73-9079-ed16e36f20f8',
  title: 'Blow Your Mind (Mwah)',
  length: 178400,
  'artist-credit': [
    { name: 'Dua Lipa', joinphrase: ' feat. ' },
    { artist: { name: 'Guest Artist' }, joinphrase: '' },
  ],
  releases: [
    { title: 'Unofficial Collection', status: 'Bootleg' },
    { title: 'Official Album', status: 'Official' },
  ],
}

test('searches recordings with an identified and bounded request', async () => {
  let request
  const provider = createMusicBrainzProvider({
    contact: 'ops@example.com',
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ recordings: [recording] })
    },
    minIntervalMs: 0,
  })

  assert.deepEqual(await provider.search('  Dua Lipa  ', 99), [{
    id: recording.id,
    title: 'Blow Your Mind (Mwah)',
    artist: 'Dua Lipa feat. Guest Artist',
    album: 'Official Album',
    duration: 178,
    source: 'musicbrainz',
    audioUrl: '',
    cover: 'gold',
    sourceUrl: `https://musicbrainz.org/recording/${recording.id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }])
  assert.equal(request.url.pathname, '/ws/2/recording/')
  assert.equal(request.url.searchParams.get('query'), 'Dua Lipa')
  assert.equal(request.url.searchParams.get('limit'), '50')
  assert.equal(request.url.searchParams.get('fmt'), 'json')
  assert.equal(request.options.headers.Accept, 'application/json')
  assert.match(request.options.headers['User-Agent'], /^Listener\/0\.4\.0 \(ops@example\.com\)$/)
  assert.equal(request.options.redirect, 'error')
  assert.equal(provider.capabilities.playback, false)
})

test('looks up a recording by MBID and rejects invalid or missing IDs', async () => {
  const requests = []
  const provider = createMusicBrainzProvider({
    contact: 'https://listener.example/contact',
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      requests.push(parsed)
      if (parsed.pathname.endsWith('/00000000-0000-0000-0000-000000000000')) {
        return new Response(null, { status: 404 })
      }
      return Response.json(recording)
    },
    minIntervalMs: 0,
  })

  assert.equal((await provider.lookup(recording.id.toUpperCase())).id, recording.id)
  assert.equal(requests[0].pathname, `/ws/2/recording/${recording.id}`)
  assert.equal(requests[0].searchParams.get('inc'), 'artists+releases')
  assert.equal(requests[0].searchParams.get('fmt'), 'json')
  await assert.rejects(() => provider.lookup('not-an-mbid'), /invalid MusicBrainz track id/)
  await assert.rejects(() => provider.lookup('00000000-0000-0000-0000-000000000000'), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    return true
  })
})

test('rejects lookup responses for a different recording', async () => {
  const requestedId = '11111111-1111-1111-1111-111111111111'
  const provider = createMusicBrainzProvider({
    contact: 'ops@example.com',
    fetchImpl: async () => Response.json(recording),
    minIntervalMs: 0,
  })

  await assert.rejects(() => provider.lookup(requestedId), /invalid MusicBrainz response/)
})

test('serializes requests to respect the configured minimum interval', async () => {
  let timestamp = 0
  const starts = []
  const waits = []
  const provider = createMusicBrainzProvider({
    contact: 'ops@example.com',
    fetchImpl: async () => {
      starts.push(timestamp)
      return Response.json({ recordings: [] })
    },
    minIntervalMs: 1_000,
    now: () => timestamp,
    waitImpl: async (milliseconds) => {
      waits.push(milliseconds)
      timestamp += milliseconds
    },
  })

  await Promise.all([provider.search('one'), provider.search('two'), provider.search('three')])
  assert.deepEqual(starts, [0, 1_000, 2_000])
  assert.deepEqual(waits, [1_000, 1_000])
})

test('rejects malformed responses and filters malformed recordings', async () => {
  const malformed = createMusicBrainzProvider({
    contact: 'ops@example.com',
    fetchImpl: async () => Response.json({ recordings: null }),
    minIntervalMs: 0,
  })
  await assert.rejects(() => malformed.search('test'), /invalid MusicBrainz response/)

  const filtered = createMusicBrainzProvider({
    contact: 'ops@example.com',
    fetchImpl: async () => Response.json({
      recordings: [
        { ...recording, id: 'invalid' },
        { ...recording, id: '11111111-1111-1111-1111-111111111111', title: '' },
        { ...recording, id: '22222222-2222-2222-2222-222222222222', length: Infinity },
      ],
    }),
    minIntervalMs: 0,
  })
  const tracks = await filtered.search('test')
  assert.deepEqual(tracks.map(({ id, duration }) => [id, duration]), [
    ['22222222-2222-2222-2222-222222222222', 0],
  ])
})

test('requires contact information and avoids requests for blank searches', async () => {
  assert.throws(() => createMusicBrainzProvider(), /contact is required/)
  assert.throws(() => createMusicBrainzProvider({ contact: 'ops@example.com\nX-Test: injected' }), /contact is required/)
  assert.throws(() => createMusicBrainzProvider({ contact: 'ops@example.com', baseUrl: 'http://musicbrainz.org/ws/2/recording/' }), /HTTPS/)
  assert.throws(() => createMusicBrainzProvider({ contact: 'ops@example.com', baseUrl: 'https://user:pass@musicbrainz.org/ws/2/recording/' }), /HTTPS/)
  assert.throws(() => createMusicBrainzProvider({ contact: 'ops@example.com', baseUrl: 'https://metadata.example/ws/2/recording/' }), /official host/)
  let calls = 0
  const provider = createMusicBrainzProvider({
    contact: 'ops@example.com',
    baseUrl: '',
    fetchImpl: async () => { calls += 1; return Response.json({ recordings: [] }) },
  })
  assert.deepEqual(await provider.search('   '), [])
  assert.equal(calls, 0)
})
