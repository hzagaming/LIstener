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
