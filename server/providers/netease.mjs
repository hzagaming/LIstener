const DEFAULT_SEARCH_URL = 'https://music.163.com/api/search/get/web'
const DEFAULT_MEDIA_URL = 'https://music.163.com/song/media/outer/url'

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
    capabilities: { playback: 'full', lyrics: false, download: false },
  }
}

export const createNeteaseProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  mediaUrl = DEFAULT_MEDIA_URL,
  timeoutMs = 8_000,
} = {}) => ({
  id: 'netease',
  capabilities: { search: true, playback: true, lyrics: false, download: false },

  async search(query, limit = 20, signal) {
    const body = new URLSearchParams({
      s: query.trim(),
      type: '1',
      offset: '0',
      total: 'true',
      limit: String(Math.min(50, Math.max(1, limit))),
    })
    const response = await fetchImpl(searchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: 'https://music.163.com/',
        'User-Agent': 'Listener/0.4.0 (+music metadata search)',
      },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`NetEase search failed: ${response.status}`)

    const payload = await response.json()
    if (payload?.abroad && typeof payload.result === 'string') {
      throw new Error('NetEase search is unavailable in this region')
    }
    if (!Array.isArray(payload?.result?.songs)) throw new Error('invalid NetEase search response')
    return payload.result.songs.map(normalizeSong).filter(Boolean)
  },

  async resolve(id) {
    if (!/^\d+$/.test(id)) throw new Error('invalid NetEase track id')
    const url = new URL(mediaUrl)
    url.searchParams.set('id', `${id}.mp3`)
    return url.toString()
  },
})
