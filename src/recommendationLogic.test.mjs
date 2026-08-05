import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeRecommendationPages, nextPlayableRecommendation, recommendationSeed, rankRecommendations,
  shouldPrefetchRecommendations,
} from './recommendationLogic.mjs'

const track = (id, artist, album, playback = 'none', source = 'netease', title = id) => ({
  id, title, artist, album, source, capabilities: { playback },
})

test('chooses the most representative concrete artist as the recommendation seed', () => {
  const seed = recommendationSeed([
    track('1', '周杰伦 / 温岚', 'A'),
    track('2', '周杰伦', 'B'),
    track('3', '未知歌手', 'C'),
    track('4', '林俊杰', 'D'),
  ])

  assert.deepEqual(seed, { query: '周杰伦', label: '周杰伦' })
  assert.equal(recommendationSeed([track('1', '甲 feat. 乙', 'A'), track('2', '甲', 'B')]).query, '甲')
  assert.equal(recommendationSeed([track('1', '未知歌手', '叶惠美')]).query, '叶惠美')
  assert.equal(recommendationSeed([]), null)
})

test('ranks explainable similar tracks while excluding playlist songs and previews', () => {
  const seeds = [
    track('seed-1', '周杰伦', '叶惠美', 'none', 'netease', '晴天'),
    track('seed-2', '周杰伦 / 温岚', '寻找周杰伦', 'none', 'netease', '屋顶'),
  ]
  const candidates = [
    track('preview', '周杰伦', '叶惠美', 'preview', 'apple', '东风破'),
    track('same-song', '周杰伦', '其他版本', 'none', 'apple', '晴天'),
    track('album', '其他歌手', '叶惠美', 'full', 'wikimedia', '专辑曲'),
    track('artist', '周杰伦', '七里香', 'none', 'netease', '七里香'),
    track('artist-copy', '周杰伦', '七里香', 'none', 'musicbrainz', '七里香'),
    track('both', '周杰伦', '叶惠美', 'none', 'netease', '以父之名'),
    track('unrelated', '林俊杰', '编号89757', 'full', 'wikimedia', '一千年以后'),
    track('artist', '周杰伦', '七里香', 'none', 'netease', '七里香重复'),
    track('generated', '周杰伦', '叶惠美', 'full', 'demo', '模拟歌曲'),
    track('fixture', '周杰伦', '叶惠美', 'full', 'fixture', '测试歌曲'),
  ]

  const ranked = rankRecommendations(seeds, candidates, 10)

  assert.deepEqual(ranked.map(({ track: item }) => item.id), ['both', 'artist', 'album'])
  assert.deepEqual(ranked.map(({ reason }) => reason), ['同歌手 · 同专辑', '同歌手', '同专辑'])
})

test('bounds recommendation output and returns no unrelated candidates', () => {
  const seeds = [track('seed', '甲', '专辑')]
  const candidates = Array.from({ length: 20 }, (_, index) => track(String(index), '甲', `专辑 ${index}`))

  assert.equal(rankRecommendations(seeds, candidates, 6).length, 6)
  assert.deepEqual(rankRecommendations(seeds, [track('other', '乙', '其他')]), [])
})

test('merges real recommendation pages without repeating existing identities', () => {
  const seeds = [track('seed', '甲', '专辑')]
  const first = rankRecommendations(seeds, [
    track('1', '甲', 'A', 'none', 'netease', '第一首'),
    track('2', '甲', 'B', 'full', 'wikimedia', '第二首'),
  ])
  const merged = mergeRecommendationPages(seeds, first, [
    track('copy', '甲', 'A', 'none', 'musicbrainz', '第一首'),
    track('3', '甲', 'C', 'full', 'wikimedia', '第三首'),
  ])

  assert.deepEqual(merged.map(({ track: item }) => item.id), ['1', '2', '3'])
})

test('selects only new full tracks for uninterrupted recommendation playback', () => {
  const queue = [track('1', '甲', 'A', 'full'), track('2', '甲', 'B', 'full')]
  const recommendations = [
    { track: track('2', '甲', 'B', 'full'), reason: '同歌手' },
    { track: track('3', '甲', 'C', 'none'), reason: '同歌手' },
    { track: track('4', '甲', 'D', 'preview'), reason: '同歌手' },
    { track: track('5', '甲', 'E', 'full', 'wikimedia'), reason: '同歌手' },
  ]

  assert.equal(nextPlayableRecommendation(queue, recommendations).id, '5')
  assert.equal(nextPlayableRecommendation([...queue, recommendations[3].track], recommendations), null)
})

test('prefetches near the queue end only for an active continuous playlist', () => {
  assert.equal(shouldPrefetchRecommendations({ continuous: true, currentIndex: 3, queueLength: 5, hasMore: true, loading: false }), true)
  assert.equal(shouldPrefetchRecommendations({ continuous: true, currentIndex: 1, queueLength: 5, hasMore: true, loading: false }), false)
  assert.equal(shouldPrefetchRecommendations({ continuous: false, currentIndex: 4, queueLength: 5, hasMore: true, loading: false }), false)
  assert.equal(shouldPrefetchRecommendations({ continuous: true, currentIndex: 4, queueLength: 5, hasMore: false, loading: false }), false)
  assert.equal(shouldPrefetchRecommendations({ continuous: true, currentIndex: 4, queueLength: 5, hasMore: true, loading: true }), false)
  assert.equal(shouldPrefetchRecommendations({ continuous: true, currentIndex: 4, queueLength: 5, hasMore: true, loading: false, requestKey: 'playlist:track', lastRequestKey: 'playlist:track' }), false)
})
