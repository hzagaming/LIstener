export type SearchFallbackError<T> = Error & {
  code: 'SEARCH_FALLBACK'
  tracks: T[]
}

export declare const searchInputMode: (value: unknown) => 'empty' | 'identify' | 'too-long' | 'search'
export declare const createSearchFallbackError: <T>(tracks: T[]) => SearchFallbackError<T>
export declare const searchFallbackTracks: <T>(error: unknown) => T[] | null
export declare const filterTracksByPlayback: <T extends { capabilities: { playback: string } }>(
  tracks: T[] | null | undefined,
  mode: 'no-preview' | 'full' | 'all',
) => T[]
export declare const summarizePlaybackTracks: (tracks: Array<{
  audioUrl?: unknown
  capabilities?: { playback?: unknown }
}> | null | undefined) => { full: number; preview: number; candidate: number; metadata: number }
export declare const playbackRank: (track: {
  audioUrl?: unknown
  capabilities?: { playback?: unknown }
} | null | undefined) => number
export declare const prioritizePlayableTracks: <T extends { capabilities: { playback: string } }>(
  tracks: T[] | null | undefined,
) => T[]
export declare const diversifyRankedTracks: <T extends {
  source?: unknown
  audioUrl?: unknown
  capabilities: { playback: string }
}>(tracks: T[] | null | undefined, limit: number, options?: { prioritizePlayback?: boolean }) => T[]
export declare const mergeSearchPages: <T extends { source?: unknown; id?: unknown }>(
  current: T[] | null | undefined,
  incoming: T[] | null | undefined,
  limit: number,
) => T[]
export type SearchDomain = 'all' | 'title' | 'artist' | 'album'
export type SearchDuration = 'all' | 'short' | 'medium' | 'long'
export type SearchSort = 'relevance' | 'title' | 'artist' | 'duration'
export declare const refineSearchTracks: <T extends {
  title?: unknown
  artist?: unknown
  album?: unknown
  duration?: unknown
}>(tracks: T[] | null | undefined, options?: {
  query?: unknown
  domain?: SearchDomain
  duration?: SearchDuration
  sort?: SearchSort
}) => T[]
export declare const parseSearchPage: <T>(payload: unknown, isItem: (item: unknown) => item is T) => {
  tracks: T[]
  page: number
  hasMore: boolean
} | null
