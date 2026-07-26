type TrackLike = {
  id: string
  source: string
  audioUrl: string
  capabilities: { playback: string }
}

export declare const playableTracks: <T extends TrackLike>(tracks: readonly T[]) => T[]
export declare const preferResolvedCurrent: <T extends TrackLike>(requested: T, current: T) => T
export declare const endedPlaybackAction: (state: {
  pending: boolean
  queueLength: number
  currentIndex: number
  repeatMode: 'off' | 'all' | 'one'
}) => 'ignore' | 'stop' | 'restart' | 'next'
export declare const mediaLoadKey: (track: TrackLike) => string
export declare const removalFocusIndex: (removedIndex: number, remainingLength: number) => number
