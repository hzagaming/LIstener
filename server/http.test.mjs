import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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
    assert.equal(invalidInput.status, 404)

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

test('rate limits repeated API requests', async () => {
  const service = { search: async () => [], resolve: async () => '' }

  await withServer(createApiHandler({ service, rateLimit: 1 }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/search?q=first`)).status, 200)
    const limited = await fetch(`${baseUrl}/api/search?q=second`)
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
  })
})
