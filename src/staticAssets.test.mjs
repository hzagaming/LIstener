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

test('GitHub Pages deploys dist without probing an unavailable API', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8')

  assert.match(workflow, /path:\s*\.\/dist/)
  assert.match(workflow, /VITE_STATIC_DEMO:\s*['"]true['"]/)
  assert.match(workflow, /actions\/deploy-pages@/)
})

test('the first render does not depend on external stylesheets', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.doesNotMatch(styles, /@import\s+(?:url\()?['"]?https?:\/\//i)
})
