import assert from 'node:assert/strict'
import test from 'node:test'
import { artworkFilename, builtInArtwork, readArtworkResponse } from './downloadLogic.mjs'

test('creates portable filenames and downloadable built-in artwork', () => {
  assert.equal(artworkFilename('A/B', 'image/jpeg'), 'A_B-cover.jpg')
  const artwork = builtInArtwork('gold', '晴天', '周杰伦')
  assert.equal(artwork.type, 'image/svg+xml')
  assert.match(artwork.svg, /晴天/)
  assert.doesNotMatch(artwork.svg, /<script/)
})

test('reads bounded image responses and rejects invalid downloads', async () => {
  const blob = await readArtworkResponse(new Response(new Uint8Array([1, 2]), {
    headers: { 'content-type': 'image/png', 'content-length': '2' },
  }), 3)
  assert.equal(blob.type, 'image/png')
  assert.equal(blob.size, 2)

  await assert.rejects(readArtworkResponse(new Response('no', { headers: { 'content-type': 'text/plain' } }), 3), /image/)
  await assert.rejects(readArtworkResponse(new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { 'content-type': 'image/png' },
  }), 3), /too large/)
})
