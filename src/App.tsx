import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Disc3, Download, ExternalLink, FileText, Heart, Home, Library,
  ListMusic, ListPlus, LoaderCircle, Menu, Pause, Play, Plus, Repeat, Repeat1,
  Search, Shuffle, SkipBack, SkipForward, Sparkles, Trash2, Upload,
  Volume2, VolumeX, Waves, X,
} from 'lucide-react'
import { playlists, tracks as initialTracks } from './data/catalog'
import {
  endedPlaybackAction, mediaLoadKey, playableTracks, preferResolvedCurrent, removalFocusIndex,
} from './playerLogic.mjs'
import { searchFallbackTracks } from './searchLogic.mjs'
import { musicProvider, sourceLabel } from './services/musicProvider'
import { isPlaylist, isTrack, musicSources, trackKey } from './types/music'
import type { MusicIdentification, MusicSource, Playlist, ProviderStatus, Track } from './types/music'

type View = 'discover' | 'search' | 'library'
type PlayMode = 'toggle' | 'play'

const readStoredTracks = (key: string, fallback: Track[], allowEmpty = false) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!Array.isArray(value)) return fallback
    const tracks = value.filter(isTrack)
    if (!tracks.length && (!allowEmpty || value.length)) return fallback
    return tracks
  } catch {
    return fallback
  }
}

const readStoredTrack = (key: string, fallback: Track) => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return isTrack(value) ? value : fallback
  } catch {
    return fallback
  }
}

const readStoredNumber = (key: string, fallback: number) => {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return fallback
    const value = Number(stored)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

const readStoredPlaylists = () => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('listener.playlists') ?? '[]')
    return Array.isArray(value) ? value.filter(isPlaylist).slice(0, 50) : []
  } catch {
    return []
  }
}

const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Playback must keep working when storage is unavailable or full.
  }
}

const prepareStoredTrack = (track: Track): Track =>
  track.source === 'demo' ? track : { ...track, audioUrl: '' }

const prepareStoredTracks = (tracks: Track[]) => tracks
  .filter((track) => track.source !== 'local')
  .map(prepareStoredTrack)

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function Cover({ name, size = 'medium' }: { name: string; size?: 'small' | 'medium' | 'large' }) {
  const imageUrl = /^https?:\/\//.test(name) ? name : undefined
  return (
    <div className={`cover ${imageUrl ? 'cover--remote' : `cover--${name}`} cover--${size}`} aria-hidden="true">
      {imageUrl ? <img className="cover__image" src={imageUrl} alt="" loading="lazy" /> : <div className="cover__grain" />}
      {!imageUrl && <Disc3 className="cover__disc" />}
      {!imageUrl && <span className="cover__mark">L.</span>}
    </div>
  )
}

function SourceBadge({ track }: { track: Track }) {
  return <span className={`source source--${track.source}`}>{sourceLabel(track.source)}</span>
}

const qualityLabels = {
  unknown: '音质未知',
  standard: '标准',
  high: '高音质',
  lossless: '无损',
  'hi-res': 'Hi-Res',
} as const

