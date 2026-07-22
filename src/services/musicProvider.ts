import { tracks } from '../data/catalog'
import type { MusicProvider, MusicSource, Track } from '../types/music'

const labels: Record<MusicSource, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  demo: '演示源',
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
}

class ApiProvider implements MusicProvider {
  id: MusicSource = 'demo'
  name = '聚合搜索'

  constructor(
    private readonly baseUrl: string,
    private readonly fallback: MusicProvider,
  ) {}

  async search(query: string): Promise<Track[]> {
    try {
      const url = new URL('/api/search', this.baseUrl)
      url.searchParams.set('q', query.trim())
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`search failed: ${response.status}`)
      const payload = await response.json() as { tracks?: Track[] }
      if (!Array.isArray(payload.tracks)) throw new Error('invalid search response')
      return payload.tracks
    } catch {
      return this.fallback.search(query)
    }
  }

  async resolve(track: Track): Promise<string> {
    try {
      const url = new URL('/api/resolve', this.baseUrl)
      url.searchParams.set('source', track.source)
      url.searchParams.set('id', track.id)
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`resolve failed: ${response.status}`)
      const payload = await response.json() as { url?: string }
      if (!payload.url) throw new Error('invalid resolve response')
      return payload.url
    } catch {
      return this.fallback.resolve(track)
    }
  }
}

const demoProvider = new DemoProvider()
const apiBase = import.meta.env.VITE_MUSIC_API_BASE?.trim()

export const musicProvider: MusicProvider = apiBase
  ? new ApiProvider(apiBase, demoProvider)
  : demoProvider
export const sourceLabel = (source: MusicSource) => labels[source]
