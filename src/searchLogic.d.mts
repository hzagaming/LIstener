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
