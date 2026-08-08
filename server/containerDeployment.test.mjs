import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('ships a non-root production API image with persistent state and health checking', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')

  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m)
  assert.match(dockerfile, /npm ci --omit=dev/)
  assert.match(dockerfile, /COPY --chown=node:node server .\/server/)
  assert.match(dockerfile, /ENV HOST=0\.0\.0\.0/)
  assert.match(dockerfile, /ENV LISTENER_DB_PATH=\/data\/listener\.sqlite/)
  assert.match(dockerfile, /HEALTHCHECK[^\n]*\n\s*CMD \["node", "server\/containerHealthCheck\.mjs"\]/)
  assert.match(dockerfile, /USER node/)
  assert.match(dockerfile, /CMD \["node", "server\/index\.mjs"\]/)
  assert.doesNotMatch(dockerfile, /COPY \. \./)
})

test('ships an all-source Compose deployment without embedding secrets', async () => {
  const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8')
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8')

  assert.match(compose, /CORS_ORIGIN:\s*\$\{CORS_ORIGIN:-https:\/\/hzagaming\.github\.io\}/)
  assert.match(compose, /BRAVE_SEARCH_API_KEY:\s*\$\{BRAVE_SEARCH_API_KEY:\?[^}]+\}/)
  assert.match(compose, /YOUTUBE_API_KEY:\s*\$\{YOUTUBE_API_KEY:\?[^}]+\}/)
  assert.match(compose, /AUDIUS_API_KEY:\s*\$\{AUDIUS_API_KEY:\?[^}]+\}/)
  assert.match(compose, /LISTENER_DB_PATH:\s*\/data\/listener\.sqlite/)
  assert.match(compose, /listener-data:\/data/)
  assert.match(compose, /^volumes:\n\s+listener-data:/m)
  assert.doesNotMatch(compose, /listener_(?:brave|youtube|audius)_search_test_key/i)
  assert.match(ignore, /^\.env$/m)
  assert.match(ignore, /^data$/m)
  assert.match(ignore, /^node_modules$/m)
})
