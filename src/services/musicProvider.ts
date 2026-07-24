import { tracks } from '../data/catalog'
import { isMusicIdentification, isMusicSource, isTrack } from '../types/music'
import type {
  DownloadDescriptor, Lyrics, MusicIdentification, MusicProvider, MusicSource,
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
  apple: 'Apple Music',
  local: '本地音乐',
  demo: '演示源',
}

const mediaUrl = (value: unknown, allowBlob = false) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:', ...(allowBlob ? ['blob:'] : [])].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * 演示适配器。接入爬虫后，只需实现 MusicProvider，页面层无需改动。
 * 建议由服务端完成抓取、音源解析与缓存，前端只消费标准 Track 结构。
 */
class DemoProvider implements MusicProvider {
  id: MusicSource = 'demo'
  name = '聚合搜索'

  async search(query: string): Promise<Track[]> {
    const key = query.trim().toLocaleLowerCase()
    await new Promise((resolve) => setTimeout(resolve, 240))
    if (!key) return tracks
    return tracks.filter((track) =>
      [track.title, track.artist, track.album].some((value) =>
        value.toLocaleLowerCase().includes(key),
      ),
    )
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
    if (!query.trim()) return this.fallback.search(query)
    try {
      const url = new URL('/api/search', this.baseUrl)
      url.searchParams.set('q', query.trim())
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`search failed: ${response.status}`)
      const payload = await response.json() as { tracks?: Track[] }
      if (!Array.isArray(payload.tracks) || !payload.tracks.every(isTrack)) throw new Error('invalid search response')
      return payload.tracks
    } catch (error) {
      if (signal?.aborted) throw error
      return this.fallback.search(query)
    }
  }

  async resolve(track: Track): Promise<string> {
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
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`resolve failed: ${response.status}`)
      const payload = await response.json() as { url?: string }
      const resolvedUrl = mediaUrl(payload.url)
      if (!resolvedUrl) throw new Error('invalid resolve response')
      return resolvedUrl
    } catch {
      const fallbackUrl = await this.fallback.resolve(track)
      if (!fallbackUrl) throw new Error('音源解析失败')
      return fallbackUrl
    }
  }

  async identify(input: string, source?: MusicSource): Promise<MusicIdentification | null> {
    const url = new URL('/api/identify', this.baseUrl)
    url.searchParams.set('input', input.trim())
    if (source) url.searchParams.set('source', source)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`identify failed: ${response.status}`)
    const payload = await response.json() as { match?: unknown }
    return isMusicIdentification(payload.match) ? payload.match : null
  }

  async lookup(match: MusicIdentification): Promise<Track> {
    const url = new URL('/api/track', this.baseUrl)
    url.searchParams.set('source', match.source)
    url.searchParams.set('id', match.id)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`lookup failed: ${response.status}`)
    const payload = await response.json() as { track?: unknown }
    if (!isTrack(payload.track)) throw new Error('invalid track response')
    return payload.track
  }

  async lyrics(track: Track): Promise<Lyrics> {
    const url = new URL('/api/lyrics', this.baseUrl)
    url.searchParams.set('source', track.source)
    url.searchParams.set('id', track.id)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`lyrics failed: ${response.status}`)
    const payload = await response.json() as Partial<Lyrics>
    if (typeof payload.plain !== 'string' || typeof payload.lrc !== 'string') throw new Error('invalid lyrics response')
    return payload as Lyrics
  }

  async download(track: Track): Promise<DownloadDescriptor> {
    const url = new URL('/api/download', this.baseUrl)
    url.searchParams.set('source', track.source)
    url.searchParams.set('id', track.id)
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`download failed: ${response.status}`)
    const payload = await response.json() as Partial<DownloadDescriptor>
    if (typeof payload.url !== 'string' || typeof payload.filename !== 'string') throw new Error('invalid download response')
    const target = new URL(payload.url)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsafe download response')
    return { url: target.toString(), filename: payload.filename }
  }

  async status(): Promise<ProviderStatus> {
    try {
      const url = new URL('/api/health', this.baseUrl)
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
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
    } catch {
      return this.fallback.status()
    }
  }
}

const demoProvider = new DemoProvider()
const apiBase = import.meta.env.VITE_MUSIC_API_BASE?.trim() || window.location.origin

export const musicProvider: MusicProvider = new ApiProvider(apiBase, demoProvider)
export const sourceLabel = (source: MusicSource) => labels[source]
