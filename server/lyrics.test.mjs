import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLyrics, parseLrc } from './lyrics.mjs'

test('parses LRC metadata, offsets, multiple timestamps, and fractional seconds', () => {
  const lyrics = parseLrc([
    '[ar:测试歌手]',
    '[offset:100]',
    '[00:01.20][00:02.345]第一行',
    '[00:02.345]同一时间',
    '[01:03]Final line',
  ].join('\r\n'))

  assert.deepEqual(lyrics.metadata, { ar: '测试歌手', offset: '100' })
  assert.deepEqual(lyrics.lines, [
    { timeMs: 1_300, text: '第一行' },
    { timeMs: 2_445, text: '第一行' },
    { timeMs: 2_445, text: '同一时间' },
    { timeMs: 63_100, text: 'Final line' },
  ])
  assert.equal(lyrics.plain, '第一行\n第一行\n同一时间\nFinal line')
  assert.match(lyrics.lrc, /^\[ar:测试歌手\]/)
})

test('normalizes plain Unicode lyrics without interpreting HTML', () => {
  assert.deepEqual(normalizeLyrics('你好\r\nこんにちは\n<script>alert(1)</script>'), {
    plain: '你好\nこんにちは\n<script>alert(1)</script>',
    lrc: '',
    lines: [],
    language: null,
    translated: null,
    metadata: {},
  })
})

test('ignores invalid timed lines and rejects overlong lyrics', () => {
  const lyrics = parseLrc('[invalid]\n[99:99.99]bad\n[00:00.01]ok\nplain note')
  assert.deepEqual(lyrics.lines, [{ timeMs: 10, text: 'ok' }])
  assert.equal(lyrics.plain, 'ok\nplain note')
  assert.throws(() => normalizeLyrics('x'.repeat(101), { maxLength: 100 }), /lyrics are too long/)
})
