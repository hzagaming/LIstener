export const playableTracks = (tracks) => tracks.filter((track) => track.capabilities.playback !== 'none')

export const preferResolvedCurrent = (requested, current) => (
  requested.source === current.source && requested.id === current.id && current.audioUrl
    ? current
    : requested
)

export const endedPlaybackAction = ({ pending, queueLength, currentIndex, repeatMode }) => {
  if (pending) return 'ignore'
  if (!queueLength || currentIndex < 0) return 'stop'
  if (repeatMode === 'one') return 'restart'
  if (repeatMode === 'off' && currentIndex === queueLength - 1) return 'stop'
  return 'next'
}

export const mediaLoadKey = (track) => JSON.stringify([track.source, track.id, track.audioUrl])

export const removalFocusIndex = (removedIndex, remainingLength) => (
  remainingLength > 0 ? Math.min(Math.max(removedIndex, 0), remainingLength - 1) : -1
)

export const playbackVisualState = ({ current, playing, resolving, buffering }) => {
  if (resolving) return 'resolving'
  if (!current) return 'idle'
  if (buffering) return 'buffering'
  return playing ? 'playing' : 'idle'
}

export const playControlDisabled = (playback, pending) => playback === 'none' && !pending

export const shouldCancelPendingTrack = (requestedKey, pendingKey) => (
  Boolean(pendingKey) && requestedKey === pendingKey
)

export const shouldRestartCurrentTrack = (progress, currentIndex, duration) => (
  currentIndex >= 0 && Number.isFinite(progress) && progress > 3
    && Number.isFinite(duration) && duration > 0
)

export const seekPosition = (value, duration) => (
  Number.isFinite(value) && Number.isFinite(duration) && duration > 0
    ? Math.min(duration, Math.max(0, value))
    : null
)

export const initialPlaybackDuration = (track) => (
  track.capabilities.playback === 'full' ? track.duration : 0
)
