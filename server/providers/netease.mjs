import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_SEARCH_URL = 'https://music.163.com/api/search/get/web'
const DEFAULT_DETAIL_URL = 'https://music.163.com/api/song/detail/'
const trackId = /^\d+$/

const publicArtwork = (value) => {
  if (typeof value !== 'string' || !value) return 'night'
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLocaleLowerCase()
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && (hostname === 'music.126.net' || hostname.endsWith('.music.126.net'))
      ? url.toString()
      : 'night'
  } catch {
    return 'night'
  }
}

const officialEndpoint = (value, expectedPath, label) => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error(`NetEase ${label} URL must use credential-free HTTPS`)
  }
  if (url.origin !== 'https://music.163.com') throw new Error(`NetEase ${label} URL must use the official host`)
  if (url.pathname !== expectedPath || url.search || url.hash) throw new Error(`NetEase ${label} path is invalid`)
  return url
}

const normalizeDuration = (milliseconds) => {
  const value = Number(milliseconds)
  return Number.isFinite(value) ? Math.max(0, Math.round(value / 1_000)) : 0
}

const normalizeSong = (song) => {
  const artists = song.artists ?? song.ar
  const album = song.album ?? song.al
  if (song.id == null || !song.name || !Array.isArray(artists)) return null

  return {
    id: String(song.id),
    title: String(song.name),
    artist: artists.map((artist) => artist?.name).filter(Boolean).join(' / ') || '未知歌手',
    album: String(album?.name || '未知专辑'),
    duration: normalizeDuration(song.duration ?? song.dt),
    source: 'netease',
    audioUrl: '',
    cover: publicArtwork(album?.picUrl),
    sourceUrl: `https://music.163.com/#/song?id=${song.id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }
}

export const createNeteaseProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  detailUrl = DEFAULT_DETAIL_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const searchEndpoint = officialEndpoint(searchUrl || DEFAULT_SEARCH_URL, '/api/search/get/web', 'search')
  const detailEndpoint = officialEndpoint(detailUrl || DEFAULT_DETAIL_URL, '/api/song/detail/', 'detail')
  const http = createProviderHttpClient({
    allowedHosts: ['music.163.com'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  const requestDetails = async (ids, signal) => {
    const url = new URL(detailEndpoint)
    url.searchParams.set('id', ids[0])
    url.searchParams.set('ids', `[${ids.join(',')}]`)
    const payload = await http.json(url, {
      headers: { Referer: 'https://music.163.com/' },
      signal,
    })
    if (payload?.code !== 200 || !Array.isArray(payload.songs)) throw new Error('invalid NetEase response')
    return payload.songs
  }

  return {
    id: 'netease',
    name: 'NetEase Music',
    enabled: true,
    experimental: true,
    official: false,
    allowedHosts: ['music.163.com'],
    capabilities: { search: true, playback: false, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      const value = query.trim()
      if (!value) return []
      const boundedLimit = Math.min(50, Math.max(1, limit))
      const body = new URLSearchParams({
        s: value,
        type: '1',
        offset: String(Math.max(0, page - 1) * boundedLimit),
        total: 'true',
        limit: String(boundedLimit),
      })
      const payload = await http.json(searchEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referer: 'https://music.163.com/',
        },
        body,
        signal,
        retryable: false,
      })
      if (payload?.abroad && typeof payload.result === 'string') {
        throw new Error('NetEase search is unavailable in this region')
      }
      if (payload?.code !== undefined && payload.code !== 200) throw new Error('invalid NetEase search response')
      if (!Array.isArray(payload?.result?.songs)) throw new Error('invalid NetEase search response')
      const tracks = payload.result.songs.map(normalizeSong).filter(Boolean)
      const ids = [...new Set(tracks.map(({ id }) => id).filter((id) => trackId.test(id)))]
      if (!ids.length) return tracks
      try {
        const details = (await requestDetails(ids, signal)).map(normalizeSong).filter(Boolean)
        const byId = new Map(details.map((track) => [track.id, track]))
        return tracks.map((track) => byId.get(track.id) ?? track)
      } catch (error) {
        if (signal?.aborted) throw error
        return tracks
      }
    },

    async lookup(id, signal) {
      const requestedId = String(id)
      if (!trackId.test(requestedId)) throw new Error('invalid NetEase track id')
      const songs = await requestDetails([requestedId], signal)
      if (!songs.length) throw Object.assign(new Error('NetEase track not found'), { code: 'TRACK_NOT_FOUND' })
      const track = songs.map(normalizeSong).find((song) => song?.id === requestedId)
      if (!track) throw new Error('invalid NetEase response')
      return track
    },
  }
}
