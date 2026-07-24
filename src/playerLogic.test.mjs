import assert from 'node:assert/strict'
import test from 'node:test'
import { playableTracks, preferResolvedCurrent } from './playerLogic.mjs'

const track = (id, playback = 'full', audioUrl = '') => ({
  id,
  source: 'test',
  audioUrl,
  capabilities: { playback },
})

test('reuses the resolved current track for the same requested song', () => {
  const requested = track('1')
  const current = track('1', 'full', 'https://audio.example/1.mp3')

  assert.equal(preferResolvedCurrent(requested, current), current)
  assert.equal(preferResolvedCurrent(track('2'), current).id, '2')
  assert.equal(preferResolvedCurrent(requested, track('1')), requested)
})

test('keeps only playable tracks in their original order', () => {
  const tracks = [track('1'), track('2', 'none'), track('3', 'preview')]

  assert.deepEqual(playableTracks(tracks).map(({ id }) => id), ['1', '3'])
})
