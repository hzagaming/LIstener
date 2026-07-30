import assert from 'node:assert/strict'
import test from 'node:test'
import { localFileStem, readLocalLyrics, selectLocalAudioFiles } from './localFiles.mjs'

test('normalizes local audio and lyric filenames to the same stem', () => {
  assert.equal(localFileStem('夜曲.MP3'), localFileStem('夜曲.lrc'))
})

test('filters unsupported files before applying the local audio limit', () => {
  const files = [
    ...Array.from({ length: 100 }, (_, index) => ({ name: `note-${index}.txt`, type: 'text/plain' })),
    { name: 'track.lrc', type: 'audio/lrc' },
    { name: 'track.flac', type: '' },
  ]

  assert.deepEqual(selectLocalAudioFiles(files, 100), [{ name: 'track.flac', type: '' }])
})

test('bounds local lyric reads before decoding the file', async () => {
  const slices = []
  const file = {
    slice(start, end) {
      slices.push([start, end])
      return { text: async () => '[00:00.00]歌词' }
    },
  }

  assert.equal(await readLocalLyrics(file), '[00:00.00]歌词')
  assert.deepEqual(slices, [[0, 500_000]])
})
