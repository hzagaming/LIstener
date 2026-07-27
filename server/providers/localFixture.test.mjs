import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalFixtureProvider } from './localFixture.mjs'

test('provides stable multilingual search with pagination and normalized tracks', async () => {
  const provider = createLocalFixtureProvider()
  const first = await provider.search(' ', 2, undefined, 1)
  const second = await provider.search(' ', 2, undefined, 2)

  assert.equal(provider.id, 'fixture')
  assert.equal(provider.experimental, false)
  assert.equal(first.length, 2)
  assert.equal(second.length, 2)
  assert.notEqual(first[0].id, second[0].id)
  assert.equal(first.every((track) => track.source === 'fixture' && track.audioUrl === ''), true)
  assert.equal((await provider.search('海風 + dawn', 10)).length, 1)
  assert.equal((await provider.search('こんにちは', 10)).length, 1)
})

test('returns details and parsed lyrics without inventing playback', async () => {
  const provider = createLocalFixtureProvider()
  const track = await provider.lookup('fixture-1')
  const lyrics = await provider.lyrics('fixture-1')

  assert.equal(track.capabilities.playback, 'none')
  assert.equal(track.capabilities.lyrics, true)
  assert.equal(lyrics.lines.length > 0, true)
  assert.equal(lyrics.plain.includes('海風'), true)
  await assert.rejects(() => provider.lookup('../etc/passwd'), /invalid fixture track id/)
  await assert.rejects(() => provider.lookup('fixture-999'), (error) => error.code === 'TRACK_NOT_FOUND')
})
