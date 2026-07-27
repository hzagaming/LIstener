import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('the document icon points to a shipped public asset', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  const iconPath = html.match(/<link\s+rel=["']icon["']\s+href=["']([^"']+)["']/)?.[1]

  assert.ok(iconPath?.startsWith('/'), 'index.html must declare a root-relative icon')
  await access(new URL(`../public${iconPath}`, import.meta.url))
})
