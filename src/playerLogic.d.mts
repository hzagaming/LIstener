type TrackLike = {
  id: string
  source: string
  audioUrl: string
  capabilities: { playback: string }
}

export declare const playableTracks: <T extends TrackLike>(tracks: readonly T[]) => T[]
export declare const preferResolvedCurrent: <T extends TrackLike>(requested: T, current: T) => T
