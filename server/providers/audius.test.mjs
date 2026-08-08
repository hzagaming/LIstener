import assert from 'node:assert/strict'
import test from 'node:test'
import { createAudiusProvider } from './audius.mjs'

const track = {
  id: 'D7KyD',
  title: 'Hypermantra',
  user: { name: 'Camoufly', handle: 'camouflybeats' },
  duration: 193.6,
  artwork: {
    '150x150': 'https://img.audius.example/150.jpg',
    '480x480': 'https://img.audius.example/480.jpg',
  },
  permalink: '/camouflybeats/hypermantra-86216',
  is_streamable: true,
  is_stream_gated: false,
  stream_conditions: null,
  album_backlink: { playlist_name: 'Originals' },
}

test('searches Audius with a server-side API key and normalizes public tracks', async () => {
  let request
  const provider = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ data: [track] })
    },
    minIntervalMs: 0,
  })

  assert.deepEqual(await provider.search('  hyper  ', 99), [{
    id: 'D7KyD',
    title: 'Hypermantra',
    artist: 'Camoufly',
    album: 'Originals',
    duration: 194,
    source: 'audius',
    audioUrl: '',
    cover: 'https://img.audius.example/480.jpg',
    sourceUrl: 'https://audius.co/camouflybeats/hypermantra-86216',
    quality: 'unknown',
    capabilities: { playback: 'full', lyrics: false, download: false },
  }])
  assert.equal(request.url.pathname, '/v1/tracks/search')
  assert.equal(request.url.searchParams.get('query'), 'hyper')
  assert.equal(request.url.searchParams.get('limit'), '50')
  assert.equal(request.url.searchParams.get('offset'), '0')
  assert.equal(request.url.searchParams.get('api_key'), 'test-key')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(provider.capabilities.download, false)
})

test('searches public Audius tracks without requiring or sending an API key', async () => {
  let request
  const provider = createAudiusProvider({
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ data: [track] })
    },
    minIntervalMs: 0,
  })

  assert.equal((await provider.search('public'))[0].id, 'D7KyD')
  assert.equal(request.url.searchParams.has('api_key'), false)
  assert.equal(request.url.origin, 'https://api.audius.co')
})

test('keeps gated or malformed-permission tracks visible but disables playback', async () => {
  const missingGate = { ...track, id: 'missing_gate' }
  delete missingGate.is_stream_gated
  const provider = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({ data: [
      { ...track, id: 'gated_1', is_stream_gated: true, stream_conditions: { follow_user_id: 7 } },
      { ...track, id: 'string_gate', is_stream_gated: 'true' },
      { ...track, id: 'string_available', is_available: 'false' },
      { ...track, id: 'unavailable', is_available: false },
      { ...track, id: 'not_streamable', is_streamable: false },
      { ...track, id: 'object_conditions', stream_conditions: { follow_user_id: 7 } },
      { ...track, id: 'array_conditions', stream_conditions: [] },
      missingGate,
    ] }),
    minIntervalMs: 0,
  })

  const results = await provider.search('gated')
  assert.equal(results.length, 8)
  assert.equal(results.every((result) => result.capabilities.playback === 'none'), true)
  assert.equal(results.every((result) => result.quality === 'unknown'), true)
})

test('falls back to a valid smaller Audius artwork URL', async () => {
  const provider = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({ data: [{
      ...track,
      artwork: {
        '480x480': 'javascript:alert(1)',
        '150x150': 'https://img.audius.example/150.jpg',
      },
    }] }),
    minIntervalMs: 0,
  })

  assert.equal((await provider.search('artwork'))[0].cover, 'https://img.audius.example/150.jpg')
})

test('rejects Audius metadata URLs that expose the API key', async () => {
  for (const exposedKey of ['private/key', 'private%2Fkey', 'private%252Fkey']) {
    const provider = createAudiusProvider({
      apiKey: 'private/key',
      fetchImpl: async () => Response.json({ data: [{
        ...track,
        artwork: {
          '480x480': `https://img.audius.example/${exposedKey}/480.jpg`,
          '150x150': 'https://img.audius.example/safe/150.jpg',
        },
        permalink: `/camouflybeats/${exposedKey}`,
      }] }),
      minIntervalMs: 0,
    })

    const [result] = await provider.search('metadata')
    assert.equal(result.cover, 'https://img.audius.example/safe/150.jpg')
    assert.equal(result.sourceUrl, 'https://api.audius.co/v1/tracks/D7KyD')
  }

  const provider = createAudiusProvider({
    apiKey: 'private/key',
    fetchImpl: async () => Response.json({ data: [{
      ...track,
      artwork: {
        '480x480': 'https://img.audius.example/private%2Fkey/480.jpg',
        '150x150': 'https://img.audius.example/private%252Fkey/150.jpg',
      },
    }] }),
    minIntervalMs: 0,
  })

  assert.equal((await provider.search('metadata'))[0].cover, 'night')
})

test('looks up tracks and resolves only public streams without exposing the API key', async () => {
  const requests = []
  const provider = createAudiusProvider({
    apiKey: 'private-key',
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      requests.push({ url: parsed, options })
      if (parsed.pathname.endsWith('/stream')) {
        return Response.json({ data: 'https://stream.audius.example/D7KyD.mp3' })
      }
      return Response.json({ data: track })
    },
    minIntervalMs: 0,
  })

  assert.equal((await provider.lookup('D7KyD')).title, 'Hypermantra')
  const streamUrl = await provider.resolve('D7KyD')
  assert.equal(streamUrl, 'https://stream.audius.example/D7KyD.mp3')
  assert.equal(streamUrl.includes('private-key'), false)
  const streamRequest = requests.find(({ url }) => url.pathname.endsWith('/stream'))
  assert.equal(streamRequest.url.searchParams.get('no_redirect'), 'true')
  assert.equal(streamRequest.url.searchParams.get('api_key'), 'private-key')
  assert.equal(streamRequest.options.redirect, 'manual')
  assert.equal(requests.every(({ url }) => url.origin === 'https://api.audius.co'), true)
})

