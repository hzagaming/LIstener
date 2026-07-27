import assert from 'node:assert/strict'
import { createServer, request as requestHttp } from 'node:http'
import test from 'node:test'
import { createApiHandler } from './http.mjs'

const withServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('serves search and resolve endpoints', async () => {
  const calls = []
  const service = {
    sources: ['apple'],
    sourceCapabilities: { apple: { search: true, playback: true, lyrics: false, download: false } },
    async search(query, limit) { calls.push(['search', query, limit]); return [{ id: '1' }] },
    async resolve(source, id) { calls.push(['resolve', source, id]); return 'https://audio.example/1' },
    identify(input, source) { calls.push(['identify', input, source]); return { source: 'netease', id: '441797' } },
    async lyrics(source, id) { calls.push(['lyrics', source, id]); return { plain: '歌词', lrc: '' } },
    async download(source, id) { calls.push(['download', source, id]); return { url: 'https://audio.example/1.flac', filename: 'song.flac' } },
    async lookup(source, id) { calls.push(['lookup', source, id]); return { id, source } },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`)
    assert.deepEqual(await health.json(), {
      status: 'ok',
      sources: ['apple'],
      capabilities: service.sourceCapabilities,
    })

    const search = await fetch(`${baseUrl}/api/search?q=%E6%B5%B7&limit=5`)
    assert.equal(search.status, 200)
    assert.deepEqual(await search.json(), { tracks: [{ id: '1' }] })

    const resolve = await fetch(`${baseUrl}/api/resolve?source=netease&id=1`)
    assert.equal(resolve.status, 200)
    assert.deepEqual(await resolve.json(), { url: 'https://audio.example/1' })

    const identify = await fetch(`${baseUrl}/api/identify?input=441797&source=netease`)
    assert.deepEqual(await identify.json(), { match: { source: 'netease', id: '441797' } })

    const lyrics = await fetch(`${baseUrl}/api/lyrics?source=netease&id=1`)
    assert.deepEqual(await lyrics.json(), { plain: '歌词', lrc: '' })

    const download = await fetch(`${baseUrl}/api/download?source=netease&id=1`)
    assert.deepEqual(await download.json(), { url: 'https://audio.example/1.flac', filename: 'song.flac' })

    const track = await fetch(`${baseUrl}/api/track?source=netease&id=1`)
    assert.deepEqual(await track.json(), { track: { id: '1', source: 'netease' } })
  })

  assert.deepEqual(calls, [
    ['search', '海', 5],
    ['resolve', 'netease', '1'],
    ['identify', '441797', 'netease'],
    ['lyrics', 'netease', '1'],
    ['download', 'netease', '1'],
    ['lookup', 'netease', '1'],
  ])
})

test('aborts a search subscription when its client disconnects', async () => {
  let markStarted
  let markAborted
  let release
  const started = new Promise((resolve) => { markStarted = resolve })
  const aborted = new Promise((resolve) => { markAborted = resolve })
  const service = {
    async search(_query, _limit, signal) {
      markStarted()
      signal?.addEventListener('abort', markAborted, { once: true })
      return new Promise((resolve) => { release = resolve })
    },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const client = requestHttp(`${baseUrl}/api/search?q=cancelled`)
    client.on('error', () => {})
    client.end()
    await started
    client.destroy()
    const wasAborted = await Promise.race([
      aborted.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    ])
    release([])
    assert.equal(wasAborted, true)
  })
})

test('aborts a resolve subscription when its client disconnects', async () => {
  let markStarted
  let markAborted
  let release
  const started = new Promise((resolve) => { markStarted = resolve })
  const aborted = new Promise((resolve) => { markAborted = resolve })
  const service = {
    async resolve(_source, _id, signal) {
      markStarted()
      signal?.addEventListener('abort', markAborted, { once: true })
      return new Promise((resolve) => { release = resolve })
    },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const client = requestHttp(`${baseUrl}/api/resolve?source=netease&id=1`)
    client.on('error', () => {})
    client.end()
    await started
    client.destroy()
    const wasAborted = await Promise.race([
      aborted.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    ])
    release('https://audio.example/1')
    assert.equal(wasAborted, true)
  })
})

test('aborts lookup, lyrics, and download when their client disconnects', async () => {
  for (const [method, path] of [
    ['lookup', '/api/track?source=apple&id=1'],
    ['lyrics', '/api/lyrics?source=apple&id=1'],
    ['download', '/api/download?source=apple&id=1'],
  ]) {
    let markStarted
    let markAborted
    let release
    const started = new Promise((resolve) => { markStarted = resolve })
    const aborted = new Promise((resolve) => { markAborted = resolve })
    const service = {
      [method](_source, _id, signal) {
        markStarted()
        signal?.addEventListener('abort', markAborted, { once: true })
        return new Promise((resolve) => { release = resolve })
      },
    }

    await withServer(createApiHandler({ service }), async (baseUrl) => {
      const client = requestHttp(`${baseUrl}${path}`)
      client.on('error', () => {})
      client.end()
      await started
      client.destroy()
      const wasAborted = await Promise.race([
        aborted.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 20)),
      ])
      release(method === 'lookup'
        ? { id: '1' }
        : method === 'lyrics' ? { plain: '', lrc: '' } : { url: 'https://example.com/1', filename: '1.mp3' })
      assert.equal(wasAborted, true)
    })
  }
})

test('validates requests and returns JSON errors', async () => {
  const service = { search: async () => [], resolve: async () => '', identify: () => null }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const missingQuery = await fetch(`${baseUrl}/api/search`)
    assert.equal(missingQuery.status, 400)
    assert.deepEqual(await missingQuery.json(), { error: { code: 'INVALID_QUERY', message: 'q is required' } })

    const missingTrack = await fetch(`${baseUrl}/api/resolve?source=netease`)
    assert.equal(missingTrack.status, 400)

    const missingInput = await fetch(`${baseUrl}/api/identify`)
    assert.equal(missingInput.status, 400)

    const invalidInput = await fetch(`${baseUrl}/api/identify?input=not-a-track`)
    assert.equal(invalidInput.status, 200)
    assert.deepEqual(await invalidInput.json(), { match: null })

    const missingLyrics = await fetch(`${baseUrl}/api/lyrics?source=netease`)
    assert.equal(missingLyrics.status, 400)

    const missingLookup = await fetch(`${baseUrl}/api/track?id=1`)
    assert.equal(missingLookup.status, 400)

    const missingRoute = await fetch(`${baseUrl}/missing`)
    assert.equal(missingRoute.status, 404)
  })
})

test('maps syntactically invalid provider track IDs to explicit client errors', async () => {
  const service = {
    async resolve() { throw new Error('invalid NetEase track id') },
    async lookup() { throw new Error('invalid Apple track id') },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    for (const path of [
      '/api/resolve?source=netease&id=invalid',
      '/api/track?source=apple&id=invalid',
    ]) {
      const response = await fetch(`${baseUrl}${path}`)
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        error: { code: 'INVALID_TRACK', message: path.includes('apple') ? 'invalid Apple track id' : 'invalid NetEase track id' },
      })
    }
  })
})

test('maps explicit track-not-found failures to 404', async () => {
  const service = {
    async lookup() {
      throw Object.assign(new Error('Apple track not found'), { code: 'TRACK_NOT_FOUND' })
    },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/track?source=apple&id=404`)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: { code: 'TRACK_NOT_FOUND', message: 'Apple track not found' },
    })
  })
})

