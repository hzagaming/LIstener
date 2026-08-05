const SEARCH_FALLBACK = 'SEARCH_FALLBACK'

export const searchInputMode = (value) => {
  const input = String(value).trim()
  if (!input) return 'empty'
  if (/^https?:\/\//i.test(input)) return 'identify'
  return input.length > 100 ? 'too-long' : 'search'
}

export const createSearchFallbackError = (tracks) => Object.assign(
  new Error('aggregated search is unavailable'),
  { code: SEARCH_FALLBACK, tracks },
)

export const searchFallbackTracks = (error) => (
  error?.code === SEARCH_FALLBACK && Array.isArray(error.tracks) ? error.tracks : null
)

export const filterTracksByPlayback = (tracks, mode) => {
  if (!Array.isArray(tracks)) return []
  if (mode === 'all') return tracks
  return tracks.filter((track) => mode === 'full'
    ? track?.capabilities?.playback === 'full'
    : track?.capabilities?.playback !== 'preview')
}

export const parseSearchPage = (payload, isItem) => {
  const data = payload?.success === true ? payload.data : null
  if (!data || !Number.isInteger(data.page) || data.page < 1 || typeof data.has_more !== 'boolean') return null
  if (!Array.isArray(data.items) || typeof isItem !== 'function' || !data.items.every(isItem)) return null
  return { tracks: data.items, page: data.page, hasMore: data.has_more }
}
