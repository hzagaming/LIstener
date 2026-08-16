import { createServer } from 'node:http'
import { createApiHandler } from './http.mjs'
import { createMusicService } from './musicService.mjs'
import { createAppleProvider } from './providers/apple.mjs'
import { createAudiusProvider } from './providers/audius.mjs'
import { createMusicBrainzProvider } from './providers/musicbrainz.mjs'
import { createWikimediaProvider } from './providers/wikimedia.mjs'
import { createInternetArchiveProvider } from './providers/internetArchive.mjs'
import { createNeteaseProvider } from './providers/netease.mjs'
import { createYouTubeProvider } from './providers/youtube.mjs'
import { catalogWebSources, createWebCatalogProvider } from './providers/webCatalog.mjs'
import { createLocalFixtureProvider } from './providers/localFixture.mjs'
import { readMusicConfig } from './config.mjs'
import { createStructuredLogger } from './logger.mjs'
import { createAccountStore } from './accountStore.mjs'
import { createArtworkDownloader } from './artwork.mjs'
import { createAudioDownloader } from './audioDownload.mjs'

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
if (selected('youtube') && process.env.YOUTUBE_API_KEY?.trim()) {
  providers.push(createYouTubeProvider({
    apiKey: process.env.YOUTUBE_API_KEY,
    ...providerHttp,
  }))
}
if (selected('musicbrainz')) {
  providers.push(createMusicBrainzProvider({
    contact: config.musicBrainzContact,
    ...providerHttp,
  }))
}
if (selected('wikimedia')) {
  providers.push(createWikimediaProvider(providerHttp))
}
if (selected('internetarchive')) {
  providers.push(createInternetArchiveProvider(providerHttp))
}
if (selected('audius')) {
  providers.push(createAudiusProvider({
    apiKey: process.env.AUDIUS_API_KEY,
    ...providerHttp,
  }))
}
const enabledWebCatalogSources = catalogWebSources.filter(selected)
if (enabledWebCatalogSources.length && process.env.BRAVE_SEARCH_API_KEY?.trim()) {
  providers.push(createWebCatalogProvider({
    apiKey: process.env.BRAVE_SEARCH_API_KEY,
    sources: enabledWebCatalogSources,
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
const accountStore = createAccountStore({ filename: config.databasePath })
const artworkDownloader = createArtworkDownloader({ maxBytes: config.artworkMaxBytes })
const audioDownloader = createAudioDownloader({
  maxBytes: config.audioDownloadMaxBytes,
  timeoutMs: config.audioDownloadTimeoutMs,
})
const server = createServer(createApiHandler({
  service,
  allowedOrigin: config.corsOrigin,
  rateLimit: config.apiRateLimit,
  logger,
  accountStore,
  artworkDownloader,
  audioDownloader,
  sessionTtlMs: config.sessionTtlMs,
  secureCookies: config.secureCookies,
  countryHeader: config.countryHeader,
}))

server.listen(config.port, config.host, () => {
  logger.info('music_api_listening', {
    host: config.host,
    port: config.port,
    providers: service.sources,
  })
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  server.close(() => {
    accountStore.close()
    process.exit(0)
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
