export type MusicSource = 'netease' | 'qq' | 'kugou' | 'demo'

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
  count: number
  tracks: Track[]
}

export interface MusicProvider {
  id: MusicSource
  name: string
  search(query: string): Promise<Track[]>
  resolve(track: Track): Promise<string>
}
