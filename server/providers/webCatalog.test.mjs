import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogWebSources, createWebCatalogProvider } from './webCatalog.mjs'

const apiKey = 'listener_brave_search_test_key_1234567890'

test('searches public platform pages through the official Brave Search API', async () => {
  const requests = []
  const provider = createWebCatalogProvider({
    apiKey,
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options })
      return Response.json({
        query: { more_results_available: true },
        web: { results: [
          { title: '晴天 - 周杰伦 &amp; Friends - QQ音乐', url: 'https://y.qq.com/n/ryqq/songDetail/002B2EAA3brD5b' },
          { title: '晴天 - 酷狗音乐', url: 'https://www.kugou.com/song/#hash=08228af3cb404e8a4e7e9871bf543ff6' },
          { title: '不是歌曲页', url: 'https://y.qq.com/n/ryqq/playlist/123' },
          { title: '外站结果', url: 'https://evil.example/song/1' },
        ] },
      })
    },
  })

  const results = await provider.search('  晴天  ', 99, undefined, 1)

  assert.deepEqual(results.map(({ source, id, title }) => [source, id, title]), [
    ['qq', '002B2EAA3brD5b', '晴天 - 周杰伦 & Friends'],
    ['kugou', '08228af3cb404e8a4e7e9871bf543ff6', '晴天'],
  ])
  assert.equal(results.every((track) => track.audioUrl === '' && track.capabilities.playback === 'none'), true)
  assert.deepEqual(provider.sources, catalogWebSources)
  assert.equal(provider.experimental, true)
  assert.equal(provider.official, false)
  assert.equal(provider.maxSearchPages, 10)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url.origin, 'https://api.search.brave.com')
  assert.equal(requests[0].url.pathname, '/res/v1/web/search')
  assert.equal(requests[0].url.searchParams.get('count'), '20')
  assert.equal(requests[0].url.searchParams.get('offset'), '0')
  assert.match(requests[0].url.searchParams.get('q'), /^晴天 \(site:y\.qq\.com.+site:kg\.qq\.com\)$/)
  assert.equal(requests[0].options.headers['X-Subscription-Token'], apiKey)
})

test('supports source-specific search and bounded Brave pagination', async () => {
  const requests = []
  const provider = createWebCatalogProvider({
    apiKey,
    sources: ['qq', '5sing-cover'],
    fetchImpl: async (url) => {
      requests.push(new URL(url))
      return Response.json({ web: { results: [
        { title: '翻唱作品 | 5sing', url: 'https://5sing.kugou.com/fc/14369766.html' },
        { title: '原创作品 | 5sing', url: 'https://5sing.kugou.com/yc/3082899.html' },
      ] } })
    },
  })

  const results = await provider.search('作品', 5, undefined, 10, '5sing-cover')
  assert.deepEqual(results.map(({ source, id }) => [source, id]), [['5sing-cover', '14369766']])
  assert.equal(requests[0].searchParams.get('offset'), '9')
  assert.equal(requests[0].searchParams.get('count'), '5')
  assert.equal(requests[0].searchParams.get('q'), '作品 site:5sing.kugou.com')
  assert.deepEqual(await provider.search('作品', 5, undefined, 11), [])
  assert.equal(requests.length, 1)
})

test('rejects unsafe configuration and malformed responses without leaking the key', async () => {
  assert.throws(() => createWebCatalogProvider(), /Brave Search API key is required/)
  assert.throws(() => createWebCatalogProvider({ apiKey: 'short' }), /Brave Search API key is required/)
  assert.throws(() => createWebCatalogProvider({ apiKey, baseUrl: 'https://evil.example/search' }), /official API/)
  assert.throws(() => createWebCatalogProvider({ apiKey, sources: ['unknown'] }), /catalog source/)

  const malformed = createWebCatalogProvider({ apiKey, fetchImpl: async () => Response.json({ web: { results: null } }) })
  await assert.rejects(() => malformed.search('test'), /invalid Brave Search response/)

  const failing = createWebCatalogProvider({ apiKey, maxRetries: 0, fetchImpl: async () => { throw new Error(apiKey) } })
  await assert.rejects(() => failing.search('test'), (error) => {
    assert.equal(error.message.includes(apiKey), false)
    return true
  })
})
