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

test('release metadata stays synchronized across the app shell', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

  assert.equal(manifest.version, '1.2.0')
  assert.equal(lock.version, manifest.version)
  assert.equal(lock.packages[''].version, manifest.version)
  assert.match(app, /Listener 1\.2\.0/)
  assert.match(readme, /当前版本：`1\.2\.0`/)
  assert.match(worker, /listener-shell-v1\.2\.0/)
  assert.match(changelog, /## 当前公告\s+### 1\.2\.0[\s\S]*?## 历史公告\s+### 1\.0\.1/)
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

test('GitHub Pages enables aggregate search when its API repository variable is configured', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8')
  const provider = await readFile(new URL('./services/musicProvider.ts', import.meta.url), 'utf8')
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(workflow, /path:\s*\.\/dist/)
  assert.match(workflow, /VITE_MUSIC_API_BASE:\s*\$\{\{\s*vars\.MUSIC_API_BASE_URL\s*\}\}/)
  assert.doesNotMatch(workflow, /VITE_PUBLIC_APPLE:\s*['"]true['"]/)
  assert.doesNotMatch(workflow, /VITE_STATIC_DEMO/)
  assert.match(provider, /const publicAppleProvider = createPublicAppleProvider\(\{ fallback: demoProvider \}\)/)
  assert.match(provider, /const publicMusicProvider = createPublicMusicProvider\(\{ apple: publicAppleProvider, fallback: demoProvider \}\)/)
  assert.match(provider, /export const publicBrowserMode = import\.meta\.env\.VITE_PUBLIC_BROWSER === 'true' \|\| !apiBase/)
  assert.match(provider, /publicBrowserMode\s*\? publicMusicProvider\s*:\s*new ApiProvider\(apiBase, publicMusicProvider\)/)
  assert.match(app, /import \{ downloadArtwork, musicProvider, publicBrowserMode, sourceLabel \}/)
  assert.match(app, /const identifiableSources: MusicSource\[\] = musicSources\.filter/)
  assert.match(workflow, /actions\/checkout@v7/)
  assert.match(workflow, /actions\/setup-node@v7/)
  assert.match(workflow, /actions\/configure-pages@v5/)
  assert.match(workflow, /actions\/upload-pages-artifact@v3/)
  assert.match(workflow, /actions\/deploy-pages@v4/)
  assert.match(workflow, /node src\/pagesSmokeCheck\.mjs/)
})

test('local development starts the aggregate API and routes the client through it', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const provider = await readFile(new URL('./services/musicProvider.ts', import.meta.url), 'utf8')
  const dev = await readFile(new URL('../server/dev.mjs', import.meta.url), 'utf8')

  assert.equal(packageJson.scripts.dev, 'node server/dev.mjs')
  assert.equal(packageJson.scripts['dev:client'], 'vite')
  assert.match(provider, /const apiBase = configuredApiBase \|\| \(import\.meta\.env\.DEV \? window\.location\.origin : ''\)/)
  assert.match(provider, /new URL\('\/api\/music\/search', this\.baseUrl\)/)
  assert.doesNotMatch(provider, /new URL\('\/api\/search', this\.baseUrl\)/)
  assert.match(dev, /server\/index\.mjs/)
  assert.match(dev, /node_modules\/vite\/bin\/vite\.js/)
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
  assert.deepEqual(trackColumns.map((match) => Number(match[1])), [40, 40, 44])
})

test('mobile layouts use the dynamic viewport', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const mobile = styles.slice(styles.indexOf('@media (max-width: 820px)'), styles.indexOf('@media (max-width: 420px)'))

  assert.match(styles, /min-height:\s*100dvh/)
  assert.match(styles, /max-height:[^;]*100dvh/)
  assert.match(mobile, /\.mobile-menu,\s*\.sidebar__close,\s*\.avatar\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.nav-group button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.search-box,\s*\.primary-button,\s*\.secondary-button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.search-input-wrap input,\s*\.search-input-wrap button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.search-input-wrap button\s*\{[^}]*min-width:\s*44px/)
  assert.match(mobile, /\.search-hints button,\s*\.search-explore button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.source-filters button,\s*\.playback-filters button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.advanced-search select,\s*\.advanced-search > button,\s*\.search-explore summary,\s*\.id-resolver select,\s*\.id-resolver \.primary-button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.track-row__play\s*\{[^}]*min-width:\s*44px/)
  assert.match(mobile, /\.track-row__actions \.icon-button,\s*\.track-row__actions \.like-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.collection-actions button,\s*\.compact-empty button\s*\{[^}]*min-height:\s*44px/)
  assert.match(mobile, /\.player__progress input\s*\{[^}]*height:\s*44px[^}]*margin-top:\s*-21px/)
  assert.match(styles, /\.settings-field select\s*\{[^}]*min-height:\s*44px/)
  assert.match(styles, /\.choice-buttons button\s*\{[^}]*min-height:\s*44px/)
  assert.match(styles, /\.accent-choices button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/)
  assert.match(styles, /@media \(hover: none\)[\s\S]*?\.search-hints button,\s*\.source-filters button,\s*\.playback-filters button,\s*\.search-explore button\s*\{[^}]*min-height:\s*44px/)
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

test('the UI exposes one music output and defaults to playable-first results', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.equal((app.match(/<audio\b/g) ?? []).length, 1)
  assert.doesNotMatch(app, /new Audio\s*\(/)
  assert.doesNotMatch(app, /AudioContext\s*\(/)
  assert.match(app, /\['demo', 'local', 'fixture'\]\.includes\(source\)/)
  assert.match(app, /useState<PlaybackFilter>\('all'\)/)
  assert.match(app, /全部 · 可播优先/)
  assert.match(app, /无试听（含元数据）/)
  assert.match(app, /仅完整可播/)
  assert.match(app, /diversifyRankedTracks\(refined, refined\.length, \{ prioritizePlayback: false \}\)/)
  assert.match(app, /searchPage\(query, \{ provider: searchSource, page: 1, pageSize: searchPageSize \}/)
  assert.match(app, /完整音源 · 点击验证/)
  assert.match(app, /完整直连 \$\{resultPlaybackCounts\.full\} 首/)
  assert.match(app, /待解析 \$\{resultPlaybackCounts\.candidate\} 首/)
})

test('metadata-only search results open their verified source instead of becoming dead controls', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const resolveAndPlay = app.slice(app.indexOf('const resolveAndPlay'), app.indexOf('const startCurrent'))

  assert.match(app, /playbackUnavailable \? false : playControlDisabled/)
  assert.match(resolveAndPlay, /target\.capabilities\.playback === 'none'[\s\S]*?cancelPendingPlay\(\)[\s\S]*?window\.open\(target\.sourceUrl, '_blank', 'noopener,noreferrer'\)/)
  assert.match(app, /站内不可播 · 点击左侧前往来源/)
})

test('Audius playback avoids CORS-only probes and still recovers from real media failures', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const provider = await readFile(new URL('./services/musicProvider.ts', import.meta.url), 'utf8')
  const publicProvider = await readFile(new URL('./services/publicMusicProvider.mjs', import.meta.url), 'utf8')
  const resolveAndPlay = app.slice(app.indexOf('const resolveAndPlay'), app.indexOf('const startCurrent'))

  assert.doesNotMatch(provider, /verifyPublicAudioUrl/)
  assert.doesNotMatch(publicProvider, /verifyPublicAudioUrl/)
  assert.match(publicProvider, /const audiusStreamUrl[\s\S]*?new URL\(`tracks\/\$\{id\}\/stream`, AUDIUS_API\)/)
  assert.match(resolveAndPlay, /restricted[\s\S]*?markPlaybackUnavailable\(target\)/)
  assert.match(app, /音源已失效，点击播放可重新连接/)
})

test('overlay scrims expose distinct accessible close actions', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /className="scrim"[^>]*aria-label="关闭侧边导航"/)
  assert.match(app, /className="queue-scrim"[^>]*aria-label="关闭队列背景"/)
  assert.match(app, /className="dialog-scrim"[^>]*aria-label="关闭歌单窗口背景"/)
  assert.match(app, /className="dialog-scrim"[^>]*aria-label="关闭歌词窗口背景"/)
})

