import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_BASE_URL = 'https://commons.wikimedia.org/w/api.php'
const pageId = /^\d+$/
const oggExtension = /\.(?:ogg|oga)$/i
const audioExtension = /\.(?:aac|flac|m4a|mid|midi|mp3|oga|ogg|opus|wav|webm)$/i

const safeUrl = (value, hostname) => {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password || url.port) return null
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLocaleLowerCase().startsWith('utm_')) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

const normalizePage = (page) => {
  const id = String(page?.pageid ?? '')
  const title = typeof page?.title === 'string'
    ? page.title.replace(/^File:/i, '').replace(audioExtension, '').trim()
    : ''
  const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null
  if (!pageId.test(id) || !title || !info) return null

  const audioUrl = safeUrl(info.url, 'upload.wikimedia.org')
  const sourceUrl = info.descriptionurl
    ? safeUrl(info.descriptionurl, 'commons.wikimedia.org')
    : `https://commons.wikimedia.org/?curid=${id}`
  const mime = typeof info.mime === 'string' ? info.mime.toLocaleLowerCase() : ''
  const isAudio = mime.startsWith('audio/')
    || (mime === 'application/ogg' && audioUrl && oggExtension.test(new URL(audioUrl).pathname))
  if (!audioUrl || !sourceUrl || !isAudio) return null

  return {
    id,
    title,
    artist: typeof info.user === 'string' && info.user.trim() ? info.user.trim() : '未知上传者',
    album: 'Wikimedia Commons',
    duration: 0,
    source: 'wikimedia',
    audioUrl,
    cover: 'gold',
    sourceUrl,
    quality: 'standard',
    capabilities: { playback: 'full', lyrics: false, download: false },
  }
}

export const createWikimediaProvider = ({
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const endpoint = new URL(baseUrl || DEFAULT_BASE_URL)
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
  const baseQuery = () => {
    const url = new URL(endpoint)
    url.searchParams.set('action', 'query')
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|mime|user')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('origin', '*')
    url.searchParams.set('maxage', '300')
    url.searchParams.set('smaxage', '300')
    return url
  }

  return {
    id: 'wikimedia',
    name: 'Wikimedia Commons',
    enabled: true,
    experimental: false,
    official: true,
    maxSearchResults: 10,
    allowedHosts: ['commons.wikimedia.org', 'upload.wikimedia.org'],
    capabilities: { search: true, playback: true, lyrics: false, download: false },

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
      return (await request(url, signal)).map(normalizePage).filter(Boolean)
    },

    async lookup(id, signal) {
      const requestedId = String(id)
      if (!pageId.test(requestedId)) throw new Error('invalid Wikimedia track id')
      const url = baseQuery()
      url.searchParams.set('pageids', requestedId)
      const track = (await request(url, signal)).map(normalizePage).find((item) => item?.id === requestedId)
      if (!track) throw new Error('invalid Wikimedia response')
      return track
    },

    async resolve(id, signal) {
      return (await this.lookup(id, signal)).audioUrl
    },
  }
}
