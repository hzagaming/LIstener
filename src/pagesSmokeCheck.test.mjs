import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPageHtml, verifyPage } from './pagesSmokeCheck.mjs'

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
