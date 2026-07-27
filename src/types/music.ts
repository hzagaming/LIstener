export const musicSources = [
  'netease', 'qq', 'kugou', 'kuwo', 'qianqian', '1ting', 'migu', 'lizhi',
  'qingting', 'ximalaya', '5sing-original', '5sing-cover', 'qmkg', 'apple',
  'musicbrainz', 'audius', 'local', 'demo',
  'fixture',
] as const
export type MusicSource = typeof musicSources[number]

export const qualityLevels = ['unknown', 'standard', 'high', 'lossless', 'hi-res'] as const
export type QualityLevel = typeof qualityLevels[number]

export interface TrackCapabilities {
  playback: 'none' | 'preview' | 'full'
  lyrics: boolean
  download: boolean
}

export interface SourceCapabilities {
  search: boolean
  playback: boolean
  lyrics: boolean
  download: boolean
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  source: MusicSource
  audioUrl: string
  cover: string
  sourceUrl: string
  quality: QualityLevel
  capabilities: TrackCapabilities
  liked?: boolean
}

export interface Playlist {
  id: string
  title: string
  description: string
  cover: string
  tracks: Track[]
}

export interface MusicProvider {
  id: MusicSource
  name: string
  search(query: string, signal?: AbortSignal): Promise<Track[]>
  resolve(track: Track, signal?: AbortSignal): Promise<string>
  identify(input: string, source?: MusicSource): Promise<MusicIdentification | null>
  lookup(match: MusicIdentification): Promise<Track>
  lyrics(track: Track): Promise<Lyrics>
  download(track: Track): Promise<DownloadDescriptor>
  status(): Promise<ProviderStatus>
}

export interface MusicIdentification {
  source: MusicSource
  id: string
  canonicalUrl: string
}

export interface Lyrics {
  plain: string
  lrc: string
  lines?: Array<{ timeMs: number; text: string }>
  language?: string | null
  translated?: string | null
}

export interface DownloadDescriptor {
  url: string
  filename: string
}

export interface ProviderStatus {
  online: boolean
  sources: MusicSource[]
  capabilities: Partial<Record<MusicSource, SourceCapabilities>>
}

export const isMusicSource = (value: unknown): value is MusicSource =>
  typeof value === 'string' && musicSources.includes(value as MusicSource)

const isSafeUrl = (value: unknown, allowEmpty = false) => {
  if (typeof value !== 'string') return false
  if (!value && allowEmpty) return true
  try {
    return ['http:', 'https:', 'blob:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export const isTrack = (value: unknown): value is Track => {
  if (!value || typeof value !== 'object') return false
  const track = value as Record<string, unknown>
  return typeof track.id === 'string'
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && typeof track.duration === 'number'
    && Number.isFinite(track.duration)
    && track.duration >= 0
    && isMusicSource(track.source)
    && isSafeUrl(track.audioUrl, true)
    && typeof track.cover === 'string'
    && isSafeUrl(track.sourceUrl)
    && qualityLevels.includes(track.quality as QualityLevel)
    && isTrackCapabilities(track.capabilities)
}

export const isTrackCapabilities = (value: unknown): value is TrackCapabilities => {
  if (!value || typeof value !== 'object') return false
  const capabilities = value as Record<string, unknown>
  return ['none', 'preview', 'full'].includes(String(capabilities.playback))
    && typeof capabilities.lyrics === 'boolean'
    && typeof capabilities.download === 'boolean'
}

export const isPlaylist = (value: unknown): value is Playlist => {
  if (!value || typeof value !== 'object') return false
  const playlist = value as Record<string, unknown>
  return typeof playlist.id === 'string'
    && typeof playlist.title === 'string'
    && typeof playlist.description === 'string'
    && typeof playlist.cover === 'string'
    && Array.isArray(playlist.tracks)
    && playlist.tracks.every(isTrack)
}

export const isMusicIdentification = (value: unknown): value is MusicIdentification => {
  if (!value || typeof value !== 'object') return false
  const match = value as Record<string, unknown>
  return isMusicSource(match.source)
    && typeof match.id === 'string'
    && typeof match.canonicalUrl === 'string'
}

export const trackKey = (track: Pick<Track, 'source' | 'id'>) => `${track.source}:${track.id}`
