import { createRequestScheduler } from './rateLimit.mjs'
import { createProviderHttpClient, ProviderHttpError } from '../providerHttpClient.mjs'

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2/recording/'
const recordingId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

const normalizeDuration = (milliseconds) => {
  const value = Number(milliseconds)
  return Number.isFinite(value) ? Math.max(0, Math.round(value / 1_000)) : 0
}

const normalizeRecording = (recording) => {
  const id = typeof recording?.id === 'string' ? recording.id.toLowerCase() : ''
  const title = typeof recording?.title === 'string' ? recording.title.trim() : ''
  if (!recordingId.test(id) || !title) return null
  const credits = Array.isArray(recording['artist-credit']) ? recording['artist-credit'] : []
  const artist = credits.map((credit) => {
    const name = typeof credit?.name === 'string' ? credit.name : credit?.artist?.name
    return name ? `${name}${typeof credit.joinphrase === 'string' ? credit.joinphrase : ''}` : ''
  }).join('').trim() || '未知歌手'
  const releases = Array.isArray(recording.releases) ? recording.releases : []
  const release = releases.find((item) => item?.status === 'Official' && item?.title)
    ?? releases.find((item) => item?.title)

  return {
    id,
    title,
    artist,
    album: String(release?.title || '未知专辑'),
    duration: normalizeDuration(recording.length),
    source: 'musicbrainz',
    audioUrl: '',
    cover: 'gold',
    sourceUrl: `https://musicbrainz.org/recording/${id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }
}

export const createMusicBrainzProvider = ({
  contact,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
  minIntervalMs = 1_000,
  now = Date.now,
  waitImpl,
} = {}) => {
  const normalizedContact = typeof contact === 'string' ? contact.trim() : ''
  if (!normalizedContact || normalizedContact.length > 200 || /[\r\n]/.test(normalizedContact)) {
    throw new Error('MusicBrainz contact is required')
  }
  const endpoint = new URL(baseUrl || DEFAULT_BASE_URL)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('MusicBrainz base URL must use credential-free HTTPS')
  }
  if (endpoint.origin !== 'https://musicbrainz.org') {
    throw new Error('MusicBrainz base URL must use the official host')
  }
  if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/'
  endpoint.search = ''
  endpoint.hash = ''
  const schedule = createRequestScheduler({ minIntervalMs, now, waitImpl })
  const http = createProviderHttpClient({
    allowedHosts: ['musicbrainz.org'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
    userAgent: `Listener/0.4.10 (${normalizedContact})`,
  })

  const request = (url, signal, notFound = false) => {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    return schedule(async () => {
      try {
        return await http.json(url, { signal: requestSignal })
      } catch (error) {
        if (notFound && error instanceof ProviderHttpError && error.status === 404) {
          throw Object.assign(new Error('MusicBrainz track not found'), { code: 'TRACK_NOT_FOUND' })
        }
        throw error
      }
    }, requestSignal)
  }

  return {
    id: 'musicbrainz',
    name: 'MusicBrainz',
    enabled: true,
    experimental: false,
    official: true,
    allowedHosts: ['musicbrainz.org'],
    capabilities: { search: true, playback: false, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1) {
      const value = query.trim()
      if (!value) return []
      const url = new URL(endpoint)
      url.searchParams.set('query', value)
      url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('offset', String(Math.max(0, page - 1) * limit))
      url.searchParams.set('fmt', 'json')
      const payload = await request(url, signal)
      if (!Array.isArray(payload?.recordings)) throw new Error('invalid MusicBrainz response')
      return payload.recordings.map(normalizeRecording).filter(Boolean)
    },

    async lookup(id, signal) {
      const normalizedId = typeof id === 'string' ? id.toLowerCase() : ''
      if (!recordingId.test(normalizedId)) throw new Error('invalid MusicBrainz track id')
      const url = new URL(normalizedId, endpoint)
      url.searchParams.set('inc', 'artists+releases')
      url.searchParams.set('fmt', 'json')
      const track = normalizeRecording(await request(url, signal, true))
      if (!track || track.id !== normalizedId) throw new Error('invalid MusicBrainz response')
      return track
    },
  }
}
