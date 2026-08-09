import { identifyMusicInput } from '../../server/platforms.mjs'
import { abortableDelay, createRequestSignal } from '../requestPolicy.mjs'
import { createSearchFallbackError, diversifyRankedTracks, playbackRank, searchFallbackTracks } from '../searchLogic.mjs'

const AUDIUS_API = 'https://api.audius.co/v1/'
const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2/recording/'
const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php'
const MAX_RESPONSE_BYTES = 2_097_152
const audiusId = /^[A-Za-z0-9_-]{1,128}$/
const recordingId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const pageId = /^\d+$/
const audioExtension = /\.(?:aac|flac|m4a|mid|midi|mp3|oga|ogg|opus|wav|webm)$/i
const oggExtension = /\.(?:oga|ogg)$/i
const capabilities = {
  apple: { search: true, playback: true, lyrics: false, download: false },
  audius: { search: true, playback: true, lyrics: false, download: true },
  musicbrainz: { search: true, playback: false, lyrics: false, download: false },
  wikimedia: { search: true, playback: true, lyrics: false, download: true },
}

export const publicMusicSources = ['apple', 'audius', 'musicbrainz', 'wikimedia']

const safeHttpsUrl = (value, allowedHost) => {
  if (typeof value !== 'string' || !value || value.length > 8_192) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return ''
    if (allowedHost && url.hostname !== allowedHost && !url.hostname.endsWith(`.${allowedHost}`)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

const readJson = async (response, label) => {
  if (!response.ok) {
    await response.body?.cancel?.()
    const error = new Error(`${label} request failed: ${response.status}`)
    error.status = response.status
    throw error
  }
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
    await response.body?.cancel?.()
    throw new Error(`${label} response is too large`)
  }
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is too large`)
    try { return JSON.parse(text) } catch { throw new Error(`invalid ${label} response`) }
  }
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(`${label} response is too large`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error(`invalid ${label} response`) }
}

const sourceUrl = (track) => {
  try {
    const url = new URL(String(track?.permalink || ''), 'https://audius.co')
    return url.origin === 'https://audius.co' && !url.username && !url.password
      ? url.toString()
      : `https://api.audius.co/v1/tracks/${track.id}`
  } catch {
    return `https://api.audius.co/v1/tracks/${track.id}`
  }
}

const publicAudiusStream = (track) => track?.access?.stream === true
  && track.is_available === true
  && track.is_streamable === true
  && track.is_stream_gated === false
  && track.stream_conditions == null

const publicAudiusDownload = (track) => track?.access?.download === true
  && track.is_downloadable === true
  && track.is_download_gated === false
  && track.download_conditions == null

const normalizeAudius = (track) => {
  const id = typeof track?.id === 'string' ? track.id : ''
  const title = typeof track?.title === 'string' ? track.title.trim() : ''
  if (!audiusId.test(id) || !title) return null
  const playable = publicAudiusStream(track)
  const downloadable = publicAudiusDownload(track)
  const duration = Number(track.duration)
  return {
    id,
    title,
    artist: String(track.user?.name || track.user?.handle || '未知歌手'),
    album: String(track.album_backlink?.playlist_name || 'Audius'),
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
    source: 'audius',
    audioUrl: '',
    cover: safeHttpsUrl(track.artwork?.['480x480']) || safeHttpsUrl(track.artwork?.['150x150']) || 'night',
    sourceUrl: sourceUrl(track),
    quality: playable ? 'high' : 'unknown',
    capabilities: { playback: playable ? 'full' : 'none', lyrics: false, download: downloadable },
  }
}

