import type { Playlist, Track } from './types/music'

export type PlaybackHistory = { track: Track; playedAt: number }
export type LibraryData = {
  version: 1
  liked: Track[]
  playlists: Playlist[]
  queue: Track[]
  current: Track | null
  history: PlaybackHistory[]
  settings: {
    volume: number
    repeat: 'off' | 'all' | 'one'
    regionalRecommendations: boolean
    region: string
  }
}
export type LibraryValidators = {
  isTrack(value: unknown): value is Track
  isPlaylist(value: unknown): value is Playlist
}
export function normalizeLibraryData(value: unknown, validators: LibraryValidators): LibraryData
export function mergeLibraryData(
  local: unknown,
  cloud: unknown,
  validators: LibraryValidators,
  options?: { preferSecondaryState?: boolean },
): LibraryData
