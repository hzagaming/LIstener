export const musicSources = ['netease', 'qq', 'kugou', 'apple', 'demo'] as const
export type MusicSource = typeof musicSources[number]

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  source: MusicSource
  audioUrl: string
  cover: string
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
  resolve(track: Track): Promise<string>
  status(): Promise<{ online: boolean; sources: MusicSource[] }>
}

export const isMusicSource = (value: unknown): value is MusicSource =>
  typeof value === 'string' && musicSources.includes(value as MusicSource)

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
    && typeof track.audioUrl === 'string'
    && typeof track.cover === 'string'
}

export const trackKey = (track: Pick<Track, 'source' | 'id'>) => `${track.source}:${track.id}`
