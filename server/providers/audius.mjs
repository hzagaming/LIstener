import { createRequestScheduler } from './rateLimit.mjs'
import { createProviderHttpClient, ProviderHttpError } from '../providerHttpClient.mjs'

const DEFAULT_BASE_URL = 'https://api.audius.co/v1/'
const audiusId = /^[A-Za-z0-9_-]{1,128}$/
const MAX_URL_LENGTH = 8_192
const percentDecoder = new TextDecoder()

const safeHttpsUrl = (value, baseUrl) => {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value, baseUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

const containsEncodedSecret = (value, secret) => {
  let decoded = value
  while (true) {
    if (decoded.includes(secret)) return true
    const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => percentDecoder.decode(
      Uint8Array.from(encoded.match(/[0-9a-f]{2}/gi).map((byte) => Number.parseInt(byte, 16))),
    ))
    if (next === decoded) return false
    decoded = next
  }
}

const safePublicUrl = (value, apiKey, baseUrl) => {
  const url = safeHttpsUrl(value, baseUrl)
  if (!url) return null
  if (!apiKey) return url
  const parts = [url, ...new URL(url).searchParams].flat()
  return parts.some((part) => containsEncodedSecret(part, apiKey)) ? null : url
}

const sourceUrl = (track, apiKey) => {
  const url = safePublicUrl(track.permalink, apiKey, 'https://audius.co')
  if (url) {
    const hostname = new URL(url).hostname.toLocaleLowerCase()
    if (hostname === 'audius.co' || hostname.endsWith('.audius.co')) return url
  }
  return `https://api.audius.co/v1/tracks/${track.id}`
}

const isPublicStream = (track) => (track.is_available === undefined || track.is_available === true)
  && track.is_streamable === true
  && track.is_stream_gated === false
  && track.stream_conditions == null

const normalizeTrack = (track, apiKey) => {
  const id = typeof track?.id === 'string' ? track.id : ''
  const title = typeof track?.title === 'string' ? track.title.trim() : ''
  if (!audiusId.test(id) || !title) return null
  const duration = Number(track.duration)
  const playable = isPublicStream(track)

  return {
    id,
    title,
    artist: String(track.user?.name || track.user?.handle || '未知歌手'),
    album: String(track.album_backlink?.playlist_name || 'Audius'),
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
    source: 'audius',
    audioUrl: '',
    cover: safePublicUrl(track.artwork?.['480x480'], apiKey)
      || safePublicUrl(track.artwork?.['150x150'], apiKey)
      || 'night',
    sourceUrl: sourceUrl(track, apiKey),
    quality: 'unknown',
    capabilities: { playback: playable ? 'full' : 'none', lyrics: false, download: false },
  }
}

export const createAudiusProvider = ({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
  minIntervalMs = 100,
  now = Date.now,
  waitImpl,
} = {}) => {
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (normalizedKey.length > 500 || /[\u0000-\u001f\u007f]/.test(normalizedKey)) {
    throw new Error('invalid Audius API key')
  }
  const endpoint = new URL(baseUrl || DEFAULT_BASE_URL)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Audius base URL must use credential-free HTTPS')
  }
  if (endpoint.origin !== 'https://api.audius.co') {
    throw new Error('Audius base URL must use the official host')
  }
  if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/'
  endpoint.search = ''
  endpoint.hash = ''
  const schedule = createRequestScheduler({ minIntervalMs, now, waitImpl })
  const http = createProviderHttpClient({
    allowedHosts: ['api.audius.co'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })

  const request = (url, signal, errorCodes = {}) => {
    const authenticatedUrl = new URL(url)
    if (normalizedKey) authenticatedUrl.searchParams.set('api_key', normalizedKey)
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    return schedule(async () => {
      try {
        return await http.json(authenticatedUrl, { signal: requestSignal })
      } catch (error) {
        if (requestSignal.aborted) throw requestSignal.reason
        const errorCode = errorCodes[error?.status]
        if (errorCode) {
          throw Object.assign(new Error(`Audius request failed: ${error.status}`), { code: errorCode })
        }
        if (error instanceof ProviderHttpError && error.code === 'PROVIDER_INVALID_JSON') {
          throw new Error('invalid Audius response')
        }
        throw new Error('Audius request failed')
      }
    }, requestSignal)
  }

  const lookup = async (id, signal) => {
    if (!audiusId.test(id)) throw new Error('invalid Audius track id')
    const url = new URL(`tracks/${id}`, endpoint)
    const track = normalizeTrack(
      (await request(url, signal, { 404: 'TRACK_NOT_FOUND' }))?.data,
      normalizedKey,
    )
    if (!track || track.id !== id) throw new Error('invalid Audius response')
    return track
  }

  return {
    id: 'audius',
    name: 'Audius',
    enabled: true,
    experimental: false,
    official: true,
    allowedHosts: ['api.audius.co'],
    capabilities: { search: true, playback: true, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      const value = query.trim()
      if (!value) return []
      const url = new URL('tracks/search', endpoint)
      url.searchParams.set('query', value)
      url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('offset', String(Math.max(0, page - 1) * limit))
      const payload = await request(url, signal)
      if (!Array.isArray(payload?.data)) throw new Error('invalid Audius response')
      return payload.data.map((track) => normalizeTrack(track, normalizedKey)).filter(Boolean)
    },

    lookup,

    async resolve(id, signal) {
      const track = await lookup(id, signal)
      if (track.capabilities.playback === 'none') {
        throw Object.assign(new Error('Audius track is not publicly streamable'), {
          code: 'CAPABILITY_UNAVAILABLE',
        })
      }
      const url = new URL(`tracks/${id}/stream`, endpoint)
      url.searchParams.set('no_redirect', 'true')
      const streamUrl = safePublicUrl((await request(url, signal, {
        403: 'CAPABILITY_UNAVAILABLE',
        404: 'TRACK_NOT_FOUND',
      }))?.data, normalizedKey)
      if (!streamUrl) throw new Error('invalid Audius stream response')
      return streamUrl
    },
  }
}
