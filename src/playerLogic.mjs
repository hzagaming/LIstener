export const playableTracks = (tracks) => tracks.filter((track) => track.capabilities.playback !== 'none')

export const preferResolvedCurrent = (requested, current) => (
  requested.source === current.source && requested.id === current.id && current.audioUrl
    ? current
    : requested
)
