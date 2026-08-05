const MAX_STATE_BYTES = 1_048_576
const qualities = new Set(['unknown', 'standard', 'high', 'lossless', 'hi-res'])
const playbackModes = new Set(['none', 'preview', 'full'])
const artworkToken = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const sourceId = /^[a-z0-9-]{1,32}$/

const safeUrl = (value, allowEmpty = false) => {
  if (typeof value !== 'string' || (!value && !allowEmpty)) return false
  if (!value) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

const text = (value, maximum) => typeof value === 'string' && value.length <= maximum
const validTrack = (value) => value && typeof value === 'object'
  && text(value.id, 256) && value.id.length > 0
  && text(value.title, 300) && text(value.artist, 300) && text(value.album, 300)
  && Number.isFinite(value.duration) && value.duration >= 0
  && typeof value.source === 'string' && sourceId.test(value.source)
  && safeUrl(value.audioUrl, true) && safeUrl(value.sourceUrl)
  && typeof value.cover === 'string' && (artworkToken.test(value.cover) || safeUrl(value.cover))
  && qualities.has(value.quality)
  && value.capabilities && typeof value.capabilities === 'object'
  && playbackModes.has(value.capabilities.playback)
  && typeof value.capabilities.lyrics === 'boolean'
  && typeof value.capabilities.download === 'boolean'

const cloneTrack = (track) => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  duration: track.duration,
  source: track.source,
  audioUrl: track.audioUrl,
  cover: track.cover,
  sourceUrl: track.sourceUrl,
  quality: track.quality,
  capabilities: {
    playback: track.capabilities.playback,
    lyrics: track.capabilities.lyrics,
    download: track.capabilities.download,
  },
})

const collection = (value, maximum, validator, mapper) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => !validator(item))) {
    throw new Error('invalid user state')
  }
  return value.map(mapper)
}

const validPlaylist = (value) => value && typeof value === 'object'
  && text(value.id, 128) && value.id.length > 0
  && text(value.title, 100) && value.title.trim().length > 0
  && text(value.description, 500)
  && typeof value.cover === 'string' && (artworkToken.test(value.cover) || safeUrl(value.cover))
  && Array.isArray(value.tracks) && value.tracks.length <= 500 && value.tracks.every(validTrack)

const clonePlaylist = (playlist) => ({
  id: playlist.id,
  title: playlist.title,
  description: playlist.description,
  cover: playlist.cover,
  tracks: playlist.tracks.map(cloneTrack),
})

export const normalizeUserState = (value) => {
  let bytes
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new Error('invalid user state')
  }
  if (bytes > MAX_STATE_BYTES) throw new Error('user state is too large')
  if (!value || typeof value !== 'object' || (value.version !== undefined && value.version !== 1)) {
    throw new Error('invalid user state')
  }

  const settings = value.settings === undefined ? {} : value.settings
  if (!settings || typeof settings !== 'object') throw new Error('invalid user state')
  const volume = settings.volume ?? 0.72
  const repeat = settings.repeat ?? 'off'
  const shuffle = settings.shuffle ?? false
  const regionalRecommendations = settings.regionalRecommendations ?? true
  const region = String(settings.region ?? '').toUpperCase()
  const theme = settings.theme ?? 'system'
  const coverStyle = settings.coverStyle ?? 'vinyl'
  const accent = settings.accent ?? 'orange'
  const density = settings.density ?? 'comfortable'
  const reduceMotion = settings.reduceMotion ?? false
  const fontScale = settings.fontScale ?? 'standard'
  const cornerStyle = settings.cornerStyle ?? 'soft'
  const playerLayout = settings.playerLayout ?? 'docked'
  const backgroundTexture = settings.backgroundTexture ?? 'paper'
  if (!Number.isFinite(volume) || volume < 0 || volume > 1
    || !['off', 'all', 'one'].includes(repeat)
    || typeof shuffle !== 'boolean'
    || typeof regionalRecommendations !== 'boolean'
    || (region && !/^[A-Z]{2}$/.test(region))
    || !['system', 'paper', 'night'].includes(theme)
    || !['vinyl', 'cassette', 'minimal'].includes(coverStyle)
    || !['orange', 'blue', 'green'].includes(accent)
    || !['comfortable', 'compact'].includes(density)
    || typeof reduceMotion !== 'boolean'
    || !['small', 'standard', 'large'].includes(fontScale)
    || !['square', 'soft', 'round'].includes(cornerStyle)
    || !['docked', 'floating'].includes(playerLayout)
    || !['none', 'paper', 'grid'].includes(backgroundTexture)) {
    throw new Error('invalid user state')
  }

  const current = value.current == null ? null : value.current
  if (current && !validTrack(current)) throw new Error('invalid user state')
  const history = collection(
    value.history,
    500,
    (item) => item && validTrack(item.track) && Number.isSafeInteger(item.playedAt) && item.playedAt > 0,
    (item) => ({ track: cloneTrack(item.track), playedAt: item.playedAt }),
  )

  return {
    version: 1,
    liked: collection(value.liked, 1_000, validTrack, cloneTrack),
    playlists: collection(value.playlists, 50, validPlaylist, clonePlaylist),
    queue: collection(value.queue, 500, validTrack, cloneTrack),
    current: current ? cloneTrack(current) : null,
    history,
    settings: {
      volume, repeat, shuffle, regionalRecommendations, region,
      theme, coverStyle, accent, density, reduceMotion,
      fontScale, cornerStyle, playerLayout, backgroundTexture,
    },
  }
}