const normalizeMusicBrainz = (recording) => {
  const id = typeof recording?.id === 'string' ? recording.id.toLocaleLowerCase() : ''
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
  const duration = Number(recording.length)
  return {
    id,
    title,
    artist,
    album: String(release?.title || '未知专辑'),
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration / 1_000)) : 0,
    source: 'musicbrainz',
    audioUrl: '',
    cover: 'gold',
    sourceUrl: `https://musicbrainz.org/recording/${id}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }
}

const normalizeWikimedia = (page) => {
  const id = String(page?.pageid ?? '')
  const title = typeof page?.title === 'string'
    ? page.title.replace(/^File:/i, '').replace(audioExtension, '').trim()
    : ''
  const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null
  if (!pageId.test(id) || !title || !info) return null
  const audioUrl = safeHttpsUrl(info.url, 'upload.wikimedia.org')
  const sourcePage = safeHttpsUrl(info.descriptionurl, 'commons.wikimedia.org')
    || `https://commons.wikimedia.org/?curid=${id}`
  const mime = typeof info.mime === 'string' ? info.mime.toLocaleLowerCase() : ''
  const playable = mime.startsWith('audio/')
    || (mime === 'application/ogg' && audioUrl && oggExtension.test(new URL(audioUrl).pathname))
  if (!audioUrl || !playable) return null
  return {
    id,
    title,
    artist: typeof info.user === 'string' && info.user.trim() ? info.user.trim() : '未知上传者',
    album: 'Wikimedia Commons',
    duration: 0,
    source: 'wikimedia',
    audioUrl,
    cover: 'gold',
    sourceUrl: sourcePage,
    quality: 'standard',
    capabilities: { playback: 'full', lyrics: false, download: true },
  }
}

