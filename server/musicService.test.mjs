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

test('keeps a coalesced search alive until its last subscriber cancels', async () => {
  let calls = 0
  let providerSignal
  let markStarted
  let releaseFirst
  const started = new Promise((resolve) => { markStarted = resolve })
  const provider = {
    id: 'netease',
    async search(_query, _limit, signal) {
      calls += 1
      if (calls > 1) return [track('2')]
      providerSignal = signal
      markStarted()
      return new Promise((resolve, reject) => {
        releaseFirst = resolve
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  }
  const service = createMusicService({ providers: [provider] })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = service.search('song', 20, firstController.signal)
  const second = service.search('SONG', 20, secondController.signal)
  const firstOutcome = first.then(() => null, (error) => error)
  const secondOutcome = second.then(() => null, (error) => error)
  await started

  try {
    firstController.abort(new Error('first cancelled'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(providerSignal.aborted, false)

    secondController.abort(new Error('second cancelled'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(providerSignal.aborted, true)
    assert.match((await firstOutcome).message, /first cancelled/)
    assert.match((await secondOutcome).message, /second cancelled/)
    assert.deepEqual(await service.search('song'), [track('2')])
    assert.equal(calls, 2)
  } finally {
    releaseFirst?.([])
    await Promise.allSettled([first, second])
  }
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

test('fails when an empty aggregate includes a provider outage', async () => {
  const service = createMusicService({
    providers: [
      { id: 'empty', search: async () => [] },
      { id: 'offline', search: async () => { throw new Error('upstream unavailable') } },
    ],
  })

  await assert.rejects(() => service.search('song', 20), /all music providers failed/)
})

test('fails when an empty aggregate includes an invalid provider response', async () => {
  const service = createMusicService({
    providers: [
      { id: 'empty', search: async () => [] },
      { id: 'invalid', search: async () => null },
    ],
  })

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

test('immediately cancels resolve providers whether they observe or ignore aborts', async () => {
  const signals = []
  const never = (_id, signal) => {
    signals.push(signal)
    return new Promise(() => {})
  }
  const observesAbort = (_id, signal) => {
    signals.push(signal)
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
  const service = createMusicService({
    providerTimeoutMs: 1_000,
    providers: [
      { id: 'ignores', search: async () => [], resolve: never },
      { id: 'observes', search: async () => [], resolve: observesAbort },
    ],
  })

  for (const source of ['ignores', 'observes']) {
    const controller = new AbortController()
    const pending = service.resolve(source, '42', controller.signal)
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort(new Error(`${source} cancelled`))
    await assert.rejects(
      () => Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 50)),
      ]),
      new RegExp(`${source} cancelled`),
    )
  }

  assert.equal(signals.length, 2)
  assert.equal(signals.every((signal) => signal.aborted), true)
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

test('does not cache partial results while a provider is unavailable', async () => {
  let healthyCalls = 0
  let recoveringCalls = 0
  const service = createMusicService({
    providers: [
      {
        id: 'healthy',
        search: async () => { healthyCalls += 1; return [{ ...track('1'), source: 'healthy' }] },
      },
      {
        id: 'recovering',
        search: async () => {
          recoveringCalls += 1
          if (recoveringCalls === 1) throw new Error('temporary outage')
          return [{ ...track('2'), source: 'recovering' }]
        },
      },
    ],
  })

  assert.deepEqual((await service.search('song')).map(({ source }) => source), ['healthy'])
  assert.deepEqual((await service.search('song')).map(({ source }) => source), ['healthy', 'recovering'])
  assert.equal(healthyCalls, 2)
  assert.equal(recoveringCalls, 2)
})

test('does not evict healthy cache entries for partial results', async () => {
  let healthyCalls = 0
  const service = createMusicService({
    maxCacheEntries: 1,
    providers: [
      {
        id: 'healthy',
        search: async (query) => {
          healthyCalls += 1
          return [{ ...track(query), source: 'healthy' }]
        },
      },
      {
        id: 'unstable',
        search: async (query) => {
          if (query === 'partial') throw new Error('temporary outage')
          return []
        },
      },
    ],
  })

  await service.search('stable')
  await service.search('partial')
  await service.search('stable')
  assert.equal(healthyCalls, 2)
})

test('does not cache mixed valid and malformed provider results', async () => {
  let calls = 0
  const service = createMusicService({
    providers: [{
      id: 'mixed',
      search: async () => {
        calls += 1
        return [{ ...track('1'), source: 'mixed' }, { id: 'malformed' }]
      },
    }],
  })

  await service.search('song')
  await service.search('song')
  assert.equal(calls, 2)
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

test('cancels lookup, lyrics, and download with the caller signal', async () => {
  const signals = []
  const never = (_id, signal) => {
    signals.push(signal)
    return new Promise(() => {})
  }
  const service = createMusicService({
    providerTimeoutMs: 1_000,
    providers: [{
      id: 'slow',
      capabilities: { search: true, playback: true, lyrics: true, download: true },
      search: async () => [],
      lookup: never,
      lyrics: never,
      download: never,
    }],
  })

  for (const operation of [service.lookup, service.lyrics, service.download]) {
    const controller = new AbortController()
    const pending = operation('slow', '7', controller.signal)
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort(new Error('client cancelled'))
    await assert.rejects(() => Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('test guard expired')), 50)),
    ]), /client cancelled/)
  }
  assert.equal(signals.length, 3)
  assert.equal(signals.every((signal) => signal.aborted), true)
})

test('validates resolved URLs and looked-up tracks at the service boundary', async () => {
  const invalidUrl = createMusicService({
    providers: [{ id: 'unsafe', search: async () => [], resolve: async () => 'javascript:alert(1)' }],
  })
  await assert.rejects(() => invalidUrl.resolve('unsafe', '1'), /invalid resolved media URL/)

  const invalidTrack = createMusicService({
    providers: [{ id: 'safe', search: async () => [], lookup: async () => ({ ...track('1'), source: 'spoofed' }) }],
  })
  await assert.rejects(() => invalidTrack.lookup('safe', '1'), /invalid provider track/)
})

test('rejects malformed download descriptors consistently', async () => {
  const service = createMusicService({
    providers: [{
      id: 'download',
      capabilities: { download: true },
      download: async () => ({ url: 'not a URL', filename: 'track.mp3' }),
    }],
  })

  await assert.rejects(() => service.download('download', '1'), /invalid download descriptor/)
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

test('gates playback for metadata-only providers', async () => {
  const service = createMusicService({ providers: [{
    id: 'metadata',
    capabilities: { search: true, playback: false, lyrics: false, download: false },
    search: async () => [],
  }] })

  assert.equal(service.sourceCapabilities.metadata.playback, false)
  await assert.rejects(() => service.resolve('metadata', '1'), /playback is unavailable/)
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
