export const ARCHIVE_BASE_URL = 'https://archive.org/'
const MAX_AUDIO_BYTES = 134_217_728
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const audioFormats = new Map([
  ['.mp3', /mp3/i],
  ['.ogg', /ogg vorbis/i],
  ['.oga', /ogg vorbis/i],
  ['.flac', /flac/i],
  ['.m4a', /(?:m4a|mpeg-4 audio|aac)/i],
  ['.aac', /aac/i],
  ['.opus', /opus/i],
  ['.wav', /(?:wave|wav)/i],
])

const text = (value, fallback = '') => {
  const candidate = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value
  return typeof candidate === 'string' ? candidate.normalize('NFKC').trim().slice(0, 300) : fallback
}

const safeFilename = (value) => {
  if (typeof value !== 'string' || !value || value.length > 180) return ''
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized === '.' || normalized === '..' || /[\\/\u0000-\u001f\u007f]/.test(normalized)) return ''
  const extension = normalized.match(/\.[a-z0-9]{3,5}$/i)?.[0].toLocaleLowerCase()
  return extension && audioFormats.has(extension) ? normalized : ''
}

const openLicense = (value) => {
  const license = text(value)
  if (!license) return false
  try {
    const url = new URL(license)
    const host = url.hostname.toLocaleLowerCase()
    if (!['creativecommons.org', 'www.creativecommons.org'].includes(host) || url.protocol !== 'https:') return false
    return /^\/licenses\/(?:by(?:-nc)?(?:-nd|-sa)?|by-nc(?:-nd|-sa)?)\/\d\.\d\/?$/i.test(url.pathname)
      || /^\/publicdomain\/(?:mark|zero)\/\d\.\d\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

const durationSeconds = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value !== 'string') return 0
  const direct = Number(value)
  if (Number.isFinite(direct)) return Math.max(0, Math.round(direct))
  const parts = value.split(':').map(Number)
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0))
}

const playableFile = (file) => {
  const name = safeFilename(file?.name)
  const extension = name.match(/\.[a-z0-9]{3,5}$/i)?.[0].toLocaleLowerCase()
  const size = Number(file?.size)
  return name && extension && audioFormats.get(extension)?.test(text(file?.format))
    && Number.isSafeInteger(size) && size > 0 && size <= MAX_AUDIO_BYTES
    ? { ...file, name, extension }
    : null
}

export const archiveIdentifier = (value) => typeof value === 'string' && identifierPattern.test(value) ? value : ''
export const archiveMediaUrl = (identifier, name) => `${ARCHIVE_BASE_URL}download/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`
export const archiveDetailsUrl = (identifier) => `${ARCHIVE_BASE_URL}details/${encodeURIComponent(identifier)}`
export const archiveTrackId = (identifier, name) => `${identifier}/${encodeURIComponent(name)}`

export const parseArchiveTrackId = (value) => {
  const requested = String(value)
  const separator = requested.indexOf('/')
  const identifier = separator === -1 ? requested : requested.slice(0, separator)
  if (!archiveIdentifier(identifier)) throw new Error('invalid Internet Archive track id')
  if (separator === -1) return { identifier, filename: '' }
  let filename
  try { filename = decodeURIComponent(requested.slice(separator + 1)) } catch { throw new Error('invalid Internet Archive track id') }
  filename = safeFilename(filename)
  if (!filename || archiveTrackId(identifier, filename) !== requested || requested.length > 256) {
    throw new Error('invalid Internet Archive track id')
  }
  return { identifier, filename }
}

export const archiveSearchUrl = (query, page = 1) => {
  const phrase = query.replace(/[\\"]/g, '\\$&')
  const url = new URL('/advancedsearch.php', ARCHIVE_BASE_URL)
  url.searchParams.set('q', `(title:"${phrase}" OR creator:"${phrase}" OR subject:"${phrase}") AND mediatype:audio AND NOT access-restricted-item:true`)
  for (const field of ['identifier', 'mediatype', 'title', 'creator']) url.searchParams.append('fl[]', field)
  url.searchParams.set('rows', '10')
  url.searchParams.set('page', String(Math.min(100, Math.max(1, page))))
  url.searchParams.set('output', 'json')
  return url
}

export const archiveSearchIdentifiers = (payload) => {
  if (!Array.isArray(payload?.response?.docs)) throw new Error('invalid Internet Archive response')
  return payload.response.docs.flatMap((document) => (
    archiveIdentifier(document?.identifier) && (!document.mediatype || text(document.mediatype) === 'audio')
      ? [document.identifier]
      : []
  )).slice(0, 10)
}

export const archiveSearchHasMore = (payload, page = 1) => {
  archiveSearchIdentifiers(payload)
  const total = Number(payload.response.numFound)
  return Number.isSafeInteger(total) && total >= 0
    ? Math.min(100, Math.max(1, page)) * 10 < total
    : payload.response.docs.length >= 10
}

export const normalizeArchiveItem = (item, requestedIdentifier) => {
  const metadata = item?.metadata
  const identifier = text(metadata?.identifier)
  if (identifier !== requestedIdentifier || !archiveIdentifier(identifier) || text(metadata?.mediatype) !== 'audio') return []
  const album = text(metadata.title, 'Internet Archive')
  const creator = text(metadata.creator, '未知上传者')
  const downloadable = openLicense(metadata.licenseurl)
  if (!Array.isArray(item.files)) return []
  return item.files.flatMap((candidate) => {
    const file = playableFile(candidate)
    if (!file) return []
    const id = archiveTrackId(identifier, file.name)
    if (id.length > 256) return []
    return [{
      id,
      title: text(file.title) || file.name.replace(/\.[a-z0-9]{3,5}$/i, '').trim() || '未知曲目',
      artist: text(file.artist, creator),
      album,
      duration: durationSeconds(file.length),
      source: 'internetarchive',
      audioUrl: archiveMediaUrl(identifier, file.name),
      cover: 'gold',
      sourceUrl: archiveDetailsUrl(identifier),
      quality: ['.flac', '.wav'].includes(file.extension) ? 'lossless' : 'standard',
      capabilities: { playback: 'full', lyrics: false, download: downloadable },
    }]
  })
}

export const interleaveArchiveTracks = (groups, limit) => {
  const tracks = []
  for (let index = 0; tracks.length < limit; index += 1) {
    let progressed = false
    for (const group of groups) {
      if (!group[index]) continue
      tracks.push(group[index])
      progressed = true
      if (tracks.length === limit) break
    }
    if (!progressed) break
  }
  return tracks
}

export const archiveDownload = (track) => {
  if (!track?.capabilities?.download) {
    throw Object.assign(new Error('Internet Archive download is not explicitly licensed'), {
      code: 'CAPABILITY_UNAVAILABLE',
    })
  }
  const extension = new URL(track.audioUrl).pathname.match(/\.[a-z0-9]{3,5}$/i)?.[0] || '.audio'
  return { url: track.audioUrl, filename: `${track.title}${extension}` }
}