test('playable-first search keeps its TypeScript declaration in sync', async () => {
  const declaration = await readFile(new URL('./searchLogic.d.mts', import.meta.url), 'utf8')

  assert.match(declaration, /export declare const prioritizePlayableTracks: <T extends \{ capabilities: \{ playback: string \} \}>/)
})

test('playlist recommendations stay derived, cancellable, and free of previews', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const logic = await readFile(new URL('./recommendationLogic.mjs', import.meta.url), 'utf8')

  assert.match(app, /recommendationControllerRef\.current\?\.abort\(\)/)
  assert.match(app, /mergeRecommendationPages\(playlist\.tracks, append \? playlistRecommendations : \[\], filtered, 500\)/)
  assert.match(app, /shouldPrefetchRecommendations/)
  assert.match(app, /continuousPlaylistId/)
  assert.match(app, /useState\(8\)/)
  assert.match(app, /playlistRecommendations\.slice\(0, recommendationVisibleLimit\)/)
  assert.match(app, /推荐理由：\$\{reason\}/)
  assert.match(app, /相似推荐/)
  assert.doesNotMatch(app, /listener\.recommend/)
  assert.match(logic, /playback === 'preview'/)
})

test('the homepage loads global and regional pop searches from a real provider instead of fixtures', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /const queries = \['周杰伦', 'Taylor Swift', 'The Weeknd', 'Dua Lipa', 'Bruno Mars'\]/)
  assert.match(app, /if \(view !== 'discover'\) return/)
  assert.match(app, /const provider: MusicSource = 'apple'/)
  assert.match(app, /musicProvider\.searchPage\(query, \{ provider, pageSize: 2 \}/)
  assert.match(app, /全球流行精选/)
  assert.doesNotMatch(app, /initialTracks\.slice\(0, 4\)\.map/)
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

test('mobile result summaries stack without squeezing the search heading', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const mobile = styles.slice(styles.indexOf('@media (max-width: 820px)'), styles.indexOf('@media (max-width: 420px)'))

  assert.match(mobile, /\.results-section \.section-heading\s*\{[^}]*flex-direction:\s*column/)
  assert.match(mobile, /\.results-section \.section-heading > div\s*\{[^}]*width:\s*100%/)
})

