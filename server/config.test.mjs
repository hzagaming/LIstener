import assert from 'node:assert/strict'
import test from 'node:test'
import { readMusicConfig } from './config.mjs'

test('loads bounded music defaults without secrets', () => {
  assert.deepEqual(readMusicConfig({}), {
    host: '127.0.0.1',
    port: 3000,
    corsOrigin: 'http://localhost:5173',
    enabledProviders: [],
    enableFixture: false,
    enableNetease: false,
    providerTimeoutMs: 8_000,
    responseLimitBytes: 2_097_152,
    maxRetries: 1,
    maxConcurrentProviders: 3,
    searchCacheTtlMs: 30_000,
    operationCacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    apiRateLimit: 60,
  })
})

test('normalizes provider lists and explicit environment overrides', () => {
  const config = readMusicConfig({
    HOST: '0.0.0.0',
    PORT: '4311',
    CORS_ORIGIN: 'https://listener.example',
    MUSIC_ENABLED_PROVIDERS: ' apple, fixture,apple ',
    ENABLE_LOCAL_FIXTURE: 'true',
    ENABLE_NETEASE: 'true',
    MUSIC_PROVIDER_TIMEOUT_MS: '1200',
    MUSIC_PROVIDER_RESPONSE_LIMIT_BYTES: '4096',
    MUSIC_MAX_RETRIES: '0',
    MUSIC_MAX_CONCURRENT_PROVIDERS: '2',
    MUSIC_CACHE_TTL_MS: '100',
    MUSIC_OPERATION_CACHE_TTL_MS: '200',
    MUSIC_NEGATIVE_CACHE_TTL_MS: '50',
    MUSIC_API_RATE_LIMIT: '10',
  })

  assert.equal(config.port, 4311)
  assert.deepEqual(config.enabledProviders, ['apple', 'fixture'])
  assert.equal(config.enableFixture, true)
  assert.equal(config.enableNetease, true)
  assert.equal(config.maxRetries, 0)
  assert.equal(config.maxConcurrentProviders, 2)
})

test('rejects unsafe numeric configuration', () => {
  for (const [name, value] of [
    ['PORT', '0'],
    ['MUSIC_PROVIDER_TIMEOUT_MS', '999999'],
    ['MUSIC_PROVIDER_RESPONSE_LIMIT_BYTES', '10'],
    ['MUSIC_MAX_RETRIES', '2'],
    ['MUSIC_MAX_CONCURRENT_PROVIDERS', '0'],
    ['MUSIC_API_RATE_LIMIT', 'NaN'],
  ]) {
    assert.throws(() => readMusicConfig({ [name]: value }), new RegExp(`invalid ${name}`))
  }
})
