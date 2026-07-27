import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_SEARCH_URL = 'https://music.163.com/api/search/get/web'

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
    cover: String(album?.picUrl || 'night'),
    sourceUrl: `https://music.163.com/#/song?id=${song.id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }
}

export const createNeteaseProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const http = createProviderHttpClient({
    allowedHosts: ['music.163.com'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  return {
    id: 'netease',
    name: 'NetEase Music',
    enabled: true,
    experimental: true,
    official: false,
    allowedHosts: ['music.163.com'],
    capabilities: { search: true, playback: false, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      const body = new URLSearchParams({
        s: query.trim(),
        type: '1',
        offset: String(Math.max(0, page - 1) * limit),
        total: 'true',
        limit: String(Math.min(50, Math.max(1, limit))),
      })
      const payload = await http.json(searchUrl, {
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
      if (!Array.isArray(payload?.result?.songs)) throw new Error('invalid NetEase search response')
      return payload.result.songs.map(normalizeSong).filter(Boolean)
    },
  }
}
