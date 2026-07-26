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
