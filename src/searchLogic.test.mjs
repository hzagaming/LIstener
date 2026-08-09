import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSearchFallbackError, diversifyRankedTracks, filterTracksByPlayback, parseSearchPage, prioritizePlayableTracks, refineSearchTracks,
  searchFallbackTracks, searchInputMode,
} from './searchLogic.mjs'

test('carries fallback results without disguising an upstream search failure', () => {
  const tracks = [{ id: 'demo-1' }]
  const error = createSearchFallbackError(tracks)

  assert.equal(error.code, 'SEARCH_FALLBACK')
  assert.equal(error.message, 'aggregated search is unavailable')
  assert.equal(searchFallbackTracks(error), tracks)
})

test('does not treat unrelated failures as demo fallback results', () => {
  assert.equal(searchFallbackTracks(new Error('cancelled')), null)
  assert.equal(searchFallbackTracks({ code: 'SEARCH_FALLBACK', tracks: 'invalid' }), null)
})

test('separates searchable text, provider URLs, and overlong queries', () => {
  assert.equal(searchInputMode('   '), 'empty')
  assert.equal(searchInputMode('Golden Hour'), 'search')
  assert.equal(searchInputMode('https://music.apple.com/cn/song/1'), 'identify')
  assert.equal(searchInputMode('x'.repeat(101)), 'too-long')
  assert.equal(searchInputMode(`https://example.com/${'x'.repeat(200)}`), 'identify')
})

test('hides previews by default while preserving full tracks and metadata', () => {
  const tracks = [
    { id: 'preview', capabilities: { playback: 'preview' } },
    { id: 'full', capabilities: { playback: 'full' } },
    { id: 'metadata', capabilities: { playback: 'none' } },
  ]

  assert.deepEqual(filterTracksByPlayback(tracks, 'no-preview').map(({ id }) => id), ['full', 'metadata'])
  assert.deepEqual(filterTracksByPlayback(tracks, 'full').map(({ id }) => id), ['full'])
  assert.equal(filterTracksByPlayback(tracks, 'all'), tracks)
  assert.deepEqual(filterTracksByPlayback(null, 'all'), [])
})

test('prioritizes direct full and preview playback before unresolved full candidates and metadata', () => {
  const tracks = [
    { id: 'metadata-1', capabilities: { playback: 'none' } },
    { id: 'preview-1', audioUrl: 'https://audio.example/preview-1', capabilities: { playback: 'preview' } },
    { id: 'full-1', audioUrl: '', capabilities: { playback: 'full' } },
    { id: 'metadata-2', capabilities: { playback: 'none' } },
    { id: 'full-2', audioUrl: 'https://audio.example/full-2', capabilities: { playback: 'full' } },
    { id: 'preview-2', audioUrl: '', capabilities: { playback: 'preview' } },
    { id: 'full-3', audioUrl: '', capabilities: { playback: 'full' } },
  ]

  assert.deepEqual(prioritizePlayableTracks(tracks).map(({ id }) => id), [
    'full-2', 'preview-1', 'full-1', 'full-3', 'preview-2', 'metadata-1', 'metadata-2',
  ])
  assert.deepEqual(tracks.map(({ id }) => id), [
    'metadata-1', 'preview-1', 'full-1', 'metadata-2', 'full-2', 'preview-2', 'full-3',
  ])
  assert.deepEqual(prioritizePlayableTracks(null), [])
})

test('keeps the first half strictly playable-first and diversifies the remaining result sources', () => {
  const direct = Array.from({ length: 8 }, (_, index) => ({
    id: `apple-${index}`, source: 'apple', audioUrl: `https://audio.example/${index}`,
    capabilities: { playback: 'preview' },
  }))
  const tracks = [
    ...direct,
    { id: 'audius-1', source: 'audius', audioUrl: '', capabilities: { playback: 'full' } },
    { id: 'netease-1', source: 'netease', audioUrl: '', capabilities: { playback: 'none' } },
    { id: 'musicbrainz-1', source: 'musicbrainz', audioUrl: '', capabilities: { playback: 'none' } },
  ]

  assert.deepEqual(diversifyRankedTracks(tracks, 6).map(({ id }) => id), [
    'apple-0', 'apple-1', 'apple-2', 'audius-1', 'netease-1', 'musicbrainz-1',
  ])
  assert.deepEqual(diversifyRankedTracks(tracks, 0), [])
})

test('filters search results by metadata field and duration without mutating relevance order', () => {
  const tracks = [
    { id: '1', title: 'Style', artist: 'Taylor Swift', album: 'Lover', duration: 221 },
    { id: '2', title: 'Lover', artist: 'Jay Chou', album: 'Greatest Hits', duration: 175 },
    { id: '3', title: 'Long Live', artist: 'Taylor Swift', album: 'Speak Now', duration: 315 },
    { id: '4', title: 'Unknown', artist: 'Taylor Swift', album: 'Archive', duration: 0 },
  ]

  assert.deepEqual(refineSearchTracks(tracks, {
    query: 'lover', domain: 'title', duration: 'all', sort: 'relevance',
  }).map(({ id }) => id), ['2'])
  assert.deepEqual(refineSearchTracks(tracks, {
    query: 'taylor', domain: 'artist', duration: 'medium', sort: 'relevance',
  }).map(({ id }) => id), ['1'])
  assert.deepEqual(refineSearchTracks(tracks, {
    query: 'speak', domain: 'album', duration: 'long', sort: 'relevance',
  }).map(({ id }) => id), ['3'])
  assert.deepEqual(refineSearchTracks(tracks, {
    query: 'ignored', domain: 'all', duration: 'short', sort: 'relevance',
  }).map(({ id }) => id), ['2'])
  assert.deepEqual(tracks.map(({ id }) => id), ['1', '2', '3', '4'])
})

test('sorts advanced search results predictably and keeps unknown durations last', () => {
  const tracks = [
    { id: '1', title: 'Beta', artist: 'Zulu', album: '', duration: 0 },
    { id: '2', title: 'Alpha', artist: 'Mike', album: '', duration: 240 },
    { id: '3', title: 'Gamma', artist: 'Able', album: '', duration: 180 },
  ]

  assert.deepEqual(refineSearchTracks(tracks, { query: '', domain: 'all', duration: 'all', sort: 'title' }).map(({ id }) => id), ['2', '1', '3'])
  assert.deepEqual(refineSearchTracks(tracks, { query: '', domain: 'all', duration: 'all', sort: 'artist' }).map(({ id }) => id), ['3', '2', '1'])
  assert.deepEqual(refineSearchTracks(tracks, { query: '', domain: 'all', duration: 'all', sort: 'duration' }).map(({ id }) => id), ['3', '2', '1'])
  assert.deepEqual(refineSearchTracks(null, { query: '', domain: 'all', duration: 'all', sort: 'title' }), [])
})

test('validates the versioned paginated search envelope', () => {
  const valid = { id: '1' }
  assert.deepEqual(parseSearchPage({
    success: true,
    data: { page: 2, has_more: true, items: [valid] },
  }, (item) => item === valid), { tracks: [valid], page: 2, hasMore: true })

  for (const payload of [
    null,
    { success: false, data: { page: 1, has_more: false, items: [] } },
    { success: true, data: { page: 0, has_more: false, items: [] } },
    { success: true, data: { page: 1, has_more: 'yes', items: [] } },
    { success: true, data: { page: 1, has_more: false, items: [{}] } },
  ]) assert.equal(parseSearchPage(payload, (item) => item === valid), null)
})
