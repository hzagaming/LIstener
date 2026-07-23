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
    async search(query, limit) { calls.push(['search', query, limit]); return [{ id: '1' }] },
    async resolve(source, id) { calls.push(['resolve', source, id]); return 'https://audio.example/1' },
  }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`)
    assert.deepEqual(await health.json(), { status: 'ok', sources: ['apple'] })

    const search = await fetch(`${baseUrl}/api/search?q=%E6%B5%B7&limit=5`)
    assert.equal(search.status, 200)
    assert.deepEqual(await search.json(), { tracks: [{ id: '1' }] })

    const resolve = await fetch(`${baseUrl}/api/resolve?source=netease&id=1`)
    assert.equal(resolve.status, 200)
    assert.deepEqual(await resolve.json(), { url: 'https://audio.example/1' })
  })

  assert.deepEqual(calls, [['search', '海', 5], ['resolve', 'netease', '1']])
})

test('validates requests and returns JSON errors', async () => {
  const service = { search: async () => [], resolve: async () => '' }

  await withServer(createApiHandler({ service }), async (baseUrl) => {
    const missingQuery = await fetch(`${baseUrl}/api/search`)
    assert.equal(missingQuery.status, 400)
    assert.deepEqual(await missingQuery.json(), { error: { code: 'INVALID_QUERY', message: 'q is required' } })

    const missingTrack = await fetch(`${baseUrl}/api/resolve?source=netease`)
    assert.equal(missingTrack.status, 400)

    const missingRoute = await fetch(`${baseUrl}/missing`)
    assert.equal(missingRoute.status, 404)
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
