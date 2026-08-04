import assert from 'node:assert/strict'
import test from 'node:test'
import { identifyMusicInput, platformSources } from './platforms.mjs'

const cases = [
  ['https://music.163.com/#/song?id=25906124', 'netease', '25906124'],
  ['https://music.163.com/song/media/outer/url?id=441797.mp3', 'netease', '441797'],
  ['https://y.qq.com/n/yqq/song/002B2EAA3brD5b.html', 'qq', '002B2EAA3brD5b'],
  ['http://www.kugou.com/song/#hash=08228af3cb404e8a4e7e9871bf543ff6', 'kugou', '08228af3cb404e8a4e7e9871bf543ff6'],
  ['https://www.kuwo.cn/play_detail/175264544/', 'kuwo', '175264544'],
  ['https://music.taihe.com/song/266069', 'qianqian', '266069'],
  ['https://www.1ting.com/player/b6/player_357838.html', '1ting', '357838'],
  ['https://music.migu.cn/v3/music/song/477803', 'migu', '477803'],
  ['https://www.lizhi.fm/1947925/2498707770886461446', 'lizhi', '2498707770886461446'],
  ['https://www.qingting.fm/channels/158696/programs/5266259', 'qingting', '158696|5266259'],
  ['https://www.ximalaya.com/51701370/sound/24755731', 'ximalaya', '24755731'],
  ['http://5sing.kugou.com/yc/3082899.html', '5sing-original', '3082899'],
  ['http://5sing.kugou.com/fc/14369766.html', '5sing-cover', '14369766'],
  ['https://kg.qq.com/node/play?s=abc_123', 'qmkg', 'abc_123'],
  ['https://music.apple.com/cn/album/example/123?i=456', 'apple', '456'],
  ['https://musicbrainz.org/recording/026FA041-3917-4C73-9079-ED16E36F20F8', 'musicbrainz', '026fa041-3917-4c73-9079-ed16e36f20f8'],
  ['https://api.audius.co/v1/tracks/D7KyD', 'audius', 'D7KyD'],
  ['https://commons.wikimedia.org/wiki/File:Example.ogg?curid=57480', 'wikimedia', '57480'],
  ['https://commons.wikimedia.org/?curid=57480', 'wikimedia', '57480'],
]

const rawIds = {
  netease: '25906124',
  qq: '002B2EAA3brD5b',
  kugou: '08228af3cb404e8a4e7e9871bf543ff6',
  kuwo: '175264544',
  qianqian: '266069',
  '1ting': '357838',
  migu: '477803',
  lizhi: '2498707770886461446',
  qingting: '158696|5266259',
  ximalaya: '24755731',
  '5sing-original': '3082899',
  '5sing-cover': '14369766',
  qmkg: 'abc_123',
  apple: '456',
  musicbrainz: '026fa041-3917-4c73-9079-ed16e36f20f8',
  audius: 'D7KyD',
  wikimedia: '57480',
}

test('identifies supported platform URLs without fetching them', () => {
  for (const [input, source, id] of cases) {
    const identified = identifyMusicInput(input)
    assert.equal(identified?.source, source, input)
    assert.equal(identified?.id, id, input)
    assert.match(identified?.canonicalUrl ?? '', /^https:\/\//)
  }
})

test('identifies source-qualified raw IDs and rejects ambiguous or malformed values', () => {
  assert.equal(identifyMusicInput('441797'), null)
  assert.equal(identifyMusicInput('441797', 'netease')?.id, '441797')
  assert.equal(identifyMusicInput('158696|5266259', 'qingting')?.id, '158696|5266259')
  assert.equal(identifyMusicInput('../secret', 'netease'), null)
  assert.equal(identifyMusicInput('javascript:alert(1)'), null)
  assert.equal(identifyMusicInput('https://evil.example/music.163.com/song?id=441797'), null)
  assert.equal(identifyMusicInput('123', 'unknown'), null)
})

test('restricts NetEase recognition to track routes and emits canonical URLs', () => {
  assert.equal(identifyMusicInput('https://music.163.com/playlist?id=441797'), null)
  assert.equal(identifyMusicInput('https://music.163.com/album?id=441797'), null)
  assert.equal(identifyMusicInput('https://music.163.com/#/playlist?id=441797'), null)
  assert.deepEqual(identifyMusicInput('http://music.163.com/song?id=441797'), {
    source: 'netease',
    id: '441797',
    canonicalUrl: 'https://music.163.com/#/song?id=441797',
  })
  assert.equal(identifyMusicInput('https://music.163.com/?id=111#/song?id=222')?.id, '222')
  assert.equal(identifyMusicInput('https://music.163.com/?id=#/song?id=222')?.id, '222')
})

test('normalizes mixed-case Kugou hashes before round-tripping', () => {
  const identified = identifyMusicInput('08228AF3CB404E8A4E7E9871BF543FF6', 'kugou')
  assert.deepEqual(identified, {
    source: 'kugou',
    id: '08228af3cb404e8a4e7e9871bf543ff6',
    canonicalUrl: 'https://www.kugou.com/song/#hash=08228af3cb404e8a4e7e9871bf543ff6',
  })
  assert.deepEqual(identifyMusicInput(identified.canonicalUrl), identified)
})

test('round-trips every generated canonical URL and rejects malformed suffixes', () => {
  for (const [source, id] of Object.entries(rawIds)) {
    const generated = identifyMusicInput(id, source)
    assert.deepEqual(identifyMusicInput(generated?.canonicalUrl), generated, source)
    assert.equal(identifyMusicInput(`${generated?.canonicalUrl}.evil`), null, source)
  }
})

test('publishes every supported platform identifier exactly once', () => {
  assert.equal(new Set(platformSources).size, platformSources.length)
  assert.deepEqual(platformSources, [
    'netease', 'qq', 'kugou', 'kuwo', 'qianqian', '1ting', 'migu', 'lizhi',
    'qingting', 'ximalaya', '5sing-original', '5sing-cover', 'qmkg', 'apple',
    'musicbrainz', 'audius', 'wikimedia',
  ])
})
