import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_SEARCH_URL = 'https://itunes.apple.com/search'
const DEFAULT_LOOKUP_URL = 'https://itunes.apple.com/lookup'

const normalizeDuration = (milliseconds) => {
  const value = Number(milliseconds)
  return Number.isFinite(value) ? Math.max(0, Math.round(value / 1_000)) : 0
}

const normalizeSong = (song) => {
  if (song.trackId == null || !song.trackName || !song.artistName) return null
  const audioUrl = song.previewUrl ? String(song.previewUrl) : ''
  return {
    id: String(song.trackId),
    title: String(song.trackName),
    artist: String(song.artistName),
    album: String(song.collectionName || '未知专辑'),
    duration: normalizeDuration(song.trackTimeMillis),
    source: 'apple',
    audioUrl,
    cover: String(song.artworkUrl100 || 'gold').replace('100x100bb', '600x600bb'),
    sourceUrl: String(song.trackViewUrl || `https://music.apple.com/cn/song/${song.trackId}`),
    quality: audioUrl ? 'standard' : 'unknown',
    capabilities: { playback: audioUrl ? 'preview' : 'none', lyrics: false, download: false },
  }
}

export const createAppleProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  lookupUrl = DEFAULT_LOOKUP_URL,
  country = 'CN',
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const http = createProviderHttpClient({
    allowedHosts: ['itunes.apple.com'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  const request = async (url, signal) => {
    const payload = await http.json(url, { signal })
    if (!Array.isArray(payload?.results)) throw new Error('invalid Apple search response')
    return payload.results
  }

  return {
    id: 'apple',
    name: 'Apple Music',
    enabled: true,
    experimental: false,
    official: true,
    maxSearchPages: 1,
    allowedHosts: ['itunes.apple.com'],
    capabilities: { search: true, playback: true, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      if (page > 1) return []
      const url = new URL(searchUrl)
      url.searchParams.set('term', query.trim())
      url.searchParams.set('entity', 'song')
      url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('country', country)
      return (await request(url, signal)).map(normalizeSong).filter(Boolean)
    },

    async resolve(id, signal) {
      const track = await this.lookup(id, signal)
      if (!track?.audioUrl) throw new Error('Apple preview is unavailable')
      return track.audioUrl
    },

    async lookup(id, signal) {
      const requestedId = String(id)
      if (!/^\d+$/.test(requestedId)) throw new Error('invalid Apple track id')
      const url = new URL(lookupUrl)
      url.searchParams.set('id', requestedId)
      url.searchParams.set('entity', 'song')
      url.searchParams.set('country', country)
      const track = (await request(url, signal)).map(normalizeSong).find((song) => song?.id === requestedId)
      if (!track) throw Object.assign(new Error('Apple track not found'), { code: 'TRACK_NOT_FOUND' })
      return track
    },
  }
}
