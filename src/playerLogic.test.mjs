import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoplayMediaMatches, collectionPlaybackPlan, endedPlaybackAction, focusTrapTargetIndex, initialPlaybackDuration, mediaLoadKey, playableTracks,
  mediaErrorAction, nextDirectFullTrack, playbackUnavailableTrack, playbackVisualState, playControlDisabled, preferResolvedCurrent, removalFocusIndex, seekPosition,
  shouldApplyEndedAction, shouldCancelPendingTrack, shouldRestartCurrentTrack,
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

test('demotes a failed remote candidate without mutating its metadata', () => {
  const candidate = track('1', 'full', 'https://audio.example/1.mp3')
  candidate.capabilities.download = true

  assert.deepEqual(playbackUnavailableTrack(candidate), {
    ...candidate,
    audioUrl: '',
    capabilities: { playback: 'none', download: true },
  })
  assert.equal(candidate.capabilities.playback, 'full')
  assert.equal(candidate.audioUrl, 'https://audio.example/1.mp3')
})

test('advances past failed candidates to the next direct full track without looping', () => {
  const tracks = [
    track('1', 'full', 'https://audio.example/1.mp3'),
    track('2', 'full'),
    track('3', 'preview', 'https://audio.example/3.mp3'),
    track('4', 'full', 'https://audio.example/4.mp3'),
  ]

  assert.equal(nextDirectFullTrack(tracks, 'test:1'), tracks[3])
  assert.equal(nextDirectFullTrack(tracks, 'test:4'), null)
  assert.equal(nextDirectFullTrack(tracks, 'test:missing'), null)
})

test('builds ordered, shuffled, and single-repeat collection playback plans', () => {
  const tracks = [track('1'), track('2', 'none'), track('3'), track('4')]
  const ordered = collectionPlaybackPlan(tracks, 'order')
  const shuffled = collectionPlaybackPlan(tracks, 'shuffle', () => 0)
  const single = collectionPlaybackPlan(tracks, 'one')

  assert.deepEqual(ordered, {
    queue: [tracks[0], tracks[2], tracks[3]],
    repeatMode: 'off',
    shuffle: false,
  })
  assert.deepEqual(shuffled.queue.map(({ id }) => id), ['3', '4', '1'])
  assert.equal(shuffled.repeatMode, 'all')
  assert.equal(shuffled.shuffle, true)
  assert.equal(single.repeatMode, 'one')
  assert.equal(single.shuffle, false)
  assert.deepEqual(tracks.map(({ id }) => id), ['1', '2', '3', '4'])
})

test('does not let an old ended event replace a pending user selection', () => {
  const action = endedPlaybackAction({ pending: true, queueLength: 3, currentIndex: 0, repeatMode: 'all' })

  assert.equal(action, 'ignore')
  assert.equal(shouldApplyEndedAction(action), false)
  assert.equal(shouldApplyEndedAction('next'), true)
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

test('autoplays only the media load explicitly requested by the user', () => {
  const currentKey = mediaLoadKey(track('2', 'full', 'https://audio.example/2.mp3'))
  assert.equal(autoplayMediaMatches(currentKey, currentKey), true)
  assert.equal(autoplayMediaMatches(null, currentKey), false)
  assert.equal(autoplayMediaMatches(mediaLoadKey(track('1')), currentKey), false)
})

test('keeps removal focus on the nearest remaining item', () => {
  assert.equal(removalFocusIndex(1, 2), 1)
  assert.equal(removalFocusIndex(2, 2), 1)
  assert.equal(removalFocusIndex(0, 0), -1)
})

test('keeps keyboard focus inside an open overlay', () => {
  assert.equal(focusTrapTargetIndex(-1, 3, false), 0)
  assert.equal(focusTrapTargetIndex(-1, 3, true), 2)
  assert.equal(focusTrapTargetIndex(0, 3, true), 2)
  assert.equal(focusTrapTargetIndex(2, 3, false), 0)
  assert.equal(focusTrapTargetIndex(1, 3, false), -1)
  assert.equal(focusTrapTargetIndex(-1, 0, false), -1)
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
  assert.equal(initialPlaybackDuration({ duration: 370, audioUrl: 'https://audio.example/full.mp3', capabilities: { playback: 'full' } }), 370)
  assert.equal(initialPlaybackDuration({ duration: 370, audioUrl: 'https://audio.example/preview.mp3', capabilities: { playback: 'preview' } }), 0)
  assert.equal(initialPlaybackDuration({ duration: 370, audioUrl: '', capabilities: { playback: 'full' } }), 0)
  assert.equal(initialPlaybackDuration({ duration: 370, audioUrl: '', capabilities: { playback: 'none' } }), 0)
})

test('keeps a pending playback control available so loading can be cancelled', () => {
  assert.equal(playControlDisabled('none', false), true)
  assert.equal(playControlDisabled('none', true), false)
  assert.equal(playControlDisabled('preview', false), false)
})

test('only cancels when the selected track owns the pending request', () => {
  assert.equal(shouldCancelPendingTrack('apple:1', 'apple:1'), true)
  assert.equal(shouldCancelPendingTrack('apple:2', 'apple:1'), false)
  assert.equal(shouldCancelPendingTrack('apple:1', null), false)
})

test('restarts the current track before moving to the previous one', () => {
  assert.equal(shouldRestartCurrentTrack(3.01, 0, 120), true)
  assert.equal(shouldRestartCurrentTrack(3.01, 0, 0), true)
  assert.equal(shouldRestartCurrentTrack(3, 0, 120), false)
  assert.equal(shouldRestartCurrentTrack(30, -1, 120), false)
  assert.equal(shouldRestartCurrentTrack(Number.NaN, 0, 120), false)
})

test('retries a media network failure only once per playback attempt', () => {
  const failure = { hasAudioUrl: true, errorCode: 2, mediaKey: 'demo:3', retryKey: null, source: 'demo' }

  assert.equal(mediaErrorAction(failure), 'retry')
  assert.equal(mediaErrorAction({ ...failure, retryKey: 'demo:3' }), 'report')
  assert.equal(mediaErrorAction({ ...failure, errorCode: 3 }), 'report')
  assert.equal(mediaErrorAction({ ...failure, source: 'apple', errorCode: 3 }), 'invalidate')
  assert.equal(mediaErrorAction({ ...failure, hasAudioUrl: false }), 'ignore')
})
