import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createAccountStore } from './accountStore.mjs'
import { createApiHandler } from './http.mjs'

const withServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const request = (url, path, options = {}) => fetch(`${url}${path}`, {
  ...options,
  headers: {
    Accept: 'application/json',
    Origin: 'http://localhost:5173',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  },
})

test('registers, authenticates, syncs revisioned data, and logs out', async () => {
  const store = createAccountStore({ filename: ':memory:' })
  const service = { sources: [], sourceCapabilities: [] }
  try {
    await withServer(createApiHandler({ service, accountStore: store }), async (baseUrl) => {
      const registered = await request(baseUrl, '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'User@example.com', password: 'correct horse battery staple' }),
      })
      assert.equal(registered.status, 201)
      const cookie = registered.headers.get('set-cookie')
      assert.match(cookie, /^listener_session=[A-Za-z0-9_-]+;/)
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /SameSite=Lax/)
      assert.doesNotMatch(cookie, /Secure/)
      const cookieHeader = cookie.split(';')[0]

      const me = await request(baseUrl, '/api/auth/me', { headers: { Cookie: cookieHeader } })
      assert.equal((await me.json()).user.email, 'user@example.com')

      const saved = await request(baseUrl, '/api/user/state', {
        method: 'PUT',
        headers: { Cookie: cookieHeader },
        body: JSON.stringify({ revision: 0, state: { version: 1, liked: [] } }),
      })
      assert.equal(saved.status, 200)
      assert.equal((await saved.json()).revision, 1)

      const conflict = await request(baseUrl, '/api/user/state', {
        method: 'PUT',
        headers: { Cookie: cookieHeader },
        body: JSON.stringify({ revision: 0, state: { version: 1, liked: [] } }),
      })
      assert.equal(conflict.status, 409)
      assert.equal((await conflict.json()).current.revision, 1)

      const loaded = await request(baseUrl, '/api/user/state', { headers: { Cookie: cookieHeader } })
      const payload = await loaded.json()
      assert.equal(payload.revision, 1)
      assert.deepEqual(payload.state.liked, [])

      const loggedOut = await request(baseUrl, '/api/auth/logout', { method: 'POST', headers: { Cookie: cookieHeader } })
      assert.equal(loggedOut.status, 200)
      assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/)
      const signedOut = await request(baseUrl, '/api/auth/me', { headers: { Cookie: cookieHeader } })
      assert.equal(signedOut.status, 200)
      assert.deepEqual(await signedOut.json(), { user: null })
    })
  } finally {
    store.close()
  }
})

test('rejects cross-origin account writes and oversized bodies', async () => {
  const store = createAccountStore({ filename: ':memory:' })
  try {
    await withServer(createApiHandler({ service: {}, accountStore: store }), async (baseUrl) => {
      const crossOrigin = await request(baseUrl, '/api/auth/register', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example' },
        body: JSON.stringify({ email: 'user@example.com', password: 'correct horse battery staple' }),
      })
      assert.equal(crossOrigin.status, 403)

      const oversized = await request(baseUrl, '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'x'.repeat(1_100_000) }),
      })
      assert.equal(oversized.status, 413)
    })
  } finally {
    store.close()
  }
})

test('returns a privacy-preserving trusted region and streams safe artwork', async () => {
  const service = {
    sources: ['apple'],
    async lookup(source, id) {
      return { source, id, title: 'Cover Song', cover: 'https://is1-ssl.mzstatic.com/image/cover.jpg' }
    },
  }
  const artworkDownloader = async ({ source, url, title }) => {
    assert.deepEqual({ source, url, title }, {
      source: 'apple',
      url: 'https://is1-ssl.mzstatic.com/image/cover.jpg',
      title: 'Cover Song',
    })
    return { bytes: new Uint8Array([1, 2]), contentType: 'image/jpeg', filename: 'Cover Song-cover.jpg' }
  }

  await withServer(createApiHandler({ service, artworkDownloader, countryHeader: 'cf-ipcountry' }), async (baseUrl) => {
    const region = await fetch(`${baseUrl}/api/recommendations/region`, { headers: { 'cf-ipcountry': 'cn' } })
    assert.deepEqual(await region.json(), { country: 'CN', source: 'trusted-proxy', storesRawIp: false })

    const artwork = await fetch(`${baseUrl}/api/artwork?source=apple&id=1`)
    assert.equal(artwork.status, 200)
    assert.equal(artwork.headers.get('content-type'), 'image/jpeg')
    assert.match(artwork.headers.get('content-disposition'), /Cover Song-cover\.jpg/)
    assert.deepEqual([...new Uint8Array(await artwork.arrayBuffer())], [1, 2])
  })
})
