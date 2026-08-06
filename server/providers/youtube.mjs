import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3/'
const videoId = /^[A-Za-z0-9_-]{11}$/
const thumbnailHosts = new Set(['i.ytimg.com', 'img.youtube.com'])
const entities = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['quot', '"'],
])

const decodeHtml = (value) => String(value ?? '').replace(
  /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi,
  (match, decimal, hexadecimal, named) => {
    const codePoint = decimal ? Number(decimal) : hexadecimal ? Number.parseInt(hexadecimal, 16) : null
    if (codePoint !== null) {
      try { return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match } catch { return match }
    }
    return entities.get(String(named).toLocaleLowerCase()) ?? match
  },
).trim()

const durationSeconds = (value) => {
  if (typeof value !== 'string') return 0
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
  if (!match) return 0
  const seconds = Number(match[1] || 0) * 86_400
    + Number(match[2] || 0) * 3_600
    + Number(match[3] || 0) * 60
    + Number(match[4] || 0)
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
}

const publicThumbnail = (thumbnails) => {
  if (!thumbnails || typeof thumbnails !== 'object') return 'night'
  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const value = thumbnails[size]?.url
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && thumbnailHosts.has(url.hostname.toLocaleLowerCase())) return url.toString()
    } catch { /* Try the next official thumbnail size. */ }
  }
  return 'night'
}

const normalizeVideo = (video) => {
  const id = typeof video?.id === 'string' ? video.id : ''
  const title = decodeHtml(video?.snippet?.title)
  if (!videoId.test(id) || !title
    || video?.status?.privacyStatus !== 'public'
    || video?.status?.uploadStatus !== 'processed') return null

  return {
    id,
    title,
    artist: decodeHtml(video.snippet?.channelTitle) || '未知创作者',
    album: 'YouTube Music',
    duration: durationSeconds(video.contentDetails?.duration),
    source: 'youtube',
    audioUrl: '',
    cover: publicThumbnail(video.snippet?.thumbnails),
    sourceUrl: `https://music.youtube.com/watch?v=${id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }
}

export const createYouTubeProvider = ({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(normalizedKey)) throw new Error('YouTube API key is required')

  const endpoint = new URL(baseUrl || DEFAULT_BASE_URL)
  if (endpoint.origin !== 'https://www.googleapis.com' || endpoint.pathname !== '/youtube/v3/'
    || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) {
    throw new Error('YouTube base URL must use the official API')
  }
  const http = createProviderHttpClient({
    allowedHosts: ['www.googleapis.com'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })

  const details = async (ids, signal) => {
    if (!ids.length) return []
    const url = new URL('videos', endpoint)
    url.searchParams.set('part', 'snippet,contentDetails,status')
    url.searchParams.set('id', ids.join(','))
    url.searchParams.set('key', normalizedKey)
    const payload = await http.json(url, { signal })
    if (!Array.isArray(payload?.items)) throw new Error('invalid YouTube response')
    return payload.items.map(normalizeVideo).filter(Boolean)
  }

  return {
    id: 'youtube',
    name: 'YouTube Music',
    enabled: true,
    experimental: false,
    official: true,
    maxSearchPages: 1,
    allowedHosts: ['www.googleapis.com'],
    capabilities: { search: true, playback: false, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      const value = query.trim()
      if (!value || page > 1) return []
      const url = new URL('search', endpoint)
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('type', 'video')
      url.searchParams.set('videoCategoryId', '10')
      url.searchParams.set('safeSearch', 'moderate')
      url.searchParams.set('maxResults', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('q', value)
      url.searchParams.set('key', normalizedKey)
      const payload = await http.json(url, { signal })
      if (!Array.isArray(payload?.items)) throw new Error('invalid YouTube response')
      const ids = [...new Set(payload.items
        .map((item) => item?.id?.videoId)
        .filter((id) => typeof id === 'string' && videoId.test(id)))]
      const byId = new Map((await details(ids, signal)).map((track) => [track.id, track]))
      return ids.map((id) => byId.get(id)).filter(Boolean)
    },

    async lookup(id, signal) {
      const requestedId = String(id)
      if (!videoId.test(requestedId)) throw new Error('invalid YouTube video id')
      const track = (await details([requestedId], signal)).find((item) => item.id === requestedId)
      if (!track) throw Object.assign(new Error('YouTube track not found'), { code: 'TRACK_NOT_FOUND' })
      return track
    },
  }
}
