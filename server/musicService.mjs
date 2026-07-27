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

  const search = async (query, requestedLimit = 20, signal) => {
    if (signal?.aborted) throw abortReason(signal)
    const normalizedQuery = normalize(query)
    if (!normalizedQuery) throw new Error('query is required')
    const limit = Math.min(50, Math.max(1, requestedLimit))
    const key = `${normalizedQuery}:${limit}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) return cached.tracks
    const pending = inFlight.get(key)
    if (pending) return subscribe(key, pending, signal)

    const controller = new AbortController()
    const entry = { controller, subscribers: 0, settled: false, promise: null }
    entry.promise = (async () => {
      const results = await Promise.allSettled(
        providers.map((provider) => withTimeout(
          (providerSignal) => provider.search(query.trim(), limit, providerSignal),
          providerTimeoutMs,
          controller.signal,
        )),
      )
      if (controller.signal.aborted) throw abortReason(controller.signal)
      let hasProviderFailure = false
      const providerTracks = results.flatMap((result, index) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
          hasProviderFailure = true
          return []
        }
        const valid = result.value.filter((track) => isTrack(track) && track.source === providers[index].id)
        if (valid.length !== result.value.length) hasProviderFailure = true
        return [valid]
      })
      if (!providerTracks.length || (hasProviderFailure && providerTracks.every((tracks) => !tracks.length))) {
        throw new Error('all music providers failed')
      }

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
      if (!hasProviderFailure) {
        const timestamp = now()
        if (cache.size >= maxCacheEntries) {
          for (const [cachedKey, value] of cache) {
            if (value.expiresAt <= timestamp) cache.delete(cachedKey)
          }
          if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value)
        }
        cache.set(key, { tracks, expiresAt: timestamp + ttlMs })
      }
      return tracks
    })().finally(() => {
      entry.settled = true
      if (inFlight.get(key) === entry) inFlight.delete(key)
    })

    inFlight.set(key, entry)
    return subscribe(key, entry, signal)
  }

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
    const value = await withTimeout(
      (providerSignal) => provider.lyrics(id, providerSignal),
      providerTimeoutMs,
      signal,
    )
    if (typeof value?.plain !== 'string' || typeof value?.lrc !== 'string') {
      throw new Error('invalid lyrics response')
    }
    return value
  }

  const lookup = async (source, id, signal) => {
    const provider = getProvider(providerById, source)
    if (typeof provider.lookup !== 'function') throw new Error('track lookup is unavailable for this source')
    const track = await withTimeout(
      (providerSignal) => provider.lookup(id, providerSignal),
      providerTimeoutMs,
      signal,
    )
    if (!isTrack(track) || track.source !== source) throw new Error('invalid provider track')
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
    resolve,
    lookup,
    lyrics,
    download,
    identify: identifyMusicInput,
    sources: [...providerById.keys()],
    sourceCapabilities,
  }
}
