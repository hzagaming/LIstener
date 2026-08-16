import { createProviderHttpClient } from '../providerHttpClient.mjs'
import { createWikimediaQuery, normalizeWikimediaPage, WIKIMEDIA_API, wikimediaPageId } from '../wikimediaLogic.mjs'

export const createWikimediaProvider = ({
  fetchImpl = globalThis.fetch,
  baseUrl = WIKIMEDIA_API,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const endpoint = new URL(baseUrl || WIKIMEDIA_API)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Wikimedia base URL must use credential-free HTTPS')
  }
  if (endpoint.origin !== 'https://commons.wikimedia.org') {
    throw new Error('Wikimedia base URL must use the official host')
  }
  if (endpoint.pathname !== '/w/api.php') throw new Error('Wikimedia base URL must use the official API path')
  endpoint.search = ''
  endpoint.hash = ''

  const http = createProviderHttpClient({
    allowedHosts: ['commons.wikimedia.org'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  const request = async (url, signal) => {
    const payload = await http.json(url, { signal })
    if (!Array.isArray(payload?.query?.pages)) throw new Error('invalid Wikimedia response')
    return payload.query.pages
  }
  const baseQuery = () => createWikimediaQuery(endpoint)

  return {
    id: 'wikimedia',
    name: 'Wikimedia Commons',
    enabled: true,
    experimental: false,
    official: true,
    maxSearchResults: 10,
    allowedHosts: ['commons.wikimedia.org', 'upload.wikimedia.org'],
    capabilities: { search: true, playback: true, lyrics: false, download: true },

    async search(query, limit = 20, signal, page = 1) {
      const value = query.trim()
      if (!value) return []
      const boundedLimit = Math.min(10, Math.max(1, limit))
      const url = baseQuery()
      url.searchParams.set('generator', 'search')
      url.searchParams.set('gsrsearch', `${value} filetype:audio`)
      url.searchParams.set('gsrnamespace', '6')
      url.searchParams.set('gsrlimit', String(boundedLimit))
      url.searchParams.set('gsroffset', String(Math.max(0, page - 1) * boundedLimit))
      return (await request(url, signal)).map(normalizeWikimediaPage).filter(Boolean)
    },

    async lookup(id, signal) {
      const requestedId = String(id)
      if (!wikimediaPageId.test(requestedId)) throw new Error('invalid Wikimedia track id')
      const url = baseQuery()
      url.searchParams.set('pageids', requestedId)
      const track = (await request(url, signal)).map(normalizeWikimediaPage).find((item) => item?.id === requestedId)
      if (!track) throw new Error('invalid Wikimedia response')
      return track
    },

    async resolve(id, signal) {
      return (await this.lookup(id, signal)).audioUrl
    },

    async download(id, signal) {
      const track = await this.lookup(id, signal)
      const extension = new URL(track.audioUrl).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.audio'
      return { url: track.audioUrl, filename: `${track.title}${extension}` }
    },
  }
}
