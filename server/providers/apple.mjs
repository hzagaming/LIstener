const DEFAULT_SEARCH_URL = 'https://itunes.apple.com/search'
const DEFAULT_LOOKUP_URL = 'https://itunes.apple.com/lookup'

const normalizeSong = (song) => {
  if (song.trackId == null || !song.trackName || !song.artistName || !song.previewUrl) return null
  return {
    id: String(song.trackId),
    title: String(song.trackName),
    artist: String(song.artistName),
    album: String(song.collectionName || '未知专辑'),
    duration: Math.max(0, Math.round(Number(song.trackTimeMillis || 0) / 1_000)),
    source: 'apple',
    audioUrl: String(song.previewUrl),
    cover: String(song.artworkUrl100 || 'gold').replace('100x100bb', '600x600bb'),
  }
}

export const createAppleProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  lookupUrl = DEFAULT_LOOKUP_URL,
  country = 'CN',
  timeoutMs = 8_000,
} = {}) => {
  const request = async (url) => {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Listener/0.2 (+music metadata search)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`Apple music request failed: ${response.status}`)
    const payload = await response.json()
    if (!Array.isArray(payload?.results)) throw new Error('invalid Apple search response')
    return payload.results
  }

  return {
    id: 'apple',

    async search(query, limit = 20) {
      const url = new URL(searchUrl)
      url.searchParams.set('term', query.trim())
      url.searchParams.set('entity', 'song')
      url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))))
      url.searchParams.set('country', country)
      return (await request(url)).map(normalizeSong).filter(Boolean)
    },

    async resolve(id) {
      if (!/^\d+$/.test(id)) throw new Error('invalid Apple track id')
      const url = new URL(lookupUrl)
      url.searchParams.set('id', id)
      url.searchParams.set('entity', 'song')
      url.searchParams.set('country', country)
      const track = (await request(url)).map(normalizeSong).find(Boolean)
      if (!track?.audioUrl) throw new Error('Apple preview is unavailable')
      return track.audioUrl
    },
  }
}
