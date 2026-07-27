import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpClient } from './providerHttpClient.mjs'

test('allows only credential-free HTTPS URLs on the provider host allowlist', async () => {
  const client = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async () => Response.json({ ok: true }),
  })

  assert.deepEqual(await client.json('https://api.example.com/search?q=song'), { ok: true })
  for (const url of [
    'http://api.example.com/search',
    'https://user:secret@api.example.com/search',
    'https://example.com/search',
    'https://localhost/search',
    'https://127.0.0.1/search',
    'https://10.0.0.1/search',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/search',
    'file:///etc/passwd',
  ]) {
    await assert.rejects(() => client.json(url), /provider URL is not allowed/)
  }
})

test('rejects redirects outside the allowlist before following them', async () => {
  let calls = 0
  const client = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } })
    },
  })

  await assert.rejects(() => client.json('https://api.example.com/start'), /provider URL is not allowed/)
  assert.equal(calls, 1)
})

test('limits response bytes and rejects malformed JSON', async () => {
  const oversized = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    maxResponseBytes: 8,
    fetchImpl: async () => new Response('{"too":"large"}', {
      headers: { 'Content-Type': 'application/json' },
    }),
  })
  await assert.rejects(() => oversized.json('https://api.example.com/data'), /provider response is too large/)

  const malformed = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async () => new Response('<html>not json</html>'),
  })
  await assert.rejects(() => malformed.json('https://api.example.com/data'), /invalid provider JSON response/)
})

test('retries one transient response but does not retry ordinary client errors', async () => {
  let transientCalls = 0
  const transient = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    retryDelayMs: 0,
    fetchImpl: async () => {
      transientCalls += 1
      return transientCalls === 1
        ? new Response('', { status: 503 })
        : Response.json({ recovered: true })
    },
  })
  assert.deepEqual(await transient.json('https://api.example.com/data'), { recovered: true })
  assert.equal(transientCalls, 2)

  let clientErrorCalls = 0
  const clientError = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async () => { clientErrorCalls += 1; return new Response('', { status: 400 }) },
  })
  await assert.rejects(() => clientError.json('https://api.example.com/data'), /provider request failed: 400/)
  assert.equal(clientErrorCalls, 1)
})

test('retries 429 once but never retries a generic 500 response', async () => {
  let rateLimitedCalls = 0
  const rateLimited = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    retryDelayMs: 0,
    fetchImpl: async () => {
      rateLimitedCalls += 1
      return rateLimitedCalls === 1 ? new Response('', { status: 429 }) : Response.json({ ok: true })
    },
  })
  assert.deepEqual(await rateLimited.json('https://api.example.com/data'), { ok: true })
  assert.equal(rateLimitedCalls, 2)

  let serverErrorCalls = 0
  const serverError = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async () => { serverErrorCalls += 1; return new Response('', { status: 500 }) },
  })
  await assert.rejects(() => serverError.json('https://api.example.com/data'), /provider request failed: 500/)
  assert.equal(serverErrorCalls, 1)
})

test('propagates caller cancellation to the provider request', async () => {
  let observedSignal
  const client = createProviderHttpClient({
    allowedHosts: ['api.example.com'],
    fetchImpl: async (_url, init) => {
      observedSignal = init.signal
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      })
    },
  })
  const controller = new AbortController()
  const pending = client.json('https://api.example.com/data', { signal: controller.signal })
  controller.abort(new Error('caller cancelled'))

  await assert.rejects(() => pending, /caller cancelled/)
  assert.equal(observedSignal.aborted, true)
})

test('rejects unsafe HTTP policy configuration', () => {
  const base = { allowedHosts: ['api.example.com'], fetchImpl: async () => Response.json({}) }
  assert.throws(() => createProviderHttpClient({ ...base, timeoutMs: 0 }), /valid provider timeout/)
  assert.throws(() => createProviderHttpClient({ ...base, maxRedirects: -1 }), /valid redirect limit/)
  assert.throws(() => createProviderHttpClient({ ...base, maxRetries: 2 }), /valid retry limit/)
})
