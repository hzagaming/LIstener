import assert from 'node:assert/strict'
import test from 'node:test'
import {
  endedPlaybackAction, initialPlaybackDuration, mediaLoadKey, playableTracks, playbackVisualState,
  preferResolvedCurrent, removalFocusIndex, seekPosition,
} from './playerLogic.mjs'

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

test('does not let an old ended event replace a pending user selection', () => {
  assert.equal(endedPlaybackAction({ pending: true, queueLength: 3, currentIndex: 0, repeatMode: 'all' }), 'ignore')
})

test('chooses the correct action when the active track ends', () => {
  assert.equal(endedPlaybackAction({ pending: false, queueLength: 0, currentIndex: -1, repeatMode: 'all' }), 'stop')
  assert.equal(endedPlaybackAction({ pending: false, queueLength: 3, currentIndex: 1, repeatMode: 'one' }), 'restart')
  assert.equal(endedPlaybackAction({ pending: false, queueLength: 3, currentIndex: 2, repeatMode: 'off' }), 'stop')
  assert.equal(endedPlaybackAction({ pending: false, queueLength: 3, currentIndex: 2, repeatMode: 'all' }), 'next')
  assert.equal(endedPlaybackAction({ pending: false, queueLength: 3, currentIndex: 0, repeatMode: 'off' }), 'next')
})

test('gives distinct media loads an identity beyond their shared URL', () => {
  const sharedUrl = 'https://audio.example/shared.mp3'
  assert.notEqual(mediaLoadKey(track('1', 'full', sharedUrl)), mediaLoadKey(track('2', 'full', sharedUrl)))
  assert.notEqual(mediaLoadKey(track('1', 'full', sharedUrl)), mediaLoadKey(track('1', 'full', `${sharedUrl}?refresh=1`)))
})

test('keeps removal focus on the nearest remaining item', () => {
  assert.equal(removalFocusIndex(1, 2), 1)
  assert.equal(removalFocusIndex(2, 2), 1)
  assert.equal(removalFocusIndex(0, 0), -1)
})

test('prioritizes resolve and buffer feedback over playback state', () => {
  assert.equal(playbackVisualState({ current: false, playing: false, resolving: true, buffering: false }), 'resolving')
  assert.equal(playbackVisualState({ current: true, playing: true, resolving: false, buffering: true }), 'buffering')
  assert.equal(playbackVisualState({ current: true, playing: true, resolving: false, buffering: false }), 'playing')
  assert.equal(playbackVisualState({ current: false, playing: true, resolving: false, buffering: true }), 'idle')
})

test('clamps media session seek positions to a playable range', () => {
  assert.equal(seekPosition(40, 120), 40)
  assert.equal(seekPosition(-10, 120), 0)
  assert.equal(seekPosition(140, 120), 120)
  assert.equal(seekPosition(Number.NaN, 120), null)
  assert.equal(seekPosition(10, 0), null)
})

test('waits for preview metadata before exposing its playable duration', () => {
  assert.equal(initialPlaybackDuration({ duration: 370, capabilities: { playback: 'preview' } }), 0)
  assert.equal(initialPlaybackDuration({ duration: 370, capabilities: { playback: 'full' } }), 370)
  assert.equal(initialPlaybackDuration({ duration: 370, capabilities: { playback: 'none' } }), 0)
})
