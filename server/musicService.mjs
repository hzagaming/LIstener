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
const artworkToken = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const isUrl = (value, allowEmpty = false) => {
  if (typeof value !== 'string' || (!value && !allowEmpty)) return false
  if (!value) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
const isArtwork = (value) => typeof value === 'string' && (artworkToken.test(value) || isUrl(value))
const isTrack = (track) => track && typeof track === 'object'
  && ['id', 'title', 'artist', 'album', 'source', 'audioUrl', 'cover', 'sourceUrl', 'quality']
    .every((key) => typeof track[key] === 'string')
  && Number.isFinite(track.duration) && track.duration >= 0 && isArtwork(track.cover)
  && isUrl(track.audioUrl, true) && isUrl(track.sourceUrl)
  && qualities.has(track.quality)
  && track.capabilities && typeof track.capabilities === 'object'
  && playbackModes.has(track.capabilities.playback)
  && typeof track.capabilities.lyrics === 'boolean'
  && typeof track.capabilities.download === 'boolean'

const resolvedMediaUrl = (value) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

const abortReason = (signal) => signal?.reason ?? new Error('operation aborted')

const withTimeout = (operation, timeoutMs, externalSignal) => new Promise((resolve, reject) => {
  const controller = new AbortController()
  let settled = false
  let timer
  const cleanup = () => {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
  const settle = (callback, value) => {
    if (settled) return
    settled = true
    cleanup()
    callback(value)
  }
  const abort = (reason) => {
    controller.abort(reason)
    settle(reject, reason)
  }
  const onExternalAbort = () => abort(abortReason(externalSignal))

  if (externalSignal?.aborted) return onExternalAbort()
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  timer = setTimeout(() => abort(new Error('music provider timed out')), timeoutMs)
  Promise.resolve()
    .then(() => operation(controller.signal))
    .then((value) => settle(resolve, value), (error) => settle(reject, error))
})

const getProvider = (providerById, source) => {
  const provider = providerById.get(source)
  if (!provider) throw new Error('unknown music source')
  if (provider.enabled === false) throw new Error('music source is disabled')
  return provider
}

export const createMusicService = ({
  providers,
  ttlMs = 30_000,
  operationTtlMs = 60_000,
  failureTtlMs = 5_000,
  maxCacheEntries = 500,
  providerTimeoutMs = 4_000,
  maxConcurrentProviders = 3,
  now = Date.now,
}) => {
  if (!Array.isArray(providers) || providers.some((provider) => !provider || typeof provider.id !== 'string')) {
    throw new Error('valid music providers are required')
  }
  if (new Set(providers.map(({ id }) => id)).size !== providers.length) {
    throw new Error('duplicate music provider id')
  }
  if (!Number.isInteger(maxConcurrentProviders) || maxConcurrentProviders < 1 || maxConcurrentProviders > 10) {
    throw new Error('valid provider concurrency is required')
  }
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const cache = new Map()
  const failureCache = new Map()
  const operationCache = new Map()
  const inFlight = new Map()
  const sourceCapabilities = Object.fromEntries(providers.map((provider) => [
    provider.id,
    { ...defaultCapabilities(provider), ...provider.capabilities },
  ]))
  const providerHealth = new Map(providers.map((provider) => [
    provider.id,
    provider.enabled === false ? 'disabled' : provider.experimental ? 'experimental' : 'healthy',
  ]))
  const providerDetails = () => providers.map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    status: providerHealth.get(provider.id),
    experimental: provider.experimental === true,
    official: provider.official === true,
    capabilities: sourceCapabilities[provider.id],
  }))

  const setBounded = (target, key, value) => {
    const timestamp = now()
    if (target.size >= maxCacheEntries) {
      for (const [cachedKey, cachedValue] of target) {
        if (cachedValue.expiresAt <= timestamp) target.delete(cachedKey)
      }
      if (target.size >= maxCacheEntries) target.delete(target.keys().next().value)
    }
    target.set(key, value)
  }

  const runProviderSearches = async (selectedProviders, query, pageSize, page, signal) => {
    const results = Array(selectedProviders.length)
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < selectedProviders.length) {
        const index = nextIndex
        nextIndex += 1
        const provider = selectedProviders[index]
        try {
          results[index] = {
            status: 'fulfilled',
            value: await withTimeout(
              (providerSignal) => provider.search(query, pageSize, providerSignal, page),
              providerTimeoutMs,
              signal,
            ),
          }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(maxConcurrentProviders, selectedProviders.length) },
      () => worker(),
    ))
    return results
  }

  const subscribe = (key, entry, signal) => new Promise((resolve, reject) => {
    let active = true
    entry.subscribers += 1
    const cleanup = () => {
      if (!active) return false
      active = false
      entry.subscribers -= 1
      signal?.removeEventListener('abort', onAbort)
      return true
    }
    const onAbort = () => {
      if (!cleanup()) return
      const reason = abortReason(signal)
      reject(reason)
      if (!entry.settled && entry.subscribers === 0) {
        if (inFlight.get(key) === entry) inFlight.delete(key)
        entry.controller.abort(reason)
      }
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      (tracks) => {
        if (!cleanup()) return
        resolve(tracks)
      },
      (error) => {
        if (!cleanup()) return
        reject(error)
      },
    )
  })

  const searchDetailed = async ({
    query,
    provider = 'all',
    page = 1,
    pageSize = 20,
  }, signal) => {
    if (signal?.aborted) throw abortReason(signal)
    if (typeof query !== 'string') throw new Error('query is required')
    const normalizedQuery = normalize(query)
    if (!normalizedQuery) throw new Error('query is required')
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('page must be between 1 and 100')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('page size must be between 1 and 50')
    const selectedProviders = provider === 'all'
      ? providers.filter((candidate) => candidate.enabled !== false && candidate.capabilities?.search !== false)
      : [getProvider(providerById, provider)]
    if (!selectedProviders.length || selectedProviders.some((candidate) => typeof candidate.search !== 'function')) {
      throw new Error('search is unavailable for this source')
    }
    const key = `v2:${provider}:${normalizedQuery}:${page}:${pageSize}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return { ...cached.value, cached: true }
    const failed = failureCache.get(key)
    if (failed && failed.expiresAt > now()) throw new Error('all music providers failed')
    const pending = inFlight.get(key)
    if (pending) return subscribe(key, pending, signal)

    const controller = new AbortController()
    const entry = { controller, subscribers: 0, settled: false, promise: null }
    entry.promise = (async () => {
      const results = await runProviderSearches(
        selectedProviders,
        query.trim(),
        pageSize,
        page,
        controller.signal,
      )
      if (controller.signal.aborted) throw abortReason(controller.signal)
      const providerErrors = []
      const providerTracks = results.flatMap((result, index) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
          providerHealth.set(selectedProviders[index].id, result.status === 'rejected' ? 'unavailable' : 'degraded')
          providerErrors.push({
            provider: selectedProviders[index].id,
            code: result.status === 'rejected' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_INVALID_RESPONSE',
          })
          return []
        }
        const valid = result.value.filter((track) => isTrack(track) && track.source === selectedProviders[index].id)
        if (valid.length !== result.value.length) {
          providerHealth.set(selectedProviders[index].id, 'degraded')
          providerErrors.push({ provider: selectedProviders[index].id, code: 'PROVIDER_INVALID_RESPONSE' })
        } else {
          providerHealth.set(selectedProviders[index].id, selectedProviders[index].experimental ? 'experimental' : 'healthy')
        }
        return [valid]
      })
      if (!providerTracks.length || (providerErrors.length && providerTracks.every((tracks) => !tracks.length))) {
        setBounded(failureCache, key, { expiresAt: now() + failureTtlMs })
        throw new Error('all music providers failed')
      }

      const seen = new Set()
      const tracks = []
      for (let index = 0; tracks.length <= pageSize; index += 1) {
        let progressed = false
        for (const candidates of providerTracks) {
          const track = candidates[index]
          if (!track) continue
          progressed = true
          const identity = `${track.source}:${track.id}`
          if (seen.has(identity)) continue
          seen.add(identity)
          tracks.push(track)
          if (tracks.length > pageSize) break
        }
        if (!progressed) break
      }
      const value = {
        tracks: tracks.slice(0, pageSize),
        providerErrors,
        cached: false,
        hasMore: tracks.length > pageSize || providerTracks.some((items) => items.length >= pageSize),
      }
      if (!providerErrors.length) {
        setBounded(cache, key, { value, expiresAt: now() + ttlMs })
      }
      return value
    })().finally(() => {
      entry.settled = true
      if (inFlight.get(key) === entry) inFlight.delete(key)
    })

    inFlight.set(key, entry)
    return subscribe(key, entry, signal)
  }

  const search = async (query, requestedLimit = 20, signal) => (
    await searchDetailed({
      query,
      provider: 'all',
      page: 1,
      pageSize: Math.min(50, Math.max(1, requestedLimit)),
    }, signal)
  ).tracks

  const resolve = async (source, id, signal) => {
    const provider = getProvider(providerById, source)
    if (typeof provider.resolve !== 'function' || provider.capabilities?.playback === false) {
      throw new Error('playback is unavailable for this source')
    }
    const url = resolvedMediaUrl(await withTimeout(
      (providerSignal) => provider.resolve(id, providerSignal),
      providerTimeoutMs,
      signal,
    ))
    if (!url) throw new Error('invalid resolved media URL')
    return url
  }

  const lyrics = async (source, id, signal) => {
    const provider = getProvider(providerById, source)
    if (!provider.capabilities?.lyrics || typeof provider.lyrics !== 'function') {
      throw new Error('lyrics are unavailable for this source')
    }
    if (signal?.aborted) throw abortReason(signal)
    const key = `lyrics:${source}:${id}`
    const cached = operationCache.get(key)
    if (cached && cached.expiresAt > now()) return cached.value
    const value = await withTimeout(
      (providerSignal) => provider.lyrics(id, providerSignal),
      providerTimeoutMs,
      signal,
    )
    if (typeof value?.plain !== 'string' || typeof value?.lrc !== 'string') {
      throw new Error('invalid lyrics response')
    }
    setBounded(operationCache, key, { value, expiresAt: now() + operationTtlMs })
    return value
  }

  const lookup = async (source, id, signal) => {
    const provider = getProvider(providerById, source)
    if (typeof provider.lookup !== 'function') throw new Error('track lookup is unavailable for this source')
    if (signal?.aborted) throw abortReason(signal)
    const key = `track:${source}:${id}`
    const cached = operationCache.get(key)
    if (cached && cached.expiresAt > now()) return cached.value
    const track = await withTimeout(
      (providerSignal) => provider.lookup(id, providerSignal),
      providerTimeoutMs,
      signal,
    )
    if (!isTrack(track) || track.source !== source) throw new Error('invalid provider track')
    setBounded(operationCache, key, { value: track, expiresAt: now() + operationTtlMs })
    return track
  }

  const download = async (source, id, signal) => {
    const provider = getProvider(providerById, source)
    if (!provider.capabilities?.download || typeof provider.download !== 'function') {
      throw new Error('download is unavailable for this source')
    }
    const descriptor = await withTimeout(
      (providerSignal) => provider.download(id, providerSignal),
      providerTimeoutMs,
      signal,
    )
    const url = resolvedMediaUrl(descriptor?.url)
    if (!url || !descriptor?.filename) {
      throw new Error('invalid download descriptor')
    }
    return { url, filename: String(descriptor.filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) }
  }

  return {
    search,
    searchDetailed,
    resolve,
    lookup,
    lyrics,
    download,
    identify: identifyMusicInput,
    sources: providers.filter((provider) => provider.enabled !== false).map((provider) => provider.id),
    sourceCapabilities,
    get providerDetails() { return providerDetails() },
  }
}
