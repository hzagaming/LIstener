import { createServer } from 'node:http'
import { createApiHandler } from './http.mjs'
import { createMusicService } from './musicService.mjs'
import { createAppleProvider } from './providers/apple.mjs'
import { createAudiusProvider } from './providers/audius.mjs'
import { createMusicBrainzProvider } from './providers/musicbrainz.mjs'
import { createNeteaseProvider } from './providers/netease.mjs'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const host = process.env.HOST ?? '127.0.0.1'
const providers = [createAppleProvider({
  searchUrl: process.env.APPLE_SEARCH_URL,
  lookupUrl: process.env.APPLE_LOOKUP_URL,
  country: process.env.APPLE_COUNTRY,
})]
if (process.env.MUSICBRAINZ_CONTACT?.trim()) {
  providers.push(createMusicBrainzProvider({
    contact: process.env.MUSICBRAINZ_CONTACT,
  }))
}
if (process.env.AUDIUS_API_KEY?.trim()) {
  providers.push(createAudiusProvider({
    apiKey: process.env.AUDIUS_API_KEY,
  }))
}
if (process.env.ENABLE_NETEASE === 'true') {
  providers.unshift(createNeteaseProvider({
    searchUrl: process.env.NETEASE_SEARCH_URL,
    mediaUrl: process.env.NETEASE_MEDIA_URL,
  }))
}
const service = createMusicService({ providers })
const server = createServer(createApiHandler({
  service,
  allowedOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
}))

server.listen(port, host, () => {
  console.log(`Listener API listening on http://${host}:${port}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