test('secondary exploration stays collapsed so mobile search results remain near the first viewport', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  const narrow = styles.slice(styles.indexOf('@media (max-width: 420px)'), styles.indexOf('@media (max-width: 350px)'))

  assert.match(app, /<details className="search-explore">/)
  assert.doesNotMatch(app, /<details className="search-explore" open>/)
  assert.doesNotMatch(narrow, /\.advanced-search\s*\{[^}]*grid-template-columns:\s*1fr/)
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.search-hero\s*\{[^}]*padding:\s*24px 0 12px/)
})

test('main search can extend across bounded pages without discarding earlier results', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.match(app, /const searchMaxPages = 10/)
  assert.match(app, /musicProvider\.searchPage\(query, \{ provider: searchSource, page: nextPage, pageSize: searchPageSize \}/)
  assert.match(app, /mergeSearchPages\(previous, found\.tracks, searchResultLimit\)/)
  assert.match(app, /继续搜索更多/)
  assert.match(app, /继续寻找完整歌曲/)
  assert.match(app, /已达到本次搜索上限/)
  assert.match(app, /重试寻找完整歌曲/)
  assert.match(app, /searchMoreControllerRef\.current\?\.abort\(\)/)
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.search-pagination \.secondary-button\s*\{[^}]*min-height:\s*44px/)
})

test('a new search clears a stale result-source filter', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const searchEffect = app.slice(app.indexOf('const inputMode'), app.indexOf('const loadMoreSearchResults'))

  assert.match(searchEffect, /setSourceFilter\('all'\)/)
})

test('ID resolution aborts an active keyword search', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const searchEffect = app.slice(app.indexOf('const inputMode'), app.indexOf('const currentKey'))
  const identifyInput = app.slice(app.indexOf('const identifyInput'), app.indexOf('const removeFromQueue'))

  assert.match(app, /const searchControllerRef = useRef<AbortController \| null>\(null\)/)
  assert.match(searchEffect, /searchControllerRef\.current = controller/)
  assert.match(identifyInput, /searchControllerRef\.current\?\.abort\(\)/)
})

test('degraded searches distinguish public results and expose an explicit retry', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /const \[searchRevision, setSearchRevision\] = useState\(0\)/)
  assert.match(app, /}, \[query, searchRevision, searchSource\]\)/)
  assert.match(app, /聚合服务离线，已切换公共搜索/)
  assert.match(app, /所选音乐源暂不可用/)
  assert.match(app, /const demoSearchFallback = searchDegraded && resultSources\.some/)
  assert.match(app, /onClick=\{\(\) => setSearchRevision\(\(value\) => value \+ 1\)\}/)
})

