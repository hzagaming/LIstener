import assert from 'node:assert/strict'
import test from 'node:test'
import { createWikimediaProvider } from './wikimedia.mjs'

const page = {
  pageid: 57480,
  title: 'File:Beethoven - Moonlight sonata.ogg',
  imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Moonlight.ogg?utm_source=test&download=1',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Beethoven_-_Moonlight_sonata.ogg?utm_campaign=test',
    mime: 'application/ogg',
    user: 'Open Music Archive',
    extmetadata: { Duration: { value: '301.4' } },
  }],
}

test('searches Wikimedia Commons audio with bounded pagination and normalizes playable files', async () => {
  let request
  const provider = createWikimediaProvider({
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return Response.json({ query: { pages: [page] } })
    },
  })

  assert.deepEqual(await provider.search('  Beethoven  ', 99, undefined, 3), [{
    id: '57480',
    title: 'Beethoven - Moonlight sonata',
    artist: 'Open Music Archive',
    album: 'Wikimedia Commons',
    duration: 0,
    source: 'wikimedia',
    audioUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Moonlight.ogg?download=1',
    cover: 'gold',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Beethoven_-_Moonlight_sonata.ogg',
    quality: 'standard',
    capabilities: { playback: 'full', lyrics: false, download: false },
  }])
  assert.equal(request.url.origin, 'https://commons.wikimedia.org')
  assert.equal(request.url.pathname, '/w/api.php')
  assert.equal(request.url.searchParams.get('action'), 'query')
  assert.equal(request.url.searchParams.get('generator'), 'search')
  assert.equal(request.url.searchParams.get('gsrsearch'), 'Beethoven filetype:audio')
  assert.equal(request.url.searchParams.get('gsrnamespace'), '6')
  assert.equal(request.url.searchParams.get('gsrlimit'), '10')
  assert.equal(request.url.searchParams.get('gsroffset'), '20')
  assert.equal(request.url.searchParams.get('iiprop'), 'url|mime|user')
  assert.equal(request.url.searchParams.get('maxage'), '300')
  assert.equal(request.url.searchParams.get('smaxage'), '300')
  assert.equal(request.url.searchParams.get('formatversion'), '2')
  assert.equal(request.url.searchParams.get('origin'), '*')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.headers['User-Agent'], 'Listener/0.4.23 (+https://github.com/hzagaming/LIstener)')
  assert.equal(provider.capabilities.playback, true)
  assert.equal(provider.capabilities.download, false)
  assert.equal(provider.maxSearchResults, 10)
})

test('accepts audio MIME types and filters non-audio or untrusted Wikimedia fields', async () => {
  const provider = createWikimediaProvider({
    fetchImpl: async () => Response.json({ query: { pages: [
      { ...page, pageid: 1, imageinfo: [{ ...page.imageinfo[0], mime: 'audio/mpeg', url: 'https://upload.wikimedia.org/audio.mp3' }] },
      { ...page, pageid: 2, imageinfo: [{ ...page.imageinfo[0], mime: 'application/ogg', url: 'https://upload.wikimedia.org/audio.txt' }] },
      { ...page, pageid: 3, imageinfo: [{ ...page.imageinfo[0], mime: 'image/jpeg', url: 'https://upload.wikimedia.org/cover.jpg' }] },
      { ...page, pageid: 4, imageinfo: [{ ...page.imageinfo[0], url: 'https://attacker.example/audio.ogg' }] },
      { ...page, pageid: 5, imageinfo: [{ ...page.imageinfo[0], descriptionurl: 'https://attacker.example/source' }] },
      { ...page, pageid: 'not-an-id' },
    ] } }),
  })

  assert.deepEqual((await provider.search('audio')).map(({ id }) => id), ['1'])
})

test('looks up and resolves Wikimedia page IDs without accepting mismatched responses', async () => {
  const requests = []
  const provider = createWikimediaProvider({
    fetchImpl: async (url) => {
      requests.push(new URL(url))
      return Response.json({ query: { pages: [page] } })
    },
  })

  assert.equal((await provider.lookup('57480')).id, '57480')
  assert.equal(await provider.resolve('57480'), 'https://upload.wikimedia.org/wikipedia/commons/6/6f/Moonlight.ogg?download=1')
  assert.equal(requests[0].searchParams.get('pageids'), '57480')
  assert.equal(requests[0].searchParams.has('generator'), false)
  await assert.rejects(() => provider.lookup('../57480'), /invalid Wikimedia track id/)

  const mismatch = createWikimediaProvider({
    fetchImpl: async () => Response.json({ query: { pages: [{ ...page, pageid: 57481 }] } }),
  })
  await assert.rejects(() => mismatch.lookup('57480'), /invalid Wikimedia response/)
})

test('rejects malformed responses and unsafe API configuration without requesting blank searches', async () => {
  assert.throws(() => createWikimediaProvider({ baseUrl: 'http://commons.wikimedia.org/w/api.php' }), /HTTPS/)
  assert.throws(() => createWikimediaProvider({ baseUrl: 'https://user:pass@commons.wikimedia.org/w/api.php' }), /HTTPS/)
  assert.throws(() => createWikimediaProvider({ baseUrl: 'https://evil.example/w/api.php' }), /official host/)
  assert.throws(() => createWikimediaProvider({ baseUrl: 'https://commons.wikimedia.org/wiki/Main_Page' }), /API path/)

  let calls = 0
  const provider = createWikimediaProvider({
    fetchImpl: async () => { calls += 1; return Response.json({ query: { pages: null } }) },
  })
  assert.deepEqual(await provider.search('   '), [])
  assert.equal(calls, 0)
  await assert.rejects(() => provider.search('test'), /invalid Wikimedia response/)
})
