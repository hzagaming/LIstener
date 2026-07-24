import { identifyMusicInput } from './platforms.mjs'

const normalize = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

const defaultCapabilities = (provider) => ({
  search: typeof provider.search === 'function',
  playback: typeof provider.resolve === 'function',
  lyrics: false,
  download: false,
})

const qualities = new Set(['unknown', 'standard', 'high', 'lossless', 'hi-res'])
const playbackModes = new Set(['none', 'preview', 'full'])
const isUrl = (value, allowEmpty = false) => {
  if (typeof value !== 'string' || (!value && !allowEmpty)) return false
  if (!value) return true
  try {
    return ['http:', 'https:', 'blob:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
const isTrack = (track) => track && typeof track === 'object'
  && ['id', 'title', 'artist', 'album', 'source', 'audioUrl', 'cover', 'sourceUrl', 'quality']
    .every((key) => typeof track[key] === 'string')
  && Number.isFinite(track.duration) && track.duration >= 0
  && isUrl(track.audioUrl, true) && isUrl(track.sourceUrl)
  && qualities.has(track.quality)
  && track.capabilities && typeof track.capabilities === 'object'
  && playbackModes.has(track.capabilities.playback)
  && typeof track.capabilities.lyrics === 'boolean'
  && typeof track.capabilities.download === 'boolean'

const withTimeout = (operation, timeoutMs) => new Promise((resolve, reject) => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('music provider timed out'))
    reject(controller.signal.reason)
  }, timeoutMs)
  Promise.resolve()
    .then(() => operation(controller.signal))
    .then(resolve, reject)
    .finally(() => clearTimeout(timer))
})

const getProvider = (providerById, source) => {
  const provider = providerById.get(source)
  if (!provider) throw new Error('unknown music source')
  return provider
}

export const createMusicService = ({
  providers,
  ttlMs = 30_000,
  maxCacheEntries = 500,
  providerTimeoutMs = 4_000,
  now = Date.now,
}) => {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const cache = new Map()
  const inFlight = new Map()
  const sourceCapabilities = Object.fromEntries(providers.map((provider) => [
    provider.id,
    { ...defaultCapabilities(provider), ...provider.capabilities },
  ]))

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
        providers.map((provider) => withTimeout((signal) => provider.search(query.trim(), limit, signal), providerTimeoutMs)),
      )
      const providerTracks = results.flatMap((result, index) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return []
        const valid = result.value.filter((track) => isTrack(track) && track.source === providers[index].id)
        return result.value.length === 0 || valid.length ? [valid] : []
      })
      if (!providerTracks.length) throw new Error('all music providers failed')

      const seen = new Set()
      const tracks = []
      for (let index = 0; tracks.length < limit; index += 1) {
        let progressed = false
        for (const candidates of providerTracks) {
          const track = candidates[index]
          if (!track) continue
          progressed = true
          const identity = `${track.source}:${track.id}`
          if (seen.has(identity)) continue
          seen.add(identity)
          tracks.push(track)
          if (tracks.length >= limit) break
        }
        if (!progressed) break
      }
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
    const provider = getProvider(providerById, source)
    return withTimeout((signal) => provider.resolve(id, signal), providerTimeoutMs)
  }

  const lyrics = async (source, id) => {
    const provider = getProvider(providerById, source)
    if (!provider.capabilities?.lyrics || typeof provider.lyrics !== 'function') {
      throw new Error('lyrics are unavailable for this source')
    }
    return withTimeout((signal) => provider.lyrics(id, signal), providerTimeoutMs)
  }

  const lookup = async (source, id) => {
    const provider = getProvider(providerById, source)
    if (typeof provider.lookup !== 'function') throw new Error('track lookup is unavailable for this source')
    return withTimeout((signal) => provider.lookup(id, signal), providerTimeoutMs)
  }

  const download = async (source, id) => {
    const provider = getProvider(providerById, source)
    if (!provider.capabilities?.download || typeof provider.download !== 'function') {
      throw new Error('download is unavailable for this source')
    }
    const descriptor = await withTimeout((signal) => provider.download(id, signal), providerTimeoutMs)
    const url = new URL(descriptor?.url)
    if (!['http:', 'https:'].includes(url.protocol) || !descriptor?.filename) {
      throw new Error('invalid download descriptor')
    }
    return { url: url.toString(), filename: String(descriptor.filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) }
  }

  return {
    search,
    resolve,
    lookup,
    lyrics,
    download,
    identify: identifyMusicInput,
    sources: [...providerById.keys()],
    sourceCapabilities,
  }
}
