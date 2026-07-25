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
} = {}) => {
  const request = async (url, signal) => {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Listener/0.4.0 (+music metadata search)' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`Apple music request failed: ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload?.results)) throw new Error('invalid Apple search response')
    return payload.results
  }

  return {
    id: 'apple',
    capabilities: { search: true, playback: true, lyrics: false, download: false },

    async search(query, limit = 20, signal) {
      const url = new URL(searchUrl)
      url.searchParams.set('term', query.trim())
      url.searchParams.set('entity', 'song')
      url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('country', country)
      return (await request(url, signal)).map(normalizeSong).filter((track) => track?.audioUrl)
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
