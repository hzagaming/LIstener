import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createApiHandler } from './http.mjs'

test('serves an authorized audio descriptor through a same-origin attachment route', async () => {
  const service = {
    sources: ['wikimedia'],
    async download(source, id) {
      assert.deepEqual({ source, id }, { source: 'wikimedia', id: '7' })
      return { url: 'https://upload.wikimedia.org/audio.ogg', filename: '开放 音频.ogg' }
    },
  }
  const audioDownloader = async ({ source, url }) => {
    assert.deepEqual({ source, url }, { source: 'wikimedia', url: 'https://upload.wikimedia.org/audio.ogg' })
    return {
      body: new Response(new Uint8Array([1, 2, 3])).body,
      contentType: 'audio/ogg',
      contentLength: 3,
      maxBytes: 4,
    }
  }
  const server = createServer(createApiHandler({ service, audioDownloader }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download/file?source=wikimedia&id=7`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/ogg')
    assert.match(response.headers.get('content-disposition'), /attachment/)
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
