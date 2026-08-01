import { createRequestSignal } from '../requestPolicy.mjs'
import { createSearchFallbackError } from '../searchLogic.mjs'

const API_ORIGIN = 'https://itunes.apple.com'
const capabilities = { search: true, playback: true, lyrics: false, download: false }

const allowedHttpsUrl = (value, rootHost) => {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    const allowedHost = url.hostname === rootHost || url.hostname.endsWith(`.${rootHost}`)
    return url.protocol === 'https:' && !url.username && !url.password && allowedHost ? url.toString() : ''
  } catch {
    return ''
  }
}

const normalizeSong = (song, country) => {
  if (!song || typeof song !== 'object') return null
  const id = String(song.trackId ?? '')
  const title = typeof song.trackName === 'string' ? song.trackName.trim() : ''
  const artist = typeof song.artistName === 'string' ? song.artistName.trim() : ''
  if (!/^\d+$/.test(id) || !title || !artist) return null

  const durationMs = Number(song.trackTimeMillis)
  const audioUrl = allowedHttpsUrl(song.previewUrl, 'itunes.apple.com')
  const artwork = allowedHttpsUrl(song.artworkUrl100, 'mzstatic.com')
  const sourceUrl = allowedHttpsUrl(song.trackViewUrl, 'music.apple.com')
    || `https://music.apple.com/${country.toLocaleLowerCase()}/song/${id}`

  return {
    id,
    title,
    artist,
    album: typeof song.collectionName === 'string' && song.collectionName.trim() ? song.collectionName.trim() : '未知专辑',
    duration: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs / 1_000)) : 0,
    source: 'apple',
    audioUrl,
    cover: artwork ? artwork.replace('100x100bb', '600x600bb') : 'gold',
    sourceUrl,
    quality: audioUrl ? 'standard' : 'unknown',
    capabilities: { playback: audioUrl ? 'preview' : 'none', lyrics: false, download: false },
  }
}

export const createPublicAppleProvider = ({ fetchImpl = globalThis.fetch, fallback, country = 'CN' } = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required')
  if (!fallback) throw new Error('fallback provider is required')

  const request = async (pathname, parameters, signal) => {
    const url = new URL(pathname, API_ORIGIN)
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: createRequestSignal(signal, 10_000),
    })
    if (!response.ok) throw new Error(`Apple search failed: ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload?.results)) throw new Error('invalid Apple search response')
    return payload.results
  }

  const lookupApple = async (id, signal) => {
    const requestedId = String(id)
    if (!/^\d+$/.test(requestedId)) throw new Error('invalid Apple track id')
    const songs = await request('/lookup', { id: requestedId, entity: 'song', country }, signal)
    const track = songs.map((song) => normalizeSong(song, country)).find((song) => song?.id === requestedId)
    if (!track) throw Object.assign(new Error('Apple track not found'), { code: 'TRACK_NOT_FOUND' })
    return track
  }

  return {
    id: 'apple',
    name: 'Apple Music',

    async search(query, signal) {
      const term = String(query).trim()
      if (!term) return fallback.search(query, signal)
      try {
        const songs = await request('/search', { term, entity: 'song', limit: 20, country }, signal)
        return songs.map((song) => normalizeSong(song, country)).filter(Boolean)
      } catch (error) {
        if (signal?.aborted) throw error
        const tracks = await fallback.search(query, signal)
        throw createSearchFallbackError(tracks)
      }
    },

    async resolve(track, signal) {
      if (track.source !== 'apple') return fallback.resolve(track, signal)
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const directUrl = allowedHttpsUrl(track.audioUrl, 'itunes.apple.com')
      if (directUrl) return directUrl
      const resolved = await lookupApple(track.id, signal)
      if (!resolved.audioUrl) throw new Error('Apple preview is unavailable')
      return resolved.audioUrl
    },

    identify(input, source, signal) {
      return fallback.identify(input, source, signal)
    },

    lookup(match, signal) {
      return match.source === 'apple' ? lookupApple(match.id, signal) : fallback.lookup(match, signal)
    },

    lyrics(track, signal) {
      return fallback.lyrics(track, signal)
    },

    download(track, signal) {
      return fallback.download(track, signal)
    },

    async status() {
      return { online: true, sources: ['apple'], capabilities: { apple: capabilities } }
    },
  }
}
