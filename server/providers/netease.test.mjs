import assert from 'node:assert/strict'
import test from 'node:test'
import { createNeteaseProvider } from './netease.mjs'

test('normalizes NetEase search results into Track objects', async () => {
  const requests = []
  const provider = createNeteaseProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options })
      return Response.json({
        result: {
          songs: [{
            id: 42,
            name: '白日梦',
            artists: [{ name: '甲' }, { name: '乙' }],
            album: { name: '沿海公路', picUrl: 'https://p1.music.126.net/42.jpg' },
            duration: 213400,
          }],
        },
      })
    },
  })

  const tracks = await provider.search('  白日梦  ', 10)
  const request = requests.find(({ url }) => url.pathname === '/api/search/get/web')

  assert.equal(request.options.method, 'POST')
  assert.match(request.options.body.toString(), /s=%E7%99%BD%E6%97%A5%E6%A2%A6/)
  assert.match(request.options.body.toString(), /offset=0/)
  assert.deepEqual(tracks, [{
    id: '42',
    title: '白日梦',
    artist: '甲 / 乙',
    album: '沿海公路',
    duration: 213,
    source: 'netease',
    audioUrl: '',
    cover: 'https://p1.music.126.net/42.jpg',
    sourceUrl: 'https://music.163.com/#/song?id=42',
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }])
})

test('bounds NetEase pagination and avoids requests for blank searches', async () => {
  let calls = 0
  let body
  const provider = createNeteaseProvider({
    fetchImpl: async (_url, options) => {
      calls += 1
      body = options.body
      return Response.json({ result: { songs: [] }, code: 200 })
    },
  })

  assert.deepEqual(await provider.search('   '), [])
  await provider.search('song', 99, undefined, 3)
  assert.equal(calls, 1)
  assert.equal(body.get('limit'), '50')
  assert.equal(body.get('offset'), '100')
})

test('enriches NetEase search results with one ordered batch detail request', async () => {
  const requests = []
  const provider = createNeteaseProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      requests.push(parsed)
      if (parsed.pathname === '/api/search/get/web') {
        return Response.json({ result: { songs: [
          { id: 1, name: 'one', artists: [], album: { name: 'first' } },
          { id: 2, name: 'two', artists: [], album: { name: 'second' } },
        ] }, code: 200 })
      }
      return Response.json({ code: 200, songs: [
        { id: 2, name: 'two detailed', artists: [], album: { name: 'second', picUrl: 'https://p2.music.126.net/2.jpg' } },
        { id: 1, name: 'one detailed', artists: [], album: { name: 'first', picUrl: 'https://p1.music.126.net/1.jpg' } },
      ] })
    },
  })

  const results = await provider.search('songs', 2)
  assert.deepEqual(results.map(({ id, title, cover }) => [id, title, cover]), [
    ['1', 'one detailed', 'https://p1.music.126.net/1.jpg'],
    ['2', 'two detailed', 'https://p2.music.126.net/2.jpg'],
  ])
  assert.equal(requests.length, 2)
  assert.equal(requests[1].searchParams.get('id'), '1')
  assert.equal(requests[1].searchParams.get('ids'), '[1,2]')
})

test('keeps NetEase search metadata when optional detail enrichment is malformed', async () => {
  let calls = 0
  const provider = createNeteaseProvider({
    fetchImpl: async () => {
      calls += 1
      return calls === 1
        ? Response.json({ result: { songs: [{ id: 1, name: 'one', artists: [], album: { name: 'first' } }] }, code: 200 })
        : Response.json({ code: 200, songs: null })
    },
  })

  const [result] = await provider.search('one')
  assert.equal(result.title, 'one')
  assert.equal(result.cover, 'night')
})

test('looks up NetEase metadata by numeric ID without inventing playback', async () => {
  let request
  const provider = createNeteaseProvider({
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({
        code: 200,
        songs: [{
          id: 42,
          name: '白日梦',
          artists: [{ name: '甲' }],
          album: { name: '沿海公路', picUrl: 'https://p2.music.126.net/42.jpg' },
          duration: 213400,
          mp3Url: null,
        }],
      })
    },
  })

  const track = await provider.lookup('42')
  assert.equal(track.id, '42')
  assert.equal(track.audioUrl, '')
  assert.equal(track.capabilities.playback, 'none')
  assert.equal(request.url.pathname, '/api/song/detail/')
  assert.equal(request.url.searchParams.get('id'), '42')
  assert.equal(request.url.searchParams.get('ids'), '[42]')
  assert.equal(request.options.headers.Referer, 'https://music.163.com/')
  await assert.rejects(() => provider.lookup('../42'), /invalid NetEase track id/)
})

test('rejects mismatched details, unsafe artwork, and unofficial endpoint configuration', async () => {
  const mismatch = createNeteaseProvider({
    fetchImpl: async () => Response.json({ code: 200, songs: [{
      id: 43,
      name: 'other',
      artists: [],
      album: { picUrl: 'https://attacker.example/cover.jpg' },
    }] }),
  })
  await assert.rejects(() => mismatch.lookup('42'), /invalid NetEase response/)

  const unsafeArtwork = createNeteaseProvider({
    fetchImpl: async () => Response.json({ result: { songs: [{
      id: 42,
      name: 'song',
      artists: [],
      album: { picUrl: 'https://attacker.example/cover.jpg' },
    }] } }),
  })
  assert.equal((await unsafeArtwork.search('song'))[0].cover, 'night')

  assert.throws(() => createNeteaseProvider({ searchUrl: 'http://music.163.com/api/search/get/web' }), /HTTPS/)
  assert.throws(() => createNeteaseProvider({ searchUrl: 'https://attacker.example/api/search/get/web' }), /official host/)
  assert.throws(() => createNeteaseProvider({ detailUrl: 'https://music.163.com/playlist' }), /detail path/)
})

test('rejects malformed upstream search responses', async () => {
  const provider = createNeteaseProvider({ fetchImpl: async () => Response.json({ result: {} }) })
  await assert.rejects(() => provider.search('test', 10), /invalid NetEase search response/)
})

test('normalizes malformed and non-finite NetEase durations to zero', async () => {
  const provider = createNeteaseProvider({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          result: {
            songs: [
              { id: 1, name: 'one', artists: [], duration: 'invalid' },
              { id: 2, name: 'two', artists: [], duration: Infinity },
            ],
          },
        }
      },
    }),
  })

  assert.deepEqual((await provider.search('test')).map(({ duration }) => duration), [0, 0])
})

test('reports region-encrypted responses explicitly', async () => {
  const provider = createNeteaseProvider({
    fetchImpl: async () => Response.json({ result: 'encrypted', abroad: true, code: 200 }),
  })
  await assert.rejects(() => provider.search('test', 10), /unavailable in this region/)
})

test('does not expose unverified playback resolution', () => {
  const provider = createNeteaseProvider({ fetchImpl: async () => Response.json({}) })
  assert.equal(provider.capabilities.playback, false)
  assert.equal(provider.resolve, undefined)
})
