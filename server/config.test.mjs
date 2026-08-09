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
    enableNetease: true,
    musicBrainzContact: 'https://github.com/hzagaming/LIstener',
    providerTimeoutMs: 4_000,
    responseLimitBytes: 2_097_152,
    maxRetries: 1,
    maxConcurrentProviders: 4,
    searchCacheTtlMs: 30_000,
    operationCacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    apiRateLimit: 60,
    databasePath: 'data/listener.sqlite',
    sessionTtlMs: 2_592_000_000,
    secureCookies: false,
    countryHeader: '',
    artworkMaxBytes: 8_388_608,
    audioDownloadMaxBytes: 134_217_728,
    audioDownloadTimeoutMs: 120_000,
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
    MUSICBRAINZ_CONTACT: 'ops@example.com',
    MUSIC_PROVIDER_TIMEOUT_MS: '1200',
    MUSIC_PROVIDER_RESPONSE_LIMIT_BYTES: '4096',
    MUSIC_MAX_RETRIES: '0',
    MUSIC_MAX_CONCURRENT_PROVIDERS: '2',
    MUSIC_CACHE_TTL_MS: '100',
    MUSIC_OPERATION_CACHE_TTL_MS: '200',
    MUSIC_NEGATIVE_CACHE_TTL_MS: '50',
    MUSIC_API_RATE_LIMIT: '10',
    LISTENER_DB_PATH: '/tmp/listener-test.sqlite',
    LISTENER_SESSION_TTL_MS: '3600000',
    LISTENER_SECURE_COOKIES: 'true',
    LISTENER_COUNTRY_HEADER: 'CF-IPCountry',
    LISTENER_ARTWORK_MAX_BYTES: '4096',
    LISTENER_AUDIO_DOWNLOAD_MAX_BYTES: '8192',
    LISTENER_AUDIO_DOWNLOAD_TIMEOUT_MS: '5000',
  })

  assert.equal(config.port, 4311)
  assert.deepEqual(config.enabledProviders, ['apple', 'fixture'])
  assert.equal(config.enableFixture, true)
  assert.equal(config.enableNetease, true)
  assert.equal(config.musicBrainzContact, 'ops@example.com')
  assert.equal(config.maxRetries, 0)
  assert.equal(config.maxConcurrentProviders, 2)
  assert.equal(config.databasePath, '/tmp/listener-test.sqlite')
  assert.equal(config.sessionTtlMs, 3_600_000)
  assert.equal(config.secureCookies, true)
  assert.equal(config.countryHeader, 'cf-ipcountry')
  assert.equal(config.artworkMaxBytes, 4_096)
  assert.equal(config.audioDownloadMaxBytes, 8_192)
  assert.equal(config.audioDownloadTimeoutMs, 5_000)
})

test('allows the default NetEase provider to be explicitly disabled', () => {
  assert.equal(readMusicConfig({ ENABLE_NETEASE: 'false' }).enableNetease, false)
})

test('rejects unsafe configuration', () => {
  for (const [name, value] of [
    ['PORT', '0'],
    ['MUSIC_PROVIDER_TIMEOUT_MS', '999999'],
    ['MUSIC_PROVIDER_RESPONSE_LIMIT_BYTES', '10'],
    ['MUSIC_MAX_RETRIES', '2'],
    ['MUSIC_MAX_CONCURRENT_PROVIDERS', '0'],
    ['MUSIC_API_RATE_LIMIT', 'NaN'],
    ['MUSICBRAINZ_CONTACT', 'ops@example.com\nX-Test: injected'],
    ['LISTENER_SESSION_TTL_MS', '10'],
    ['LISTENER_COUNTRY_HEADER', 'bad header'],
    ['LISTENER_ARTWORK_MAX_BYTES', '10'],
    ['LISTENER_AUDIO_DOWNLOAD_MAX_BYTES', '10'],
    ['LISTENER_AUDIO_DOWNLOAD_TIMEOUT_MS', '10'],
    ['LISTENER_DB_PATH', 'bad\npath'],
  ]) {
    assert.throws(() => readMusicConfig({ [name]: value }), new RegExp(`invalid ${name}`))
  }
})
