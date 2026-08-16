import { createProviderHttpClient } from '../providerHttpClient.mjs'
import {
  ARCHIVE_BASE_URL,
  archiveDownload,
  archiveSearchIdentifiers,
  archiveSearchUrl,
  archiveTrackId,
  interleaveArchiveTracks,
  normalizeArchiveItem,
  parseArchiveTrackId,
} from '../internetArchiveLogic.mjs'

export const createInternetArchiveProvider = ({
  fetchImpl = globalThis.fetch,
  baseUrl = ARCHIVE_BASE_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const endpoint = new URL(baseUrl || ARCHIVE_BASE_URL)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Internet Archive base URL must use credential-free HTTPS')
  }
  if (endpoint.origin !== 'https://archive.org') throw new Error('Internet Archive base URL must use the official host')
  if (endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('Internet Archive base URL must be the official origin')

  const http = createProviderHttpClient({
    allowedHosts: ['archive.org'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  const metadata = async (identifier, signal) => normalizeArchiveItem(
    await http.json(new URL(`/metadata/${encodeURIComponent(identifier)}`, endpoint), { signal }),
    identifier,
  )
  const lookup = async (id, signal) => {
    const requested = parseArchiveTrackId(id)
    const tracks = await metadata(requested.identifier, signal)
    const track = requested.filename
      ? tracks.find((candidate) => candidate.id === archiveTrackId(requested.identifier, requested.filename))
      : tracks[0]
    if (!track) throw new Error('invalid Internet Archive response')
    return track
  }

  return {
    id: 'internetarchive',
    name: 'Internet Archive',
    enabled: true,
    experimental: false,
    official: true,
    maxSearchResults: 10,
    allowedHosts: ['archive.org'],
    capabilities: { search: true, playback: true, lyrics: false, download: true },

    async search(query, limit = 20, signal, page = 1) {
      const value = String(query).normalize('NFKC').trim()
      if (!value) return []
      const payload = await http.json(archiveSearchUrl(value, page), { signal })
      const identifiers = archiveSearchIdentifiers(payload)
      const settled = await Promise.allSettled(identifiers.map((identifier) => metadata(identifier, signal)))
      if (signal?.aborted) throw signal.reason
      const groups = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      return interleaveArchiveTracks(groups, Math.min(50, Math.max(1, limit)))
    },

    lookup,

    async resolve(id, signal) {
      return (await lookup(id, signal)).audioUrl
    },

    async download(id, signal) {
      return archiveDownload(await lookup(id, signal))
    },
  }
}
