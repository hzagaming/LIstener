const unknownValues = new Set(['', '未知歌手', '未知专辑', 'unknown artist', 'unknown album'])
const generatedSources = new Set(['demo', 'fixture'])

const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase()

const concrete = (value) => {
  const normalized = normalize(value)
  return unknownValues.has(normalized) ? '' : normalized
}

const artists = (value) => String(value ?? '')
  .split(/\s*(?:\/|、|,|&|\bfeat\.?\b|\bft\.?\b)\s*/iu)
  .map((artist) => ({ label: artist.trim(), key: concrete(artist) }))
  .filter(({ key }) => key)

const mostFrequent = (values) => {
  const counts = new Map()
  for (const value of values) {
    const current = counts.get(value.key)
    counts.set(value.key, current ? { ...current, count: current.count + 1 } : { ...value, count: 1 })
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0] ?? null
}

export const recommendationSeed = (tracks) => {
  if (!Array.isArray(tracks) || !tracks.length) return null
  const artist = mostFrequent(tracks.flatMap((track) => artists(track?.artist)))
  if (artist) return { query: artist.label, label: artist.label }
  const album = mostFrequent(tracks.map((track) => ({ label: String(track?.album ?? '').trim(), key: concrete(track?.album) })).filter(({ key }) => key))
  if (album) return { query: album.label, label: album.label }
  return null
}

export const rankRecommendations = (seeds, candidates, limit = 8) => {
  if (!Array.isArray(seeds) || !seeds.length || !Array.isArray(candidates)) return []
  const boundedLimit = Math.min(500, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 8))
  if (!boundedLimit) return []
  const seedKeys = new Set(seeds.map((track) => `${track?.source}:${track?.id}`))
  const seedArtists = new Set(seeds.flatMap((track) => artists(track?.artist).map(({ key }) => key)))
  const seedAlbums = new Set(seeds.map((track) => concrete(track?.album)).filter(Boolean))
  const seedTitles = new Set(seeds.map((track) => concrete(track?.title)).filter(Boolean))
  const seen = new Set()
  const seenIdentities = new Set()

  return candidates.flatMap((track, index) => {
    const key = `${track?.source}:${track?.id}`
    if (seedKeys.has(key) || seen.has(key) || generatedSources.has(track?.source) || track?.capabilities?.playback === 'preview') return []
    seen.add(key)
    const candidateArtists = artists(track?.artist).map(({ key: artist }) => artist)
    const sameArtist = candidateArtists.some((artist) => seedArtists.has(artist))
    const sameAlbum = seedAlbums.has(concrete(track?.album))
    if (sameArtist && seedTitles.has(concrete(track?.title))) return []
    if (!sameArtist && !sameAlbum) return []
    const identity = `${concrete(track?.title)}|${candidateArtists.sort().join('|')}`
    if (seenIdentities.has(identity)) return []
    seenIdentities.add(identity)
    return [{
      track,
      reason: [sameArtist && '同歌手', sameAlbum && '同专辑'].filter(Boolean).join(' · '),
      score: (sameArtist ? 100 : 0) + (sameAlbum ? 40 : 0),
      index,
    }]
  }).sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, boundedLimit)
    .map(({ track, reason }) => ({ track, reason }))
}

export const mergeRecommendationPages = (seeds, existing, candidates, limit = 200) => {
  const previousTracks = Array.isArray(existing) ? existing.map((item) => item?.track).filter(Boolean) : []
  return rankRecommendations(seeds, [...previousTracks, ...(Array.isArray(candidates) ? candidates : [])], limit)
}

export const nextPlayableRecommendation = (queue, recommendations) => {
  const queued = new Set((Array.isArray(queue) ? queue : []).map((track) => `${track?.source}:${track?.id}`))
  return (Array.isArray(recommendations) ? recommendations : [])
    .map((item) => item?.track)
    .find((track) => track?.capabilities?.playback === 'full' && !queued.has(`${track?.source}:${track?.id}`)) ?? null
}

export const shouldPrefetchRecommendations = ({
  continuous, currentIndex, queueLength, hasMore, loading, requestKey, lastRequestKey,
}) => (
  Boolean(continuous)
  && Boolean(hasMore)
  && !loading
  && (!requestKey || requestKey !== lastRequestKey)
  && Number.isInteger(currentIndex)
  && Number.isInteger(queueLength)
  && queueLength > 0
  && currentIndex >= Math.max(0, queueLength - 2)
)