test('maps track-level playback restrictions to capability errors', async () => {
  const service = {
    async resolve() {
      throw Object.assign(new Error('Audius track is not publicly streamable'), {
        code: 'CAPABILITY_UNAVAILABLE',
      })
    },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/resolve?source=audius&id=D7KyD`)
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'Audius track is not publicly streamable',
      },
    })
  })
})

test('rate limits repeated API requests', async () => {
  const service = { search: async () => [], resolve: async () => '' }

  await withServer(createApiHandler({ service, rateLimit: 1 }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/search?q=first`)).status, 200)
    const limited = await fetch(`${baseUrl}/api/search?q=second`)
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
  })
})

test('uses the versioned error envelope when music API requests are rate limited', async () => {
  const service = { providerDetails: [], sources: [] }

  await withServer(createApiHandler({
    service,
    rateLimit: 1,
    requestId: () => 'req-limit',
    now: () => 100,
  }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/music/providers`)).status, 200)
    const limited = await fetch(`${baseUrl}/api/music/providers`)
    assert.equal(limited.status, 429)
    assert.deepEqual(await limited.json(), {
      success: false,
      data: null,
      meta: { request_id: 'req-limit', elapsed_ms: 0 },
      error: { code: 'RATE_LIMITED', message: 'too many requests' },
    })
  })
})

test('serves the versioned provider, search, detail, lyrics, and playback API', async () => {
  const calls = []
  const providers = [{
    id: 'fixture', name: 'Local Fixture', status: 'healthy', experimental: false, official: false,
    capabilities: { search: true, playback: false, lyrics: true, download: false },
  }]
  const service = {
    sources: ['fixture'],
    providerDetails: providers,
    async searchDetailed(options) {
      calls.push(['searchDetailed', options])
      return {
        tracks: [{ id: 'fixture-1', source: 'fixture' }],
        providerErrors: [],
        cached: false,
        hasMore: false,
      }
    },
    async lookup(source, id) { calls.push(['lookup', source, id]); return { id, source } },
    async lyrics(source, id) { calls.push(['lyrics', source, id]); return { plain: 'line', lrc: '', lines: [] } },
    async resolve(source, id) { calls.push(['resolve', source, id]); return 'https://audio.example/preview.mp3' },
  }

  await withServer(createApiHandler({ service, requestId: () => 'req-1', now: () => 100 }), async (baseUrl) => {
    const providerResponse = await fetch(`${baseUrl}/api/music/providers`)
    assert.deepEqual(await providerResponse.json(), {
      success: true,
      data: { providers },
      meta: { request_id: 'req-1', elapsed_ms: 0 },
      error: null,
    })

    const search = await fetch(`${baseUrl}/api/music/search?q=%E6%B5%B7&provider=fixture&page=2&page_size=3`)
    assert.deepEqual(await search.json(), {
      success: true,
      data: {
        query: '海', provider: 'fixture', page: 2, page_size: 3, has_more: false,
        items: [{ id: 'fixture-1', source: 'fixture' }],
      },
      meta: { request_id: 'req-1', cached: false, elapsed_ms: 0, provider_errors: [] },
      error: null,
    })

    assert.deepEqual(await (await fetch(`${baseUrl}/api/music/tracks/fixture/fixture-1`)).json(), {
      success: true,
      data: { track: { id: 'fixture-1', source: 'fixture' } },
      meta: { request_id: 'req-1', elapsed_ms: 0 },
      error: null,
    })
    assert.equal((await fetch(`${baseUrl}/api/music/tracks/fixture/fixture-1/lyrics`)).status, 200)
    const playback = await fetch(`${baseUrl}/api/music/tracks/fixture/fixture-1/playback`, { method: 'POST' })
    assert.deepEqual((await playback.json()).data, { playback: { url: 'https://audio.example/preview.mp3' } })
  })

  assert.deepEqual(calls, [
    ['searchDetailed', { query: '海', provider: 'fixture', page: 2, pageSize: 3 }],
    ['lookup', 'fixture', 'fixture-1'],
    ['lyrics', 'fixture', 'fixture-1'],
    ['resolve', 'fixture', 'fixture-1'],
  ])
})

test('validates versioned search pagination, provider, and playback method', async () => {
  const service = {
    sources: ['apple'],
    providerDetails: [],
    searchDetailed: async () => ({ tracks: [], providerErrors: [], cached: false, hasMore: false }),
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    for (const path of [
      '/api/music/search',
      '/api/music/search?q=x&provider=unknown',
      '/api/music/search?q=x&page=0',
      '/api/music/search?q=x&page=101',
      '/api/music/search?q=x&page_size=0',
      '/api/music/search?q=x&page_size=51',
    ]) {
      const response = await fetch(`${baseUrl}${path}`)
      assert.equal(response.status, 400, path)
    }
    const getPlayback = await fetch(`${baseUrl}/api/music/tracks/apple/1/playback`)
    assert.equal(getPlayback.status, 405)
  })
})

test('logs request metadata without query values', async () => {
  const entries = []
  const service = { search: async () => [], sources: [] }
  const logger = { info: (event, fields) => entries.push({ event, ...fields }) }

  await withServer(createApiHandler({ service, logger, requestId: () => 'req-log' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search?q=private-search`)
    assert.equal(response.headers.get('x-request-id'), 'req-log')
  })

  assert.equal(entries.length, 1)
  assert.equal(entries[0].path, '/api/search')
  assert.equal(entries[0].requestId, 'req-log')
  assert.equal(JSON.stringify(entries[0]).includes('private-search'), false)
})