const interleave = (pages, limit) => {
  const merged = []
  const seen = new Set()
  for (const rank of [0, 1, 2, 3, 4]) {
    const tier = pages.map((page) => page.tracks.filter((track) => playbackRank(track) === rank))
    for (let index = 0; ; index += 1) {
      let progressed = false
      for (const tracks of tier) {
        const track = tracks[index]
        if (!track) continue
        progressed = true
        const key = `${track.source}:${track.id}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(track)
      }
      if (!progressed) break
    }
  }
  return diversifyRankedTracks(merged, limit)
}

const filename = (title, url) => {
  const extension = new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.audio'
  const stem = String(title).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'audio'
  return `${stem}${extension}`
}

export const createPublicMusicProvider = ({
  apple,
  fallback,
  fetchImpl = globalThis.fetch,
  musicBrainzIntervalMs = 1_000,
  statusTimeoutMs = 4_000,
  now = Date.now,
  waitImpl = abortableDelay,
} = {}) => {
  if (!apple || !fallback || typeof fetchImpl !== 'function') throw new Error('public music providers are required')
  if (!Number.isFinite(musicBrainzIntervalMs) || musicBrainzIntervalMs < 0 || musicBrainzIntervalMs > 60_000) {
    throw new Error('valid MusicBrainz interval is required')
  }
  if (!Number.isInteger(statusTimeoutMs) || statusTimeoutMs < 1 || statusTimeoutMs > 30_000) {
    throw new Error('valid status timeout is required')
  }
  let nextMusicBrainzRequestAt = 0
  let musicBrainzQueue = Promise.resolve()

  const request = async (url, signal, label, timeoutMs = 8_000) => {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      signal: createRequestSignal(signal, timeoutMs),
    })
    return readJson(response, label)
  }

  const scheduleMusicBrainz = (operation, signal) => {
    const acquire = async () => {
      if (signal?.aborted) throw signal.reason
      const delay = Math.max(0, nextMusicBrainzRequestAt - now())
      if (delay) await waitImpl(delay, signal)
      if (signal?.aborted) throw signal.reason
      nextMusicBrainzRequestAt = now() + musicBrainzIntervalMs
      return operation()
    }
    const scheduled = musicBrainzQueue.then(acquire, acquire)
    musicBrainzQueue = scheduled.catch(() => undefined)
    return scheduled
  }

  const searchAudius = async (query, pageSize, page, signal) => {
    const url = new URL('tracks/search', AUDIUS_API)
    url.searchParams.set('query', query)
    url.searchParams.set('limit', String(pageSize))
    url.searchParams.set('offset', String((page - 1) * pageSize))
    const payload = await request(url, signal, 'Audius')
    if (!Array.isArray(payload?.data)) throw new Error('invalid Audius response')
    return payload.data.map(normalizeAudius).filter(Boolean)
  }

  const lookupAudiusData = async (id, signal) => {
    if (!audiusId.test(id)) throw new Error('invalid Audius track id')
    const payload = await request(new URL(`tracks/${id}`, AUDIUS_API), signal, 'Audius')
    if (!payload?.data || payload.data.id !== id) throw new Error('invalid Audius response')
    return payload.data
  }

  const searchMusicBrainz = (query, pageSize, page, signal) => scheduleMusicBrainz(async () => {
    const url = new URL(MUSICBRAINZ_API)
    url.searchParams.set('query', query)
    url.searchParams.set('limit', String(Math.min(50, pageSize)))
    url.searchParams.set('offset', String((page - 1) * Math.min(50, pageSize)))
    url.searchParams.set('fmt', 'json')
    const payload = await request(url, signal, 'MusicBrainz')
    if (!Array.isArray(payload?.recordings)) throw new Error('invalid MusicBrainz response')
    return payload.recordings.map(normalizeMusicBrainz).filter(Boolean)
  }, signal)

  const lookupMusicBrainz = (id, signal) => scheduleMusicBrainz(async () => {
    const normalizedId = String(id).toLocaleLowerCase()
    if (!recordingId.test(normalizedId)) throw new Error('invalid MusicBrainz track id')
    const url = new URL(normalizedId, MUSICBRAINZ_API)
    url.searchParams.set('inc', 'artists+releases')
    url.searchParams.set('fmt', 'json')
    const result = normalizeMusicBrainz(await request(url, signal, 'MusicBrainz'))
    if (!result || result.id !== normalizedId) throw new Error('invalid MusicBrainz response')
    return result
  }, signal)

  const wikimediaQuery = () => {
    const url = new URL(WIKIMEDIA_API)
    url.searchParams.set('action', 'query')
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|mime|user')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('origin', '*')
    url.searchParams.set('maxage', '300')
    url.searchParams.set('smaxage', '300')
    return url
  }

  const requestWikimedia = async (url, signal) => {
    const payload = await request(url, signal, 'Wikimedia')
    if (!Array.isArray(payload?.query?.pages)) throw new Error('invalid Wikimedia response')
    return payload.query.pages.map(normalizeWikimedia).filter(Boolean)
  }

  const searchWikimedia = (query, pageSize, page, signal) => {
    const url = wikimediaQuery()
    const limit = Math.min(10, pageSize)
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrsearch', `${query} filetype:audio`)
    url.searchParams.set('gsrnamespace', '6')
    url.searchParams.set('gsrlimit', String(limit))
    url.searchParams.set('gsroffset', String((page - 1) * limit))
    return requestWikimedia(url, signal)
  }

  const lookupWikimedia = async (id, signal) => {
    if (!pageId.test(String(id))) throw new Error('invalid Wikimedia track id')
    const url = wikimediaQuery()
    url.searchParams.set('pageids', String(id))
    const result = (await requestWikimedia(url, signal)).find((item) => item.id === String(id))
    if (!result) throw new Error('invalid Wikimedia response')
    return result
  }

  const searchSource = async (source, query, pageSize, page, signal) => {
    if (source === 'apple') return apple.searchPage(query, { provider: 'apple', pageSize, page }, signal)
    const tracks = source === 'audius'
      ? await searchAudius(query, pageSize, page, signal)
      : source === 'musicbrainz'
        ? await searchMusicBrainz(query, pageSize, page, signal)
        : await searchWikimedia(query, pageSize, page, signal)
    return { tracks, page, hasMore: tracks.length >= Math.min(source === 'wikimedia' ? 10 : 50, pageSize) }
  }

  const provider = {
    id: 'demo',
    name: '公共多平台搜索',

    async search(query, signal) {
      return (await this.searchPage(query, {}, signal)).tracks
    },

    async searchPage(query, options = {}, signal) {
      const term = String(query).normalize('NFKC').trim()
      const page = Math.min(100, Math.max(1, options.page ?? 1))
      const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20))
      const selected = options.provider && options.provider !== 'all' ? options.provider : null
      if (!term) return fallback.searchPage(query, options, signal)
      if (selected && !publicMusicSources.includes(selected)) return { tracks: [], page, hasMore: false }
      if (selected) return searchSource(selected, term, pageSize, page, signal)

      const settled = await Promise.allSettled(publicMusicSources.map((source) => (
        searchSource(source, term, pageSize, page, signal)
      )))
      if (signal?.aborted) throw signal.reason
      const pages = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      if (!pages.length) {
        const publicFallback = settled.flatMap((result) => result.status === 'rejected'
          ? [searchFallbackTracks(result.reason)]
          : []).find(Boolean)
        const tracks = publicFallback || (await fallback.searchPage(query, options, signal)).tracks
        throw createSearchFallbackError(tracks)
      }
      return {
        tracks: interleave(pages, pageSize),
        page,
        hasMore: pages.some((result) => result.hasMore),
      }
    },

    async resolve(track, signal) {
      if (track.source === 'apple') return apple.resolve(track, signal)
      if (track.source === 'audius') {
        const direct = safeHttpsUrl(track.audioUrl)
        if (direct) return direct
        const data = await lookupAudiusData(track.id, signal)
        if (!publicAudiusStream(data)) {
          throw Object.assign(new Error('Audius track is not publicly streamable'), { code: 'CAPABILITY_UNAVAILABLE' })
        }
        const url = new URL(`tracks/${track.id}/stream`, AUDIUS_API)
        url.searchParams.set('skip_play_count', 'true')
        url.searchParams.set('_t', String(now()))
        return url.toString()
      }
      if (track.source === 'wikimedia') {
        return safeHttpsUrl(track.audioUrl, 'upload.wikimedia.org') || (await lookupWikimedia(track.id, signal)).audioUrl
      }
      return fallback.resolve(track, signal)
    },

    async identify(input, source, signal) {
      if (signal?.aborted) throw signal.reason
      return identifyMusicInput(input, source) ?? fallback.identify(input, source, signal)
    },

    async lookup(match, signal) {
      if (match.source === 'apple') return apple.lookup(match, signal)
      if (match.source === 'audius') {
        const result = normalizeAudius(await lookupAudiusData(match.id, signal))
        if (!result) throw new Error('invalid Audius response')
        return result
      }
      if (match.source === 'musicbrainz') return lookupMusicBrainz(match.id, signal)
      if (match.source === 'wikimedia') return lookupWikimedia(match.id, signal)
      return fallback.lookup(match, signal)
    },

    lyrics(track, signal) {
      return fallback.lyrics(track, signal)
    },

    async download(track, signal) {
      if (track.source === 'wikimedia') {
        const resolved = safeHttpsUrl(track.audioUrl, 'upload.wikimedia.org') || (await lookupWikimedia(track.id, signal)).audioUrl
        return { url: resolved, filename: filename(track.title, resolved) }
      }
      if (track.source === 'audius') {
        const data = await lookupAudiusData(track.id, signal)
        const url = publicAudiusDownload(data) ? safeHttpsUrl(data.download?.url) : ''
        if (!url) throw Object.assign(new Error('Audius download is not publicly authorized'), { code: 'CAPABILITY_UNAVAILABLE' })
        return { url, filename: filename(data.title, url) }
      }
      return fallback.download(track, signal)
    },

    async status(signal) {
      const statusSignal = createRequestSignal(signal, statusTimeoutMs)
      const checks = await Promise.allSettled([
        apple.status(statusSignal).then((status) => status.online && status.sources.includes('apple') ? 'apple' : Promise.reject()),
        searchAudius('Listener', 1, 1, statusSignal).then(() => 'audius'),
        searchMusicBrainz('Listener', 1, 1, statusSignal).then(() => 'musicbrainz'),
        searchWikimedia('music', 1, 1, statusSignal).then(() => 'wikimedia'),
      ])
      if (signal?.aborted) throw signal.reason
      const sources = publicMusicSources.filter((source) => checks.some((result) => result.status === 'fulfilled' && result.value === source))
      if (!sources.length) return fallback.status(signal)
      return {
        online: true,
        sources,
        capabilities: Object.fromEntries(sources.map((source) => [source, capabilities[source]])),
      }
    },
  }
  return provider
}
