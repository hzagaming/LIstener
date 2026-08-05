import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSearchFallbackError, filterTracksByPlayback, parseSearchPage,
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
