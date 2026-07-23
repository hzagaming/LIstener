import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicService } from './musicService.mjs'

const track = (id, title = 'Song') => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  duration: 120,
  source: 'netease',
  audioUrl: '',
  cover: 'night',
})

test('coalesces concurrent searches and caches normalized queries', async () => {
  let calls = 0
  let release
  const provider = {
    id: 'netease',
    async search() {
      calls += 1
      await new Promise((resolve) => { release = resolve })
      return [track('1')]
    },
    async resolve(id) { return `https://audio.example/${id}` },
  }
  const service = createMusicService({ providers: [provider], ttlMs: 1_000 })

  const first = service.search(' Song ', 20)
  const second = service.search('song', 20)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  release()

  assert.deepEqual(await first, [track('1')])
  assert.deepEqual(await second, [track('1')])
  assert.deepEqual(await service.search('SONG', 20), [track('1')])
  assert.equal(calls, 1)
})

test('deduplicates equivalent tracks returned by multiple providers', async () => {
  const providers = [
    { id: 'netease', search: async () => [track('1', ' Same Song ')], resolve: async () => '' },
    { id: 'qq', search: async () => [{ ...track('2', 'same song'), source: 'qq' }], resolve: async () => '' },
  ]
  const service = createMusicService({ providers })

  assert.equal((await service.search('song', 20)).length, 1)
})

test('expires and bounds cached searches', async () => {
  let calls = 0
  let timestamp = 0
  const provider = {
    id: 'netease',
    search: async (query) => { calls += 1; return [track(query)] },
    resolve: async () => '',
  }
  const service = createMusicService({
    providers: [provider],
    ttlMs: 100,
    maxCacheEntries: 1,
    now: () => timestamp,
  })

  await service.search('first')
  await service.search('second')
  await service.search('first')
  assert.equal(calls, 3)

  timestamp = 101
  await service.search('first')
  assert.equal(calls, 4)
})

test('fails when every provider fails so the frontend can use its fallback', async () => {
  const provider = {
    id: 'netease',
    search: async () => { throw new Error('upstream unavailable') },
    resolve: async () => '',
  }
  const service = createMusicService({ providers: [provider] })

  await assert.rejects(() => service.search('song', 20), /all music providers failed/)
})

test('resolves tracks through the requested provider', async () => {
  const service = createMusicService({
    providers: [{ id: 'netease', search: async () => [], resolve: async (id) => `https://audio.example/${id}` }],
  })

  assert.equal(await service.resolve('netease', '42'), 'https://audio.example/42')
  assert.deepEqual(service.sources, ['netease'])
  await assert.rejects(() => service.resolve('qq', '42'), /unknown music source/)
})