type TrackRowProps = {
  track: Track
  index: number
  current: boolean
  playing?: boolean
  pending?: boolean
  liked: boolean
  onPlay: () => void
  onLike: () => void
  onPlaylist: () => void
  onLyrics: () => void
  onDownload: () => void
  onRemove?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

function TrackRow({
  track, index, current, playing, pending, liked, onPlay, onLike, onPlaylist,
  onLyrics, onDownload, onRemove,
}: TrackRowProps) {
  const playbackUnavailable = track.capabilities.playback === 'none'
  const playLabel = playbackUnavailable ? `无法播放 ${track.title}` : pending ? `正在加载 ${track.title}` : current && playing ? `暂停 ${track.title}` : `播放 ${track.title}`
  return (
    <div className={`track-row ${current ? 'track-row--current' : ''}`} role="listitem">
      <button className="track-row__play" aria-label={playLabel} title={playbackUnavailable ? '来源未提供可播放音源' : undefined} aria-busy={pending} aria-pressed={current && playing} disabled={playbackUnavailable || pending} onClick={onPlay}>
        <span>{String(index + 1).padStart(2, '0')}</span>{pending ? <LoaderCircle className="spin" /> : current && playing ? <Pause /> : <Play fill="currentColor" />}
      </button>
      <Cover name={track.cover} size="small" />
      <div className="track-row__title">
        <strong>{track.title}</strong>
        <span>{track.artist}<small className="track-row__source-mobile"> · {sourceLabel(track.source)}</small></span>
        {playbackUnavailable && <small className="track-row__availability">仅元数据 · 不可播放</small>}
      </div>
      <span className="track-row__album">{track.album}</span>
      <div className="track-row__badges"><SourceBadge track={track} /><span className="quality-badge">{qualityLabels[track.quality]}</span></div>
      <span className="track-row__duration">{formatTime(track.duration)}</span>
      <div className="track-row__actions">
        <button className="icon-button" aria-label={`加入歌单 ${track.title}`} title="加入歌单" onClick={onPlaylist}><ListPlus /></button>
        <button className={`icon-button ${track.capabilities.lyrics ? '' : 'is-unavailable'}`} aria-disabled={!track.capabilities.lyrics} aria-label={track.capabilities.lyrics ? `查看歌词 ${track.title}` : `歌词不可用：${track.title}`} title={track.capabilities.lyrics ? '查看歌词' : '来源未提供歌词，点击了解详情'} onClick={onLyrics}><FileText /></button>
        <button className={`icon-button ${track.capabilities.download ? '' : 'is-unavailable'}`} aria-disabled={!track.capabilities.download} aria-label={track.capabilities.download ? `下载 ${track.title}` : `下载不可用：${track.title}`} title={track.capabilities.download ? '下载' : '来源未授权下载，点击了解详情'} onClick={onDownload}><Download /></button>
        <a className="icon-button" href={track.sourceUrl} target="_blank" rel="noreferrer" aria-label={`在 ${sourceLabel(track.source)} 打开 ${track.title}`} title="在来源中打开"><ExternalLink /></a>
        <button aria-label={`${liked ? '取消收藏' : '收藏'} ${track.title}`} className={`like-button ${liked ? 'liked' : ''}`} onClick={onLike}><Heart fill={liked ? 'currentColor' : 'none'} /></button>
        {onRemove && <button className="icon-button danger track-row__remove" aria-label={`移除 ${track.title}`} title="移除" onClick={onRemove}><Trash2 /></button>}
      </div>
    </div>
  )
}

function App() {
  const [view, setView] = useState<View>('discover')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>(initialTracks)
  const [resultQuery, setResultQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchDegraded, setSearchDegraded] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSource>('all')
  const [queue, setQueue] = useState<Track[]>(() => playableTracks(readStoredTracks('listener.queue', initialTracks.slice(0, 6), true)))
  const [current, setCurrent] = useState<Track>(() => readStoredTrack('listener.current', initialTracks[0]))
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(current.duration)
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('listener.volume', 0.72))))
  const [queueOpen, setQueueOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [liked, setLiked] = useState(() => new Map(
    readStoredTracks('listener.liked', initialTracks.filter((track) => track.liked), true)
      .map((track) => [trackKey(track), track]),
  ))
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>(readStoredPlaylists)
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [pendingDeletePlaylistId, setPendingDeletePlaylistId] = useState<string | null>(null)
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>()
  const [playlistName, setPlaylistName] = useState('')
  const [lyricsTrack, setLyricsTrack] = useState<Track | null>(null)
  const [lyricsText, setLyricsText] = useState('')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>(() => {
    try {
      const stored = localStorage.getItem('listener.repeat')
      return stored === 'all' || stored === 'one' ? stored : 'off'
    } catch {
      return 'off'
    }
  })
  const [identifySource, setIdentifySource] = useState<MusicSource>('netease')
  const [identification, setIdentification] = useState<MusicIdentification | null>(null)
  const [identificationHasDetails, setIdentificationHasDetails] = useState<boolean | null>(null)
  const [isIdentifying, setIsIdentifying] = useState(false)
  const [providerChecking, setProviderChecking] = useState(true)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    online: false,
    sources: ['demo'],
    capabilities: { demo: { search: true, playback: true, lyrics: false, download: false } },
  })
  const [notice, setNotice] = useState('')
  const [pendingTrackKey, setPendingTrackKey] = useState<string | null>(null)
  const pendingTrackKeyRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const resolveControllerRef = useRef<AbortController | null>(null)
  const playRequestRef = useRef(0)
  const queueRevisionRef = useRef(0)
  const searchRequestRef = useRef(0)
  const identifyRequestRef = useRef(0)
  const lyricsRequestRef = useRef(0)
  const noticeTimerRef = useRef<number>()
  const queueTriggerRef = useRef<HTMLElement | null>(null)
  const dialogTriggerRef = useRef<HTMLElement | null>(null)
  const mobileMenuRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playlistsHeadingRef = useRef<HTMLHeadingElement>(null)
  const likedHeadingRef = useRef<HTMLHeadingElement>(null)
  const lastAudibleVolumeRef = useRef(volume || 0.72)
  const localFilesRef = useRef(new Map<string, { file: File; url: string }>())
  const localLyricsRef = useRef(new Map<string, { plain: string; lrc: string }>())

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 1800)
  }

  const attemptPlayback = (audio: HTMLAudioElement) => {
    void audio.play().catch((error: unknown) => {
      if (audioRef.current !== audio) return
      setIsPlaying(false)
      if (error instanceof DOMException && error.name === 'AbortError') return
      showNotice(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '播放被浏览器拦截，请再次点击播放'
        : '音频无法开始播放，请稍后重试')
    })
  }

  const isCurrentAudio = (audio: HTMLAudioElement) => audioRef.current === audio

  const focusAfterRemoval = (
    button: HTMLButtonElement,
    containerSelector: string,
    itemSelector: string,
    fallbackSelector: string,
  ) => {
    const container = button.closest(containerSelector)
    const removedIndex = container
      ? [...container.querySelectorAll<HTMLButtonElement>(itemSelector)].indexOf(button)
      : -1
    window.setTimeout(() => {
      const remaining = [...document.querySelectorAll<HTMLButtonElement>(`${containerSelector} ${itemSelector}`)]
      const nextIndex = removalFocusIndex(removedIndex, remaining.length)
      const target = nextIndex >= 0 ? remaining[nextIndex] : document.querySelector<HTMLElement>(fallbackSelector)
      target?.focus()
    }, 0)
  }

  const updateQuery = (value: string) => {
    identifyRequestRef.current += 1
    setIsIdentifying(false)
    setIdentification(null)
    setIdentificationHasDetails(null)
    setSearchDegraded(false)
    setQuery(value)
  }

  const updateIdentifySource = (source: MusicSource) => {
    identifyRequestRef.current += 1
    setIsIdentifying(false)
    setIdentification(null)
    setIdentificationHasDetails(null)
    setIdentifySource(source)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    if (volume > 0) lastAudibleVolumeRef.current = volume
  }, [volume])

  useEffect(() => {
    writeStorage('listener.volume', String(volume))
  }, [volume])

  useEffect(() => {
    writeStorage('listener.liked', prepareStoredTracks([...liked.values()]))
  }, [liked])

  useEffect(() => {
    writeStorage('listener.queue', prepareStoredTracks(queue))
  }, [queue])

  useEffect(() => {
    writeStorage('listener.playlists', userPlaylists.map((playlist) => ({
      ...playlist,
      tracks: prepareStoredTracks(playlist.tracks),
    })))
  }, [userPlaylists])

  useEffect(() => {
    writeStorage('listener.repeat', repeatMode)
  }, [repeatMode])

  useEffect(() => {
    if (current.source !== 'local') writeStorage('listener.current', prepareStoredTrack(current))
    document.title = `${current.title} · ${current.artist} — Listener`
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album })
    }
  }, [current])

  useEffect(() => () => {
    playRequestRef.current += 1
    resolveControllerRef.current?.abort()
    for (const { url } of localFilesRef.current.values()) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    let active = true
    void musicProvider.status()
      .then((status) => { if (active) setProviderStatus(status) })
      .catch(() => undefined)
      .finally(() => { if (active) setProviderChecking(false) })
    return () => {
      active = false
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInteractive = Boolean(target?.closest('button, input, textarea, select, a, [contenteditable="true"]'))
      const dialogOpen = playlistModalTrack !== undefined || lyricsTrack !== null
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !queueOpen && !mobileNavOpen && !dialogOpen) {
        event.preventDefault()
        navigate('search')
      } else if (event.code === 'Space' && !isInteractive && !queueOpen && !mobileNavOpen && !dialogOpen) {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'Escape') {
        closeQueue()
        closeMobileNav()
        closeDialog()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  useEffect(() => {
    if (playlistModalTrack === undefined && !lyricsTrack && !queueOpen && !mobileNavOpen) return
    const container = document.querySelector<HTMLElement>('.dialog, .queue-drawer, .sidebar--open')
    if (!container) return
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...container.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => document.removeEventListener('keydown', trapFocus)
  }, [lyricsTrack, mobileNavOpen, playlistModalTrack, queueOpen])

  useEffect(() => {
    if (playlistModalTrack === undefined && !lyricsTrack && !queueOpen && !mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [lyricsTrack, mobileNavOpen, playlistModalTrack, queueOpen])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.load()
    if (isPlaying) attemptPlayback(audio)
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const requestId = ++searchRequestRef.current
    const trimmed = query.trim()
    setSearchDegraded(false)
    if (!trimmed) {
      setResults(initialTracks)
      setResultQuery('')
      setIsSearching(false)
      return () => controller.abort()
    }
    if (/^https?:\/\//i.test(trimmed) || trimmed.length > 100) {
      setResults([])
      setResultQuery(trimmed)
      setIsSearching(false)
      return () => controller.abort()
    }
    setResults([])
    setResultQuery(trimmed)
    setIsSearching(true)
    const timeout = window.setTimeout(async () => {
      try {
        const found = await musicProvider.search(query, controller.signal)
        if (active && requestId === searchRequestRef.current) setResults(found)
      } catch (error) {
        const fallback = searchFallbackTracks<Track>(error)
        if (fallback && active && requestId === searchRequestRef.current) {
          setResults(fallback)
          setSearchDegraded(true)
        }
      } finally {
        if (active && requestId === searchRequestRef.current) setIsSearching(false)
      }
    }, 180)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [query])

  const currentKey = trackKey(current)
  const currentIndex = useMemo(() => queue.findIndex((track) => trackKey(track) === currentKey), [queue, currentKey])
  const displayResults = useMemo(
    () => sourceFilter === 'all' ? results : results.filter((track) => track.source === sourceFilter),
    [results, sourceFilter],
  )
  const resultSources = useMemo(() => [...new Set(results.map((track) => track.source))], [results])
  const likedTracks = useMemo(() => [...liked.values()], [liked])
  const selectedPlaylist = useMemo(
    () => userPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [selectedPlaylistId, userPlaylists],
  )
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit' }).format(new Date()),
    [],
  )

  useEffect(() => {
    if (sourceFilter !== 'all' && !resultSources.includes(sourceFilter)) setSourceFilter('all')
  }, [resultSources, sourceFilter])

  const cancelPendingPlay = () => {
    playRequestRef.current += 1
    resolveControllerRef.current?.abort()
    resolveControllerRef.current = null
    pendingTrackKeyRef.current = null
    setPendingTrackKey(null)
  }

  const playTrack = (track: Track, list?: Track[], mode: PlayMode = 'toggle') => {
    const key = trackKey(track)
    const updateTrack = (item: Track) => trackKey(item) === key ? track : item
    if (list) {
      const resolvedList = playableTracks(list).map(updateTrack)
      setQueue(resolvedList.some((item) => trackKey(item) === key) ? resolvedList : [track, ...resolvedList])
    } else {
      setQueue((previous) => previous.some((item) => trackKey(item) === key)
        ? previous.map(updateTrack)
        : [track, ...previous])
    }
    if (currentKey === key) {
      if (current.audioUrl !== track.audioUrl) {
        setCurrent(track)
        setProgress(0)
        setDuration(track.duration)
        setIsPlaying(true)
        return
      }
      const audio = audioRef.current
      if (!audio) return
      if (mode === 'toggle' && !audio.paused) audio.pause()
      else if (audio.paused) attemptPlayback(audio)
      return
    }
    setCurrent(track)
    setProgress(0)
    setDuration(track.duration)
    setIsPlaying(true)
  }

  const resolveAndPlay = async (track: Track, list?: Track[], mode: PlayMode = 'toggle') => {
    const target = preferResolvedCurrent(track, current)
    if (target.capabilities.playback === 'none') return showNotice('该来源没有可用音源')
    resolveControllerRef.current?.abort()
    resolveControllerRef.current = null
    const requestId = ++playRequestRef.current
    const key = trackKey(target)
    if (target.audioUrl) {
      pendingTrackKeyRef.current = null
      setPendingTrackKey(null)
      setLiked((previous) => previous.has(key) ? new Map(previous).set(key, target) : previous)
      playTrack(target, list, mode)
      return
    }
    const queueRevision = queueRevisionRef.current
    const controller = new AbortController()
    resolveControllerRef.current = controller
    pendingTrackKeyRef.current = key
    setPendingTrackKey(key)
    try {
      const resolvedUrl = await musicProvider.resolve(target, controller.signal)
      if (requestId !== playRequestRef.current) return
      const resolvedTrack = { ...target, audioUrl: resolvedUrl }
      setLiked((previous) => previous.has(key) ? new Map(previous).set(key, resolvedTrack) : previous)
      playTrack(resolvedTrack, queueRevision === queueRevisionRef.current ? list : undefined, mode)
    } catch (error) {
      if (requestId === playRequestRef.current && !controller.signal.aborted) {
        const restricted = error instanceof Error && 'code' in error && error.code === 'CAPABILITY_UNAVAILABLE'
        showNotice(restricted ? '该歌曲当前不允许公开播放' : '这首歌暂时没有可用音源')
      }
    } finally {
      if (resolveControllerRef.current === controller) resolveControllerRef.current = null
      if (requestId === playRequestRef.current) {
        pendingTrackKeyRef.current = null
        setPendingTrackKey(null)
      }
    }
  }

  const startCurrent = () => {
    if (pendingTrackKeyRef.current) return
    if (current.capabilities.playback === 'none') return showNotice('该来源没有可用音源')
    const audio = audioRef.current
    if (!audio) return
    if (currentIndex < 0) {
      queueRevisionRef.current += 1
      setQueue((previous) => [current, ...previous])
    }
    if (!current.audioUrl) {
      void resolveAndPlay(current, undefined, 'play')
      return
    }
    attemptPlayback(audio)
  }

  const togglePlay = () => {
    if (pendingTrackKeyRef.current) {
      cancelPendingPlay()
      showNotice('已取消加载')
      return
    }
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    startCurrent()
  }

  const skip = (direction: 1 | -1) => {
    if (!queue.length) return
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + queue.length) % queue.length
    void resolveAndPlay(queue[nextIndex], undefined, 'play')
  }

  const shuffle = () => {
    const candidates = queue.filter((track) => trackKey(track) !== currentKey)
    if (!candidates.length) return showNotice('播放队列里还没有其他歌曲')
    const track = candidates[Math.floor(Math.random() * candidates.length)]
    void resolveAndPlay(track, undefined, 'play')
  }

  const cycleRepeat = () => {
    setRepeatMode((mode) => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')
  }

  const toggleMute = () => {
    setVolume((value) => value > 0 ? 0 : lastAudibleVolumeRef.current)
  }

  const handleEnded = () => {
    const action = endedPlaybackAction({
      pending: Boolean(pendingTrackKeyRef.current),
      queueLength: queue.length,
      currentIndex,
      repeatMode,
    })
    setIsPlaying(false)
    if (action === 'restart' && audioRef.current) {
      audioRef.current.currentTime = 0
      attemptPlayback(audioRef.current)
    } else if (action === 'next') {
      skip(1)
    }
  }

  const toggleLike = (track: Track) => {
    const key = trackKey(track)
    const removing = liked.has(key)
    setLiked((previous) => {
      const next = new Map(previous)
      if (removing) next.delete(key)
      else next.set(key, track)
      return next
    })
    showNotice(removing ? '已从收藏中移除' : '已加入喜欢的音乐')
  }

  const openPlaylist = (playlist: Playlist) => {
    const playable = playableTracks(playlist.tracks)
    if (playable[0]) void resolveAndPlay(playable[0], playable, 'play')
    else showNotice('歌单里没有可播放的歌曲')
  }

  const rememberDialogTrigger = () => {
    dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  const openPlaylistDialog = (track: Track | null) => {
    rememberDialogTrigger()
    setPlaylistName('')
    setPlaylistModalTrack(track)
  }

  const closeDialog = () => {
    if (playlistModalTrack === undefined && lyricsTrack === null) return
    lyricsRequestRef.current += 1
    setPlaylistModalTrack(undefined)
    setLyricsTrack(null)
    setLyricsText('')
    window.setTimeout(() => dialogTriggerRef.current?.focus(), 0)
  }

  const addTrackToPlaylist = (playlistId: string, track: Track) => {
    const playlist = userPlaylists.find((item) => item.id === playlistId)
    if (!playlist || playlist.tracks.some((item) => trackKey(item) === trackKey(track))) return showNotice('歌曲已在歌单中')
    setUserPlaylists((previous) => previous.map((item) => item.id === playlistId
      ? { ...item, cover: item.tracks.length ? item.cover : track.cover, tracks: [...item.tracks, track] }
      : item))
    showNotice('已加入歌单')
    closeDialog()
  }

  const createPlaylist = (event: React.FormEvent) => {
    event.preventDefault()
    const title = playlistName.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (!title) return showNotice('请输入歌单名称')
    if (userPlaylists.length >= 50) return showNotice('最多创建 50 个歌单')
    const newPlaylist: Playlist = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `playlist-${Date.now()}`,
      title: title.slice(0, 40),
      description: '我的自建歌单',
      cover: playlistModalTrack?.cover ?? 'radio',
      tracks: playlistModalTrack ? [playlistModalTrack] : [],
    }
    setUserPlaylists((previous) => [...previous, newPlaylist])
    setSelectedPlaylistId(newPlaylist.id)
    showNotice(playlistModalTrack ? '歌单已创建并加入歌曲' : '歌单已创建')
    closeDialog()
  }

  const removeTrackFromPlaylist = (playlistId: string, track: Track) => {
    setUserPlaylists((previous) => previous.map((playlist) => playlist.id === playlistId
      ? { ...playlist, tracks: playlist.tracks.filter((item) => trackKey(item) !== trackKey(track)) }
      : playlist))
    showNotice('已从歌单移除')
  }

  const deletePlaylist = (playlistId: string) => {
    if (pendingDeletePlaylistId !== playlistId) {
      setPendingDeletePlaylistId(playlistId)
      showNotice('再次点击“确认删除”才会删除歌单')
      return
    }
    setUserPlaylists((previous) => previous.filter((playlist) => playlist.id !== playlistId))
    setSelectedPlaylistId(null)
    setPendingDeletePlaylistId(null)
    showNotice('歌单已删除')
    window.setTimeout(() => playlistsHeadingRef.current?.focus(), 0)
  }

  const openLyrics = async (track: Track) => {
    if (!track.capabilities.lyrics) return showNotice('该来源没有提供歌词')
    const requestId = ++lyricsRequestRef.current
    rememberDialogTrigger()
    setLyricsTrack(track)
    setLyricsText('')
    setLyricsLoading(true)
    try {
      const localLyrics = track.source === 'local' ? localLyricsRef.current.get(trackKey(track)) : undefined
      const lyrics = localLyrics ?? await musicProvider.lyrics(track)
      if (requestId === lyricsRequestRef.current) setLyricsText(lyrics.lrc || lyrics.plain || '[00:00.00] 暂无歌词')
    } catch {
      if (requestId === lyricsRequestRef.current) setLyricsText('[00:00.00] 歌词暂时不可用')
    } finally {
      if (requestId === lyricsRequestRef.current) setLyricsLoading(false)
    }
  }

  const downloadTrack = async (track: Track) => {
    if (!track.capabilities.download) return showNotice('该来源未授权下载')
    try {
      const localFile = track.source === 'local' ? localFilesRef.current.get(trackKey(track)) : undefined
      const descriptor = localFile
        ? { url: localFile.url, filename: localFile.file.name }
        : await musicProvider.download(track)
      const link = document.createElement('a')
      link.href = descriptor.url
      link.download = descriptor.filename
      link.target = '_blank'
      link.rel = 'noreferrer'
      document.body.append(link)
      link.click()
      link.remove()
      showNotice('已交给浏览器下载')
    } catch {
      showNotice('下载授权已失效或来源不可用')
    }
  }

  const importLocalTracks = async (files: FileList | null) => {
    if (!files?.length) return
    const imported: Track[] = []
    const selected = Array.from(files)
    const lyricsFiles = new Map(selected
      .filter((file) => /\.lrc$/i.test(file.name))
      .map((file) => [file.name.replace(/\.lrc$/i, '').toLocaleLowerCase(), file]))
    for (const file of selected.filter((item) => !/\.lrc$/i.test(item.name)).slice(0, 100)) {
      if (!file.type.startsWith('audio/') && !/\.(aac|aiff?|alac|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name)) continue
      const id = `${file.name}:${file.size}:${file.lastModified}`
      const key = `local:${id}`
      if (localFilesRef.current.has(key)) continue
      const url = URL.createObjectURL(file)
      const lyricsFile = lyricsFiles.get(file.name.replace(/\.[^.]+$/, '').toLocaleLowerCase())
      let lrc = ''
      if (lyricsFile) {
        try { lrc = (await lyricsFile.text()).slice(0, 500_000) } catch { /* unreadable local lyrics */ }
      }
      localFilesRef.current.set(key, { file, url })
      if (lrc) localLyricsRef.current.set(key, { plain: lrc.replace(/\[[^\]]+]/g, '').trim(), lrc })
      imported.push({
        id,
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '本地文件',
        album: '本地导入',
        duration: 0,
        source: 'local',
        audioUrl: url,
        cover: 'local',
        sourceUrl: url,
        quality: 'unknown',
        capabilities: { playback: 'full', lyrics: Boolean(lrc), download: true },
      })
    }
    if (!imported.length) return showNotice('没有发现可用的音频文件')
    setLocalTracks((previous) => [...previous, ...imported])
    queueRevisionRef.current += 1
    setQueue((previous) => [...imported, ...previous])
    showNotice(`已导入 ${imported.length} 首本地音乐`)
  }

  const removeLocalTrack = (track: Track) => {
    const key = trackKey(track)
    const local = localFilesRef.current.get(key)
    if (pendingTrackKeyRef.current === key) cancelPendingPlay()
    queueRevisionRef.current += 1
    if (currentKey === key) {
      const audio = audioRef.current
      audio?.pause()
      audio?.removeAttribute('src')
      audio?.load()
    }
    localFilesRef.current.delete(key)
    localLyricsRef.current.delete(key)
    setLocalTracks((previous) => previous.filter((item) => trackKey(item) !== key))
    setQueue((previous) => previous.filter((item) => trackKey(item) !== key))
    setLiked((previous) => { const next = new Map(previous); next.delete(key); return next })
    setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter((item) => trackKey(item) !== key) })))
    if (currentKey === key) {
      const replacement = queue.find((item) => trackKey(item) !== key) ?? initialTracks[0]
      setCurrent(replacement)
      setProgress(0)
      setDuration(replacement.duration)
      setIsPlaying(false)
    }
    if (local) window.setTimeout(() => URL.revokeObjectURL(local.url), 0)
    showNotice('已移除本地音乐')
  }

  const identifyInput = async () => {
    const input = query.normalize('NFKC').trim()
    if (!input) return showNotice('请输入音乐地址或 ID')
    const requestId = ++identifyRequestRef.current
    searchRequestRef.current += 1
    setIsSearching(false)
    setIsIdentifying(true)
    setIdentification(null)
    setIdentificationHasDetails(null)
    try {
      const match = await musicProvider.identify(input, /^https?:\/\//i.test(input) ? undefined : identifySource)
      if (requestId !== identifyRequestRef.current) return
      if (!match) return showNotice('没有识别出受支持的音乐地址或 ID')
      setIdentification(match)
      try {
        const track = await musicProvider.lookup(match)
        if (requestId !== identifyRequestRef.current) return
        setResults([track])
        setResultQuery(input)
        setSourceFilter('all')
        setIdentificationHasDetails(true)
        showNotice('已获取歌曲信息')
      } catch {
        if (requestId === identifyRequestRef.current) {
          setIdentificationHasDetails(false)
          showNotice('已识别 ID；该来源尚未接入详情接口')
        }
      }
    } catch {
      if (requestId === identifyRequestRef.current) showNotice('解析服务暂时不可用')
    } finally {
      if (requestId === identifyRequestRef.current) setIsIdentifying(false)
    }
  }

  const removeFromQueue = (track: Track) => {
    const key = trackKey(track)
    if (pendingTrackKeyRef.current === key) cancelPendingPlay()
    queueRevisionRef.current += 1
    setQueue((previous) => previous.filter((item) => trackKey(item) !== key))
    if (key === currentKey) {
      audioRef.current?.pause()
      setIsPlaying(false)
    }
  }

  const clearQueue = () => {
    cancelPendingPlay()
    queueRevisionRef.current += 1
    audioRef.current?.pause()
    setQueue([])
    setIsPlaying(false)
    showNotice('播放队列已清空')
  }

  const updateLocalDuration = (seconds: number) => {
    if (current.source !== 'local' || current.duration === seconds) return
    const update = (track: Track) => trackKey(track) === currentKey ? { ...track, duration: seconds } : track
    setLocalTracks((previous) => previous.map(update))
    setQueue((previous) => previous.map(update))
    setLiked((previous) => previous.has(currentKey) ? new Map(previous).set(currentKey, update(previous.get(currentKey)!)) : previous)
    setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(update) })))
  }

  const handleAudioError = () => {
    if (!current.audioUrl) return
    setIsPlaying(false)
    if (current.source === 'demo' || current.source === 'local') {
      showNotice('音源暂时无法播放，请换一首试试')
      return
    }
    const invalidated = { ...current, audioUrl: '' }
    const update = (track: Track) => trackKey(track) === currentKey ? invalidated : track
    queueRevisionRef.current += 1
    setCurrent(invalidated)
    setQueue((previous) => previous.map(update))
    setResults((previous) => previous.map(update))
    setLiked((previous) => previous.has(currentKey) ? new Map(previous).set(currentKey, invalidated) : previous)
    setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(update) })))
    showNotice('音源已失效，点击播放可重新连接')
  }

  const seekTo = (value: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(duration) || duration <= 0) return
    const next = Math.min(duration, Math.max(0, value))
    try {
      audio.currentTime = next
      setProgress(next)
    } catch {
      showNotice('当前音源暂不支持跳转')
    }
  }

  const navigate = (next: View) => {
    setView(next)
    setMobileNavOpen(false)
    if (next === 'search') window.setTimeout(() => document.querySelector<HTMLInputElement>('#search-input')?.focus(), 0)
  }

  const navigateLibrarySection = (target: 'playlists' | 'liked') => {
    setView('library')
    setMobileNavOpen(false)
    window.setTimeout(() => {
      const heading = target === 'playlists' ? playlistsHeadingRef.current : likedHeadingRef.current
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus({ preventScroll: true })
    }, 0)
  }

  const openMobileNav = () => {
    setMobileNavOpen(true)
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('.sidebar__close')?.focus(), 0)
  }

  const closeMobileNav = () => {
    if (!mobileNavOpen) return
    setMobileNavOpen(false)
    window.setTimeout(() => mobileMenuRef.current?.focus(), 0)
  }

  const openQueue = () => {
    queueTriggerRef.current = mobileNavOpen
      ? document.querySelector<HTMLElement>('.mobile-menu')
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMobileNavOpen(false)
    setQueueOpen(true)
  }

  const closeQueue = () => {
    if (!queueOpen) return
    setQueueOpen(false)
    window.setTimeout(() => queueTriggerRef.current?.focus(), 0)
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => {
        startCurrent()
      }],
      ['pause', () => {
        if (pendingTrackKeyRef.current) cancelPendingPlay()
        audioRef.current?.pause()
      }],
      ['previoustrack', () => skip(-1)],
      ['nexttrack', () => skip(1)],
    ]
    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* unsupported action */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null) } catch { /* unsupported action */ }
      }
    }
  })

  const dialogOpen = playlistModalTrack !== undefined || lyricsTrack !== null
  const resultHeading = resultQuery.length > 64 ? `${resultQuery.slice(0, 64)}…` : resultQuery
  const seekDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const seekProgress = seekDuration ? Math.min(seekDuration, Math.max(0, progress)) : 0

  return (
    <div className="app-shell">
      <aside id="mobile-navigation" className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`} aria-label="侧边导航" {...(queueOpen || dialogOpen ? { inert: '' } : {})}>
        <button className="sidebar__close icon-button" onClick={closeMobileNav} aria-label="关闭菜单"><X /></button>
        <button className="brand" onClick={() => navigate('discover')}>
          <span className="brand__symbol"><Waves /></span>
          <span>Listener</span>
        </button>

        <nav className="nav-group" aria-label="主导航">
          <button aria-current={view === 'discover' ? 'page' : undefined} className={view === 'discover' ? 'active' : ''} onClick={() => navigate('discover')}><Home />发现音乐</button>
          <button aria-current={view === 'search' ? 'page' : undefined} className={view === 'search' ? 'active' : ''} onClick={() => navigate('search')}><Search />聚合搜索</button>
          <button aria-current={view === 'library' ? 'page' : undefined} className={view === 'library' ? 'active' : ''} onClick={() => navigateLibrarySection('liked')}><Library />我的收藏</button>
        </nav>

        <div className="sidebar__section-label">我的音乐</div>
        <nav className="nav-group nav-group--sub">
          <button onClick={() => navigateLibrarySection('liked')}><Heart />喜欢的音乐 <span>{liked.size}</span></button>
          <button onClick={() => navigateLibrarySection('playlists')}><Library />我的歌单 <span>{userPlaylists.length}</span></button>
          <button onClick={openQueue}><ListMusic />最近播放</button>
        </nav>

        <div className="source-card">
          <span><Sparkles /> {providerChecking ? '正在连接音乐源' : providerStatus.online ? `${providerStatus.sources.length} 个音乐源已接入` : '演示模式'}</span>
          <p>{providerChecking ? '正在检查聚合服务…' : providerStatus.online ? providerStatus.sources.map(sourceLabel).join(' · ') : '聚合服务暂时离线'}</p>
          <div className={`source-card__dots ${providerChecking ? 'checking' : providerStatus.online ? '' : 'offline'}`}><i /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="scrim" onClick={closeMobileNav} aria-label="关闭菜单" />}

      <main className="main-content" {...(queueOpen || mobileNavOpen || dialogOpen ? { inert: '' } : {})}>
        <header className="topbar">
          <button ref={mobileMenuRef} className="mobile-menu icon-button" onClick={openMobileNav} aria-label="打开菜单" aria-controls="mobile-navigation" aria-expanded={mobileNavOpen}><Menu /></button>
          <button className="search-box" onClick={() => navigate('search')}>
            <Search />
            <span>搜索歌曲、歌手或专辑</span>
            <kbd>⌘/Ctrl K</kbd>
          </button>
          <div className="topbar__actions">
            <div className="source-selector"><span className={`status-dot ${providerChecking ? 'checking' : providerStatus.online ? '' : 'offline'}`} />{providerChecking ? '正在连接' : providerStatus.online ? '聚合服务在线' : '演示模式'}</div>
            <div className="avatar" aria-hidden="true">L</div>
          </div>
        </header>

        {view === 'discover' && (
          <div className="page page--discover">
            <section className="hero">
              <div className="hero__content">
                <span className="eyebrow">MULTI-SOURCE MUSIC SEARCH</span>
                <h1>音乐搜索器<br />让好歌更好找。</h1>
                <p>多平台并行检索，真实标注试听、完整播放、歌词、下载权限与音质。</p>
                <div className="hero__actions">
                  <button className="primary-button" onClick={() => navigate('search')}><Search />多平台搜索</button>
                  <a className="text-button" href="https://qm.qq.com/q/WEGUnXZVSw" target="_blank" rel="noreferrer">加入官方 QQ 群 <ArrowRight /></a>
                </div>
              </div>
              <div className="hero__art" aria-hidden="true">
                <div className="hero__sun" />
                <div className="hero__record"><span>LISTENER<br /><small>DAILY {today.replace('/', '·')}</small></span></div>
                <div className="hero__line hero__line--one" />
                <div className="hero__line hero__line--two" />
                <span className="hero__note">{today}</span>
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div><span className="section-index">01</span><h2>最近很对味</h2></div>
                <button onClick={() => navigate('search')}>查看全部 <ArrowRight /></button>
              </div>
              <div className="track-grid">
                {initialTracks.slice(0, 4).map((track, index) => {
                  const key = trackKey(track)
                  const isCurrent = currentKey === key
                  const isLiked = liked.has(key)
                  const isPending = pendingTrackKey === key
                  return (
                  <article className={`track-card ${isCurrent ? 'track-card--current' : ''}`} key={key}>
                    <div className="track-card__number">0{index + 1}</div>
                    <button className="track-card__cover" disabled={isPending} aria-busy={isPending} aria-pressed={isCurrent && isPlaying} onClick={() => void resolveAndPlay(track, initialTracks)} aria-label={isPending ? `正在加载 ${track.title}` : isCurrent && isPlaying ? `暂停 ${track.title}` : `播放 ${track.title}`}>
                      <Cover name={track.cover} />
                      <span className="cover-play">{isPending ? <LoaderCircle className="spin" /> : isCurrent && isPlaying ? <Pause /> : <Play fill="currentColor" />}</span>
                    </button>
                    <div className="track-card__meta">
                      <h3>{track.title}</h3>
                      <p>{track.artist}</p>
                      <SourceBadge track={track} />
                    </div>
                    <button className={`like-button ${isLiked ? 'liked' : ''}`} onClick={() => toggleLike(track)} aria-label={`${isLiked ? '取消收藏' : '收藏'} ${track.title}`}><Heart fill={isLiked ? 'currentColor' : 'none'} /></button>
                  </article>
                  )
                })}
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div><span className="section-index">02</span><h2>听点不一样的</h2></div>
              </div>
              <div className="playlist-grid">
                {playlists.map((playlist, index) => (
                  <button className="playlist-card" key={playlist.id} onClick={() => openPlaylist(playlist)}>
                    <div className="playlist-card__visual">
                      <Cover name={playlist.cover} size="large" />
                      <span className="playlist-card__count">{playlist.tracks.length} 首</span>
                      <span className="playlist-card__play"><Play fill="currentColor" /></span>
                    </div>
                    <div className="playlist-card__copy"><span>0{index + 1}</span><div><h3>{playlist.title}</h3><p>{playlist.description}</p></div></div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === 'search' && (
          <div className="page page--search">
            <div className="search-hero">
              <span className="eyebrow">SEARCH ACROSS SOURCES</span>
              <h1>多平台搜索</h1>
              <div className="search-input-wrap">
                <Search aria-hidden="true" />
                <input id="search-input" aria-label="搜索歌曲、歌手、专辑、音乐地址或 ID" maxLength={2048} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="歌曲、歌手、专辑、音乐地址或 ID……" />
                {query && <button onClick={() => updateQuery('')} aria-label="清空"><X /></button>}
              </div>
              <div className="search-hints"><span>试试：</span>{['周杰伦', '久石譲', 'Golden Hour'].map((word) => <button key={word} onClick={() => updateQuery(word)}>{word}</button>)}</div>
              <div className="id-resolver">
                <select aria-label="音乐 ID 所属平台" value={identifySource} onChange={(event) => updateIdentifySource(event.target.value as MusicSource)}>
                  {musicSources.filter((source) => source !== 'demo' && source !== 'local').map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
                </select>
                <button className="primary-button" disabled={isIdentifying} onClick={() => void identifyInput()}>{isIdentifying ? '正在识别…' : '解析地址 / ID'}</button>
                <span>平台地址与纯 ID 均需点击解析；纯 ID 请先选择平台。</span>
              </div>
              {identification && (
                <div className="identification" role="status">
                  <div><SourceBadge track={{ ...initialTracks[0], source: identification.source }} /><strong>{identification.id}</strong></div>
                  <span>{identificationHasDetails === true ? '歌曲详情已获取' : identificationHasDetails === false ? '已识别，详情接口不可用' : '已识别，正在获取歌曲详情…'}</span>
                  <a href={identification.canonicalUrl} target="_blank" rel="noreferrer">在来源中打开 <ExternalLink /></a>
                </div>
              )}
              <div className="source-filters" role="group" aria-label="音乐源筛选">
                <button aria-pressed={sourceFilter === 'all'} className={sourceFilter === 'all' ? 'active' : ''} onClick={() => setSourceFilter('all')}>全部来源</button>
                {resultSources.map((source) => (
                  <button key={source} aria-pressed={sourceFilter === source} className={sourceFilter === source ? 'active' : ''} onClick={() => setSourceFilter(source)}>{sourceLabel(source)}</button>
                ))}
              </div>
            </div>
            <section className="results-section">
              {searchDegraded && <div className="search-warning" role="alert"><Sparkles /><span><strong>聚合服务异常，当前为演示结果</strong><small>真实音乐源暂时不可用，请稍后重试。</small></span></div>}
              <div className="section-heading"><div><span className="section-index">{String(displayResults.length).padStart(2, '0')}</span><h2>{resultHeading ? `“${resultHeading}” 的结果` : '全部音乐'}</h2></div><span className="searching-state" aria-live="polite">{isSearching ? '正在检索音乐源…' : searchDegraded ? `演示结果 ${displayResults.length} 首` : `共 ${displayResults.length} 首`}</span></div>
              <div className="track-list" role="list">
                {displayResults.length ? displayResults.map((track, index) => (
                  <TrackRow
                    key={trackKey(track)}
                    track={track}
                    index={index}
                    current={currentKey === trackKey(track)}
                    playing={isPlaying}
                    pending={pendingTrackKey === trackKey(track)}
                    liked={liked.has(trackKey(track))}
                    onPlay={() => void resolveAndPlay(track, displayResults)}
                    onLike={() => toggleLike(track)}
                    onPlaylist={() => openPlaylistDialog(track)}
                    onLyrics={() => void openLyrics(track)}
                    onDownload={() => void downloadTrack(track)}
                  />
                )) : <div className="empty-state"><Disc3 /><h3>{isSearching ? '正在寻找好音乐' : searchDegraded ? '聚合服务暂不可用' : identification ? '地址已识别' : '还没找到这首歌'}</h3><p>{isSearching ? '正在连接可用音乐源，请稍候。' : searchDegraded ? '演示曲库里也没有匹配结果，请稍后重试真实搜索。' : identification ? '当前来源尚未提供授权详情接口，可先在来源页面打开。' : '换个关键词，或使用上方地址 / ID 解析。'}</p></div>}
              </div>
            </section>
          </div>
        )}

        {view === 'library' && (
          <div className="page page--library">
            <div className="library-heading library-heading--actions">
              <div><span className="eyebrow">YOUR COLLECTION</span><h1>我的音乐</h1><p>{liked.size} 首收藏 · {userPlaylists.length} 个自建歌单</p></div>
              <div className="library-heading__buttons">
                <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><Upload />导入音乐 / LRC</button>
                <button className="primary-button" onClick={() => openPlaylistDialog(null)}><Plus />新建歌单</button>
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*,.lrc" multiple tabIndex={-1} aria-label="选择本地音乐或 LRC 文件" onChange={(event) => { void importLocalTracks(event.target.files); event.target.value = '' }} />
              </div>
            </div>
            {localTracks.length > 0 && (
              <section id="local-tracks" className="library-section">
                <div className="section-heading"><div><span className="section-index">{String(localTracks.length).padStart(2, '0')}</span><h2>本地音乐</h2></div><span className="searching-state">仅保留在当前会话</span></div>
                <div className="track-list" role="list">
                  {localTracks.map((track, index) => (
                    <TrackRow
                      key={trackKey(track)} track={track} index={index}
                      current={currentKey === trackKey(track)} playing={isPlaying}
                      pending={pendingTrackKey === trackKey(track)}
                      liked={liked.has(trackKey(track))}
                      onPlay={() => void resolveAndPlay(track, localTracks)}
                      onLike={() => toggleLike(track)}
                      onPlaylist={() => openPlaylistDialog(track)}
                      onLyrics={() => void openLyrics(track)}
                      onDownload={() => void downloadTrack(track)}
                      onRemove={(event) => {
                        focusAfterRemoval(event.currentTarget, '#local-tracks', '.track-row__remove', '#playlists-heading')
                        removeLocalTrack(track)
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            <section className="library-section">
              <div className="section-heading"><div><span className="section-index">01</span><h2 id="playlists-heading" ref={playlistsHeadingRef} tabIndex={-1}>我的歌单</h2></div></div>
              {userPlaylists.length ? (
                <div className="playlist-grid playlist-grid--user">
                  {userPlaylists.map((playlist, index) => (
                    <button className={`playlist-card ${selectedPlaylistId === playlist.id ? 'playlist-card--active' : ''}`} aria-pressed={selectedPlaylistId === playlist.id} aria-controls="selected-playlist-detail" key={playlist.id} onClick={() => { setSelectedPlaylistId(playlist.id); setPendingDeletePlaylistId(null) }}>
                      <div className="playlist-card__visual"><Cover name={playlist.cover} size="large" /><span className="playlist-card__count">{playlist.tracks.length} 首</span></div>
                      <div className="playlist-card__copy"><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{playlist.title}</h3><p>{playlist.description}</p></div></div>
                    </button>
                  ))}
                </div>
              ) : <div className="compact-empty"><Library /><span>还没有自建歌单</span><button onClick={() => openPlaylistDialog(null)}>创建第一个歌单</button></div>}
            </section>

            {selectedPlaylist && (
              <section id="selected-playlist-detail" className="library-section playlist-detail" aria-labelledby="selected-playlist-title">
                <div className="section-heading">
                  <div><span className="section-index">{String(selectedPlaylist.tracks.length).padStart(2, '0')}</span><h2 id="selected-playlist-title" tabIndex={-1}>{selectedPlaylist.title}</h2></div>
                  <div className="section-actions">
                    <button disabled={!selectedPlaylist.tracks.length} onClick={() => openPlaylist(selectedPlaylist)}><Play />播放全部</button>
                    <button className="danger" onClick={() => deletePlaylist(selectedPlaylist.id)}><Trash2 />{pendingDeletePlaylistId === selectedPlaylist.id ? '确认删除' : '删除歌单'}</button>
                  </div>
                </div>
                <div className="track-list" role="list">
                  {selectedPlaylist.tracks.map((track, index) => (
                    <TrackRow
                      key={trackKey(track)} track={track} index={index}
                      current={currentKey === trackKey(track)} playing={isPlaying}
                      pending={pendingTrackKey === trackKey(track)}
                      liked={liked.has(trackKey(track))}
                      onPlay={() => void resolveAndPlay(track, selectedPlaylist.tracks)}
                      onLike={() => toggleLike(track)}
                      onPlaylist={() => openPlaylistDialog(track)}
                      onLyrics={() => void openLyrics(track)}
                      onDownload={() => void downloadTrack(track)}
                      onRemove={(event) => {
                        focusAfterRemoval(event.currentTarget, '#selected-playlist-detail', '.track-row__remove', '#selected-playlist-title')
                        removeTrackFromPlaylist(selectedPlaylist.id, track)
                      }}
                    />
                  ))}
                  {!selectedPlaylist.tracks.length && <div className="compact-empty"><ListMusic /><span>歌单还是空的</span><button onClick={() => navigate('search')}>去搜索音乐</button></div>}
                </div>
              </section>
            )}

            <section className="library-section">
              <div className="section-heading"><div><span className="section-index">02</span><h2 ref={likedHeadingRef} tabIndex={-1}>喜欢的音乐</h2></div></div>
            <div className="track-list" role="list">
              {likedTracks.map((track, index) => (
                <TrackRow
                  key={trackKey(track)} track={track} index={index}
                  current={currentKey === trackKey(track)} playing={isPlaying} liked
                  pending={pendingTrackKey === trackKey(track)}
                  onPlay={() => void resolveAndPlay(track, likedTracks)}
                  onLike={() => toggleLike(track)}
                  onPlaylist={() => openPlaylistDialog(track)}
                  onLyrics={() => void openLyrics(track)}
                  onDownload={() => void downloadTrack(track)}
                />
              ))}
              {!liked.size && <div className="empty-state"><Heart /><h3>收藏夹还是空的</h3><p>遇到喜欢的歌，就点一下心形按钮吧。</p></div>}
            </div>
            </section>
          </div>
        )}
      </main>

      {queueOpen && (
        <>
          <aside className="queue-drawer queue-drawer--open" role="dialog" aria-modal="true" aria-label="播放队列">
            <div className="queue-drawer__header"><div><span className="eyebrow">UP NEXT</span><h2>播放队列</h2></div><button className="icon-button" aria-label="关闭播放队列" autoFocus onClick={closeQueue}><X /></button></div>
            <div className="queue-drawer__count"><span>共 {queue.length} 首</span><button disabled={!queue.length} onClick={clearQueue}>停止并清空</button></div>
            <div className="queue-drawer__list">
              {queue.map((track, index) => {
                const isCurrent = trackKey(track) === currentKey
                return <div className={`queue-item ${isCurrent ? 'current' : ''}`} key={`${trackKey(track)}-${index}`}>
                  <button className="queue-item__main" aria-current={isCurrent ? 'true' : undefined} onClick={() => void resolveAndPlay(track, undefined, 'play')}><Cover name={track.cover} size="small" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>{isCurrent && <i><Waves /></i>}</button>
                  <button className="icon-button queue-item__remove" aria-label={`从队列移除 ${track.title}`} onClick={(event) => {
                    focusAfterRemoval(event.currentTarget, '.queue-drawer__list', '.queue-item__remove', '.queue-drawer__header .icon-button')
                    removeFromQueue(track)
                  }}><X /></button>
                </div>
              })}
              {!queue.length && <div className="compact-empty"><ListMusic /><span>播放队列为空</span></div>}
            </div>
          </aside>
          <button className="queue-scrim" onClick={closeQueue} aria-label="关闭播放队列" />
        </>
      )}

      {playlistModalTrack !== undefined && (
        <>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title">
            <div className="dialog__header"><div><span className="eyebrow">MY PLAYLISTS</span><h2 id="playlist-dialog-title">{playlistModalTrack ? '加入歌单' : '新建歌单'}</h2></div><button className="icon-button" aria-label="关闭" onClick={closeDialog}><X /></button></div>
            {playlistModalTrack && userPlaylists.length > 0 && (
              <div className="dialog__choices">
                {userPlaylists.map((playlist, index) => <button key={playlist.id} autoFocus={index === 0} onClick={() => addTrackToPlaylist(playlist.id, playlistModalTrack)}><Cover name={playlist.cover} size="small" /><span><strong>{playlist.title}</strong><small>{playlist.tracks.length} 首</small></span><Plus /></button>)}
              </div>
            )}
            <form className="dialog__form" onSubmit={createPlaylist}>
              <label htmlFor="playlist-name">{playlistModalTrack ? '或创建新歌单' : '歌单名称'}</label>
              <input id="playlist-name" autoFocus={!playlistModalTrack || userPlaylists.length === 0} maxLength={40} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="例如：深夜循环" />
              <button className="primary-button" type="submit"><Plus />{playlistModalTrack ? '创建并加入' : '创建歌单'}</button>
            </form>
          </section>
          <button className="dialog-scrim" onClick={closeDialog} aria-label="关闭歌单窗口" />
        </>
      )}

      {lyricsTrack && (
        <>
          <section className="dialog dialog--lyrics" role="dialog" aria-modal="true" aria-labelledby="lyrics-dialog-title">
            <div className="dialog__header"><div><span className="eyebrow">LYRICS</span><h2 id="lyrics-dialog-title">{lyricsTrack.title}</h2><p>{lyricsTrack.artist}</p></div><button className="icon-button" aria-label="关闭歌词" autoFocus onClick={closeDialog}><X /></button></div>
            <span className="visually-hidden" role="status" aria-live="polite">{lyricsLoading ? '正在加载歌词' : '歌词已加载'}</span>
            <pre className="lyrics-content">{lyricsLoading ? '正在加载歌词…' : lyricsText}</pre>
          </section>
          <button className="dialog-scrim" onClick={closeDialog} aria-label="关闭歌词" />
        </>
      )}

      <footer className="player" {...(queueOpen || mobileNavOpen || dialogOpen ? { inert: '' } : {})}>
        <audio
          key={mediaLoadKey(current)}
          ref={audioRef}
          src={current.audioUrl || undefined}
          preload="metadata"
          onPlay={(event) => { if (isCurrentAudio(event.currentTarget)) setIsPlaying(true) }}
          onPause={(event) => { if (isCurrentAudio(event.currentTarget)) setIsPlaying(false) }}
          onTimeUpdate={(event) => {
            if (isCurrentAudio(event.currentTarget) && Number.isFinite(event.currentTarget.currentTime)) setProgress(event.currentTarget.currentTime)
          }}
          onLoadedMetadata={(event) => {
            if (isCurrentAudio(event.currentTarget) && Number.isFinite(event.currentTarget.duration)) {
              setDuration(event.currentTarget.duration)
              updateLocalDuration(event.currentTarget.duration)
            }
          }}
          onEnded={(event) => { if (isCurrentAudio(event.currentTarget)) handleEnded() }}
          onError={(event) => { if (isCurrentAudio(event.currentTarget)) handleAudioError() }}
        />
        <div className="player__track"><Cover name={current.cover} size="small" /><div><strong>{current.title}</strong><span>{current.artist} · {sourceLabel(current.source)} · {qualityLabels[current.quality]}{current.capabilities.playback === 'preview' ? '试听' : ''}</span></div><button aria-label={`${liked.has(currentKey) ? '取消收藏' : '收藏'} ${current.title}`} className={`like-button ${liked.has(currentKey) ? 'liked' : ''}`} onClick={() => toggleLike(current)}><Heart fill={liked.has(currentKey) ? 'currentColor' : 'none'} /></button></div>
        <div className="player__center">
          <div className="player__controls"><button aria-label="随机播放" disabled={queue.length < 2} onClick={shuffle}><Shuffle /></button><button aria-label="上一首" disabled={!queue.length} onClick={() => skip(-1)}><SkipBack fill="currentColor" /></button><button className="play-main" aria-label={current.capabilities.playback === 'none' ? '当前歌曲无法播放' : pendingTrackKey ? '取消加载' : isPlaying ? '暂停' : '播放'} aria-busy={Boolean(pendingTrackKey)} disabled={current.capabilities.playback === 'none'} onClick={togglePlay}>{pendingTrackKey ? <LoaderCircle className="spin" /> : isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" disabled={!queue.length} onClick={() => skip(1)}><SkipForward fill="currentColor" /></button><button className={repeatMode === 'off' ? '' : 'active'} aria-label={`循环模式：${repeatMode === 'off' ? '关闭' : repeatMode === 'all' ? '列表循环' : '单曲循环'}`} aria-pressed={repeatMode !== 'off'} onClick={cycleRepeat}>{repeatMode === 'one' ? <Repeat1 /> : <Repeat />}</button><button aria-label="播放队列" onClick={openQueue}><ListMusic /></button></div>
          <div className="player__progress"><span>{formatTime(seekProgress)}</span><input aria-label="播放进度" aria-valuetext={`${formatTime(seekProgress)} / ${formatTime(seekDuration)}`} disabled={!seekDuration} type="range" min="0" max={seekDuration || 1} step="0.1" value={seekProgress} style={{ '--progress': `${seekDuration ? (seekProgress / seekDuration) * 100 : 0}%` } as React.CSSProperties} onChange={(event) => seekTo(Number(event.target.value))} /><span>{formatTime(seekDuration)}</span></div>
        </div>
        <div className="player__tools"><button aria-label={`将 ${current.title} 加入歌单`} onClick={() => openPlaylistDialog(current)}><ListPlus /></button><button className={current.capabilities.lyrics ? '' : 'is-unavailable'} aria-disabled={!current.capabilities.lyrics} aria-label={current.capabilities.lyrics ? `查看 ${current.title} 的歌词` : `${current.title} 的歌词不可用`} onClick={() => void openLyrics(current)}><FileText /></button><button className={current.capabilities.download ? '' : 'is-unavailable'} aria-disabled={!current.capabilities.download} aria-label={current.capabilities.download ? `下载 ${current.title}` : `${current.title} 不可下载`} onClick={() => void downloadTrack(current)}><Download /></button><button className="volume-button" aria-label={volume > 0 ? '静音' : '取消静音'} aria-pressed={volume === 0} onClick={toggleMute}>{volume > 0 ? <Volume2 /> : <VolumeX />}</button><input aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`} type="range" min="0" max="1" step="0.01" value={volume} style={{ '--progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></div>
      </footer>
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  )
}

export default App
