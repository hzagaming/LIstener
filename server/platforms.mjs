const numeric = /^\d+$/
const alphaNumeric = /^[A-Za-z0-9_-]+$/
const kugouHash = /^[a-fA-F0-9]{32}$/
const qingtingId = /^\d+\|\d+$/
const musicBrainzId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const audiusId = /^[A-Za-z0-9_-]{1,128}$/

const matchPath = (url, pattern) => pattern.exec(url.pathname)?.[1]
const queryValue = (url, name) => url.searchParams.get(name) ?? new URLSearchParams(
  url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : url.hash.slice(1),
).get(name)
const fragmentValue = (url, name) => new URLSearchParams(
  url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '',
).get(name)
const isNeteaseTrackRoute = (url) => /^\/song\/?$/i.test(url.pathname)
  || /^\/song\/media\/outer\/url\/?$/i.test(url.pathname)
const isNeteaseHashTrackRoute = (url) => /^\/?$/i.test(url.pathname)
  && /^#\/song(?:\?|$)/i.test(url.hash)

const definitions = [
  {
    source: 'netease',
    hosts: ['music.163.com'],
    validate: (id) => numeric.test(id),
    match: (url) => {
      const id = isNeteaseHashTrackRoute(url)
        ? fragmentValue(url, 'id')
        : isNeteaseTrackRoute(url) ? url.searchParams.get('id') : undefined
      return /^(\d+)(?:\.mp3)?$/.exec(id ?? '')?.[1]
    },
    canonical: (id) => `https://music.163.com/#/song?id=${id}`,
  },
  {
    source: 'qq',
    hosts: ['y.qq.com'],
    validate: (id) => alphaNumeric.test(id),
    match: (url) => matchPath(url, /^\/n\/yqq\/song\/([A-Za-z0-9_-]+)(?:\.html)?\/?$/i),
    canonical: (id) => `https://y.qq.com/n/yqq/song/${id}.html`,
  },
  {
    source: 'kugou',
    hosts: ['kugou.com'],
    validate: (id) => kugouHash.test(id),
    normalize: (id) => id.toLowerCase(),
    match: (url) => /^\/song\/?$/i.test(url.pathname) ? queryValue(url, 'hash') : undefined,
    canonical: (id) => `https://www.kugou.com/song/#hash=${id.toLowerCase()}`,
  },
  {
    source: 'kuwo',
    hosts: ['kuwo.cn'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/play_detail\/(\d+)\/?$/i),
    canonical: (id) => `https://www.kuwo.cn/play_detail/${id}/`,
  },
  {
    source: 'qianqian',
    hosts: ['music.taihe.com'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/song\/(\d+)\/?$/i),
    canonical: (id) => `https://music.taihe.com/song/${id}`,
  },
  {
    source: '1ting',
    hosts: ['1ting.com'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/(?:.*\/)?player_(\d+)\.html$/i),
    canonical: (id) => `https://www.1ting.com/player/player_${id}.html`,
  },
  {
    source: 'migu',
    hosts: ['music.migu.cn'],
    validate: (id) => alphaNumeric.test(id),
    match: (url) => matchPath(url, /^\/v3\/music\/song\/([A-Za-z0-9_-]+)\/?$/i),
    canonical: (id) => `https://music.migu.cn/v3/music/song/${id}`,
  },
  {
    source: 'lizhi',
    hosts: ['lizhi.fm'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/\d+\/(\d+)\/?$/i),
    canonical: (id) => `https://www.lizhi.fm/0/${id}`,
  },
  {
    source: 'qingting',
    hosts: ['qingting.fm'],
    validate: (id) => qingtingId.test(id),
    match: (url) => {
      const match = /^\/channels\/(\d+)\/programs\/(\d+)\/?$/i.exec(url.pathname)
      return match ? `${match[1]}|${match[2]}` : undefined
    },
    canonical: (id) => {
      const [channel, program] = id.split('|')
      return `https://www.qingting.fm/channels/${channel}/programs/${program}`
    },
  },
  {
    source: 'ximalaya',
    hosts: ['ximalaya.com'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^(?:\/[^/]+)*\/sound\/(\d+)\/?$/i),
    canonical: (id) => `https://www.ximalaya.com/sound/${id}`,
  },
  {
    source: '5sing-original',
    hosts: ['5sing.kugou.com'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/yc\/(\d+)\.html$/i),
    canonical: (id) => `https://5sing.kugou.com/yc/${id}.html`,
  },
  {
    source: '5sing-cover',
    hosts: ['5sing.kugou.com'],
    validate: (id) => numeric.test(id),
    match: (url) => matchPath(url, /^\/fc\/(\d+)\.html$/i),
    canonical: (id) => `https://5sing.kugou.com/fc/${id}.html`,
  },
  {
    source: 'qmkg',
    hosts: ['kg.qq.com'],
    validate: (id) => alphaNumeric.test(id),
    match: (url) => /^\/node\/play\/?$/i.test(url.pathname) ? queryValue(url, 's') : undefined,
    canonical: (id) => `https://kg.qq.com/node/play?s=${id}`,
  },
  {
    source: 'apple',
    hosts: ['music.apple.com'],
    validate: (id) => numeric.test(id),
    match: (url) => queryValue(url, 'i') ?? matchPath(url, /^\/[^/]+\/song\/(?:[^/]+\/)?(\d+)\/?$/i),
    canonical: (id) => `https://music.apple.com/cn/song/${id}`,
  },
  {
    source: 'musicbrainz',
    hosts: ['musicbrainz.org'],
    validate: (id) => musicBrainzId.test(id),
    normalize: (id) => id.toLowerCase(),
    match: (url) => matchPath(url, /^\/recording\/([0-9a-f-]+)\/?$/i),
    canonical: (id) => `https://musicbrainz.org/recording/${id.toLowerCase()}`,
  },
  {
    source: 'audius',
    hosts: ['api.audius.co'],
    validate: (id) => audiusId.test(id),
    match: (url) => matchPath(url, /^\/v1\/tracks\/([A-Za-z0-9_-]+)\/?$/i),
    canonical: (id) => `https://api.audius.co/v1/tracks/${id}`,
  },
  {
    source: 'wikimedia',
    hosts: ['commons.wikimedia.org'],
    validate: (id) => numeric.test(id),
    match: (url) => url.searchParams.get('curid') ?? undefined,
    canonical: (id) => `https://commons.wikimedia.org/?curid=${id}`,
  },
]

export const platformSources = definitions.map(({ source }) => source)

export const identifyMusicInput = (input, preferredSource) => {
  const value = typeof input === 'string' ? input.normalize('NFKC').trim() : ''
  if (!value || value.length > 2_048) return null

  if (preferredSource) {
    const definition = definitions.find(({ source }) => source === preferredSource)
    if (!definition || !definition.validate(value)) return null
    const id = definition.normalize?.(value) ?? value
    return { source: definition.source, id, canonicalUrl: definition.canonical(id) }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(value)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null

  for (const definition of definitions) {
    const hostname = parsedUrl.hostname.toLocaleLowerCase()
    if (!definition.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) continue
    const matchedId = definition.match(parsedUrl)
    if (matchedId && definition.validate(matchedId)) {
      const id = definition.normalize?.(matchedId) ?? matchedId
      return { source: definition.source, id, canonicalUrl: definition.canonical(id) }
    }
  }
  return null
}
