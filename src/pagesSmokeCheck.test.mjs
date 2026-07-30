import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPageHtml, verifyPage, verifyPageWithRetries } from './pagesSmokeCheck.mjs'

test('rejects a GitHub Pages document that exposes the Vite source entry', () => {
  assert.throws(
    () => inspectPageHtml('<link rel="icon" href="/favicon.svg"><script type="module" src="/src/main.tsx"></script>', 'https://example.com/LIstener/'),
    /source entry/i,
  )
})

test('collects the built icon, script, and stylesheet under the project path', () => {
  const html = `
    <link rel="icon" href="/LIstener/favicon.svg">
    <script type="module" src="/LIstener/assets/app.js"></script>
    <link rel="stylesheet" href="/LIstener/assets/app.css">
  `

  assert.deepEqual(inspectPageHtml(html, 'https://example.com/LIstener/'), [
    { type: 'icon', url: 'https://example.com/LIstener/favicon.svg' },
    { type: 'script', url: 'https://example.com/LIstener/assets/app.js' },
    { type: 'stylesheet', url: 'https://example.com/LIstener/assets/app.css' },
  ])
})

test('rejects a deployed resource that returns 404', async () => {
  const html = `
    <link rel="icon" href="/LIstener/favicon.svg">
    <script type="module" src="/LIstener/assets/app.js"></script>
    <link rel="stylesheet" href="/LIstener/assets/app.css">
  `
  const fetchPage = async (url) => String(url).includes('favicon.svg')
    ? new Response('', { status: 404 })
    : String(url).includes('/assets/')
      ? new Response('', { headers: { 'content-type': String(url).endsWith('.js') ? 'text/javascript' : 'text/css' } })
      : new Response(html, { headers: { 'content-type': 'text/html' } })

  await assert.rejects(
    verifyPage('https://example.com/LIstener/', fetchPage),
    /favicon\.svg returned 404/,
  )
})

test('retries transient Pages propagation failures', async () => {
  const html = `
    <link rel="icon" href="/LIstener/favicon.svg">
    <script type="module" src="/LIstener/assets/app.js"></script>
    <link rel="stylesheet" href="/LIstener/assets/app.css">
  `
  let pageRequests = 0
  const waits = []
  const fetchPage = async (url) => {
    if (!String(url).includes('/assets/') && !String(url).includes('favicon.svg')) {
      pageRequests += 1
      if (pageRequests === 1) return new Response('', { status: 404 })
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    }
    return new Response('', { headers: { 'content-type': String(url).endsWith('.js') ? 'text/javascript' : String(url).endsWith('.css') ? 'text/css' : 'image/svg+xml' } })
  }

  const resources = await verifyPageWithRetries('https://example.com/LIstener/', {
    attempts: 2,
    delayMs: 25,
    fetchPage,
    wait: async (milliseconds) => waits.push(milliseconds),
  })

  assert.equal(resources.length, 3)
  assert.deepEqual(waits, [25])
})

test('checks the final Pages state after an early successful response', async () => {
  const html = `
    <link rel="icon" href="/LIstener/favicon.svg">
    <script type="module" src="/LIstener/assets/app.js"></script>
    <link rel="stylesheet" href="/LIstener/assets/app.css">
  `
  let pageRequests = 0
  const fetchPage = async (url) => {
    if (!String(url).includes('/assets/') && !String(url).includes('favicon.svg')) {
      pageRequests += 1
      return pageRequests === 1
        ? new Response(html, { headers: { 'content-type': 'text/html' } })
        : new Response('<script type="module" src="/src/main.tsx"></script>', { headers: { 'content-type': 'text/html' } })
    }
    return new Response('', { headers: { 'content-type': String(url).endsWith('.js') ? 'text/javascript' : String(url).endsWith('.css') ? 'text/css' : 'image/svg+xml' } })
  }

  await assert.rejects(
    verifyPageWithRetries('https://example.com/LIstener/', { attempts: 2, fetchPage }),
    /source entry/i,
  )
  assert.equal(pageRequests, 2)
})

test('bounds every deployed resource request with a timeout signal', async () => {
  const html = `
    <link rel="icon" href="/LIstener/favicon.svg">
    <script type="module" src="/LIstener/assets/app.js"></script>
    <link rel="stylesheet" href="/LIstener/assets/app.css">
  `
  const signals = []
  const fetchPage = async (url, options) => {
    signals.push(options?.signal)
    return String(url).includes('/assets/') || String(url).includes('favicon.svg')
      ? new Response('', { headers: { 'content-type': String(url).endsWith('.js') ? 'text/javascript' : String(url).endsWith('.css') ? 'text/css' : 'image/svg+xml' } })
      : new Response(html, { headers: { 'content-type': 'text/html' } })
  }

  await verifyPage('https://example.com/LIstener/', fetchPage)

  assert.equal(signals.length, 4)
  assert.equal(signals.every((signal) => signal instanceof AbortSignal), true)
})
