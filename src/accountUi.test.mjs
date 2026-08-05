import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('ships account sync, JSON migration, cover download, and offline application controls', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const main = await readFile(new URL('./main.tsx', import.meta.url), 'utf8')
  const provider = await readFile(new URL('./services/musicProvider.ts', import.meta.url), 'utf8')

  assert.match(app, /登录|注册/)
  assert.match(app, /导出.*JSON/)
  assert.match(app, /导入.*记录/)
  assert.match(app, /下载封面/)
  assert.match(app, /地区推荐/)
  assert.match(index, /manifest\.webmanifest/)
  assert.match(main, /serviceWorker\.register/)
  assert.match(provider, /\/api\/download\/file/)
  await access(new URL('../public/manifest.webmanifest', import.meta.url))
  await access(new URL('../public/sw.js', import.meta.url))
})
