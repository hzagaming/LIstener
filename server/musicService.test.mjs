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
  sourceUrl: `https://music.example/${id}`,
  quality: 'unknown',
  capabilities: { playback: 'full', lyrics: false, download: false },
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

test('keeps equivalent tracks from different providers but removes exact source duplicates', async () => {
  const providers = [
    { id: 'netease', search: async () => [track('1', ' Same Song '), track('1', ' Same Song ')], resolve: async () => '' },
    { id: 'qq', search: async () => [{ ...track('2', 'same song'), source: 'qq' }], resolve: async () => '' },
  ]
  const service = createMusicService({ providers })

  assert.equal((await service.search('song', 20)).length, 2)
})

test('interleaves provider results so one source cannot fill the entire limit', async () => {
  const providers = [
    { id: 'netease', search: async () => [track('1'), track('2'), track('3')], resolve: async () => '' },
    { id: 'qq', search: async () => [
      { ...track('4'), source: 'qq' },
      { ...track('5'), source: 'qq' },
      { ...track('6'), source: 'qq' },
    ], resolve: async () => '' },
  ]
  const service = createMusicService({ providers })

  assert.deepEqual((await service.search('song', 4)).map(({ source, id }) => `${source}:${id}`), [
    'netease:1', 'qq:4', 'netease:2', 'qq:5',
  ])
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

test('bounds slow providers and still returns results from healthy sources', async () => {
  let aborted = false
  const service = createMusicService({
    providerTimeoutMs: 5,
    providers: [
      { id: 'netease', search: async (_query, _limit, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
      }), resolve: async () => '' },
      { id: 'qq', search: async () => [{ ...track('2'), source: 'qq' }], resolve: async () => '' },
    ],
  })

  assert.deepEqual(await service.search('song'), [{ ...track('2'), source: 'qq' }])
  assert.equal(aborted, true)
})

test('isolates invalid fulfilled provider search outputs', async () => {
  const service = createMusicService({
    providers: [
      { id: 'null', search: async () => null },
      { id: 'malformed', search: async () => [{ id: 'missing-track-fields' }] },
      { id: 'mismatch', search: async () => [{ ...track('3'), source: 'spoofed' }] },
      { id: 'healthy', search: async () => [{ ...track('2'), source: 'healthy' }] },
    ],
  })

  assert.deepEqual(await service.search('song'), [{ ...track('2'), source: 'healthy' }])

  const invalid = createMusicService({
    providers: [
      { id: 'null', search: async () => null },
      { id: 'malformed', search: async () => [{ id: 'missing-track-fields' }] },
    ],
  })
  await assert.rejects(() => invalid.search('song'), /all music providers failed/)
})

test('times out every non-search provider operation and passes its abort signal', async () => {
  const signals = []
  const never = (_id, signal) => {
    signals.push(signal)
    return new Promise(() => {})
  }
  const service = createMusicService({
    providerTimeoutMs: 5,
    providers: [{
      id: 'slow',
      capabilities: { search: true, playback: true, lyrics: true, download: true },
      search: async () => [],
      resolve: never,
      lookup: never,
      lyrics: never,
      download: never,
    }],
  })
  const guard = (operation) => Promise.race([
    operation(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 50)),
  ])

  for (const operation of [service.resolve, service.lookup, service.lyrics, service.download]) {
    await assert.rejects(() => guard(() => operation('slow', '7')), /music provider timed out/)
  }
  assert.equal(signals.length, 4)
  assert.equal(signals.every((signal) => signal instanceof AbortSignal && signal.aborted), true)
})

test('keeps lyrics and download disabled unless explicitly declared', async () => {
  const provider = {
    id: 'implicit',
    search: async () => [],
    resolve: async () => '',
    lyrics: async () => ({ plain: '', lrc: '' }),
    download: async () => ({ url: 'https://example.com/1', filename: '1.mp3' }),
  }
  const service = createMusicService({ providers: [provider] })

  assert.deepEqual(service.sourceCapabilities.implicit, {
    search: true,
    playback: true,
    lyrics: false,
    download: false,
  })
  await assert.rejects(() => service.lyrics('implicit', '1'), /lyrics are unavailable/)
  await assert.rejects(() => service.download('implicit', '1'), /download is unavailable/)
})

test('exposes provider capabilities and gates lyrics and downloads', async () => {
  const provider = {
    id: 'licensed',
    capabilities: { search: true, playback: true, lyrics: true, download: true },
    search: async () => [],
    resolve: async () => '',
    lookup: async (id) => ({ ...track(id), source: 'licensed' }),
    lyrics: async (id) => ({ lrc: `[00:00.00] Track ${id}`, plain: `Track ${id}` }),
    download: async (id) => ({ url: `https://licensed.example/${id}.flac`, filename: `${id}.flac` }),
  }
  const limited = {
    id: 'preview',
    capabilities: { search: true, playback: true, lyrics: false, download: false },
    search: async () => [],
    resolve: async () => '',
  }
  const service = createMusicService({ providers: [provider, limited] })

  assert.deepEqual(service.sourceCapabilities, {
    licensed: provider.capabilities,
    preview: limited.capabilities,
  })
  assert.deepEqual(await service.lyrics('licensed', '7'), { lrc: '[00:00.00] Track 7', plain: 'Track 7' })
  assert.deepEqual(await service.download('licensed', '7'), {
    url: 'https://licensed.example/7.flac',
    filename: '7.flac',
  })
  assert.deepEqual(await service.lookup('licensed', '7'), { ...track('7'), source: 'licensed' })
  await assert.rejects(() => service.lyrics('preview', '7'), /lyrics are unavailable/)
  await assert.rejects(() => service.download('preview', '7'), /download is unavailable/)
  await assert.rejects(() => service.lookup('preview', '7'), /track lookup is unavailable/)
})
