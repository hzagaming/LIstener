import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'

test('the document icon points to a shipped public asset', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const iconPath = html.match(/<link\s+rel=["']icon["']\s+href=["']([^"']+)["']/)?.[1]

  assert.ok(iconPath?.startsWith('/'), 'index.html must declare a root-relative icon')
  await access(new URL(`../public${iconPath}`, import.meta.url))
})

test('the production build targets the GitHub Pages project path', async () => {
  const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
  const [build, preview] = await Promise.all([
    loadConfigFromFile({ command: 'build', mode: 'production' }, configFile),
    loadConfigFromFile({ command: 'serve', mode: 'production', isPreview: true }, configFile),
  ])

  assert.equal(build?.config.base, '/LIstener/')
  assert.equal(preview?.config.base, '/LIstener/')
})

test('GitHub Pages deploys public search without probing an unavailable Node API', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8')
  const provider = await readFile(new URL('./services/musicProvider.ts', import.meta.url), 'utf8')
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(workflow, /path:\s*\.\/dist/)
  assert.match(workflow, /VITE_PUBLIC_APPLE:\s*['"]true['"]/)
  assert.doesNotMatch(workflow, /VITE_STATIC_DEMO/)
  assert.match(provider, /VITE_PUBLIC_APPLE === 'true'\s*\? createPublicAppleProvider\(\{ fallback: demoProvider \}\)/)
  assert.match(app, /const publicAppleMode = import\.meta\.env\.VITE_PUBLIC_APPLE === 'true'/)
  assert.match(app, /const identifiableSources: MusicSource\[\] = publicAppleMode \? \['apple'\] :/)
  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-node@v7/)
  assert.match(workflow, /actions\/configure-pages@v5/)
  assert.match(workflow, /actions\/upload-pages-artifact@v3/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
  assert.match(workflow, /node src\/pagesSmokeCheck\.mjs/)
})

test('the first render does not depend on external stylesheets', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.doesNotMatch(styles, /@import\s+(?:url\()?['"]?https?:\/\//i)
})

test('touch devices keep primary playback affordances visible', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const trackColumns = [...styles.matchAll(/\.track-row\s*\{[^}]*grid-template-columns:\s*(\d+)px/g)]

  assert.match(styles, /@media\s*\(hover:\s*none\)[\s\S]*?\.cover-play[\s\S]*?opacity:\s*1/)
  assert.match(styles, /\.track-row__play\s*\{[^}]*min-width:\s*40px/)
  assert.match(styles, /@media\s*\(hover:\s*none\)[\s\S]*?\.track-row__play span[^}]*display:\s*none[\s\S]*?\.track-row__play svg[^}]*display:\s*inline/)
  assert.deepEqual(trackColumns.map((match) => Number(match[1])), [40, 40, 40])
})

test('mobile layouts use the dynamic viewport', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.match(styles, /min-height:\s*100dvh/)
  assert.match(styles, /max-height:[^;]*100dvh/)
})

test('short desktop viewports keep every sidebar section reachable', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const sidebar = styles.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(sidebar, /overflow-y:\s*auto/)
  assert.match(styles, /\.sidebar\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/)
})

test('the initial player does not initiate third-party audio loading', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const effectEnd = app.indexOf('  }, [currentMediaKey]) // eslint-disable-line react-hooks/exhaustive-deps')
  const currentTrackEffect = effectEnd < 0 ? '' : app.slice(Math.max(0, effectEnd - 350), effectEnd)

  assert.match(app, /<audio[\s\S]*?preload="none"/)
  assert.match(app, /const autoplayMediaKeyRef = useRef<string \| null>\(null\)/)
  assert.match(currentTrackEffect, /if \(!autoplayMediaMatches\(autoplayMediaKeyRef\.current, currentMediaKey\)\) return[\s\S]*?audio\.load\(\)/)
})

