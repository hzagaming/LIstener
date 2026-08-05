import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLibraryData, normalizeLibraryData } from './syncLogic.mjs'

const track = (id) => ({ id, source: 'apple' })
const validators = {
  isTrack: (value) => Boolean(value?.id && value?.source),
  isPlaylist: (value) => typeof value?.id === 'string' && Array.isArray(value?.tracks),
}

test('normalizes import data and merges device libraries without duplicates', () => {
  const local = normalizeLibraryData({
    liked: [track('1')],
    playlists: [{ id: 'local', title: 'Local', tracks: [track('1')] }],
    queue: [track('1')],
    current: track('1'),
    history: [{ track: track('1'), playedAt: 20 }],
    settings: { volume: 0.4, repeat: 'one', regionalRecommendations: true, region: 'CN' },
  }, validators)
  const cloud = normalizeLibraryData({
    liked: [track('1'), track('2')],
    playlists: [{ id: 'cloud', title: 'Cloud', tracks: [track('2')] }],
    queue: [track('2')],
    current: track('2'),
    history: [{ track: track('2'), playedAt: 10 }],
    settings: { volume: 0.7, repeat: 'all', regionalRecommendations: false, region: 'US' },
  }, validators)

  const merged = mergeLibraryData(local, cloud, validators)
  assert.deepEqual(merged.liked.map(({ id }) => id), ['1', '2'])
  assert.deepEqual(merged.playlists.map(({ id }) => id), ['local', 'cloud'])
  assert.deepEqual(merged.queue.map(({ id }) => id), ['1', '2'])
  assert.equal(merged.current.id, '1')
  assert.deepEqual(merged.history.map(({ track: item }) => item.id), ['1', '2'])
  assert.deepEqual(merged.settings, local.settings)
})

test('drops malformed import records and bounds collections', () => {
  const normalized = normalizeLibraryData({
    liked: [null, track('1')],
    playlists: [{ id: 'bad' }, { id: 'bounded', tracks: Array.from({ length: 600 }, (_, id) => track(String(id))) }],
    queue: Array.from({ length: 600 }, (_, id) => track(String(id))),
    history: [{ track: null, playedAt: 10 }, { track: track('2'), playedAt: 20 }],
  }, validators)

  assert.deepEqual(normalized.liked, [track('1')])
  assert.equal(normalized.playlists.length, 1)
  assert.equal(normalized.playlists[0].tracks.length, 500)
  assert.equal(normalized.queue.length, 500)
  assert.equal(normalized.history.length, 1)
})

test('merges tracks added to the same playlist on different devices', () => {
  const local = {
    playlists: [{ id: 'shared', title: 'Local title', tracks: [track('1')] }],
  }
  const cloud = {
    playlists: [{ id: 'shared', title: 'Cloud title', tracks: [track('2')] }],
  }

  const merged = mergeLibraryData(local, cloud, validators)

  assert.equal(merged.playlists[0].title, 'Local title')
  assert.deepEqual(merged.playlists[0].tracks.map(({ id }) => id), ['1', '2'])
})

test('can prefer cloud playback position and settings during initial sign-in', () => {
  const local = {
    current: track('local'),
    settings: { volume: 0.4, repeat: 'one', regionalRecommendations: false, region: 'CN' },
  }
  const cloud = {
    current: track('cloud'),
    settings: { volume: 0.8, repeat: 'all', regionalRecommendations: true, region: 'US' },
  }

  const merged = mergeLibraryData(local, cloud, validators, { preferSecondaryState: true })

  assert.equal(merged.current.id, 'cloud')
  assert.deepEqual(merged.settings, normalizeLibraryData(cloud, validators).settings)
})
