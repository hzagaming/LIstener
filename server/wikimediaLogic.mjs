export const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php'
export const wikimediaPageId = /^\d+$/

const browserAudioExtension = /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i
const oggExtension = /\.(?:ogg|oga)$/i
const losslessExtension = /\.(?:flac|wav)$/i

const safeUrl = (value, hostname) => {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password || url.port) return null
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLocaleLowerCase().startsWith('utm_')) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

const durationSeconds = (value) => {
  const duration = Number(value)
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0
}

export const normalizeWikimediaPage = (page) => {
  const id = String(page?.pageid ?? '')
  const title = typeof page?.title === 'string'
    ? page.title.replace(/^File:/i, '').replace(browserAudioExtension, '').trim()
    : ''
  const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null
  if (!wikimediaPageId.test(id) || !title || !info) return null

  const audioUrl = safeUrl(info.url, 'upload.wikimedia.org')
  const sourceUrl = info.descriptionurl
    ? safeUrl(info.descriptionurl, 'commons.wikimedia.org')
    : `https://commons.wikimedia.org/?curid=${id}`
  if (!audioUrl || !sourceUrl) return null
  const audioPath = new URL(audioUrl).pathname
  const mime = typeof info.mime === 'string' ? info.mime.toLocaleLowerCase() : ''
  const playable = browserAudioExtension.test(audioPath)
    && (mime.startsWith('audio/') || (mime === 'application/ogg' && oggExtension.test(audioPath)))
  if (!playable) return null

  return {
    id,
    title,
    artist: typeof info.user === 'string' && info.user.trim() ? info.user.trim() : '未知上传者',
    album: 'Wikimedia Commons',
    duration: durationSeconds(info.extmetadata?.Duration?.value),
    source: 'wikimedia',
    audioUrl,
    cover: 'gold',
    sourceUrl,
    quality: losslessExtension.test(audioPath) ? 'lossless' : 'standard',
    capabilities: { playback: 'full', lyrics: false, download: true },
  }
}

export const createWikimediaQuery = (endpoint = WIKIMEDIA_API) => {
  const url = new URL(endpoint)
  url.searchParams.set('action', 'query')
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|mime|user|extmetadata')
  url.searchParams.set('iiextmetadatafilter', 'Duration')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  url.searchParams.set('origin', '*')
  url.searchParams.set('maxage', '300')
  url.searchParams.set('smaxage', '300')
  return url
}
