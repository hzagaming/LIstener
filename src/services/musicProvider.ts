import { tracks } from '../data/catalog'
import { abortableDelay, createRequestSignal } from '../requestPolicy.mjs'
import { createSearchFallbackError, parseSearchPage } from '../searchLogic.mjs'
import { isMusicIdentification, isMusicSource, isTrack } from '../types/music'
import { isSafeUrl } from '../urlPolicy.mjs'
import { createPublicAppleProvider } from './publicAppleProvider.mjs'
import { createPublicMusicProvider } from './publicMusicProvider.mjs'
import { artworkFilename, builtInArtwork, readArtworkResponse } from '../downloadLogic.mjs'
import type {
  DownloadDescriptor, Lyrics, MusicIdentification, MusicProvider, MusicSearchPage, MusicSearchPageOptions, MusicSource,
  ProviderStatus, SourceCapabilities, Track,
} from '../types/music'

const labels: Record<MusicSource, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  kuwo: '酷我',
  qianqian: '千千',
  '1ting': '一听',
  migu: '咪咕',
  lizhi: '荔枝',
  qingting: '蜻蜓 FM',
  ximalaya: '喜马拉雅',
  '5sing-original': '5sing 原创',
  '5sing-cover': '5sing 翻唱',
  qmkg: '全民 K 歌',
  youtube: 'YouTube Music',
  apple: 'Apple Music',
  musicbrainz: 'MusicBrainz',
  audius: 'Audius',
  wikimedia: 'Wikimedia Commons',
  internetarchive: 'Internet Archive',
  local: '本地音乐',
  demo: '演示源',
  fixture: '离线测试源',
}

const mediaUrl = (value: unknown, allowBlob = false) => {
  if (!isSafeUrl(value, { allowBlob })) return null
  return new URL(value as string).toString()
}

const apiError = async (response: Response, message: string) => {
  const payload = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
  const error = new Error(message) as Error & { code?: string }
  if (typeof payload?.error?.code === 'string') error.code = payload.error.code
  return error
}

/**
 * 演示适配器。接入爬虫后，只需实现 MusicProvider，页面层无需改动。
 * 建议由服务端完成抓取、音源解析与缓存，前端只消费标准 Track 结构。
 */
class DemoProvider implements MusicProvider {
  id: MusicSource = 'demo'
  name = '聚合搜索'

  async search(query: string, signal?: AbortSignal): Promise<Track[]> {
    const key = query.trim().toLocaleLowerCase()
    await abortableDelay(240, signal)
    if (!key) return tracks
    return tracks.filter((track) =>
      [track.title, track.artist, track.album].some((value) =>
        value.toLocaleLowerCase().includes(key),
      ),
    )
  }

  async searchPage(query: string, options: MusicSearchPageOptions = {}, signal?: AbortSignal): Promise<MusicSearchPage> {
    const page = Math.max(1, options.page ?? 1)
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20))
    const matches = await this.search(query, signal)
    const start = (page - 1) * pageSize
    return { tracks: matches.slice(start, start + pageSize), page, hasMore: start + pageSize < matches.length }
  }

  async resolve(track: Track): Promise<string> {
    return track.audioUrl
  }

  async identify(): Promise<null> { return null }

  async lookup(): Promise<Track> { throw new Error('演示源不支持 ID 查询') }

  async lyrics(): Promise<Lyrics> { throw new Error('演示音频没有歌词') }

  async download(): Promise<DownloadDescriptor> { throw new Error('演示音频未开放下载') }

  async status(): Promise<ProviderStatus> {
    return {
      online: false,
      sources: ['demo'],
      capabilities: { demo: { search: true, playback: true, lyrics: false, download: false } },
    }
  }
}

class ApiProvider implements MusicProvider {
  id: MusicSource = 'demo'
  name = '聚合搜索'

