const normalize = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export const createMusicService = ({ providers, ttlMs = 30_000, maxCacheEntries = 500, now = Date.now }) => {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const cache = new Map()
  const inFlight = new Map()

  const search = async (query, requestedLimit = 20) => {
    const normalizedQuery = normalize(query)
    if (!normalizedQuery) throw new Error('query is required')
    const limit = Math.min(50, Math.max(1, requestedLimit))
    const key = `${normalizedQuery}:${limit}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return cached.tracks
    if (inFlight.has(key)) return inFlight.get(key)

    const request = (async () => {
      const results = await Promise.allSettled(
        providers.map((provider) => provider.search(query.trim(), limit)),
      )
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      if (!fulfilled.length) throw new Error('all music providers failed')

      const seen = new Set()
      const tracks = fulfilled
        .flatMap((result) => result.value)
        .filter((track) => {
          const identity = `${normalize(track.title)}:${normalize(track.artist)}`
          if (seen.has(identity)) return false
          seen.add(identity)
          return true
        })
        .slice(0, limit)
      const timestamp = now()
      if (cache.size >= maxCacheEntries) {
        for (const [cachedKey, value] of cache) {
          if (value.expiresAt <= timestamp) cache.delete(cachedKey)
        }
        if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value)
      }
      cache.set(key, { tracks, expiresAt: timestamp + ttlMs })
      return tracks
    })()

    inFlight.set(key, request)
    try {
      return await request
    } finally {
      inFlight.delete(key)
    }
  }

  const resolve = async (source, id) => {
    const provider = providerById.get(source)
    if (!provider) throw new Error('unknown music source')
    return provider.resolve(id)
  }

  return { search, resolve, sources: [...providerById.keys()] }
}
