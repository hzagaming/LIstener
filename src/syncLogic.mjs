const defaults = {
  volume: 0.72,
  repeat: 'off',
  shuffle: false,
  regionalRecommendations: true,
  region: '',
  theme: 'system',
  coverStyle: 'vinyl',
  accent: 'orange',
  density: 'comfortable',
  reduceMotion: false,
  fontScale: 'standard',
  cornerStyle: 'soft',
  playerLayout: 'docked',
  backgroundTexture: 'paper',
}

const uniqueTracks = (items, isTrack, maximum) => {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((track) => {
    if (!isTrack(track)) return false
    const key = `${track.source}:${track.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, maximum)
}

export const normalizeLibraryData = (value, { isTrack, isPlaylist }) => {
  const input = value && typeof value === 'object' ? value : {}
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {}
  const volume = Number(settings.volume)
  const region = typeof settings.region === 'string' && /^[a-z]{2}$/i.test(settings.region) ? settings.region.toUpperCase() : ''
  const history = (Array.isArray(input.history) ? input.history : [])
    .filter((item) => item && isTrack(item.track) && Number.isSafeInteger(item.playedAt) && item.playedAt > 0)
    .sort((left, right) => right.playedAt - left.playedAt)
    .slice(0, 500)
  return {
    version: 1,
    liked: uniqueTracks(input.liked, isTrack, 1_000),
    playlists: (Array.isArray(input.playlists) ? input.playlists : [])
      .filter(isPlaylist)
      .slice(0, 50)
      .map((playlist) => ({ ...playlist, tracks: uniqueTracks(playlist.tracks, isTrack, 500) })),
    queue: uniqueTracks(input.queue, isTrack, 500),
    current: isTrack(input.current) ? input.current : null,
    history,
    settings: {
      volume: Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : defaults.volume,
      repeat: ['off', 'all', 'one'].includes(settings.repeat) ? settings.repeat : defaults.repeat,
      shuffle: typeof settings.shuffle === 'boolean' ? settings.shuffle : defaults.shuffle,
      regionalRecommendations: typeof settings.regionalRecommendations === 'boolean'
        ? settings.regionalRecommendations
        : defaults.regionalRecommendations,
      region,
      theme: ['system', 'paper', 'night'].includes(settings.theme) ? settings.theme : defaults.theme,
      coverStyle: ['vinyl', 'cassette', 'minimal'].includes(settings.coverStyle) ? settings.coverStyle : defaults.coverStyle,
      accent: ['orange', 'blue', 'green'].includes(settings.accent) ? settings.accent : defaults.accent,
      density: ['comfortable', 'compact'].includes(settings.density) ? settings.density : defaults.density,
      reduceMotion: typeof settings.reduceMotion === 'boolean' ? settings.reduceMotion : defaults.reduceMotion,
      fontScale: ['small', 'standard', 'large'].includes(settings.fontScale) ? settings.fontScale : defaults.fontScale,
      cornerStyle: ['square', 'soft', 'round'].includes(settings.cornerStyle) ? settings.cornerStyle : defaults.cornerStyle,
      playerLayout: ['docked', 'floating'].includes(settings.playerLayout) ? settings.playerLayout : defaults.playerLayout,
      backgroundTexture: ['none', 'paper', 'grid'].includes(settings.backgroundTexture)
        ? settings.backgroundTexture
        : defaults.backgroundTexture,
    },
  }
}

const mergeTracks = (primary, secondary, isTrack, maximum) => uniqueTracks([...primary, ...secondary], isTrack, maximum)

export const mergeLibraryData = (localValue, cloudValue, validators, { preferSecondaryState = false } = {}) => {
  const local = normalizeLibraryData(localValue, validators)
  const cloud = normalizeLibraryData(cloudValue, validators)
  const playlists = new Map()
  for (const playlist of [...local.playlists, ...cloud.playlists]) {
    const existing = playlists.get(playlist.id)
    playlists.set(playlist.id, existing
      ? { ...existing, tracks: mergeTracks(existing.tracks, playlist.tracks, validators.isTrack, 500) }
      : playlist)
  }
  const history = [...local.history, ...cloud.history]
    .sort((left, right) => right.playedAt - left.playedAt)
    .filter((item, index, items) => items.findIndex((candidate) => (
      `${candidate.track.source}:${candidate.track.id}` === `${item.track.source}:${item.track.id}`
    )) === index)
    .slice(0, 500)
  const preferred = preferSecondaryState ? cloud : local
  const fallback = preferSecondaryState ? local : cloud
  return {
    version: 1,
    liked: mergeTracks(local.liked, cloud.liked, validators.isTrack, 1_000),
    playlists: [...playlists.values()].slice(0, 50),
    queue: mergeTracks(local.queue, cloud.queue, validators.isTrack, 500),
    current: preferred.current ?? fallback.current,
    history,
    settings: preferred.settings,
  }
}
