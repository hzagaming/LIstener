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