  constructor(
    private readonly baseUrl: string,
    private readonly fallback: MusicProvider,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<Track[]> {
    return (await this.searchPage(query, {}, signal)).tracks
  }

  async searchPage(query: string, options: MusicSearchPageOptions = {}, signal?: AbortSignal): Promise<MusicSearchPage> {
    const term = query.trim()
    const provider = options.provider ?? 'all'
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 20
    if (!term) return this.fallback.searchPage(query, options, signal)
    try {
      const url = new URL('/api/music/search', this.baseUrl)
      url.searchParams.set('q', term)
      url.searchParams.set('provider', provider)
      url.searchParams.set('page', String(page))
      url.searchParams.set('page_size', String(pageSize))
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: createRequestSignal(signal, 10_000),
      })
      if (!response.ok) throw new Error(`search failed: ${response.status}`)
      const result = parseSearchPage(await response.json(), isTrack)
      if (!result || result.page !== page) throw new Error('invalid search response')
      return result
    } catch (error) {
      if (signal?.aborted) throw error
      if (provider !== 'all' || page !== 1) throw error
      const fallbackPage = await this.fallback.searchPage(query, options, signal)
      if (signal?.aborted) throw signal.reason ?? error
      throw createSearchFallbackError(fallbackPage.tracks)
    }
  }

  async resolve(track: Track, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (track.audioUrl) {
      const directUrl = mediaUrl(track.audioUrl, track.source === 'local')
      if (!directUrl) throw new Error('音源地址无效')
      return directUrl
    }
    try {
      const url = new URL('/api/resolve', this.baseUrl)
      url.searchParams.set('source', track.source)
      url.searchParams.set('id', track.id)
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: createRequestSignal(signal, 10_000),
      })
      if (!response.ok) throw await apiError(response, `resolve failed: ${response.status}`)
      const payload = await response.json() as { url?: string }
      const resolvedUrl = mediaUrl(payload.url)
      if (!resolvedUrl) throw new Error('invalid resolve response')
      return resolvedUrl
    } catch (error) {
      if (signal?.aborted) throw error
      if (track.source === 'apple') return this.fallback.resolve(track, signal)
      throw error
    }
  }

  async identify(input: string, source?: MusicSource, signal?: AbortSignal): Promise<MusicIdentification | null> {
    try {
      const url = new URL('/api/identify', this.baseUrl)
      url.searchParams.set('input', input.trim())
      if (source) url.searchParams.set('source', source)
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: createRequestSignal(signal, 6_000) })
      if (!response.ok) throw new Error(`identify failed: ${response.status}`)
      const payload = await response.json() as { match?: unknown }
      return isMusicIdentification(payload.match) ? payload.match : null
    } catch (error) {
      if (signal?.aborted) throw error
      return this.fallback.identify(input, source, signal)
    }
  }

  async lookup(match: MusicIdentification, signal?: AbortSignal): Promise<Track> {
    try {
      const url = new URL('/api/track', this.baseUrl)
      url.searchParams.set('source', match.source)
      url.searchParams.set('id', match.id)
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: createRequestSignal(signal, 10_000) })
      if (!response.ok) throw new Error(`lookup failed: ${response.status}`)
      const payload = await response.json() as { track?: unknown }
      if (!isTrack(payload.track)) throw new Error('invalid track response')
      return payload.track
    } catch (error) {
      if (signal?.aborted) throw error
      return this.fallback.lookup(match, signal)
    }
  }

  async lyrics(track: Track, signal?: AbortSignal): Promise<Lyrics> {
    const url = new URL('/api/lyrics', this.baseUrl)
    url.searchParams.set('source', track.source)
    url.searchParams.set('id', track.id)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: createRequestSignal(signal, 10_000) })
    if (!response.ok) throw new Error(`lyrics failed: ${response.status}`)
    const payload = await response.json() as Partial<Lyrics>
    if (typeof payload.plain !== 'string' || typeof payload.lrc !== 'string') throw new Error('invalid lyrics response')
    return payload as Lyrics
  }

  async download(track: Track, signal?: AbortSignal): Promise<DownloadDescriptor> {
    const url = new URL('/api/download', this.baseUrl)
    url.searchParams.set('source', track.source)
    url.searchParams.set('id', track.id)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: createRequestSignal(signal, 10_000) })
    if (!response.ok) throw new Error(`download failed: ${response.status}`)
    const payload = await response.json() as Partial<DownloadDescriptor>
    if (typeof payload.url !== 'string' || typeof payload.filename !== 'string') throw new Error('invalid download response')
    if (!isSafeUrl(payload.url)) throw new Error('unsafe download response')
    const downloadUrl = new URL('/api/download/file', this.baseUrl)
    downloadUrl.searchParams.set('source', track.source)
    downloadUrl.searchParams.set('id', track.id)
    return { url: downloadUrl.toString(), filename: payload.filename }
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      const url = new URL('/api/health', this.baseUrl)
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: createRequestSignal(signal, 4_000),
      })
      if (!response.ok) throw new Error(`health failed: ${response.status}`)
      const payload = await response.json() as { status?: string; sources?: unknown[]; capabilities?: unknown }
      if (payload.status !== 'ok' || !Array.isArray(payload.sources)) throw new Error('invalid health response')
      const sources = payload.sources.filter(isMusicSource)
      if (!sources.length) throw new Error('no music sources available')
      const capabilities = payload.capabilities && typeof payload.capabilities === 'object'
        ? payload.capabilities as Partial<Record<MusicSource, SourceCapabilities>>
        : {}
      return { online: true, sources, capabilities }
    } catch (error) {
      if (signal?.aborted) throw error
      return this.fallback.status()
    }
  }
}

const demoProvider = new DemoProvider()
const publicAppleProvider = createPublicAppleProvider({ fallback: demoProvider })
const publicMusicProvider = createPublicMusicProvider({ apple: publicAppleProvider, fallback: demoProvider })
const configuredApiBase = import.meta.env.VITE_MUSIC_API_BASE?.trim() ?? ''
const apiBase = configuredApiBase || (import.meta.env.DEV ? window.location.origin : '')
export const publicBrowserMode = import.meta.env.VITE_PUBLIC_BROWSER === 'true' || !apiBase
export const musicProvider: MusicProvider = publicBrowserMode
  ? publicMusicProvider
  : new ApiProvider(apiBase, publicMusicProvider)
export const sourceLabel = (source: MusicSource) => labels[source]

export const downloadArtwork = async (track: Track, signal?: AbortSignal) => {
  if (!isSafeUrl(track.cover)) {
    const artwork = builtInArtwork(track.cover, track.title, track.artist)
    return {
      blob: new Blob([artwork.svg], { type: artwork.type }),
      filename: artworkFilename(track.title, artwork.type),
    }
  }
  const url = publicBrowserMode
    ? new URL(track.cover)
    : new URL(`/api/artwork?source=${encodeURIComponent(track.source)}&id=${encodeURIComponent(track.id)}`, apiBase)
  const response = await fetch(url, {
    credentials: publicBrowserMode ? 'omit' : 'include',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
    signal: createRequestSignal(signal, 12_000),
  })
  const blob = await readArtworkResponse(response)
  return { blob, filename: artworkFilename(track.title, blob.type) }
}
