const DEFAULT_SEARCH_URL = 'https://music.163.com/api/search/get/web'
const DEFAULT_MEDIA_URL = 'https://music.163.com/song/media/outer/url'

const normalizeSong = (song) => {
  const artists = song.artists ?? song.ar
  const album = song.album ?? song.al
  if (song.id == null || !song.name || !Array.isArray(artists)) return null

  return {
    id: String(song.id),
    title: String(song.name),
    artist: artists.map((artist) => artist?.name).filter(Boolean).join(' / ') || '未知歌手',
    album: String(album?.name || '未知专辑'),
    duration: Math.max(0, Math.round(Number(song.duration ?? song.dt ?? 0) / 1_000)),
    source: 'netease',
    audioUrl: '',
    cover: String(album?.picUrl || 'night'),
  }
}

export const createNeteaseProvider = ({
  fetchImpl = globalThis.fetch,
  searchUrl = DEFAULT_SEARCH_URL,
  mediaUrl = DEFAULT_MEDIA_URL,
  timeoutMs = 8_000,
} = {}) => ({
  id: 'netease',

  async search(query, limit = 20) {
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
        'User-Agent': 'Listener/0.2 (+music metadata search)',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
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
