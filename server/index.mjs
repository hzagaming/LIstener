import { createServer } from 'node:http'
import { createApiHandler } from './http.mjs'
import { createMusicService } from './musicService.mjs'
import { createAppleProvider } from './providers/apple.mjs'
import { createAudiusProvider } from './providers/audius.mjs'
import { createMusicBrainzProvider } from './providers/musicbrainz.mjs'
import { createNeteaseProvider } from './providers/netease.mjs'
import { createLocalFixtureProvider } from './providers/localFixture.mjs'
import { readMusicConfig } from './config.mjs'
import { createStructuredLogger } from './logger.mjs'

const config = readMusicConfig()
const logger = createStructuredLogger()
const selected = (id) => !config.enabledProviders.length || config.enabledProviders.includes(id)
const providerHttp = {
  timeoutMs: config.providerTimeoutMs,
  responseLimitBytes: config.responseLimitBytes,
  maxRetries: config.maxRetries,
}
const providers = []
if (selected('apple')) {
  providers.push(createAppleProvider({
    country: process.env.APPLE_COUNTRY,
    ...providerHttp,
  }))
}
if (selected('musicbrainz')) {
  providers.push(createMusicBrainzProvider({
    contact: config.musicBrainzContact,
    ...providerHttp,
  }))
}
if (selected('audius') && process.env.AUDIUS_API_KEY?.trim()) {
  providers.push(createAudiusProvider({
    apiKey: process.env.AUDIUS_API_KEY,
    ...providerHttp,
  }))
}
if (selected('netease') && (config.enableNetease || config.enabledProviders.includes('netease'))) {
  providers.unshift(createNeteaseProvider({
    ...providerHttp,
  }))
}
if (selected('fixture') && (config.enableFixture || config.enabledProviders.includes('fixture'))) {
  providers.push(createLocalFixtureProvider())
}
if (!providers.length) throw new Error('at least one music provider must be enabled')

const service = createMusicService({
  providers,
  ttlMs: config.searchCacheTtlMs,
  operationTtlMs: config.operationCacheTtlMs,
  failureTtlMs: config.negativeCacheTtlMs,
  providerTimeoutMs: config.providerTimeoutMs,
  maxConcurrentProviders: config.maxConcurrentProviders,
})
const server = createServer(createApiHandler({
  service,
  allowedOrigin: config.corsOrigin,
  rateLimit: config.apiRateLimit,
  logger,
}))

server.listen(config.port, config.host, () => {
  logger.info('music_api_listening', {
    host: config.host,
    port: config.port,
    providers: service.sources,
  })
})

const shutdown = () => server.close(() => process.exit(0))
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
