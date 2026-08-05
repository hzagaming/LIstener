export type RecommendationSeed = { query: string; label: string }
export type Recommendation<T> = { track: T; reason: string }

export declare const recommendationSeed: <T extends { artist?: unknown; album?: unknown }>(tracks: T[] | null | undefined) => RecommendationSeed | null
export declare const rankRecommendations: <T extends {
  id?: unknown
  source?: unknown
  title?: unknown
  artist?: unknown
  album?: unknown
  capabilities?: { playback?: unknown }
}>(seeds: T[] | null | undefined, candidates: T[] | null | undefined, limit?: number) => Recommendation<T>[]
export declare const mergeRecommendationPages: <T extends {
  id?: unknown
  source?: unknown
  title?: unknown
  artist?: unknown
  album?: unknown
  capabilities?: { playback?: unknown }
}>(seeds: T[] | null | undefined, existing: Recommendation<T>[] | null | undefined, candidates: T[] | null | undefined, limit?: number) => Recommendation<T>[]
export declare const nextPlayableRecommendation: <T extends {
  id?: unknown
  source?: unknown
  capabilities?: { playback?: unknown }
}>(queue: T[] | null | undefined, recommendations: Recommendation<T>[] | null | undefined) => T | null
export declare const shouldPrefetchRecommendations: (state: {
  continuous: boolean
  currentIndex: number
  queueLength: number
  hasMore: boolean
  loading: boolean
  requestKey?: string
  lastRequestKey?: string
}) => boolean
