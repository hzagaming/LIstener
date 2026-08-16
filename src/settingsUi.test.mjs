import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('ships a settings center with playback, appearance, source, and project controls', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /设置中心/)
  assert.match(app, /顺序播放/)
  assert.match(app, /随机播放/)
  assert.match(app, /单曲循环/)
  assert.match(app, /磁带/)
  assert.match(app, /界面字号/)
  assert.match(app, /圆角风格/)
  assert.match(app, /播放器布局/)
  assert.match(app, /背景纹理/)
  assert.match(app, /音乐源能力/)
  assert.match(app, /identifiableSources\.map\(\(source\) =>/)
  assert.match(app, /全民 K 歌原生能力仅支持 ID 或地址解析；配置公开网页目录后可检索已索引作品页/)
  assert.match(app, /YouTube Music 使用官方 Data API 搜索元数据，不抽取音视频/)
  assert.match(app, /静态版可直连 Apple Music、Audius、MusicBrainz、Wikimedia Commons 与 Internet Archive/)
  assert.match(app, /YouTube Music 与其余平台名称搜索仍需部署服务端及对应 Key/)
  assert.match(app, /Listener 1\.0\.0/)
  assert.match(app, /地址 \/ ID 解析/)
  assert.match(app, /if \(!providerStatus\.sources\.includes\(match\.source\)\)/)
  assert.match(app, /https:\/\/github\.com\/hzagaming\/LIstener\/issues/)
  assert.match(app, /https:\/\/github\.com\/hzagaming\/LIstener\/commits\/main/)
  assert.match(app, /https:\/\/github\.com\/hzagaming\/LIstener\/releases/)
  assert.match(app, /当前版本公告/)
  assert.match(app, /https:\/\/github\.com\/hzagaming\/LIstener\/blob\/main\/CHANGELOG\.md/)
  assert.doesNotMatch(app, /releases\/tag\/v0\.10\.\d+/)
  assert.match(app, /https:\/\/github\.com\/hzagaming/)
})

test('ships advanced search fields, duration, sorting, and curated discovery entry points', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /搜索字段/)
  assert.match(app, /歌曲名/)
  assert.match(app, /时长范围/)
  assert.match(app, /结果排序/)
  assert.match(app, /流派/)
  assert.match(app, /场景/)
  assert.match(app, /年代/)
  assert.match(app, /地区/)
})

test('keeps discovery controls readable at night and touch friendly', async () => {
  const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

  assert.match(styles, /:root\[data-theme='night'\] \.search-explore button[^}]*color: var\(--muted\)/)
  assert.match(styles, /@media \(hover: none\)[\s\S]*\.search-explore button[^}]*min-height: 44px/)
  const narrowStyles = styles.slice(styles.indexOf('@media (max-width: 820px)'), styles.indexOf('@media (max-width: 420px)'))
  assert.match(narrowStyles, /\.search-explore button[^}]*min-height: 44px/)
  assert.match(styles, /\.app-shell\[data-font-scale\] :where\(\.nav-group button\)/)
  assert.match(styles, /\.source--youtube[^}]*color:/)
})
