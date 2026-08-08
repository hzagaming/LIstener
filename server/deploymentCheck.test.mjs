import assert from 'node:assert/strict'
import test from 'node:test'
import { platformSources } from './platforms.mjs'
import { verifyMusicDeployment } from './deploymentCheck.mjs'

const frontendOrigin = 'https://hzagaming.github.io'
const apiBase = 'https://listener-api.example.com'
const healthyPayload = {
  status: 'ok',
  sources: platformSources,
  capabilities: Object.fromEntries(platformSources.map((source) => [source, {
    search: true,
    playback: false,
    lyrics: false,
    download: false,
  }])),
}

const response = (payload = healthyPayload, headers = {}) => Response.json(payload, {
  headers: { 'Access-Control-Allow-Origin': frontendOrigin, ...headers },
})

test('verifies every production search source and the Pages CORS origin', async () => {
  const requests = []
  const result = await verifyMusicDeployment({
    apiBase,
    frontendOrigin,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options })
      return response()
    },
  })

  assert.deepEqual(result.sources, platformSources)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url.href, `${apiBase}/api/health`)
  assert.equal(requests[0].options.headers.Origin, frontendOrigin)
  assert.equal(requests[0].options.cache, 'no-store')
  assert.equal(requests[0].options.signal instanceof AbortSignal, true)
})

test('rejects Apple-only, non-searchable, and incorrectly configured CORS deployments', async () => {
  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin, fetchImpl: async () => response({
      ...healthyPayload,
      sources: ['apple'],
      capabilities: { apple: healthyPayload.capabilities.apple },
    }) }),
    /missing searchable sources: netease, qq/,
  )

  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin, fetchImpl: async () => response({
      ...healthyPayload,
      capabilities: { ...healthyPayload.capabilities, qq: { ...healthyPayload.capabilities.qq, search: false } },
    }) }),
    /missing searchable sources: qq/,
  )

  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin, fetchImpl: async () => response(healthyPayload, {
      'Access-Control-Allow-Origin': 'https://wrong.example',
    }) }),
    /CORS origin/,
  )
})

test('rejects unsafe deployment URLs and invalid health responses', async () => {
  await assert.rejects(
    verifyMusicDeployment({ apiBase: 'http://listener-api.example.com', frontendOrigin, fetchImpl: async () => response() }),
    /API origin.*HTTPS/,
  )
  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin: 'not-an-origin', fetchImpl: async () => response() }),
    /frontend origin/,
  )
  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin, fetchImpl: async () => new Response('bad gateway', { status: 502 }) }),
    /health check returned 502/,
  )
  await assert.rejects(
    verifyMusicDeployment({ apiBase, frontendOrigin, fetchImpl: async () => response({ status: 'ok' }) }),
    /invalid health response/,
  )
})
