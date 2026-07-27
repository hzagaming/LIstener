import assert from 'node:assert/strict'
import test from 'node:test'
import { createNeteaseProvider } from './netease.mjs'

test('normalizes NetEase search results into Track objects', async () => {
  let request
  const provider = createNeteaseProvider({
    fetchImpl: async (url, options) => {
      request = { url, options }
      return Response.json({
        result: {
          songs: [{
            id: 42,
            name: '白日梦',
            artists: [{ name: '甲' }, { name: '乙' }],
            album: { name: '沿海公路', picUrl: 'https://img.example/42.jpg' },
            duration: 213400,
          }],
        },
      })
    },
  })

  const tracks = await provider.search('  白日梦  ', 10)

  assert.equal(request.options.method, 'POST')
  assert.match(request.options.body.toString(), /s=%E7%99%BD%E6%97%A5%E6%A2%A6/)
  assert.deepEqual(tracks, [{
    id: '42',
    title: '白日梦',
    artist: '甲 / 乙',
    album: '沿海公路',
    duration: 213,
    source: 'netease',
    audioUrl: '',
    cover: 'https://img.example/42.jpg',
    sourceUrl: 'https://music.163.com/#/song?id=42',
    quality: 'unknown',
    capabilities: { playback: 'none', lyrics: false, download: false },
  }])
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
