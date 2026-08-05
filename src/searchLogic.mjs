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

const searchableText = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase()

export const refineSearchTracks = (tracks, options = {}) => {
  if (!Array.isArray(tracks)) return []
  const domain = ['title', 'artist', 'album'].includes(options.domain) ? options.domain : 'all'
  const duration = ['short', 'medium', 'long'].includes(options.duration) ? options.duration : 'all'
  const sort = ['title', 'artist', 'duration'].includes(options.sort) ? options.sort : 'relevance'
  const query = searchableText(options.query).trim()
  const filtered = tracks.filter((track) => {
    if (domain !== 'all' && query && !searchableText(track?.[domain]).includes(query)) return false
    const seconds = Number(track?.duration)
    if (duration === 'short') return Number.isFinite(seconds) && seconds > 0 && seconds < 180
    if (duration === 'medium') return Number.isFinite(seconds) && seconds >= 180 && seconds <= 300
    if (duration === 'long') return Number.isFinite(seconds) && seconds > 300
    return true
  })
  if (sort === 'relevance') return filtered
  return filtered.map((track, index) => ({ track, index })).sort((left, right) => {
    if (sort === 'duration') {
      const leftDuration = Number(left.track?.duration) > 0 ? Number(left.track.duration) : Number.POSITIVE_INFINITY
      const rightDuration = Number(right.track?.duration) > 0 ? Number(right.track.duration) : Number.POSITIVE_INFINITY
      return leftDuration - rightDuration || left.index - right.index
    }
    return searchableText(left.track?.[sort]).localeCompare(searchableText(right.track?.[sort]), undefined, {
      numeric: true, sensitivity: 'base',
    }) || left.index - right.index
  }).map(({ track }) => track)
}

export const parseSearchPage = (payload, isItem) => {
  const data = payload?.success === true ? payload.data : null
  if (!data || !Number.isInteger(data.page) || data.page < 1 || typeof data.has_more !== 'boolean') return null
  if (!Array.isArray(data.items) || typeof isItem !== 'function' || !data.items.every(isItem)) return null
  return { tracks: data.items, page: data.page, hasMore: data.has_more }
}