test('search can target every currently connected provider before results load', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /const \[searchSource, setSearchSource\] = useState<'all' \| MusicSource>\('all'\)/)
  assert.match(app, /providerStatus\.sources\.filter\(\(source\) => providerStatus\.capabilities\[source\]\?\.search/)
  assert.match(app, /musicProvider\.searchPage\(query, \{ provider: searchSource, page: 1, pageSize: searchPageSize \}, controller\.signal\)/)
  assert.match(app, /<select aria-label="搜索音乐源" value=\{searchSource\}/)
  assert.match(app, /searchableSources\.map\(\(source\) => <option key=\{source\} value=\{source\}>\{sourceLabel\(source\)\}<\/option>\)/)
})

test('the static UI advertises public multi-source search and full-track playback honestly', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /公共多平台搜索/)
  assert.match(app, /Apple Music、Audius、MusicBrainz、Wikimedia Commons 与 Internet Archive/)
  assert.match(app, /Archive 已支持 MP3、Ogg\/OGA、FLAC、M4A、AAC、Opus 与 WAV/)
  assert.doesNotMatch(app, />Apple Music 搜索</)
})

test('playlist delete confirmation expires automatically', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /if \(!pendingDeletePlaylistId\) return\s+const timeout = window\.setTimeout\(\(\) => setPendingDeletePlaylistId\(null\), 5_000\)/)
})

test('an invalidated audio source clears stale progress metadata', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const handler = app.slice(app.indexOf('const handleAudioError'), app.indexOf('const seekTo'))

  assert.match(app, /const mediaRetryKeyRef = useRef<string \| null>\(null\)/)
  assert.match(handler, /mediaErrorAction\(/)
  assert.match(handler, /audio\.load\(\)[\s\S]*?attemptPlayback\(audio\)/)
  assert.match(handler, /setProgress\(0\)/)
  assert.match(handler, /setDuration\(initialPlaybackDuration\(invalidated\)\)/)
})

test('switching tracks cancels retry timers and the previous media request', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const playTrack = app.slice(app.indexOf('const playTrack'), app.indexOf('const resolveAndPlay'))

  assert.match(playTrack, /if \(mediaLoadKey\(track\) !== currentMediaKey\)\s*{[\s\S]*?cancelMediaRetry\(\)[\s\S]*?audio\.removeAttribute\('src'\)[\s\S]*?audio\.load\(\)/)
})

test('media errors own playback failure feedback without a competing promise notice', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const attemptPlayback = app.slice(app.indexOf('const attemptPlayback'), app.indexOf('const isCurrentAudio'))

  assert.match(attemptPlayback, /if \(audioRef\.current !== audio \|\| audio\.error\) return/)
})

test('a stalled audio source cannot leave the player buffering forever', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const buffering = app.slice(app.indexOf('const clearBufferingTimeout'), app.indexOf('const cancelMediaRetry'))
  const mediaFailure = app.slice(app.indexOf('const handleAudioError'), app.indexOf('const seekTo'))

  assert.match(app, /const bufferingTimerRef = useRef<number>\(\)/)
  assert.match(buffering, /window\.setTimeout\([\s\S]*?handleAudioError\(audio\)[\s\S]*?5_000/)
  assert.match(app, /nextDirectFullTrack\(queue, currentKey\)[\s\S]*?当前音源失效，正在切换下一首完整歌曲/)
  assert.match(mediaFailure, /setHomeTracks\(\(previous\) => previous\.map\(update\)\)/)
  assert.match(mediaFailure, /setPlaylistRecommendations\([\s\S]*?track: update\(recommendation\.track\)/)
  assert.match(mediaFailure, /setHistory\([\s\S]*?track: update\(item\.track\)/)
  assert.match(mediaFailure, /setQueue\(\(previous\) => queueWithoutTrack\(previous, currentKey\)\)/)
  assert.match(app, /onPlaying=\{\(event\) => \{ if \(isCurrentAudio\(event\.currentTarget\)\) \{ clearBufferingTimeout\(\)/)
  assert.match(app, /onPause=\{\(event\) => \{ if \(isCurrentAudio\(event\.currentTarget\)\) \{ clearBufferingTimeout\(\)/)
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
