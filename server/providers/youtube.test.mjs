import assert from 'node:assert/strict'
import test from 'node:test'
import { createYouTubeProvider } from './youtube.mjs'

const apiKey = 'listener_youtube_test_key_1234567890'
const videoId = 'dQw4w9WgXcQ'
const video = {
  id: videoId,
  snippet: {
    title: 'Never Gonna Give You Up &amp; More',
    channelTitle: 'Rick Astley',
    thumbnails: {
      high: { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
      maxres: { url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` },
    },
  },
  contentDetails: { duration: 'PT3M33S' },
  status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true },
}

test('searches official YouTube music videos and enriches metadata in one batch', async () => {
  const requests = []
  const provider = createYouTubeProvider({
    apiKey,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      requests.push({ url: parsed, options })
      return parsed.pathname.endsWith('/search')
        ? Response.json({ items: [{ id: { kind: 'youtube#video', videoId } }], nextPageToken: 'NEXT' })
        : Response.json({ items: [video] })
    },
  })

  assert.deepEqual(await provider.search('  Rick Astley  ', 99), [{
    id: videoId,
    title: 'Never Gonna Give You Up & More',
    artist: 'Rick Astley',
    album: 'YouTube Music',
    duration: 213,
    source: 'youtube',
    audioUrl: '',
    cover: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    sourceUrl: `https://music.youtube.com/watch?v=${videoId}`,
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }])

  assert.equal(requests.length, 2)
  const [search, details] = requests.map(({ url }) => url)
  assert.equal(search.origin, 'https://www.googleapis.com')
  assert.equal(search.pathname, '/youtube/v3/search')
  assert.equal(search.searchParams.get('part'), 'snippet')
  assert.equal(search.searchParams.get('type'), 'video')
  assert.equal(search.searchParams.get('videoCategoryId'), '10')
  assert.equal(search.searchParams.get('safeSearch'), 'moderate')
  assert.equal(search.searchParams.get('maxResults'), '50')
  assert.equal(search.searchParams.get('q'), 'Rick Astley')
  assert.equal(search.searchParams.get('key'), apiKey)
  assert.equal(details.pathname, '/youtube/v3/videos')
  assert.equal(details.searchParams.get('part'), 'snippet,contentDetails,status')
  assert.equal(details.searchParams.get('id'), videoId)
  assert.equal(requests.every(({ options }) => options.redirect === 'manual'), true)
  assert.equal(JSON.stringify(await provider.search('', 5)).includes(apiKey), false)
  assert.deepEqual(provider.capabilities, { search: true, playback: false, lyrics: false, download: false })
  assert.equal(provider.maxSearchPages, 1)
  assert.equal(provider.official, true)
})

test('does not spend search quota on unsupported pages', async () => {
  let calls = 0
  const provider = createYouTubeProvider({ apiKey, fetchImpl: async () => { calls += 1; return Response.json({ items: [] }) } })

  assert.deepEqual(await provider.search('music', 20, undefined, 2), [])
  assert.equal(calls, 0)
})

test('looks up public videos and reports invalid or missing IDs', async () => {
  const provider = createYouTubeProvider({ apiKey, fetchImpl: async () => Response.json({ items: [video] }) })
  assert.equal((await provider.lookup(videoId)).duration, 213)
  await assert.rejects(() => provider.lookup('../secret'), /invalid YouTube video id/)

  const missing = createYouTubeProvider({ apiKey, fetchImpl: async () => Response.json({ items: [] }) })
  await assert.rejects(() => missing.lookup(videoId), (error) => {
    assert.equal(error.code, 'TRACK_NOT_FOUND')
    return true
  })
})

test('filters unavailable videos and unsafe metadata without exposing the API key', async () => {
  const provider = createYouTubeProvider({
    apiKey,
    fetchImpl: async (url) => new URL(url).pathname.endsWith('/search')
      ? Response.json({ items: [
        { id: { videoId } },
        { id: { videoId: 'abcdefghijk' } },
        { id: { videoId: 'invalid' } },
      ] })
      : Response.json({ items: [
        { ...video, snippet: { ...video.snippet, thumbnails: { high: { url: 'javascript:alert(1)' } } }, contentDetails: { duration: 'invalid' } },
        { ...video, id: 'abcdefghijk', status: { ...video.status, privacyStatus: 'private' } },
      ] }),
  })

  const results = await provider.search('test')
  assert.equal(results.length, 1)
  assert.equal(results[0].cover, 'night')
  assert.equal(results[0].duration, 0)
  assert.equal(JSON.stringify(results).includes(apiKey), false)

  const failing = createYouTubeProvider({ apiKey, maxRetries: 0, fetchImpl: async (url) => { throw new Error(String(url)) } })
  await assert.rejects(() => failing.search('secret'), (error) => {
    assert.equal(error.message.includes(apiKey), false)
    return true
  })
})

test('rejects malformed responses, API keys, and non-official endpoints', async () => {
  assert.throws(() => createYouTubeProvider(), /API key is required/)
  assert.throws(() => createYouTubeProvider({ apiKey: 'short' }), /API key is required/)
  assert.throws(() => createYouTubeProvider({ apiKey, baseUrl: 'https://evil.example/youtube/v3/' }), /official API/)

  const provider = createYouTubeProvider({ apiKey, fetchImpl: async () => Response.json({ items: null }) })
  await assert.rejects(() => provider.search('test'), /invalid YouTube response/)
})
