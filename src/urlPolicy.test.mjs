import assert from 'node:assert/strict'
import test from 'node:test'
import { isSafeArtwork, isSafeUrl } from './urlPolicy.mjs'

test('accepts ordinary web URLs without embedded credentials', () => {
  assert.equal(isSafeUrl('https://music.example/track/1'), true)
  assert.equal(isSafeUrl('http://127.0.0.1:3000/audio.mp3'), true)
  assert.equal(isSafeUrl('https://user:secret@music.example/track/1'), false)
})

test('rejects executable and opaque URLs unless a local blob is explicit', () => {
  assert.equal(isSafeUrl('javascript:alert(1)'), false)
  assert.equal(isSafeUrl('data:text/html,unsafe'), false)
  assert.equal(isSafeUrl('blob:https://listener.example/id'), false)
  assert.equal(isSafeUrl('blob:https://listener.example/id', { allowBlob: true }), true)
  assert.equal(isSafeUrl('', { allowEmpty: true }), true)
})

test('accepts safe artwork tokens and web URLs without embedded credentials', () => {
  assert.equal(isSafeArtwork('night'), true)
  assert.equal(isSafeArtwork('cover-blue_2'), true)
  assert.equal(isSafeArtwork('https://img.example/cover.jpg'), true)
  assert.equal(isSafeArtwork('https://user:secret@img.example/cover.jpg'), false)
  assert.equal(isSafeArtwork('javascript:alert(1)'), false)
  assert.equal(isSafeArtwork('../cover.jpg'), false)
  assert.equal(isSafeArtwork(''), false)
})
