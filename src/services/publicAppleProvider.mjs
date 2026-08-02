import { createRequestSignal } from '../requestPolicy.mjs'
import { createSearchFallbackError } from '../searchLogic.mjs'

const API_ORIGIN = 'https://itunes.apple.com'
const MAX_RESPONSE_BYTES = 2_097_152
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

const identifyApple = (input, preferredSource) => {
  const value = typeof input === 'string' ? input.normalize('NFKC').trim() : ''
  if (!value || value.length > 2_048) return null
  if (preferredSource) {
    if (preferredSource !== 'apple' || !/^\d+$/.test(value)) return null
    return { source: 'apple', id: value, canonicalUrl: `https://music.apple.com/cn/song/${value}` }
  }

  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname !== 'music.apple.com') return null
    const id = url.searchParams.get('i') ?? /^\/[^/]+\/song\/(?:[^/]+\/)?(\d+)\/?$/i.exec(url.pathname)?.[1]
    return id && /^\d+$/.test(id)
      ? { source: 'apple', id, canonicalUrl: `https://music.apple.com/cn/song/${id}` }
      : null
  } catch {
    return null
  }
}

export const createPublicAppleProvider = ({ fetchImpl = globalThis.fetch, fallback, country = 'CN' } = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required')
  if (!fallback) throw new Error('fallback provider is required')
  const normalizedCountry = String(country).trim().toLocaleUpperCase()
  if (!/^[A-Z]{2}$/.test(normalizedCountry)) throw new Error('valid Apple country is required')

  const requestUrl = (pathname, parameters) => {
    const url = new URL(pathname, API_ORIGIN)
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
    return url
  }

  const request = async (pathname, parameters, signal, timeoutMs = 10_000) => {
    let response
    try {
      response = await fetchImpl(requestUrl(pathname, parameters), {
        headers: { Accept: 'application/json' },
        signal: createRequestSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw Object.assign(error instanceof Error ? error : new Error('Apple network request failed'), { retryable: true })
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Apple request failed: ${response.status}`), {
        retryable: response.status === 429 || response.status >= 500,
      })
    }
    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) throw new Error('Apple response is too large')
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error('Apple response is too large')
    let payload
    try { payload = JSON.parse(body) } catch { throw new Error('invalid Apple search response') }
    if (!Array.isArray(payload?.results)) throw new Error('invalid Apple search response')
    return payload.results
  }

  const requestWithRetry = async (...parameters) => {
    try {
      return await request(...parameters)
    } catch (error) {
      if (parameters[2]?.aborted || !error?.retryable) throw error
      return request(...parameters)
    }
  }

  const lookupApple = async (id, signal) => {
    const requestedId = String(id)
    if (!/^\d+$/.test(requestedId)) throw new Error('invalid Apple track id')
    const songs = await requestWithRetry('/lookup', { id: requestedId, entity: 'song', country: normalizedCountry }, signal)
    const track = songs.map((song) => normalizeSong(song, normalizedCountry)).find((song) => song?.id === requestedId)
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
        const songs = await requestWithRetry('/search', { term, entity: 'song', limit: 20, country: normalizedCountry }, signal)
        const normalized = songs.map((song) => normalizeSong(song, normalizedCountry)).filter(Boolean)
        if (normalized.length || normalizedCountry === 'US') return normalized
        try {
          const globalSongs = await requestWithRetry('/search', { term, entity: 'song', limit: 20, country: 'US' }, signal)
          return globalSongs.map((song) => normalizeSong(song, 'US')).filter(Boolean)
        } catch (error) {
          if (signal?.aborted) throw error
          return normalized
        }
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

    async identify(input, source, signal) {
      const match = identifyApple(input, source)
      return match ?? fallback.identify(input, source, signal)
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

    async status(signal) {
      try {
        await requestWithRetry('/search', {
          term: 'Listener', entity: 'song', limit: 1, country: normalizedCountry,
        }, signal, 4_000)
        return { online: true, sources: ['apple'], capabilities: { apple: capabilities } }
      } catch (error) {
        if (signal?.aborted) throw error
        return fallback.status(signal)
      }
    },
  }
}
