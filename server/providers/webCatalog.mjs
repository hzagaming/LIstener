import { identifyMusicInput } from '../platforms.mjs'
import { createProviderHttpClient } from '../providerHttpClient.mjs'

const DEFAULT_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const definitions = [
  ['qq', 'QQ Music', ['y.qq.com']],
  ['kugou', 'Kugou Music', ['kugou.com']],
  ['kuwo', 'Kuwo Music', ['kuwo.cn']],
  ['qianqian', 'Qianqian Music', ['music.taihe.com']],
  ['1ting', '1ting Music', ['1ting.com']],
  ['migu', 'Migu Music', ['music.migu.cn', 'h5.nf.migu.cn']],
  ['lizhi', 'Lizhi FM', ['lizhi.fm']],
  ['qingting', 'Qingting FM', ['qingting.fm']],
  ['ximalaya', 'Ximalaya', ['ximalaya.com']],
  ['5sing-original', '5sing Original', ['5sing.kugou.com']],
  ['5sing-cover', '5sing Cover', ['5sing.kugou.com']],
  ['qmkg', 'Quanmin Karaoke', ['kg.qq.com']],
].map(([id, name, domains]) => ({ id, name, domains }))
const definitionById = new Map(definitions.map((definition) => [definition.id, definition]))
const titleSuffix = /\s*[-|_–—]\s*(?:QQ音乐|酷狗音乐|酷我音乐|千千音乐|一听音乐|咪咕音乐|荔枝FM|蜻蜓FM|喜马拉雅|5sing|全民K歌)\s*$/iu
const entities = new Map([['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['quot', '"']])

export const catalogWebSources = definitions.map(({ id }) => id)

const decodeHtml = (value) => String(value ?? '').replace(
  /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi,
  (match, decimal, hexadecimal, named) => {
    const codePoint = decimal ? Number(decimal) : hexadecimal ? Number.parseInt(hexadecimal, 16) : null
    if (codePoint !== null) {
      try { return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match } catch { return match }
    }
    return entities.get(String(named).toLocaleLowerCase()) ?? match
  },
).normalize('NFKC').trim()

const searchTitle = (value, fallback) => decodeHtml(value).replace(titleSuffix, '').trim() || fallback

const queryScope = (selected) => {
  const domains = [...new Set(selected.flatMap(({ domains: values }) => values))]
  const operators = domains.map((domain) => `site:${domain}`)
  return operators.length === 1 ? operators[0] : `(${operators.join(' OR ')})`
}

export const createWebCatalogProvider = ({
  apiKey,
  sources = catalogWebSources,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_SEARCH_URL,
  timeoutMs = 8_000,
  responseLimitBytes = 2_097_152,
  maxRetries = 1,
} = {}) => {
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(normalizedKey)) throw new Error('Brave Search API key is required')
  if (!Array.isArray(sources) || !sources.length || sources.some((source) => !definitionById.has(source))) {
    throw new Error('valid catalog source is required')
  }
  const selected = [...new Set(sources)].map((source) => definitionById.get(source))
  const endpoint = new URL(baseUrl || DEFAULT_SEARCH_URL)
  if (endpoint.origin !== 'https://api.search.brave.com' || endpoint.pathname !== '/res/v1/web/search'
    || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) {
    throw new Error('Brave Search base URL must use the official API')
  }
  const http = createProviderHttpClient({
    allowedHosts: ['api.search.brave.com'],
    fetchImpl,
    timeoutMs,
    maxResponseBytes: responseLimitBytes,
    maxRetries,
  })
  const sourceNames = Object.fromEntries(selected.map(({ id, name }) => [id, name]))

  return {
    id: 'web-catalog',
    name: 'Brave Public Web Catalog',
    sources: selected.map(({ id }) => id),
    sourceNames,
    enabled: true,
    experimental: true,
    official: false,
    maxSearchPages: 10,
    allowedHosts: ['api.search.brave.com'],
    capabilities: { search: true, playback: false, lyrics: false, download: false },

    async search(query, limit = 20, signal, page = 1, requestedSource) {
      const value = query.normalize('NFKC').trim()
      if (!value || page > 10) return []
      const requested = requestedSource ? selected.filter(({ id }) => id === requestedSource) : selected
      if (!requested.length) return []
      const url = new URL(endpoint)
      url.searchParams.set('q', `${value} ${queryScope(requested)}`)
      url.searchParams.set('count', String(Math.min(20, Math.max(1, limit))))
      url.searchParams.set('offset', String(Math.max(0, page - 1)))
      url.searchParams.set('safesearch', 'moderate')
      const payload = await http.json(url, {
        headers: { 'X-Subscription-Token': normalizedKey },
        signal,
      })
      if (payload?.web === undefined) return []
      if (!Array.isArray(payload.web?.results)) throw new Error('invalid Brave Search response')
      const allowedSources = new Set(requested.map(({ id }) => id))
      const seen = new Set()
      return payload.web.results.flatMap((result) => {
        const identified = identifyMusicInput(result?.url)
        if (!identified || !allowedSources.has(identified.source)) return []
        const identity = `${identified.source}:${identified.id}`
        if (seen.has(identity)) return []
        seen.add(identity)
        const definition = definitionById.get(identified.source)
        return [{
          id: identified.id,
          title: searchTitle(result.title, `${definition.name} 公开曲目`),
          artist: definition.name,
          album: 'Brave 公开网页索引',
          duration: 0,
          source: identified.source,
          audioUrl: '',
          cover: 'night',
          sourceUrl: identified.canonicalUrl,
          quality: 'unknown',
          capabilities: { playback: 'none', lyrics: false, download: false },
        }]
      })
    },
  }
}
