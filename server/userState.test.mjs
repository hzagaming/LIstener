import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUserState } from './userState.mjs'

const track = (id = '1') => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  source: 'apple',
  audioUrl: '',
  cover: 'gold',
  sourceUrl: `https://music.example/${id}`,
  quality: 'standard',
  capabilities: { playback: 'none', lyrics: false, download: false },
})

test('normalizes bounded portable user state', () => {
  const state = normalizeUserState({
    version: 1,
    liked: [track()],
    playlists: [{ id: 'road', title: 'Road', description: '', cover: 'gold', tracks: [track()] }],
    queue: [track()],
    current: track(),
    history: [{ track: track(), playedAt: 1_700_000_000_000 }],
    settings: { volume: 0.5, repeat: 'all', regionalRecommendations: false, region: 'cn' },
  })

  assert.equal(state.version, 1)
  assert.equal(state.liked.length, 1)
  assert.equal(state.playlists[0].tracks.length, 1)
  assert.deepEqual(state.settings, {
    volume: 0.5,
    repeat: 'all',
    regionalRecommendations: false,
    region: 'CN',
  })
})

test('rejects unsafe, oversized, and malformed portable state', () => {
  assert.throws(() => normalizeUserState({ liked: [{ ...track(), sourceUrl: 'file:///tmp/song' }] }), /invalid user state/)
  assert.throws(() => normalizeUserState({ liked: Array.from({ length: 1001 }, (_, id) => track(String(id))) }), /invalid user state/)
  assert.throws(() => normalizeUserState({ settings: { volume: 2 } }), /invalid user state/)
  assert.throws(() => normalizeUserState({ extra: 'x'.repeat(1_100_000) }), /too large/)
})