test('rejects gated, invalid, missing, and malformed stream responses', async () => {
  const gated = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({ data: { ...track, is_stream_gated: true } }),
    minIntervalMs: 0,
  })
  await assert.rejects(() => gated.resolve('D7KyD'), (error) => {
    assert.equal(error.code, 'CAPABILITY_UNAVAILABLE')
    assert.match(error.message, /not publicly streamable/)
    return true
  })

  const invalidStream = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async (url) => new URL(url).pathname.endsWith('/stream')
      ? Response.json({ data: 'javascript:alert(1)' })
      : Response.json({ data: track }),
    minIntervalMs: 0,
  })
  await assert.rejects(() => invalidStream.resolve('D7KyD'), /invalid Audius stream response/)
  await assert.rejects(() => invalidStream.lookup('../secret'), /invalid Audius track id/)

  for (const [apiKey, data] of [
    ['private/key', 'https://stream.audius.example/audio?api_key=private%2Fkey'],
    ['private/key', 'https://stream.audius.example/audio?api_key=private%252Fkey'],
    ['private/key', 'https://private:key@stream.audius.example/audio'],
    ['private key', 'https://stream.audius.example/audio?api_key=private+key'],
  ]) {
    const leaked = createAudiusProvider({
      apiKey,
      fetchImpl: async (url) => new URL(url).pathname.endsWith('/stream')
        ? Response.json({ data })
        : Response.json({ data: track }),
      minIntervalMs: 0,
    })
    await assert.rejects(() => leaked.resolve('D7KyD'), /invalid Audius stream response/)
  }

  const missing = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(null, { status: 404 }),
    minIntervalMs: 0,
  })
  await assert.rejects(() => missing.lookup('D7KyD'), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    return true
  })
})

test('binds lookup permissions to the requested Audius track id', async () => {
  let streamCalls = 0
  const provider = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      if (new URL(url).pathname.endsWith('/stream')) {
        streamCalls += 1
        return Response.json({ data: 'https://stream.audius.example/D7KyD.mp3' })
      }
      return Response.json({ data: { ...track, id: 'another_track' } })
    },
    minIntervalMs: 0,
  })

  await assert.rejects(() => provider.resolve('D7KyD'), /invalid Audius response/)
  assert.equal(streamCalls, 0)
})

test('classifies Audius stream permission and missing-track failures', async () => {
  for (const [status, code] of [[403, 'CAPABILITY_UNAVAILABLE'], [404, 'TRACK_NOT_FOUND']]) {
    const provider = createAudiusProvider({
      apiKey: 'test-key',
      fetchImpl: async (url) => new URL(url).pathname.endsWith('/stream')
        ? new Response(null, { status })
        : Response.json({ data: track }),
      minIntervalMs: 0,
    })

    await assert.rejects(() => provider.resolve('D7KyD'), (error) => {
      assert.equal(error.code, code)
      return true
    })
  }
})

test('redacts the Audius API key from upstream request failures', async () => {
  const provider = createAudiusProvider({
    apiKey: 'private-key',
    fetchImpl: async (url) => {
      throw new Error(`fetch failed for ${url}`)
    },
    minIntervalMs: 0,
  })

  await assert.rejects(() => provider.search('secret'), (error) => {
    assert.equal(error.message, 'Audius request failed')
    assert.equal(error.message.includes('private-key'), false)
    return true
  })
})

test('serializes Audius requests at the configured rate', async () => {
  let timestamp = 0
  const starts = []
  const waits = []
  const provider = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => {
      starts.push(timestamp)
      return Response.json({ data: [] })
    },
    minIntervalMs: 100,
    now: () => timestamp,
    waitImpl: async (milliseconds) => {
      waits.push(milliseconds)
      timestamp += milliseconds
    },
  })

  await Promise.all([provider.search('one'), provider.search('two'), provider.search('three')])
  assert.deepEqual(starts, [0, 100, 200])
  assert.deepEqual(waits, [100, 100])
})

test('accepts an absent API key and rejects unsafe optional credentials and malformed searches', async () => {
  assert.throws(() => createAudiusProvider({ apiKey: 'key\nX-Test: injected' }), /invalid Audius API key/)
  assert.throws(() => createAudiusProvider({ apiKey: 'key', baseUrl: 'http://api.audius.co/v1/' }), /HTTPS/)
  assert.throws(() => createAudiusProvider({ apiKey: 'key', baseUrl: 'https://user:pass@api.audius.co/v1/' }), /HTTPS/)
  assert.throws(() => createAudiusProvider({ apiKey: 'key', baseUrl: 'https://api.example/v1/' }), /official host/)
  let calls = 0
  const blank = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => { calls += 1; return Response.json({ data: [] }) },
  })
  assert.deepEqual(await blank.search('   '), [])
  assert.equal(calls, 0)

  const malformed = createAudiusProvider({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({ data: null }),
    minIntervalMs: 0,
  })
  await assert.rejects(() => malformed.search('test'), /invalid Audius response/)
})
