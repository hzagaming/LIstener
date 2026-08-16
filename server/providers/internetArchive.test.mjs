import assert from 'node:assert/strict'
import test from 'node:test'
import { createInternetArchiveProvider } from './internetArchive.mjs'

const openItem = {
  metadata: {
    identifier: 'open-concert',
    mediatype: 'audio',
    title: 'Open Concert',
    creator: ['Open Artist'],
    licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  files: [
    { name: '01 Song.mp3', title: 'Song One', artist: 'File Artist', format: 'VBR MP3', size: '12345', length: '3:05' },
    { name: '02 Song.ogg', format: 'Ogg Vorbis', size: '23456', length: '62.4' },
    { name: '03 Song.flac', format: 'Flac', size: '34567' },
    { name: 'cover.jpg', format: 'JPEG', size: '1234' },
  ],
}

const responseFor = (input) => {
  const url = new URL(input)
  if (url.pathname === '/advancedsearch.php') {
    return Response.json({ response: { numFound: 1, docs: [{
      identifier: 'open-concert', mediatype: 'audio', title: 'Open Concert', creator: 'Open Artist',
    }] } })
  }
  if (url.pathname === '/metadata/open-concert') return Response.json(openItem)
  throw new Error(`unexpected request: ${url}`)
}

test('searches Archive audio items and expands safe browser-playable files', async () => {
  const requests = []
  const provider = createInternetArchiveProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options })
      return responseFor(url)
    },
  })

  const tracks = await provider.search('  public concert  ', 99, undefined, 3)

  assert.deepEqual(tracks.map(({ id }) => id), [
    'open-concert/01%20Song.mp3',
    'open-concert/02%20Song.ogg',
    'open-concert/03%20Song.flac',
  ])
  assert.deepEqual(tracks[0], {
    id: 'open-concert/01%20Song.mp3',
    title: 'Song One',
    artist: 'File Artist',
    album: 'Open Concert',
    duration: 185,
    source: 'internetarchive',
    audioUrl: 'https://archive.org/download/open-concert/01%20Song.mp3',
    cover: 'gold',
    sourceUrl: 'https://archive.org/details/open-concert',
    quality: 'standard',
    capabilities: { playback: 'full', lyrics: false, download: true },
  })
  assert.equal(tracks[2].quality, 'lossless')
  const search = requests[0]
  assert.equal(search.url.origin, 'https://archive.org')
  assert.equal(search.url.pathname, '/advancedsearch.php')
  assert.equal(search.url.searchParams.get('q'), '(title:"public concert" OR creator:"public concert") AND mediatype:audio AND NOT access-restricted-item:true')
  assert.deepEqual(search.url.searchParams.getAll('fl[]'), ['identifier', 'mediatype', 'title', 'creator'])
  assert.equal(search.url.searchParams.get('rows'), '10')
  assert.equal(search.url.searchParams.get('page'), '3')
  assert.equal(search.url.searchParams.get('output'), 'json')
  assert.equal(search.options.redirect, 'manual')
  assert.equal(search.options.headers['User-Agent'], 'Listener/1.0.0 (+https://github.com/hzagaming/LIstener)')
  assert.equal(provider.maxSearchResults, 10)
  assert.deepEqual(provider.capabilities, { search: true, playback: true, lyrics: false, download: true })
})

test('keeps public playback but only advertises downloads for explicit open licenses', async () => {
  const unsafeFiles = [
    { name: '../escape.mp3', format: 'VBR MP3', size: '100' },
    { name: '..／unicode-escape.mp3', format: 'VBR MP3', size: '100' },
    { name: 'oversized.mp3', format: 'VBR MP3', size: String(134_217_729) },
    { name: 'fake.txt', format: 'VBR MP3', size: '100' },
    { name: 'safe.mp3', format: 'VBR MP3', size: '100' },
  ]
  const provider = createInternetArchiveProvider({
    fetchImpl: async (input) => {
      const url = new URL(input)
      if (url.pathname === '/advancedsearch.php') return Response.json({ response: { docs: [
        { identifier: 'closed-audio', mediatype: 'audio' },
        { identifier: 'movie-item', mediatype: 'movies' },
        { identifier: '../unsafe', mediatype: 'audio' },
      ] } })
      return Response.json({
        metadata: { identifier: 'closed-audio', mediatype: 'audio', title: 'Unclear Rights' },
        files: unsafeFiles,
      })
    },
  })

  const tracks = await provider.search('audio', 10)

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].audioUrl, 'https://archive.org/download/closed-audio/safe.mp3')
  assert.deepEqual(tracks[0].capabilities, { playback: 'full', lyrics: false, download: false })
  await assert.rejects(() => provider.download(tracks[0].id), (error) => error.code === 'CAPABILITY_UNAVAILABLE')
})

test('looks up, resolves, and downloads exact Archive files without trusting caller URLs', async () => {
  const requests = []
  const provider = createInternetArchiveProvider({
    fetchImpl: async (input) => {
      requests.push(new URL(input))
      return Response.json(openItem)
    },
  })

  assert.equal((await provider.lookup('open-concert')).id, 'open-concert/01%20Song.mp3')
  assert.equal((await provider.lookup('open-concert/02%20Song.ogg')).title, '02 Song')
  assert.equal(await provider.resolve('open-concert/02%20Song.ogg'), 'https://archive.org/download/open-concert/02%20Song.ogg')
  assert.deepEqual(await provider.download('open-concert/02%20Song.ogg'), {
    url: 'https://archive.org/download/open-concert/02%20Song.ogg',
    filename: '02 Song.ogg',
  })
  assert.equal(requests.every((url) => url.pathname === '/metadata/open-concert'), true)
  await assert.rejects(() => provider.lookup('../open-concert'), /invalid Internet Archive track id/)
  await assert.rejects(() => provider.lookup('open-concert/%2Fetc.mp3'), /invalid Internet Archive track id/)
})

test('rejects unsafe API configuration and malformed Archive responses', async () => {
  assert.throws(() => createInternetArchiveProvider({ baseUrl: 'http://archive.org' }), /HTTPS/)
  assert.throws(() => createInternetArchiveProvider({ baseUrl: 'https://user:pass@archive.org' }), /HTTPS/)
  assert.throws(() => createInternetArchiveProvider({ baseUrl: 'https://evil.example' }), /official host/)
  assert.throws(() => createInternetArchiveProvider({ baseUrl: 'https://archive.org/details' }), /origin/)

  let calls = 0
  const provider = createInternetArchiveProvider({
    fetchImpl: async () => { calls += 1; return Response.json({ response: { docs: null } }) },
  })
  assert.deepEqual(await provider.search('   '), [])
  assert.equal(calls, 0)
  await assert.rejects(() => provider.search('test'), /invalid Internet Archive response/)
})
