type TrackLike = {
  id: string
  source: string
  audioUrl: string
  capabilities: { playback: string }
}

type DurationTrackLike = {
  duration: number
  audioUrl: string
  capabilities: { playback: string }
}

export declare const playableTracks: <T extends TrackLike>(tracks: readonly T[]) => T[]
export declare const playbackUnavailableTrack: <T extends TrackLike>(track: T) => T
export declare const nextDirectFullTrack: <T extends TrackLike>(tracks: readonly T[], currentKey: string) => T | null
export declare const queueWithoutTrack: <T extends TrackLike>(
  tracks: readonly T[] | null | undefined,
  currentKey: string,
) => T[]
export declare const collectionPlaybackPlan: <T extends TrackLike>(
  tracks: readonly T[],
  mode: 'order' | 'shuffle' | 'one',
  random?: () => number,
) => { queue: T[]; repeatMode: 'off' | 'all' | 'one'; shuffle: boolean }
export declare const preferResolvedCurrent: <T extends TrackLike>(requested: T, current: T) => T
export declare const endedPlaybackAction: (state: {
  pending: boolean
  queueLength: number
  currentIndex: number
  repeatMode: 'off' | 'all' | 'one'
}) => 'ignore' | 'stop' | 'restart' | 'next'
export declare const shouldApplyEndedAction: (action: 'ignore' | 'stop' | 'restart' | 'next') => boolean
export declare const mediaLoadKey: (track: TrackLike) => string
export declare const autoplayMediaMatches: (requestedKey: string | null, currentKey: string) => boolean
export declare const removalFocusIndex: (removedIndex: number, remainingLength: number) => number
export declare const focusTrapTargetIndex: (activeIndex: number, length: number, backwards: boolean) => number
export declare const playbackVisualState: (state: {
  current: boolean
  playing: boolean
  resolving: boolean
  buffering: boolean
}) => 'idle' | 'resolving' | 'buffering' | 'playing'
export declare const playControlDisabled: (playback: string, pending: boolean) => boolean
export declare const shouldCancelPendingTrack: (requestedKey: string, pendingKey: string | null) => boolean
export declare const shouldRestartCurrentTrack: (progress: number, currentIndex: number) => boolean
export declare const seekPosition: (value: number, duration: number) => number | null
export declare const initialPlaybackDuration: (track: DurationTrackLike) => number
export declare const mediaErrorAction: (state: {
  hasAudioUrl: boolean
  errorCode: number
  mediaKey: string
  retryKey: string | null
  source: string
}) => 'ignore' | 'retry' | 'report' | 'invalidate'