test('mobile and queue dialogs keep valid semantics and move focus inside', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /const mobileCloseRef = useRef<HTMLButtonElement>\(null\)/)
  assert.match(app, /if \(mobileNavOpen\) mobileCloseRef\.current\?\.focus\(\)/)
  assert.match(app, /<div id="mobile-navigation"[\s\S]*?role=\{mobileNavOpen \? 'dialog' : 'complementary'\}/)
  assert.match(app, /<div className="queue-drawer queue-drawer--open" role="dialog"/)
})

test('small controls remain readable and disabled progress has no stray thumb', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.hero \.text-button\s*\{[^}]*color:\s*#514c45/)
  assert.match(styles, /\.section-index\s*\{[^}]*color:\s*#b94724/)
  assert.match(styles, /\.playlist-card__copy > span\s*\{[^}]*color:\s*#6f6b63/)
  assert.match(styles, /\.track-row__play\s*\{[^}]*color:\s*#6f6b63/)
  assert.match(styles, /\.player__state\s*\{[^}]*color:\s*#ad3e1f/)
  assert.match(styles, /input\[type='range'\]:disabled::-(?:webkit-slider-thumb|moz-range-thumb)\s*\{[^}]*opacity:\s*0/)
})

test('narrow players preserve readable track metadata', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const mobile = styles.slice(styles.indexOf('@media (max-width: 820px)'), styles.indexOf('@media (max-width: 420px)'))

  assert.match(styles, /@media\s*\(max-width:\s*350px\)[\s\S]*?\.player__track \.cover\s*\{[^}]*display:\s*none/)
  assert.match(mobile, /\.track-row__actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/)
})

test('narrow public search headings remain on one readable line', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const mobile = styles.slice(styles.indexOf('@media (max-width: 820px)'), styles.indexOf('@media (max-width: 420px)'))

  assert.match(mobile, /\.search-hero h1\s*\{[^}]*font-size:\s*clamp\(34px,\s*10\.5vw,\s*44px\)[^}]*white-space:\s*nowrap/)
})

test('ID resolution aborts an active keyword search', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const searchEffect = app.slice(app.indexOf('const inputMode'), app.indexOf('const currentKey'))
  const identifyInput = app.slice(app.indexOf('const identifyInput'), app.indexOf('const removeFromQueue'))

  assert.match(app, /const searchControllerRef = useRef<AbortController \| null>\(null\)/)
  assert.match(searchEffect, /searchControllerRef\.current = controller/)
  assert.match(identifyInput, /searchControllerRef\.current\?\.abort\(\)/)
})

test('playlist delete confirmation expires automatically', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /if \(!pendingDeletePlaylistId\) return\s+const timeout = window\.setTimeout\(\(\) => setPendingDeletePlaylistId\(null\), 5_000\)/)
})

test('an invalidated audio source clears stale progress metadata', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const handler = app.slice(app.indexOf('const handleAudioError'), app.indexOf('const seekTo'))

  assert.match(handler, /setProgress\(0\)/)
  assert.match(handler, /setDuration\(initialPlaybackDuration\(invalidated\)\)/)
})

test('an unplayable track clears stale system media progress', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const positionEffect = app.slice(
    app.indexOf("typeof navigator.mediaSession.setPositionState !== 'function'"),
    app.indexOf('  }, [duration, progress])'),
  )

  assert.match(positionEffect, /if \(position === null\)[\s\S]*?navigator\.mediaSession\.setPositionState\(\)/)
})

test('separate local lyrics imports update existing tracks without reloading audio', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const importLocalTracks = app.slice(app.indexOf('const importLocalTracks'), app.indexOf('const removeLocalTrack'))
  const currentTrackEffect = app.slice(app.indexOf('const currentMediaKey'), app.indexOf('const inputMode'))

  assert.match(importLocalTracks, /localFilesRef\.current\.entries\(\)/)
  assert.match(importLocalTracks, /if \(matchedKeys\.size\)\s*{\s*queueRevisionRef\.current \+= 1/)
  assert.match(importLocalTracks, /setCurrent\(\(previous\) => enableLocalLyrics\(previous\)\)/)
  assert.match(currentTrackEffect, /const currentMediaKey = mediaLoadKey\(current\)/)
  assert.match(currentTrackEffect, /}, \[currentMediaKey\]\)/)
})
