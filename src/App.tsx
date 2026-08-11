import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, CassetteTape, CircleUserRound, Cloud, CloudOff, Disc3, Download, ExternalLink, FileDown, FileText, Github, Heart, Home, ImageDown, Library,
  ListMusic, ListPlus, LoaderCircle, Menu, Pause, Play, Plus, Repeat, Repeat1,
  Palette, Search, Settings, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Trash2, Upload, MapPin,
  Volume2, VolumeX, Waves, X,
} from 'lucide-react'
import { playlists, tracks as initialTracks } from './data/catalog'
import { localFileStem, readLocalLyrics, selectLocalAudioFiles } from './localFiles.mjs'
import {
  autoplayMediaMatches, collectionPlaybackPlan, endedPlaybackAction, focusTrapTargetIndex, initialPlaybackDuration, mediaLoadKey, playableTracks,
  mediaErrorAction, nextDirectFullTrack, playbackUnavailableTrack, playbackVisualState, playControlDisabled, preferResolvedCurrent, queueWithoutTrack,
  removalFocusIndex, seekPosition,
  shouldApplyEndedAction, shouldCancelPendingTrack, shouldRestartCurrentTrack,
} from './playerLogic.mjs'
import {
  mergeRecommendationPages, nextPlayableRecommendation, recommendationSeed, shouldPrefetchRecommendations,
} from './recommendationLogic.mjs'
import { diversifyRankedTracks, filterTracksByPlayback, mergeSearchPages, refineSearchTracks, searchFallbackTracks, searchInputMode, summarizePlaybackTracks } from './searchLogic.mjs'
import { downloadArtwork, musicProvider, publicBrowserMode, sourceLabel } from './services/musicProvider'
import { accountApi, accountAvailable } from './services/account'
import { mergeLibraryData, normalizeLibraryData } from './syncLogic.mjs'
import { isPlaylist, isTrack, musicSources, trackKey } from './types/music'
import { isSafeUrl } from './urlPolicy.mjs'
import type { AccountUser } from './services/account'
import type { LibraryData, PlaybackHistory } from './syncLogic.mjs'
import type { SearchDomain, SearchDuration, SearchSort } from './searchLogic.mjs'
import type { MusicIdentification, MusicSource, Playlist, ProviderStatus, Track } from './types/music'

type View = 'discover' | 'search' | 'library' | 'account' | 'settings'
type PlayMode = 'toggle' | 'play'
type PlaybackFilter = 'no-preview' | 'full' | 'all'
type CollectionPlaybackMode = 'order' | 'shuffle' | 'one'
type Theme = 'system' | 'paper' | 'night'
type CoverStyle = 'vinyl' | 'cassette' | 'minimal'
type Accent = 'orange' | 'blue' | 'green'
type Density = 'comfortable' | 'compact'
type FontScale = 'small' | 'standard' | 'large'
type CornerStyle = 'square' | 'soft' | 'round'
type PlayerLayout = 'docked' | 'floating'
type BackgroundTexture = 'none' | 'paper' | 'grid'
type PlaylistRecommendation = { track: Track; reason: string }
const searchPageSize = 50
const searchMaxPages = 10
const searchResultLimit = searchPageSize * searchMaxPages
const identifiableSources: MusicSource[] = musicSources.filter((source) => !['demo', 'local', 'fixture'].includes(source))
const publicBrowserSources = new Set<MusicSource>(['apple', 'audius', 'musicbrainz', 'wikimedia'])
const sourceParsingNotes: Partial<Record<MusicSource, string>> = {
  qmkg: '全民 K 歌原生能力仅支持 ID 或地址解析；配置公开网页目录后可检索已索引作品页',
  youtube: 'YouTube Music 使用官方 Data API 搜索元数据，不抽取音视频',
}
const libraryValidators = { isTrack, isPlaylist }
const projectLinks = [
  { label: 'GitHub 仓库', href: 'https://github.com/hzagaming/LIstener' },
  { label: 'Issue 仓库', href: 'https://github.com/hzagaming/LIstener/issues' },
  { label: 'Commit 记录', href: 'https://github.com/hzagaming/LIstener/commits/main' },
  { label: '当前版本公告', href: 'https://github.com/hzagaming/LIstener/blob/main/CHANGELOG.md' },
  { label: 'GitHub Releases', href: 'https://github.com/hzagaming/LIstener/releases' },
  { label: 'HZAGAMING 主页', href: 'https://github.com/hzagaming' },
] as const
const accentColors: Record<Accent, string> = { orange: '#ed6c3b', blue: '#477fc1', green: '#3f8a65' }
const searchExplorations = [
  { label: '流派', terms: [{ label: '流行', query: 'pop hits' }, { label: '摇滚', query: 'rock hits' }, { label: 'R&B', query: 'R&B' }, { label: '电子', query: 'electronic music' }, { label: '民谣', query: 'folk music' }] },
  { label: '场景', terms: [{ label: '通勤', query: 'commute music' }, { label: '学习', query: 'focus music' }, { label: '健身', query: 'workout music' }, { label: '深夜', query: 'late night music' }, { label: '派对', query: 'party hits' }] },
  { label: '年代', terms: [{ label: '80年代', query: '80s hits' }, { label: '90年代', query: '90s hits' }, { label: '00年代', query: '2000s hits' }, { label: '10年代', query: '2010s hits' }, { label: '20年代', query: '2020s hits' }] },
  { label: '地区', terms: [{ label: '华语', query: '华语流行' }, { label: '欧美', query: 'US UK pop' }, { label: '日本', query: 'J-pop' }, { label: '韩国', query: 'K-pop' }, { label: '拉丁', query: 'Latin pop' }] },
] as const

const browserRegion = () => {
  const parts = navigator.language.split('-')
  const explicit = parts[1]?.toUpperCase()
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit
  return parts[0].toLocaleLowerCase() === 'zh' ? 'CN' : 'US'
}

const regionalQuery = (region: string) => ({
  CN: '华语流行', US: 'US pop', GB: 'UK pop', JP: 'J-pop', KR: 'K-pop', FR: 'French pop', DE: 'German pop',
})[region] || 'global pop'

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

const readStoredBoolean = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

const readStoredText = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

const looksLikeMusicAddress = (value: string) => /https?:\/\//i.test(value)
  || /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/.test(value)

const readStoredChoice = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
  const value = readStoredText(key, fallback)
  return choices.includes(value as T) ? value as T : fallback
}

const readStoredHistory = () => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('listener.history') ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is PlaybackHistory => Boolean(item && typeof item === 'object' && isTrack(item.track) && Number.isSafeInteger(item.playedAt))).slice(0, 500)
      : []
  } catch {
    return []
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
  const imageUrl = isSafeUrl(name) ? new URL(name).toString() : undefined
  const [failedUrl, setFailedUrl] = useState('')
  return (
    <div className={`cover ${imageUrl ? 'cover--remote' : `cover--${name}`} cover--${size}`} aria-hidden="true">
      <div className="cover__grain" />
      <Disc3 className="cover__disc" />
      <div className="cover__cassette"><span /><span /></div>
      <span className="cover__mark">L.</span>
      {imageUrl && failedUrl !== imageUrl && <img className="cover__image" src={imageUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(imageUrl)} />}
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
  buffering?: boolean
  liked: boolean
  onPlay: () => void
  onLike: () => void
  onPlaylist: () => void
  onLyrics: () => void
  onDownload: () => void
  onCoverDownload: () => void
  onRemove?: (event: React.MouseEvent<HTMLButtonElement>) => void
  context?: string
}

function TrackRow({
  track, index, current, playing, pending, buffering, liked, onPlay, onLike, onPlaylist,
  onLyrics, onDownload, onCoverDownload, onRemove, context,
}: TrackRowProps) {
  const playbackUnavailable = track.capabilities.playback === 'none'
  const visualState = playbackVisualState({
    current, playing: Boolean(playing), resolving: Boolean(pending), buffering: Boolean(buffering),
  })
  const loading = visualState === 'resolving' || visualState === 'buffering'
  const playLabel = playbackUnavailable
    ? `在 ${sourceLabel(track.source)} 打开 ${track.title}`
    : visualState === 'resolving'
      ? `取消加载 ${track.title}`
      : visualState === 'buffering'
        ? `正在缓冲 ${track.title}，点击暂停`
        : visualState === 'playing' ? `暂停 ${track.title}` : `播放 ${track.title}`
  return (
    <div className={`track-row ${current ? 'track-row--current' : ''}`} role="listitem">
      <button className="track-row__play" aria-label={playLabel} title={playbackUnavailable ? '站内不可播放，点击前往已验证的来源页' : undefined} aria-busy={loading} aria-pressed={visualState === 'playing'} disabled={playbackUnavailable ? false : playControlDisabled(track.capabilities.playback, Boolean(pending))} onClick={onPlay}>
        <span>{String(index + 1).padStart(2, '0')}</span>{loading ? <LoaderCircle className="spin" /> : visualState === 'playing' ? <Pause /> : <Play fill="currentColor" />}
      </button>
      <Cover name={track.cover} size="small" />
      <div className="track-row__title">
        <strong>{track.title}</strong>
        <span>{track.artist}<small className="track-row__source-mobile"> · {sourceLabel(track.source)}</small></span>
        {context && <small className="track-row__context">{context}</small>}
        {playbackUnavailable
          ? <small className="track-row__availability">站内不可播 · 点击左侧前往来源</small>
          : <small className={`track-row__availability track-row__availability--${track.capabilities.playback}`}>{track.capabilities.playback === 'full' ? track.audioUrl ? '完整可播' : '完整音源 · 点击验证' : track.audioUrl ? '试听可播' : '试听音源 · 点击验证'}</small>}
      </div>
      <span className="track-row__album">{track.album}</span>
      <div className="track-row__badges"><SourceBadge track={track} /><span className="quality-badge">{track.capabilities.playback === 'full' ? '完整' : track.capabilities.playback === 'preview' ? '试听' : qualityLabels[track.quality]}</span></div>
      <span className="track-row__duration">{formatTime(track.duration)}</span>
      <div className="track-row__actions">
        <button className="icon-button" aria-label={`加入歌单 ${track.title}`} title="加入歌单" onClick={onPlaylist}><ListPlus /></button>
        <button className={`icon-button ${track.capabilities.lyrics ? '' : 'is-unavailable'}`} aria-disabled={!track.capabilities.lyrics} aria-label={track.capabilities.lyrics ? `查看歌词 ${track.title}` : `歌词不可用：${track.title}`} title={track.capabilities.lyrics ? '查看歌词' : '来源未提供歌词，点击了解详情'} onClick={onLyrics}><FileText /></button>
        <button className={`icon-button ${track.capabilities.download ? '' : 'is-unavailable'}`} aria-disabled={!track.capabilities.download} aria-label={track.capabilities.download ? `下载 ${track.title}` : `下载不可用：${track.title}`} title={track.capabilities.download ? '下载' : '来源未授权下载，点击了解详情'} onClick={onDownload}><Download /></button>
        <button className="icon-button" aria-label={`下载封面 ${track.title}`} title="下载封面" onClick={onCoverDownload}><ImageDown /></button>
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
  const [homeTracks, setHomeTracks] = useState<Track[]>([])
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState(false)
  const [homeRevision, setHomeRevision] = useState(0)
  const [resultQuery, setResultQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchDegraded, setSearchDegraded] = useState(false)
  const [searchRevision, setSearchRevision] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [searchMoreError, setSearchMoreError] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSource>('all')
  const [searchSource, setSearchSource] = useState<'all' | MusicSource>('all')
  const [playbackFilter, setPlaybackFilter] = useState<PlaybackFilter>('all')
  const [searchDomain, setSearchDomain] = useState<SearchDomain>('all')
  const [searchDuration, setSearchDuration] = useState<SearchDuration>('all')
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance')
  const [queue, setQueue] = useState<Track[]>(() => playableTracks(readStoredTracks('listener.queue', initialTracks.slice(0, 6), true)))
  const [current, setCurrent] = useState<Track>(() => readStoredTrack('listener.current', initialTracks[0]))
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(() => initialPlaybackDuration(current))
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('listener.volume', 0.72))))
  const [queueOpen, setQueueOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [liked, setLiked] = useState(() => new Map(
    readStoredTracks('listener.liked', initialTracks.filter((track) => track.liked), true)
      .map((track) => [trackKey(track), track]),
  ))
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>(readStoredPlaylists)
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [history, setHistory] = useState<PlaybackHistory[]>(readStoredHistory)
  const [regionalRecommendations, setRegionalRecommendations] = useState(() => readStoredBoolean('listener.regional', true))
  const [region, setRegion] = useState(() => readStoredText('listener.region', browserRegion()).toUpperCase())
  const [theme, setTheme] = useState<Theme>(() => readStoredChoice('listener.theme', ['system', 'paper', 'night'], 'system'))
  const [coverStyle, setCoverStyle] = useState<CoverStyle>(() => readStoredChoice('listener.cover-style', ['vinyl', 'cassette', 'minimal'], 'vinyl'))
  const [accent, setAccent] = useState<Accent>(() => readStoredChoice('listener.accent', ['orange', 'blue', 'green'], 'orange'))
  const [density, setDensity] = useState<Density>(() => readStoredChoice('listener.density', ['comfortable', 'compact'], 'comfortable'))
  const [reduceMotion, setReduceMotion] = useState(() => readStoredBoolean('listener.reduce-motion', false))
  const [fontScale, setFontScale] = useState<FontScale>(() => readStoredChoice('listener.font-scale', ['small', 'standard', 'large'], 'standard'))
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>(() => readStoredChoice('listener.corner-style', ['square', 'soft', 'round'], 'soft'))
  const [playerLayout, setPlayerLayout] = useState<PlayerLayout>(() => readStoredChoice('listener.player-layout', ['docked', 'floating'], 'docked'))
  const [backgroundTexture, setBackgroundTexture] = useState<BackgroundTexture>(() => readStoredChoice('listener.background-texture', ['none', 'paper', 'grid'], 'paper'))
  const [online, setOnline] = useState(navigator.onLine)
  const [user, setUser] = useState<AccountUser | null>(null)
  const [accountChecking, setAccountChecking] = useState(accountAvailable)
  const [accountMode, setAccountMode] = useState<'login' | 'register'>('login')
  const [accountEmail, setAccountEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [syncStatus, setSyncStatus] = useState(accountAvailable ? '本地保存' : '静态版 · 本地保存')
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [playlistRecommendations, setPlaylistRecommendations] = useState<PlaylistRecommendation[]>([])
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [recommendationError, setRecommendationError] = useState(false)
  const [recommendationPage, setRecommendationPage] = useState(0)
  const [recommendationHasMore, setRecommendationHasMore] = useState(false)
  const [recommendationVisibleLimit, setRecommendationVisibleLimit] = useState(8)
  const [continuousPlaylistId, setContinuousPlaylistId] = useState<string | null>(null)
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
  const [shuffleMode, setShuffleMode] = useState(() => readStoredBoolean('listener.shuffle', false))
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
  const searchControllerRef = useRef<AbortController | null>(null)
  const searchMoreControllerRef = useRef<AbortController | null>(null)
  const recommendationControllerRef = useRef<AbortController | null>(null)
  const homeControllerRef = useRef<AbortController | null>(null)
  const recommendationLoadingRef = useRef(false)
  const recommendationRequestRef = useRef(0)
  const recommendationPrefetchKeyRef = useRef('')
  const selectedPlaylistIdRef = useRef(selectedPlaylistId)
  const continuousPlaylistIdRef = useRef(continuousPlaylistId)
  const identifyControllerRef = useRef<AbortController | null>(null)
  const lyricsControllerRef = useRef<AbortController | null>(null)
  const playRequestRef = useRef(0)
  const autoplayMediaKeyRef = useRef<string | null>(null)
  const mediaRetryKeyRef = useRef<string | null>(null)
  const mediaRetryTimerRef = useRef<number>()
  const bufferingTimerRef = useRef<number>()
  const queueRevisionRef = useRef(0)
  const searchRequestRef = useRef(0)
  const identifyRequestRef = useRef(0)
  const lyricsRequestRef = useRef(0)
  const noticeTimerRef = useRef<number>()
  const queueTriggerRef = useRef<HTMLElement | null>(null)
  const dialogTriggerRef = useRef<HTMLElement | null>(null)
  const mobileMenuRef = useRef<HTMLButtonElement>(null)
  const mobileCloseRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dataImportRef = useRef<HTMLInputElement>(null)
  const cloudRevisionRef = useRef(0)
  const cloudReadyRef = useRef(false)
  const cloudSavingRef = useRef(false)
  const cloudTimerRef = useRef<number>()
  const lastSyncedRef = useRef('')
  const playlistsHeadingRef = useRef<HTMLHeadingElement>(null)
  const likedHeadingRef = useRef<HTMLHeadingElement>(null)
  const lastAudibleVolumeRef = useRef(volume || 0.72)
  const localFilesRef = useRef(new Map<string, { file: File; url: string }>())
  const localLyricsRef = useRef(new Map<string, { plain: string; lrc: string }>())
  selectedPlaylistIdRef.current = selectedPlaylistId
  continuousPlaylistIdRef.current = continuousPlaylistId

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2800)
  }

  const clearBufferingTimeout = () => {
    if (bufferingTimerRef.current) window.clearTimeout(bufferingTimerRef.current)
    bufferingTimerRef.current = undefined
  }

  const watchBuffering = (audio: HTMLAudioElement) => {
    clearBufferingTimeout()
    setIsBuffering(true)
    bufferingTimerRef.current = window.setTimeout(() => {
      bufferingTimerRef.current = undefined
      if (audioRef.current !== audio || audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || audio.paused) return
      handleAudioError(audio)
    }, 5_000)
  }

  const attemptPlayback = (audio: HTMLAudioElement) => {
    if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) watchBuffering(audio)
    void audio.play().catch((error: unknown) => {
      if (audioRef.current !== audio || audio.error) return
      clearBufferingTimeout()
      setIsPlaying(false)
      setIsBuffering(false)
      if (error instanceof DOMException && error.name === 'AbortError') return
      showNotice(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '播放被浏览器拦截，请再次点击播放'
        : '音频无法开始播放，请稍后重试')
    })
  }

  const isCurrentAudio = (audio: HTMLAudioElement) => audioRef.current === audio

  const cancelMediaRetry = () => {
    if (mediaRetryTimerRef.current) window.clearTimeout(mediaRetryTimerRef.current)
    mediaRetryTimerRef.current = undefined
    mediaRetryKeyRef.current = null
  }

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
    identifyControllerRef.current?.abort()
    identifyControllerRef.current = null
    identifyRequestRef.current += 1
    setIsIdentifying(false)
    setIdentification(null)
    setIdentificationHasDetails(null)
    setSearchDegraded(false)
    setQuery(value)
  }

  const exploreSearch = (value: string) => {
    setSearchDomain('all')
    setSearchDuration('all')
    setSearchSort('relevance')
    updateQuery(value)
  }

  const updateIdentifySource = (source: MusicSource) => {
    identifyControllerRef.current?.abort()
    identifyControllerRef.current = null
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
    writeStorage('listener.shuffle', String(shuffleMode))
  }, [shuffleMode])

  useEffect(() => {
    writeStorage('listener.theme', theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'night' : 'paper' : theme }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    writeStorage('listener.cover-style', coverStyle)
    writeStorage('listener.accent', accent)
    writeStorage('listener.density', density)
    writeStorage('listener.reduce-motion', String(reduceMotion))
    writeStorage('listener.font-scale', fontScale)
    writeStorage('listener.corner-style', cornerStyle)
    writeStorage('listener.player-layout', playerLayout)
    writeStorage('listener.background-texture', backgroundTexture)
  }, [accent, backgroundTexture, cornerStyle, coverStyle, density, fontScale, playerLayout, reduceMotion])

  useEffect(() => {
    writeStorage('listener.history', history.map((item) => ({
      ...item,
      track: prepareStoredTrack(item.track),
    })))
  }, [history])

  useEffect(() => {
    writeStorage('listener.regional', String(regionalRecommendations))
    writeStorage('listener.region', region)
  }, [region, regionalRecommendations])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!pendingDeletePlaylistId) return
    const timeout = window.setTimeout(() => setPendingDeletePlaylistId(null), 5_000)
    return () => window.clearTimeout(timeout)
  }, [pendingDeletePlaylistId])

  useEffect(() => {
    if (current.source !== 'local') writeStorage('listener.current', prepareStoredTrack(current))
    document.title = `${current.title} · ${current.artist} — Listener`
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: isSafeUrl(current.cover) ? [{ src: new URL(current.cover).toString() }] : undefined,
      })
    }
  }, [current])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused' } catch { /* unsupported state */ }
  }, [isPlaying])

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return
    const position = seekPosition(progress, duration)
    if (position === null) {
      try { navigator.mediaSession.setPositionState() } catch { /* unsupported media */ }
      return
    }
    try { navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position }) } catch { /* unsupported media */ }
  }, [duration, progress])

  useEffect(() => () => {
    playRequestRef.current += 1
    resolveControllerRef.current?.abort()
    searchControllerRef.current?.abort()
    searchMoreControllerRef.current?.abort()
    homeControllerRef.current?.abort()
    recommendationControllerRef.current?.abort()
    identifyControllerRef.current?.abort()
    lyricsControllerRef.current?.abort()
    if (mediaRetryTimerRef.current) window.clearTimeout(mediaRetryTimerRef.current)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current)
    if (bufferingTimerRef.current) window.clearTimeout(bufferingTimerRef.current)
    for (const { url } of localFilesRef.current.values()) URL.revokeObjectURL(url)
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void musicProvider.status(controller.signal)
      .then((status) => { if (active) setProviderStatus(status) })
      .catch(() => undefined)
      .finally(() => { if (active) setProviderChecking(false) })
    return () => {
      active = false
      controller.abort()
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
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const targetIndex = focusTrapTargetIndex(activeIndex, focusable.length, event.shiftKey)
      if (targetIndex < 0) return
      event.preventDefault()
      focusable[targetIndex].focus()
    }
    document.addEventListener('keydown', trapFocus)
    return () => document.removeEventListener('keydown', trapFocus)
  }, [lyricsTrack, mobileNavOpen, playlistModalTrack, queueOpen])

  useEffect(() => {
    if (mobileNavOpen) mobileCloseRef.current?.focus()
  }, [mobileNavOpen])

  useEffect(() => {
    if (playlistModalTrack === undefined && !lyricsTrack && !queueOpen && !mobileNavOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [lyricsTrack, mobileNavOpen, playlistModalTrack, queueOpen])

  const currentMediaKey = mediaLoadKey(current)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    if (!autoplayMediaMatches(autoplayMediaKeyRef.current, currentMediaKey)) return
    autoplayMediaKeyRef.current = null
    audio.load()
    attemptPlayback(audio)
  }, [currentMediaKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const inputMode = searchInputMode(query)
  const searchableSources = useMemo(
    () => providerStatus.sources.filter((source) => providerStatus.capabilities[source]?.search
      && !['demo', 'local', 'fixture'].includes(source)),
    [providerStatus],
  )

  useEffect(() => {
    if (searchSource !== 'all' && !searchableSources.includes(searchSource)) setSearchSource('all')
  }, [searchSource, searchableSources])

  useEffect(() => {
    let active = true
    const requestId = ++searchRequestRef.current
    const trimmed = query.trim()
    searchMoreControllerRef.current?.abort()
    searchMoreControllerRef.current = null
    setSearchDegraded(false)
    setSearchPage(1)
    setSearchHasMore(false)
    setIsLoadingMore(false)
    setSearchMoreError(false)
    setSourceFilter('all')
    if (inputMode === 'empty') {
      setResults(initialTracks)
      setResultQuery('')
      setIsSearching(false)
      return
    }
    if (inputMode !== 'search') {
      setResults([])
      setResultQuery(trimmed)
      setIsSearching(false)
      return
    }
    const controller = new AbortController()
    searchControllerRef.current = controller
    setResults([])
    setResultQuery(trimmed)
    setIsSearching(true)
    const timeout = window.setTimeout(async () => {
      try {
        const found = await musicProvider.searchPage(query, { provider: searchSource, page: 1, pageSize: searchPageSize }, controller.signal)
        if (active && requestId === searchRequestRef.current) {
          setResults(found.tracks)
          setSearchPage(found.page)
          setSearchHasMore(found.hasMore && found.page < searchMaxPages)
        }
      } catch (error) {
        const fallback = searchFallbackTracks<Track>(error)
        if (active && requestId === searchRequestRef.current) {
          if (fallback) setResults(fallback)
          setSearchDegraded(true)
        }
      } finally {
        if (searchControllerRef.current === controller) searchControllerRef.current = null
        if (active && requestId === searchRequestRef.current) setIsSearching(false)
      }
    }, 180)
    return () => {
      active = false
      if (searchControllerRef.current === controller) searchControllerRef.current = null
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [query, searchRevision, searchSource])

  const loadMoreSearchResults = async () => {
    if (inputMode !== 'search' || isSearching || isLoadingMore || !searchHasMore || searchPage >= searchMaxPages) return
    searchMoreControllerRef.current?.abort()
    const controller = new AbortController()
    searchMoreControllerRef.current = controller
    const requestId = searchRequestRef.current
    const nextPage = searchPage + 1
    setIsLoadingMore(true)
    setSearchMoreError(false)
    try {
      const found = await musicProvider.searchPage(query, { provider: searchSource, page: nextPage, pageSize: searchPageSize }, controller.signal)
      if (controller.signal.aborted || requestId !== searchRequestRef.current || found.page !== nextPage) return
      setResults((previous) => mergeSearchPages(previous, found.tracks, searchResultLimit))
      setSearchPage(found.page)
      setSearchHasMore(found.hasMore && found.page < searchMaxPages)
    } catch {
      if (!controller.signal.aborted && requestId === searchRequestRef.current) setSearchMoreError(true)
    } finally {
      if (searchMoreControllerRef.current === controller) searchMoreControllerRef.current = null
      if (requestId === searchRequestRef.current) setIsLoadingMore(false)
    }
  }

  const currentKey = trackKey(current)
  const currentIndex = useMemo(() => queue.findIndex((track) => trackKey(track) === currentKey), [queue, currentKey])
  const sourceResults = useMemo(
    () => sourceFilter === 'all' ? results : results.filter((track) => track.source === sourceFilter),
    [results, sourceFilter],
  )
  const refinedResults = useMemo(() => {
    const refined = refineSearchTracks(sourceResults, {
      query: resultQuery, domain: searchDomain, duration: searchDuration, sort: searchSort,
    })
    return searchSort === 'relevance' ? diversifyRankedTracks(refined, refined.length) : refined
  }, [resultQuery, searchDomain, searchDuration, searchSort, sourceResults])
  const displayResults = useMemo(
    () => filterTracksByPlayback(refinedResults, playbackFilter),
    [refinedResults, playbackFilter],
  )
  const hiddenByFilters = sourceResults.length - displayResults.length
  const resultPlaybackCounts = useMemo(() => summarizePlaybackTracks(displayResults), [displayResults])
  const resultPlaybackSummary = [
    `完整直连 ${resultPlaybackCounts.full} 首`,
    playbackFilter === 'all' ? `试听 ${resultPlaybackCounts.preview} 首` : '',
    playbackFilter !== 'full' ? `待解析 ${resultPlaybackCounts.candidate} 首` : '',
    playbackFilter !== 'full' ? `元数据 ${resultPlaybackCounts.metadata} 首` : '',
  ].filter(Boolean).join(' · ')
  const searchPaginationStatus = isLoadingMore
    ? playbackFilter === 'full' ? `正在继续寻找完整歌曲（第 ${searchPage + 1} 页）…` : `正在搜索第 ${searchPage + 1} 页…`
    : searchMoreError
      ? `第 ${searchPage + 1} 页加载失败，已保留当前 ${displayResults.length} 首结果`
      : searchPage >= searchMaxPages
        ? playbackFilter === 'full'
          ? `共找到 ${displayResults.length} 首完整可播，已达到本次搜索上限`
          : `已加载 ${results.length} 首，已达到本次搜索上限`
        : playbackFilter === 'full'
          ? searchHasMore ? `当前已找到 ${displayResults.length} 首完整可播，可继续搜索后续页面` : `共找到 ${displayResults.length} 首完整可播，当前来源已到末页`
          : searchHasMore ? `已加载 ${results.length} 首，可继续拓展至最多 ${searchResultLimit} 首` : `已加载 ${results.length} 首，当前来源已到末页`
  const searchMoreLabel = searchMoreError
    ? playbackFilter === 'full' ? '重试寻找完整歌曲' : '重试加载更多'
    : playbackFilter === 'full' ? '继续寻找完整歌曲' : '继续搜索更多'
  const resultSources = useMemo(() => [...new Set(results.map((track) => track.source))], [results])
  const publicSearchFallback = searchDegraded && resultSources.some((source) => publicBrowserSources.has(source))
  const demoSearchFallback = searchDegraded && resultSources.some((source) => ['demo', 'fixture'].includes(source))
  const likedTracks = useMemo(() => [...liked.values()], [liked])
  const portableLibrary = useMemo(() => normalizeLibraryData({
    version: 1,
    liked: prepareStoredTracks(likedTracks),
    playlists: userPlaylists.map((playlist) => ({ ...playlist, tracks: prepareStoredTracks(playlist.tracks) })),
    queue: prepareStoredTracks(queue),
    current: current.source === 'local' ? null : prepareStoredTrack(current),
    history: history.filter((item) => item.track.source !== 'local').map((item) => ({ ...item, track: prepareStoredTrack(item.track) })),
    settings: {
      volume, repeat: repeatMode, shuffle: shuffleMode, regionalRecommendations, region,
      theme, coverStyle, accent, density, reduceMotion,
      fontScale, cornerStyle, playerLayout, backgroundTexture,
    },
  }, libraryValidators), [accent, backgroundTexture, cornerStyle, coverStyle, current, density, fontScale, history, likedTracks, playerLayout, queue, reduceMotion, region, regionalRecommendations, repeatMode, shuffleMode, theme, userPlaylists, volume])
  const portableLibraryRef = useRef<LibraryData>(portableLibrary)
  portableLibraryRef.current = portableLibrary

  const applyLibraryData = (data: LibraryData) => {
    setLiked(new Map(data.liked.map((track) => [trackKey(track), track])))
    setUserPlaylists(data.playlists)
    setQueue(playableTracks(data.queue))
    if (data.current) setCurrent(data.current)
    setHistory(data.history)
    setVolume(data.settings.volume)
    setRepeatMode(data.settings.repeat)
    setShuffleMode(data.settings.shuffle)
    setRegionalRecommendations(data.settings.regionalRecommendations)
    if (data.settings.region) setRegion(data.settings.region)
    setTheme(data.settings.theme)
    setCoverStyle(data.settings.coverStyle)
    setAccent(data.settings.accent)
    setDensity(data.settings.density)
    setReduceMotion(data.settings.reduceMotion)
    setFontScale(data.settings.fontScale)
    setCornerStyle(data.settings.cornerStyle)
    setPlayerLayout(data.settings.playerLayout)
    setBackgroundTexture(data.settings.backgroundTexture)
  }

  const saveCloudState = async (snapshot = portableLibraryRef.current) => {
    if (!user || !cloudReadyRef.current || cloudSavingRef.current || !online) return
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSyncedRef.current) return
    cloudSavingRef.current = true
    let saveCompleted = false
    setSyncStatus('正在同步…')
    try {
      const saved = await accountApi.saveState(snapshot, cloudRevisionRef.current)
      cloudRevisionRef.current = saved.revision
      lastSyncedRef.current = serialized
      saveCompleted = true
      setSyncStatus('云端已同步')
    } catch (error) {
      const conflict = error as { code?: string; current?: { state: unknown; revision: number } }
      if (conflict.code === 'STATE_CONFLICT' && conflict.current) {
        try {
          const merged = mergeLibraryData(snapshot, conflict.current.state, libraryValidators)
          applyLibraryData(merged)
          const saved = await accountApi.saveState(merged, conflict.current.revision)
          cloudRevisionRef.current = saved.revision
          lastSyncedRef.current = JSON.stringify(merged)
          saveCompleted = true
          setSyncStatus('冲突已合并')
        } catch {
          setSyncStatus('等待网络同步')
        }
      } else {
        setSyncStatus('等待网络同步')
      }
    } finally {
      cloudSavingRef.current = false
      if (saveCompleted && cloudReadyRef.current
        && JSON.stringify(portableLibraryRef.current) !== lastSyncedRef.current) {
        if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current)
        cloudTimerRef.current = window.setTimeout(() => { void saveCloudState() }, 0)
      }
    }
  }

  const initializeCloud = async () => {
    const remote = await accountApi.loadState()
    cloudRevisionRef.current = remote.revision
    const merged = mergeLibraryData(portableLibraryRef.current, remote.state, libraryValidators, {
      preferSecondaryState: remote.state !== null,
    })
    const serialized = JSON.stringify(merged)
    cloudReadyRef.current = true
    applyLibraryData(merged)
    if (remote.state === null || serialized !== JSON.stringify(normalizeLibraryData(remote.state, libraryValidators))) {
      try {
        const saved = await accountApi.saveState(merged, remote.revision)
        cloudRevisionRef.current = saved.revision
      } catch {
        setSyncStatus('等待网络同步')
        return
      }
    }
    lastSyncedRef.current = serialized
    setSyncStatus('云端已同步')
  }

  useEffect(() => {
    if (!accountAvailable) return
    let active = true
    void accountApi.me().then(async ({ user: currentUser }) => {
      if (!active || !currentUser) return
      setUser(currentUser)
      await initializeCloud()
    }).catch(() => undefined).finally(() => { if (active) setAccountChecking(false) })
    return () => { active = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!accountAvailable) return
    let active = true
    void accountApi.region().then((result) => {
      if (!active || !result.country) return
      try {
        if (!localStorage.getItem('listener.region')) setRegion(result.country)
      } catch { setRegion(result.country) }
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user || !cloudReadyRef.current || !online) return
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current)
    cloudTimerRef.current = window.setTimeout(() => { void saveCloudState() }, 1_000)
    return () => { if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current) }
  }, [online, portableLibrary, user]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectedPlaylist = useMemo(
    () => userPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [selectedPlaylistId, userPlaylists],
  )
  const selectedRecommendationSeed = useMemo(
    () => recommendationSeed(selectedPlaylist?.tracks),
    [selectedPlaylist],
  )
  const selectedPlaylistRecommendationKey = useMemo(
    () => selectedPlaylist
      ? `${selectedPlaylist.id}:${selectedPlaylist.tracks.map((track) => `${trackKey(track)}:${track.artist}:${track.album}`).join('|')}`
      : '',
    [selectedPlaylist],
  )
  const recommendationTracks = useMemo(
    () => playlistRecommendations.map(({ track }) => track),
    [playlistRecommendations],
  )
  const visibleRecommendations = useMemo(
    () => playlistRecommendations.slice(0, recommendationVisibleLimit),
    [playlistRecommendations, recommendationVisibleLimit],
  )
  const selectedPlaylistPlayableCount = useMemo(
    () => selectedPlaylist ? playableTracks([...selectedPlaylist.tracks, ...recommendationTracks]).length : 0,
    [recommendationTracks, selectedPlaylist],
  )
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit' }).format(new Date()),
    [],
  )

  useEffect(() => {
    if (sourceFilter !== 'all' && !resultSources.includes(sourceFilter)) setSourceFilter('all')
  }, [resultSources, sourceFilter])

  useEffect(() => {
    if (view !== 'discover') return
    const controller = new AbortController()
    homeControllerRef.current = controller
    setHomeLoading(true)
    setHomeError(false)
    const provider: MusicSource = 'apple'
    const queries = ['周杰伦', 'Taylor Swift', 'The Weeknd', 'Dua Lipa', 'Bruno Mars']
    if (regionalRecommendations) queries.push(regionalQuery(region))
    else queries.push('Ariana Grande')
    void (async () => {
      const pages: PromiseSettledResult<Awaited<ReturnType<typeof musicProvider.searchPage>>>[] = []
      for (let index = 0; index < queries.length; index += 2) {
        pages.push(...await Promise.allSettled(queries.slice(index, index + 2).map((query) => (
          musicProvider.searchPage(query, { provider, pageSize: 2 }, controller.signal)
        ))))
        if (controller.signal.aborted) return
      }
      if (controller.signal.aborted) return
      const candidates = pages.flatMap((page) => {
        if (page.status !== 'fulfilled') return []
        const tracks = page.value.tracks.filter((track) => !['demo', 'fixture'].includes(track.source))
        const selected = tracks.find((track) => track.capabilities.playback === 'full')
          ?? tracks.find((track) => track.capabilities.playback === 'preview')
          ?? tracks[0]
        return selected ? [selected] : []
      })
      const seen = new Set<string>()
      const unique = candidates.filter((track) => {
        const key = trackKey(track)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setHomeTracks(unique)
      setHomeError(!unique.length)
    })().finally(() => {
      if (homeControllerRef.current === controller) homeControllerRef.current = null
      if (!controller.signal.aborted) setHomeLoading(false)
    })
    return () => {
      if (homeControllerRef.current === controller) homeControllerRef.current = null
      controller.abort()
    }
  }, [homeRevision, region, regionalRecommendations, view])

  const loadRecommendationPage = async (playlist: Playlist, page: number, append: boolean) => {
    if (recommendationLoadingRef.current) return null
    const seed = recommendationSeed(playlist.tracks)
    if (!seed) return null
    const requestId = ++recommendationRequestRef.current
    const controller = new AbortController()
    recommendationControllerRef.current = controller
    recommendationLoadingRef.current = true
    setRecommendationLoading(true)
    setRecommendationError(false)
    try {
      let candidates: Track[]
      let hasMore: boolean
      try {
        const result = await musicProvider.searchPage(seed.query, { page, pageSize: 30 }, controller.signal)
        candidates = result.tracks
        hasMore = result.hasMore
      } catch (error) {
        const fallback = page === 1 ? searchFallbackTracks<Track>(error) : null
        if (!fallback) throw error
        candidates = fallback.filter((track) => !['demo', 'fixture'].includes(track.source))
        if (!candidates.length) throw error
        hasMore = false
      }
      const filtered = filterTracksByPlayback(candidates, 'no-preview')
      const merged = mergeRecommendationPages(playlist.tracks, append ? playlistRecommendations : [], filtered, 500)
      if (requestId !== recommendationRequestRef.current || selectedPlaylistIdRef.current !== playlist.id) return null
      setPlaylistRecommendations(merged)
      setRecommendationPage(page)
      setRecommendationHasMore(hasMore && page < 100)
      if (continuousPlaylistIdRef.current === playlist.id) {
        const queued = new Set(queue.map(trackKey))
        const additions = merged.map(({ track }) => track)
          .filter((track) => track.capabilities.playback === 'full' && !queued.has(trackKey(track)))
        if (additions.length) {
          queueRevisionRef.current += 1
          setQueue((previous) => {
            const currentKeys = new Set(previous.map(trackKey))
            return [...previous, ...additions.filter((track) => !currentKeys.has(trackKey(track)))]
          })
        }
      }
      return { recommendations: merged, hasMore }
    } catch {
      if (requestId === recommendationRequestRef.current && !controller.signal.aborted) setRecommendationError(true)
      return null
    } finally {
      if (recommendationControllerRef.current === controller) recommendationControllerRef.current = null
      if (requestId === recommendationRequestRef.current) {
        recommendationLoadingRef.current = false
        setRecommendationLoading(false)
      }
    }
  }

  useEffect(() => {
    recommendationRequestRef.current += 1
    recommendationControllerRef.current?.abort()
    recommendationControllerRef.current = null
    recommendationLoadingRef.current = false
    setRecommendationError(false)
    setPlaylistRecommendations([])
    setRecommendationPage(0)
    setRecommendationHasMore(false)
    setRecommendationVisibleLimit(8)
    recommendationPrefetchKeyRef.current = ''
    continuousPlaylistIdRef.current = null
    setContinuousPlaylistId(null)
    if (!selectedPlaylist?.tracks.length || !selectedRecommendationSeed) {
      setRecommendationLoading(false)
      return
    }
    void loadRecommendationPage(selectedPlaylist, 1, false)
    return () => {
      recommendationRequestRef.current += 1
      recommendationControllerRef.current?.abort()
      recommendationControllerRef.current = null
      recommendationLoadingRef.current = false
    }
  }, [selectedPlaylistId, selectedPlaylistRecommendationKey, selectedRecommendationSeed?.query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPlaylist) return
    const requestKey = `${selectedPlaylist.id}:${currentKey}`
    if (!shouldPrefetchRecommendations({
      continuous: continuousPlaylistId === selectedPlaylist.id,
      currentIndex,
      queueLength: queue.length,
      hasMore: recommendationHasMore,
      loading: recommendationLoading,
      requestKey,
      lastRequestKey: recommendationPrefetchKeyRef.current,
    })) return
    recommendationPrefetchKeyRef.current = requestKey
    void loadRecommendationPage(selectedPlaylist, recommendationPage + 1, true)
  }, [continuousPlaylistId, currentIndex, currentKey, queue.length, recommendationHasMore, recommendationLoading, recommendationPage, selectedPlaylist]) // eslint-disable-line react-hooks/exhaustive-deps

  const cancelPendingPlay = () => {
    playRequestRef.current += 1
    resolveControllerRef.current?.abort()
    resolveControllerRef.current = null
    pendingTrackKeyRef.current = null
    setPendingTrackKey(null)
  }

  const playTrack = (track: Track, list?: Track[], mode: PlayMode = 'toggle') => {
    if (mediaLoadKey(track) !== currentMediaKey) {
      cancelMediaRetry()
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
    }
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
        autoplayMediaKeyRef.current = mediaLoadKey(track)
        setCurrent(track)
        setProgress(0)
        setDuration(initialPlaybackDuration(track))
        setIsPlaying(true)
        setIsBuffering(true)
        return
      }
      const audio = audioRef.current
      if (!audio) return
      if (mode === 'toggle' && isBuffering) {
        cancelMediaRetry()
        audio.pause()
        setIsPlaying(false)
        setIsBuffering(false)
      } else if (mode === 'toggle' && !audio.paused) audio.pause()
      else if (audio.paused) attemptPlayback(audio)
      return
    }
    autoplayMediaKeyRef.current = mediaLoadKey(track)
    setCurrent(track)
    setProgress(0)
    setDuration(initialPlaybackDuration(track))
    setIsPlaying(true)
    setIsBuffering(true)
  }

  const markPlaybackUnavailable = (track: Track) => {
    const unavailable = playbackUnavailableTrack(track) as Track
    const key = trackKey(unavailable)
    const update = (item: Track) => trackKey(item) === key ? unavailable : item
    setCurrent((previous) => trackKey(previous) === key ? unavailable : previous)
    setResults((previous) => previous.map(update))
    setHomeTracks((previous) => previous.map(update))
    setQueue((previous) => playableTracks(previous.map(update)))
    setLiked((previous) => previous.has(key) ? new Map(previous).set(key, unavailable) : previous)
    setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(update) })))
    setPlaylistRecommendations((previous) => previous.map((recommendation) => ({
      ...recommendation,
      track: update(recommendation.track),
    })))
  }

  const resolveAndPlay = async (track: Track, list?: Track[], mode: PlayMode = 'toggle', continuationPlaylistId: string | null = null) => {
    if (shouldCancelPendingTrack(trackKey(track), pendingTrackKeyRef.current)) {
      cancelPendingPlay()
      showNotice('已取消加载')
      return
    }
    const target = preferResolvedCurrent(track, current)
    if (target.capabilities.playback === 'none') {
      cancelPendingPlay()
      window.open(target.sourceUrl, '_blank', 'noopener,noreferrer')
      showNotice(`已打开 ${sourceLabel(target.source)} 来源页`)
      return
    }
    if (continuationPlaylistId !== continuousPlaylistIdRef.current) recommendationPrefetchKeyRef.current = ''
    continuousPlaylistIdRef.current = continuationPlaylistId
    setContinuousPlaylistId(continuationPlaylistId)
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
        if (restricted) markPlaybackUnavailable(target)
        showNotice(restricted ? '音源验证失败，已改为来源跳转' : '这首歌暂时没有可用音源')
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
      void resolveAndPlay(current, undefined, 'play', continuousPlaylistId)
      return
    }
    cancelMediaRetry()
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
    if (isBuffering) {
      cancelMediaRetry()
      audio.pause()
      setIsPlaying(false)
      setIsBuffering(false)
      return
    }
    if (!audio.paused) {
      audio.pause()
      return
    }
    startCurrent()
  }

  const skip = (direction: 1 | -1, continuationPlaylistId = continuousPlaylistId) => {
    if (!queue.length) return
    const currentTime = audioRef.current?.currentTime ?? progress
    if (direction === -1 && shouldRestartCurrentTrack(currentTime, currentIndex)) {
      const audio = audioRef.current
      try {
        if (audio) audio.currentTime = 0
        setProgress(0)
      } catch {
        showNotice('当前音源暂不支持跳转')
      }
      return
    }
    const nextIndex = shuffleMode && direction === 1 && queue.length > 1
      ? (() => {
          const candidates = queue.map((_, index) => index).filter((index) => index !== currentIndex)
          return candidates[Math.floor(Math.random() * candidates.length)]
        })()
      : currentIndex < 0 ? 0 : (currentIndex + direction + queue.length) % queue.length
    void resolveAndPlay(queue[nextIndex], undefined, 'play', continuationPlaylistId)
  }

  const updateShuffleMode = (enabled: boolean) => {
    setShuffleMode(enabled)
    if (enabled && repeatMode === 'off') setRepeatMode('all')
    showNotice(enabled ? '随机播放已开启' : '随机播放已关闭')
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
    if (!shouldApplyEndedAction(action)) return
    const continuous = Boolean(continuousPlaylistId && selectedPlaylist?.id === continuousPlaylistId)
    setIsPlaying(false)
    setIsBuffering(false)
    if (action === 'restart' && audioRef.current) {
      audioRef.current.currentTime = 0
      attemptPlayback(audioRef.current)
    } else if (action === 'next') {
      skip(1)
    } else if (action === 'stop' && continuous && queue.length) {
      const next = nextPlayableRecommendation(queue, playlistRecommendations)
      if (next) {
        queueRevisionRef.current += 1
        setQueue((previous) => [...previous, next])
        void resolveAndPlay(next, undefined, 'play', continuousPlaylistId)
      } else {
        if (queue.length === 1 && recommendationHasMore && selectedPlaylist && !recommendationLoading) {
          recommendationPrefetchKeyRef.current = `${selectedPlaylist.id}:${currentKey}`
          void loadRecommendationPage(selectedPlaylist, recommendationPage + 1, true)
        }
        skip(1, continuousPlaylistId)
      }
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

  const openPlaylist = (playlist: Playlist, continuous = false) => {
    const recommended = continuous && selectedPlaylist?.id === playlist.id
      ? recommendationTracks.filter((track) => track.capabilities.playback === 'full')
      : []
    playCollection([...playlist.tracks, ...recommended], 'order', continuous ? playlist.id : null)
  }

  const playCollection = (tracks: Track[], mode: CollectionPlaybackMode, continuationPlaylistId: string | null = null) => {
    const plan = collectionPlaybackPlan(tracks, mode)
    if (!plan.queue[0]) return showNotice('歌单里没有可播放的歌曲')
    setShuffleMode(plan.shuffle)
    setRepeatMode(plan.repeatMode)
    void resolveAndPlay(plan.queue[0], plan.queue, 'play', continuationPlaylistId)
    showNotice(mode === 'shuffle' ? '正在随机播放歌单' : mode === 'one' ? '已开启单曲循环' : '正在顺序播放歌单')
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
    lyricsControllerRef.current?.abort()
    lyricsControllerRef.current = null
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
    lyricsControllerRef.current?.abort()
    const controller = new AbortController()
    lyricsControllerRef.current = controller
    rememberDialogTrigger()
    setLyricsTrack(track)
    setLyricsText('')
    setLyricsLoading(true)
    try {
      const localLyrics = track.source === 'local' ? localLyricsRef.current.get(trackKey(track)) : undefined
      const lyrics = localLyrics ?? await musicProvider.lyrics(track, controller.signal)
      if (requestId === lyricsRequestRef.current) setLyricsText(lyrics.lrc || lyrics.plain || '[00:00.00] 暂无歌词')
    } catch {
      if (requestId === lyricsRequestRef.current && !controller.signal.aborted) setLyricsText('[00:00.00] 歌词暂时不可用')
    } finally {
      if (lyricsControllerRef.current === controller) lyricsControllerRef.current = null
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

  const downloadCover = async (track: Track) => {
    try {
      const { blob, filename } = await downloadArtwork(track)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      showNotice('封面已交给浏览器下载')
    } catch {
      showNotice('封面下载失败，请稍后重试')
    }
  }

  const recordHistory = (track: Track) => {
    if (track.source === 'local' || track.source === 'demo') return
    const playedAt = Date.now()
    setHistory((previous) => {
      const latest = previous[0]
      if (latest && trackKey(latest.track) === trackKey(track) && playedAt - latest.playedAt < 30_000) return previous
      return [{ track, playedAt }, ...previous.filter((item) => trackKey(item.track) !== trackKey(track))].slice(0, 500)
    })
  }

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accountAvailable) return setAccountError('静态站未连接账号后端，请使用 JSON 导入导出迁移')
    setAccountBusy(true)
    setAccountError('')
    cloudReadyRef.current = false
    try {
      const result = accountMode === 'register'
        ? await accountApi.register(accountEmail, accountPassword)
        : await accountApi.login(accountEmail, accountPassword)
      setUser(result.user)
      setAccountPassword('')
      await initializeCloud()
      showNotice(accountMode === 'register' ? '账号已创建并完成同步' : '登录成功，设备记录已合并')
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : '账号操作失败')
    } finally {
      setAccountBusy(false)
      setAccountChecking(false)
    }
  }

  const logout = async () => {
    setAccountBusy(true)
    try { await accountApi.logout() } catch { /* local sign-out still completes */ }
    cloudReadyRef.current = false
    cloudRevisionRef.current = 0
    lastSyncedRef.current = ''
    setUser(null)
    setSyncStatus('本地保存')
    setAccountBusy(false)
    showNotice('已退出，当前设备记录仍保留')
  }

  const exportLibrary = () => {
    const blob = new Blob([JSON.stringify(portableLibraryRef.current, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `listener-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    showNotice('记录已导出为 JSON')
  }

  const importLibrary = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > 2_097_152) return showNotice('备份文件不能超过 2 MB')
    try {
      const imported = normalizeLibraryData(JSON.parse(await file.text()), libraryValidators)
      const merged = mergeLibraryData(imported, portableLibraryRef.current, libraryValidators)
      applyLibraryData(merged)
      showNotice('导入完成，已与当前设备记录合并')
    } catch {
      showNotice('备份文件格式无效')
    }
  }

  const importLocalTracks = async (files: FileList | null) => {
    if (!files?.length) return
    const imported: Track[] = []
    const selected = Array.from(files)
    const lyricsByStem = new Map<string, string>()
    for (const file of selected.filter((item) => /\.lrc$/i.test(item.name)).slice(0, 100)) {
      try {
        const lyrics = await readLocalLyrics(file)
        if (lyrics.trim()) lyricsByStem.set(localFileStem(file.name), lyrics)
      } catch { /* unreadable local lyrics */ }
    }

    const matchedKeys = new Set<string>()
    for (const [key, { file }] of localFilesRef.current.entries()) {
      const lrc = lyricsByStem.get(localFileStem(file.name))
      if (!lrc) continue
      localLyricsRef.current.set(key, { plain: lrc.replace(/\[[^\]]+]/g, '').trim(), lrc })
      matchedKeys.add(key)
    }
    const enableLocalLyrics = (track: Track) => matchedKeys.has(trackKey(track)) && !track.capabilities.lyrics
      ? { ...track, capabilities: { ...track.capabilities, lyrics: true } }
      : track
    if (matchedKeys.size) {
      queueRevisionRef.current += 1
      setLocalTracks((previous) => previous.map(enableLocalLyrics))
      setQueue((previous) => previous.map(enableLocalLyrics))
      setLiked((previous) => new Map([...previous].map(([key, track]) => [key, enableLocalLyrics(track)])))
      setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(enableLocalLyrics) })))
      setCurrent((previous) => enableLocalLyrics(previous))
    }

    for (const file of selectLocalAudioFiles(selected)) {
      const id = `${file.name}:${file.size}:${file.lastModified}`
      const key = `local:${id}`
      if (localFilesRef.current.has(key)) continue
      const url = URL.createObjectURL(file)
      const lrc = lyricsByStem.get(localFileStem(file.name)) ?? ''
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
    if (!imported.length) {
      return showNotice(matchedKeys.size
        ? `已为 ${matchedKeys.size} 首本地音乐匹配歌词`
        : '没有发现可用的音频文件或匹配的 LRC')
    }
    setLocalTracks((previous) => [...previous, ...imported])
    queueRevisionRef.current += 1
    setQueue((previous) => [...imported, ...previous])
    const lyricCount = matchedKeys.size + imported.filter((track) => track.capabilities.lyrics).length
    showNotice(`已导入 ${imported.length} 首本地音乐${lyricCount ? ` · 匹配 ${lyricCount} 份歌词` : ''}`)
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
      setDuration(initialPlaybackDuration(replacement))
      setIsPlaying(false)
      setIsBuffering(false)
    }
    if (local) window.setTimeout(() => URL.revokeObjectURL(local.url), 0)
    showNotice('已移除本地音乐')
  }

  const identifyInput = async () => {
    const input = query.normalize('NFKC').trim()
    if (!input) return showNotice('请输入音乐地址或 ID')
    searchControllerRef.current?.abort()
    searchControllerRef.current = null
    searchMoreControllerRef.current?.abort()
    searchMoreControllerRef.current = null
    identifyControllerRef.current?.abort()
    const controller = new AbortController()
    identifyControllerRef.current = controller
    const requestId = ++identifyRequestRef.current
    searchRequestRef.current += 1
    setIsSearching(false)
    setIsIdentifying(true)
    setIdentification(null)
    setIdentificationHasDetails(null)
    try {
      const match = await musicProvider.identify(input, looksLikeMusicAddress(input) ? undefined : identifySource, controller.signal)
      if (requestId !== identifyRequestRef.current) return
      if (!match) return showNotice('没有识别出受支持的音乐地址或 ID')
      setIdentification(match)
      if (!providerStatus.sources.includes(match.source)) {
        setIdentificationHasDetails(false)
        showNotice('已识别 ID；该来源仅支持地址 / ID 解析')
        return
      }
      try {
        const track = await musicProvider.lookup(match, controller.signal)
        if (requestId !== identifyRequestRef.current) return
        setResults([track])
        setSearchPage(1)
        setSearchHasMore(false)
        setSearchMoreError(false)
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
      if (requestId === identifyRequestRef.current && !controller.signal.aborted) showNotice('解析服务暂时不可用')
    } finally {
      if (identifyControllerRef.current === controller) identifyControllerRef.current = null
      if (requestId === identifyRequestRef.current) setIsIdentifying(false)
    }
  }

  const removeFromQueue = (track: Track) => {
    const key = trackKey(track)
    if (pendingTrackKeyRef.current === key) cancelPendingPlay()
    queueRevisionRef.current += 1
    setQueue((previous) => previous.filter((item) => trackKey(item) !== key))
    if (key === currentKey) {
      cancelMediaRetry()
      audioRef.current?.pause()
      setIsPlaying(false)
      setIsBuffering(false)
    }
  }

  const clearQueue = () => {
    cancelPendingPlay()
    cancelMediaRetry()
    queueRevisionRef.current += 1
    audioRef.current?.pause()
    setQueue([])
    continuousPlaylistIdRef.current = null
    setContinuousPlaylistId(null)
    setIsPlaying(false)
    setIsBuffering(false)
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

  const handleAudioError = (audio: HTMLAudioElement) => {
    clearBufferingTimeout()
    const action = mediaErrorAction({
      hasAudioUrl: Boolean(current.audioUrl),
      errorCode: audio.error?.code ?? 0,
      mediaKey: currentMediaKey,
      retryKey: mediaRetryKeyRef.current,
      source: current.source,
    })
    if (action === 'ignore') return
    setIsPlaying(false)
    if (action === 'retry') {
      mediaRetryKeyRef.current = currentMediaKey
      setIsBuffering(true)
      showNotice('网络发生变化，正在重新连接音源')
      mediaRetryTimerRef.current = window.setTimeout(() => {
        mediaRetryTimerRef.current = undefined
        if (audioRef.current !== audio) return
        audio.load()
        attemptPlayback(audio)
      }, 800)
      return
    }
    setIsBuffering(false)
    if (action === 'report') {
      showNotice('音源暂时无法播放，请换一首试试')
      return
    }
    const replacement = nextDirectFullTrack(queue, currentKey)
    const invalidated = { ...current, audioUrl: '' }
    const update = (track: Track) => trackKey(track) === currentKey ? invalidated : track
    queueRevisionRef.current += 1
    setCurrent(invalidated)
    setProgress(0)
    setDuration(initialPlaybackDuration(invalidated))
    setQueue((previous) => queueWithoutTrack(previous, currentKey))
    setResults((previous) => previous.map(update))
    setHomeTracks((previous) => previous.map(update))
    setLiked((previous) => previous.has(currentKey) ? new Map(previous).set(currentKey, invalidated) : previous)
    setUserPlaylists((previous) => previous.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map(update) })))
    setPlaylistRecommendations((previous) => previous.map((recommendation) => ({
      ...recommendation,
      track: update(recommendation.track),
    })))
    setHistory((previous) => previous.map((item) => ({ ...item, track: update(item.track) })))
    if (!replacement) {
      showNotice('音源已失效，点击播放可重新连接')
      return
    }
    showNotice('当前音源失效，正在切换下一首完整歌曲')
    window.setTimeout(() => void resolveAndPlay(replacement, undefined, 'play', continuousPlaylistIdRef.current), 0)
  }

  const seekTo = (value: number) => {
    const audio = audioRef.current
    const next = seekPosition(value, duration)
    if (!audio || next === null) return
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
    setPendingDeletePlaylistId(null)
    if (next === 'search') window.setTimeout(() => document.querySelector<HTMLInputElement>('#search-input')?.focus(), 0)
  }

  const navigateLibrarySection = (target: 'playlists' | 'liked') => {
    setView('library')
    setMobileNavOpen(false)
    setPendingDeletePlaylistId(null)
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
        cancelMediaRetry()
        audioRef.current?.pause()
      }],
      ['previoustrack', () => skip(-1)],
      ['nexttrack', () => skip(1)],
      ['seekbackward', (details) => seekTo((audioRef.current?.currentTime ?? progress) - (details.seekOffset ?? 10))],
      ['seekforward', (details) => seekTo((audioRef.current?.currentTime ?? progress) + (details.seekOffset ?? 10))],
      ['seekto', (details) => { if (typeof details.seekTime === 'number') seekTo(details.seekTime) }],
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
  const playerVisualState = playbackVisualState({
    current: true, playing: isPlaying, resolving: Boolean(pendingTrackKey), buffering: isBuffering,
  })
  const playerLoading = playerVisualState === 'resolving' || playerVisualState === 'buffering'
  const playerStateLabel = playerVisualState === 'resolving'
    ? '正在切换'
    : playerVisualState === 'buffering'
      ? '正在缓冲'
      : playerVisualState === 'playing' ? '正在播放' : ''

  return (
    <div
      className={`app-shell app-shell--${density}`}
      data-cover-style={coverStyle}
      data-reduce-motion={reduceMotion ? 'true' : 'false'}
      data-font-scale={fontScale}
      data-corner-style={cornerStyle}
      data-player-layout={playerLayout}
      data-background-texture={backgroundTexture}
      style={{ '--orange': accentColors[accent] } as React.CSSProperties}
    >
      <div id="mobile-navigation" className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`} role={mobileNavOpen ? 'dialog' : 'complementary'} aria-modal={mobileNavOpen ? 'true' : undefined} aria-label="侧边导航" {...(queueOpen || dialogOpen ? { inert: '' } : {})}>
        <button ref={mobileCloseRef} className="sidebar__close icon-button" onClick={closeMobileNav} aria-label="关闭菜单"><X /></button>
        <button className="brand" onClick={() => navigate('discover')}>
          <span className="brand__symbol"><Waves /></span>
          <span>Listener</span>
        </button>

        <nav className="nav-group" aria-label="主导航">
          <button aria-current={view === 'discover' ? 'page' : undefined} className={view === 'discover' ? 'active' : ''} onClick={() => navigate('discover')}><Home />发现音乐</button>
          <button aria-current={view === 'search' ? 'page' : undefined} className={view === 'search' ? 'active' : ''} onClick={() => navigate('search')}><Search />聚合搜索</button>
          <button aria-current={view === 'library' ? 'page' : undefined} className={view === 'library' ? 'active' : ''} onClick={() => navigateLibrarySection('liked')}><Library />我的收藏</button>
          <button aria-current={view === 'account' ? 'page' : undefined} className={view === 'account' ? 'active' : ''} onClick={() => navigate('account')}><CircleUserRound />账号与同步</button>
          <button aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings />设置</button>
        </nav>

        <div className="sidebar__section-label">我的音乐</div>
        <nav className="nav-group nav-group--sub" aria-label="个人音乐">
          <button onClick={() => navigateLibrarySection('liked')}><Heart />喜欢的音乐 <span>{liked.size}</span></button>
          <button onClick={() => navigateLibrarySection('playlists')}><Library />我的歌单 <span>{userPlaylists.length}</span></button>
          <button onClick={openQueue}><ListMusic />最近播放</button>
        </nav>

        <div className="source-card">
          <span>{online ? <Sparkles /> : <CloudOff />} {online ? providerChecking ? '正在连接音乐源' : providerStatus.online ? `${providerStatus.sources.length} 个音乐源已接入` : '演示模式' : '离线模式'}</span>
          <p>{online ? providerChecking ? '正在检查音乐源…' : providerStatus.online ? providerStatus.sources.map(sourceLabel).join(' · ') : '音乐源暂时离线' : '应用壳与本地记录仍可使用'}</p>
          <div className={`source-card__dots ${!online ? 'offline' : providerChecking ? 'checking' : providerStatus.online ? '' : 'offline'}`}><i /></div>
        </div>
      </div>

      {mobileNavOpen && <button className="scrim" tabIndex={-1} onClick={closeMobileNav} aria-label="关闭侧边导航" />}

      <main className="main-content" {...(queueOpen || mobileNavOpen || dialogOpen ? { inert: '' } : {})}>
        <header className="topbar">
          <button ref={mobileMenuRef} className="mobile-menu icon-button" onClick={openMobileNav} aria-label="打开菜单" aria-controls="mobile-navigation" aria-expanded={mobileNavOpen}><Menu /></button>
          <button className="search-box" onClick={() => navigate('search')}>
            <Search />
            <span>搜索歌曲、歌手或专辑</span>
            <kbd>⌘/Ctrl K</kbd>
          </button>
          <div className="topbar__actions">
            <div className="source-selector" role="status" aria-live="polite"><span className={`status-dot ${!online ? 'offline' : providerChecking ? 'checking' : providerStatus.online ? '' : 'offline'}`} />{!online ? '离线模式' : providerChecking ? '正在连接' : providerStatus.online ? '音乐源在线' : '演示模式'}</div>
            <button className="avatar" aria-label={user ? `账号 ${user.email}` : '登录或迁移记录'} title={user ? user.email : '账号与同步'} onClick={() => navigate('account')}>{user?.email[0]?.toUpperCase() || 'L'}</button>
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
                  <button className="primary-button" onClick={() => navigate('search')}><Search />{publicBrowserMode ? '公共多平台搜索' : '多平台搜索'}</button>
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
                <div><span className="section-index">01</span><h2>全球流行精选{regionalRecommendations ? ` · ${region}` : ''}</h2></div>
                <span className="searching-state" aria-live="polite">{homeLoading ? '正在加载真实曲目…' : homeError ? '真实音乐源暂不可用' : `来自真实音乐源 · ${homeTracks.length} 首`}</span>
              </div>
              {homeTracks.length ? <div className="track-grid">
                {homeTracks.map((track, index) => {
                  const key = trackKey(track)
                  const isCurrent = currentKey === key
                  const isLiked = liked.has(key)
                  const isPending = pendingTrackKey === key
                  const visualState = playbackVisualState({
                    current: isCurrent, playing: isPlaying, resolving: isPending, buffering: isBuffering,
                  })
                  const loading = visualState === 'resolving' || visualState === 'buffering'
                  return (
                  <article className={`track-card ${isCurrent ? 'track-card--current' : ''}`} key={key}>
                    <div className="track-card__number">0{index + 1}</div>
                    <button className="track-card__cover" disabled={playControlDisabled(track.capabilities.playback, isPending)} title={track.capabilities.playback === 'none' ? '来源未提供可播放音源' : undefined} aria-busy={loading} aria-pressed={visualState === 'playing'} onClick={() => void resolveAndPlay(track, homeTracks)} aria-label={track.capabilities.playback === 'none' ? `${track.title} 仅提供元数据` : visualState === 'resolving' ? `取消加载 ${track.title}` : visualState === 'buffering' ? `正在缓冲 ${track.title}，点击暂停` : visualState === 'playing' ? `暂停 ${track.title}` : `播放 ${track.title}`}>
                      <Cover name={track.cover} />
                      <span className="cover-play">{loading ? <LoaderCircle className="spin" /> : visualState === 'playing' ? <Pause /> : <Play fill="currentColor" />}</span>
                    </button>
                    <div className="track-card__meta">
                      <h3>{track.title}</h3>
                      <p>{track.artist}</p>
                      {track.capabilities.playback === 'none' && <small>仅元数据</small>}
                      <SourceBadge track={track} />
                    </div>
                    <button className={`like-button ${isLiked ? 'liked' : ''}`} onClick={() => toggleLike(track)} aria-label={`${isLiked ? '取消收藏' : '收藏'} ${track.title}`}><Heart fill={isLiked ? 'currentColor' : 'none'} /></button>
                    <button className="cover-download-card" onClick={() => void downloadCover(track)} aria-label={`下载封面 ${track.title}`} title="下载封面"><ImageDown /></button>
                  </article>
                  )
                })}
              </div> : <div className="compact-empty home-empty">{homeLoading ? <LoaderCircle className="spin" /> : <Sparkles />}<span>{homeLoading ? '正在获取真实流行歌曲' : '暂时无法获取主页真实歌曲'}</span>{!homeLoading && <button onClick={() => setHomeRevision((value) => value + 1)}>重新获取</button>}</div>}
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
              <h1>{publicBrowserMode ? '公共多平台搜索' : '多平台搜索'}</h1>
              <div className="search-input-wrap">
                <Search aria-hidden="true" />
                <input id="search-input" aria-label="搜索歌曲、歌手、专辑、音乐地址或 ID" aria-invalid={inputMode === 'too-long'} aria-describedby={inputMode === 'too-long' ? 'search-input-error search-guidance' : 'search-guidance'} maxLength={2048} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="歌曲、歌手、专辑、音乐地址或 ID……" />
                {query && <button onClick={() => updateQuery('')} aria-label="清空"><X /></button>}
              </div>
              <div className="search-hints"><span>试试：</span>{['周杰伦', 'Taylor Swift', '晴天'].map((word) => <button key={word} onClick={() => updateQuery(word)}>{word}</button>)}</div>
              {inputMode === 'too-long' && <div id="search-input-error" className="search-input-error" role="alert">搜索关键词最多 100 个字符；如果粘贴的是音乐地址，请保留完整的 http:// 或 https:// 前缀。</div>}
              <div className="advanced-search" aria-label="高级搜索筛选">
                <label>搜索平台<select aria-label="搜索音乐源" value={searchSource} onChange={(event) => { setSearchSource(event.target.value as 'all' | MusicSource); setSourceFilter('all') }}><option value="all">全部已接入平台</option>{searchableSources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
                <label>搜索字段<select value={searchDomain} onChange={(event) => setSearchDomain(event.target.value as SearchDomain)}><option value="all">全部字段</option><option value="title">歌曲名</option><option value="artist">歌手</option><option value="album">专辑</option></select></label>
                <label>时长范围<select value={searchDuration} onChange={(event) => setSearchDuration(event.target.value as SearchDuration)}><option value="all">全部时长</option><option value="short">3 分钟内</option><option value="medium">3–5 分钟</option><option value="long">5 分钟以上</option></select></label>
                <label>结果排序<select value={searchSort} onChange={(event) => setSearchSort(event.target.value as SearchSort)}><option value="relevance">相关度</option><option value="title">歌曲名</option><option value="artist">歌手</option><option value="duration">时长</option></select></label>
                {(searchSource !== 'all' || searchDomain !== 'all' || searchDuration !== 'all' || searchSort !== 'relevance') && <button onClick={() => { setSearchSource('all'); setSearchDomain('all'); setSearchDuration('all'); setSearchSort('relevance') }}>清除筛选</button>}
              </div>
              <details className="search-explore">
                <summary>探索更多音乐领域</summary>
                <div>{searchExplorations.map((group) => <div className="search-explore__group" key={group.label}><strong>{group.label}</strong><span>{group.terms.map((term) => <button key={term.label} title={`搜索 ${term.query}`} onClick={() => exploreSearch(term.query)}>{term.label}</button>)}</span></div>)}</div>
              </details>
              <div className="id-resolver">
                <select aria-label="音乐 ID 所属平台" value={identifySource} onChange={(event) => updateIdentifySource(event.target.value as MusicSource)}>
                  {identifiableSources.map((source) => <option key={source} value={source}>{sourceLabel(source)}{source === 'qmkg' ? '（仅地址 / ID）' : ''}</option>)}
                </select>
                <button className="primary-button" disabled={isIdentifying} onClick={() => void identifyInput()}>{isIdentifying ? '正在识别…' : '解析地址 / ID'}</button>
                <span id="search-guidance">{publicBrowserMode
                  ? 'Pages 可直接查询 4 个公共来源，并在本地识别全部已列平台的地址与 ID。'
                  : sourceParsingNotes[identifySource] ?? '平台地址与纯 ID 均需点击解析；纯 ID 请先选择平台。'}</span>
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
              <div className="playback-filters" role="group" aria-label="播放范围筛选">
                <span>播放范围</span>
                <button aria-pressed={playbackFilter === 'all'} className={playbackFilter === 'all' ? 'active' : ''} onClick={() => setPlaybackFilter('all')}>全部 · 可播优先</button>
                <button aria-pressed={playbackFilter === 'full'} className={playbackFilter === 'full' ? 'active' : ''} onClick={() => setPlaybackFilter('full')}>仅完整可播</button>
                <button aria-pressed={playbackFilter === 'no-preview'} className={playbackFilter === 'no-preview' ? 'active' : ''} onClick={() => setPlaybackFilter('no-preview')}>无试听（含元数据）</button>
              </div>
            </div>
            <section className="results-section">
              {searchDegraded && <div className="search-warning" role="alert"><Sparkles /><span><strong>{publicSearchFallback ? '聚合服务离线，已切换公共搜索' : demoSearchFallback ? '聚合服务异常，当前为演示结果' : '所选音乐源暂不可用'}</strong><small>{publicSearchFallback ? '当前由 Apple Music、Audius、MusicBrainz 与 Wikimedia Commons 提供可用结果。' : demoSearchFallback ? '真实音乐源暂时不可用，以下为演示数据。' : '没有返回回退数据，请检查服务配置后重试。'}</small></span><button onClick={() => setSearchRevision((value) => value + 1)}>重试</button></div>}
              <div className="section-heading"><div><span className="section-index">{String(displayResults.length).padStart(2, '0')}</span><h2>{resultHeading ? `“${resultHeading}” 的结果` : '全部音乐'}</h2></div><span className="searching-state" aria-live="polite">{isSearching ? '正在检索音乐源…' : publicSearchFallback ? `公共搜索 · ${resultPlaybackSummary} · 共 ${displayResults.length} 首` : demoSearchFallback ? `演示结果 ${displayResults.length} 首` : searchDegraded ? '搜索失败' : `${resultPlaybackSummary} · 共 ${displayResults.length} 首${hiddenByFilters ? ` · 已过滤 ${hiddenByFilters} 首` : ''}`}</span></div>
              <div className="track-list" role="list">
                {displayResults.length ? displayResults.map((track, index) => (
                  <TrackRow
                    key={trackKey(track)}
                    track={track}
                    index={index}
                    current={currentKey === trackKey(track)}
                    playing={isPlaying}
                    pending={pendingTrackKey === trackKey(track)}
                    buffering={isBuffering && currentKey === trackKey(track)}
                    liked={liked.has(trackKey(track))}
                    onPlay={() => void resolveAndPlay(track, displayResults)}
                    onLike={() => toggleLike(track)}
                    onPlaylist={() => openPlaylistDialog(track)}
                    onLyrics={() => void openLyrics(track)}
                    onDownload={() => void downloadTrack(track)}
                    onCoverDownload={() => void downloadCover(track)}
                  />
                )) : <div className="empty-state"><Disc3 /><h3>{isSearching ? '正在寻找好音乐' : inputMode === 'too-long' ? '搜索词太长' : sourceResults.length ? '当前筛选没有结果' : searchDegraded ? '聚合服务暂不可用' : identification ? '地址已识别' : '还没找到这首歌'}</h3><p>{isSearching ? '正在连接可用音乐源，请稍候。' : inputMode === 'too-long' ? '请缩短到 100 个字符以内，再重新搜索。' : sourceResults.length ? '可调整搜索字段、时长或播放范围，查看其他曲目。' : searchDegraded ? '备用音乐源也没有匹配结果，请点击重试。' : identification ? '当前来源尚未提供授权详情接口，可先在来源页面打开。' : '换个关键词，或使用上方地址 / ID 解析。'}</p></div>}
              </div>
              {(searchHasMore || searchPage > 1 || searchMoreError) && (
                <div className="search-pagination">
                  <span aria-live="polite">{searchPaginationStatus}</span>
                  {searchMoreError && <small role="alert">更多结果加载失败，请重试。</small>}
                  {searchHasMore && <button className="secondary-button" aria-busy={isLoadingMore} disabled={isLoadingMore} onClick={() => void loadMoreSearchResults()}>{isLoadingMore ? <LoaderCircle className="spin" /> : <Plus />}{searchMoreLabel}</button>}
                </div>
              )}
            </section>
          </div>
        )}

        {view === 'account' && (
          <div className="page page--account">
            <div className="account-heading">
              <span className="eyebrow">ACCOUNT · SYNC · OFFLINE</span>
              <h1>账号与记录</h1>
              <p>收藏、歌单、队列、播放记录和偏好可在设备间迁移；服务端不保存原始 IP。</p>
            </div>

            {accountChecking ? (
              <div className="account-loading"><LoaderCircle className="spin" />正在检查登录状态…</div>
            ) : user ? (
              <section className="account-panel account-panel--identity">
                <div className="account-panel__header"><div><span className="eyebrow">SIGNED IN</span><h2>{user.email}</h2></div><span className={`sync-pill ${online ? '' : 'offline'}`}>{online ? <Cloud /> : <CloudOff />}{syncStatus}</span></div>
                <p>数据使用带修订号的合并同步；另一台设备有新记录时不会直接覆盖本机收藏。</p>
                <div className="account-actions">
                  <button className="secondary-button" disabled={!online || accountBusy} onClick={() => void saveCloudState()}><Cloud />立即同步</button>
                  <button className="secondary-button" disabled={accountBusy} onClick={() => void logout()}><CircleUserRound />退出登录</button>
                </div>
              </section>
            ) : (
              <section className="account-panel account-panel--auth">
                <div><span className="eyebrow">{accountMode === 'login' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}</span><h2>{accountMode === 'login' ? '登录 Listener' : '注册 Listener'}</h2><p>{accountAvailable ? '邮箱与密码仅发送到当前 Listener 后端，密码使用 scrypt 哈希保存。' : '当前是静态版本，账号后端不可用；仍可使用下方 JSON 迁移。'}</p></div>
                <form className="account-form" onSubmit={submitAccount}>
                  <label htmlFor="account-email">邮箱</label>
                  <input id="account-email" type="email" autoComplete="email" required maxLength={254} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="you@example.com" />
                  <label htmlFor="account-password">密码</label>
                  <input id="account-password" type="password" autoComplete={accountMode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={200} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="至少 12 个字符" />
                  {accountError && <p className="account-error" role="alert">{accountError}</p>}
                  <div className="account-actions">
                    <button className="primary-button" disabled={!accountAvailable || accountBusy} type="submit">{accountBusy ? <LoaderCircle className="spin" /> : <CircleUserRound />}{accountMode === 'login' ? '登录' : '注册并同步'}</button>
                    <button className="text-button" type="button" onClick={() => { setAccountMode((mode) => mode === 'login' ? 'register' : 'login'); setAccountError('') }}>{accountMode === 'login' ? '没有账号？注册' : '已有账号？登录'}</button>
                  </div>
                </form>
              </section>
            )}

            <div className="account-grid">
              <section className="account-panel">
                <div className="account-panel__header"><div><span className="eyebrow">PORTABLE DATA</span><h2>设备迁移</h2></div><FileDown /></div>
                <p>导出文件不包含密码、Cookie、本地音频文件或临时播放地址；导入会与当前记录去重合并。</p>
                <div className="account-actions">
                  <button className="secondary-button" onClick={exportLibrary}><FileDown />导出记录 JSON</button>
                  <button className="secondary-button" onClick={() => dataImportRef.current?.click()}><Upload />导入记录</button>
                  <input ref={dataImportRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="选择 Listener JSON 备份" onChange={(event) => { void importLibrary(event.target.files); event.target.value = '' }} />
                </div>
              </section>

              <section className="account-panel">
                <div className="account-panel__header"><div><span className="eyebrow">OFFLINE READY</span><h2>{online ? '离线应用已准备' : '当前处于离线模式'}</h2></div>{online ? <Cloud /> : <CloudOff />}</div>
                <p>生产版本会缓存应用壳与同源构建资源，不缓存账号 API、第三方音频或私人云端数据；本地音乐只在当前页面会话保留。</p>
              </section>

              <section className="account-panel">
                <div className="account-panel__header"><div><span className="eyebrow">PLAY HISTORY</span><h2>最近播放</h2></div>{history.length > 0 && <button className="text-button danger" onClick={() => setHistory([])}>清空</button>}</div>
                {history.length ? <ol className="history-list">{history.slice(0, 8).map((item) => <li key={`${trackKey(item.track)}:${item.playedAt}`}><span><strong>{item.track.title}</strong><small>{item.track.artist}</small></span><time dateTime={new Date(item.playedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(item.playedAt)}</time></li>)}</ol> : <p>播放真实歌曲后，记录会出现在这里。</p>}
              </section>
            </div>
          </div>
        )}

        {view === 'settings' && (
          <div className="page page--settings">
            <div className="account-heading settings-heading">
              <span className="eyebrow">PLAYBACK · APPEARANCE · SOURCES</span>
              <h1>设置中心</h1>
              <p>播放偏好与外观会保存在当前设备，登录后也会跟随账号同步。</p>
            </div>

            <div className="settings-grid">
              <section className="account-panel settings-panel">
                <div className="account-panel__header"><div><span className="eyebrow">APPEARANCE</span><h2>样式与封面</h2></div><Palette /></div>
                <label className="settings-field">主题
                  <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                    <option value="system">跟随系统</option><option value="paper">暖纸日间</option><option value="night">深夜模式</option>
                  </select>
                </label>
                <fieldset className="choice-fieldset"><legend>歌曲封面样式</legend><div className="choice-buttons">
                  <button aria-pressed={coverStyle === 'vinyl'} className={coverStyle === 'vinyl' ? 'active' : ''} onClick={() => setCoverStyle('vinyl')}><Disc3 />黑胶</button>
                  <button aria-pressed={coverStyle === 'cassette'} className={coverStyle === 'cassette' ? 'active' : ''} onClick={() => setCoverStyle('cassette')}><CassetteTape />磁带</button>
                  <button aria-pressed={coverStyle === 'minimal'} className={coverStyle === 'minimal' ? 'active' : ''} onClick={() => setCoverStyle('minimal')}><ImageDown />纯封面</button>
                </div></fieldset>
                <fieldset className="choice-fieldset"><legend>强调色</legend><div className="accent-choices">
                  {(['orange', 'blue', 'green'] as Accent[]).map((color) => <button key={color} aria-label={`${color === 'orange' ? '橙色' : color === 'blue' ? '蓝色' : '绿色'}强调色`} aria-pressed={accent === color} className={accent === color ? 'active' : ''} style={{ '--swatch': accentColors[color] } as React.CSSProperties} onClick={() => setAccent(color)} />)}
                </div></fieldset>
                <label className="setting-row"><span><strong>紧凑列表</strong><small>在一屏展示更多歌曲</small></span><input type="checkbox" checked={density === 'compact'} onChange={(event) => setDensity(event.target.checked ? 'compact' : 'comfortable')} /></label>
                <label className="setting-row"><span><strong>减少动效</strong><small>关闭旋转、过渡和页面入场动画</small></span><input type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} /></label>
              </section>

              <section className="account-panel settings-panel">
                <div className="account-panel__header"><div><span className="eyebrow">LAYOUT</span><h2>界面布局</h2></div><SlidersHorizontal /></div>
                <label className="settings-field">界面字号<select value={fontScale} onChange={(event) => setFontScale(event.target.value as FontScale)}><option value="small">精简</option><option value="standard">标准</option><option value="large">大号</option></select></label>
                <label className="settings-field">圆角风格<select value={cornerStyle} onChange={(event) => setCornerStyle(event.target.value as CornerStyle)}><option value="square">直角</option><option value="soft">轻圆角</option><option value="round">大圆角</option></select></label>
                <label className="settings-field">播放器布局<select value={playerLayout} onChange={(event) => setPlayerLayout(event.target.value as PlayerLayout)}><option value="docked">贴底通栏</option><option value="floating">桌面悬浮</option></select></label>
                <label className="settings-field">背景纹理<select value={backgroundTexture} onChange={(event) => setBackgroundTexture(event.target.value as BackgroundTexture)}><option value="none">纯色</option><option value="paper">纸张颗粒</option><option value="grid">唱片网格</option></select></label>
                <p className="settings-note">悬浮播放器仅在桌面宽度启用，手机端自动保持贴底，避免遮挡歌曲操作。</p>
              </section>

              <section className="account-panel settings-panel">
                <div className="account-panel__header"><div><span className="eyebrow">PLAYBACK</span><h2>播放参数</h2></div><SlidersHorizontal /></div>
                <label className="settings-field">默认循环模式
                  <select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as 'off' | 'all' | 'one')}>
                    <option value="off">顺序播放</option><option value="all">列表循环</option><option value="one">单曲循环</option>
                  </select>
                </label>
                <label className="setting-row"><span><strong>随机播放</strong><small>下一首从当前队列随机选择</small></span><input type="checkbox" checked={shuffleMode} onChange={(event) => updateShuffleMode(event.target.checked)} /></label>
                <label className="volume-setting">音量 <strong>{Math.round(volume * 100)}%</strong><input aria-label="设置页音量" type="range" min="0" max="1" step="0.01" value={volume} style={{ '--progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></label>
                <p className="settings-note">喜欢的音乐和自建歌单均可单独选择顺序、随机或单曲循环；底部播放器可随时覆盖当前模式。</p>
              </section>

              <section className="account-panel settings-panel">
                <div className="account-panel__header"><div><span className="eyebrow">PRIVATE REGION</span><h2>地区与隐私</h2></div><MapPin /></div>
                <p>后端只读取可信反向代理提供的两位国家代码，不记录原始 IP。</p>
                <label className="setting-row"><span><strong>启用地区推荐</strong><small>仅影响主页流行搜索词</small></span><input type="checkbox" checked={regionalRecommendations} onChange={(event) => setRegionalRecommendations(event.target.checked)} /></label>
                <label className="settings-field" htmlFor="region-select">推荐地区<select id="region-select" value={region} onChange={(event) => setRegion(event.target.value)}><option value="CN">中国大陆</option><option value="US">美国</option><option value="GB">英国</option><option value="JP">日本</option><option value="KR">韩国</option><option value="FR">法国</option><option value="DE">德国</option></select></label>
              </section>

              <section className="account-panel settings-panel settings-panel--sources">
                <div className="account-panel__header"><div><span className="eyebrow">SOURCE CAPABILITIES</span><h2>音乐源能力</h2></div><Sparkles /></div>
                <p>只展示当前部署真实返回的能力；“可解析”只代表能够识别地址或 ID，不代表获得搜索、播放或下载授权。</p>
                <div className="provider-settings-list">
                  {identifiableSources.map((source) => {
                    const connected = providerStatus.sources.includes(source)
                    const capabilities = providerStatus.capabilities[source]
                    return <div className="provider-setting" key={source}>
                      <div className="provider-setting__identity"><SourceBadge track={{ ...initialTracks[0], source }} /><small>{connected ? '已接入' : '仅解析'}</small></div>
                      <span>地址 / ID 解析 · {capabilities?.search ? '名称搜索' : '不可名称搜索'} · {capabilities?.playback ? '可请求播放' : '无播放接口'} · {capabilities?.lyrics ? '歌词' : '无歌词'} · {capabilities?.download ? '授权下载' : '不可下载'}</span>
                      {sourceParsingNotes[source] && <small className="provider-setting__note">{sourceParsingNotes[source]}</small>}
                    </div>
                  })}
                </div>
                <div className="parseable-sources"><strong>{identifiableSources.length} 个平台已加入地址 / ID 解析白名单</strong><span>{identifiableSources.map(sourceLabel).join(' · ')}</span></div>
                <p className="settings-note">静态版可直连 Apple Music、Audius、MusicBrainz 与 Wikimedia Commons；Audius 与 Wikimedia Commons 可提供来源明确授权的完整音频。YouTube Music 与其余平台名称搜索仍需部署服务端及对应 Key；会员、DRM、签名、地区限制和未授权下载不会被绕过。</p>
              </section>

              <section className="account-panel settings-panel settings-panel--project">
                <div className="account-panel__header"><div><span className="eyebrow">OPEN SOURCE</span><h2>项目与版本</h2></div><Github /></div>
                <p>Listener 0.10.3 · 开源仓库、问题反馈、提交历史与发行版入口。</p>
                <div className="project-links">
                  {projectLinks.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer"><span>{link.label}</span><ExternalLink /></a>)}
                </div>
              </section>
            </div>
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
                      buffering={isBuffering && currentKey === trackKey(track)}
                      liked={liked.has(trackKey(track))}
                      onPlay={() => void resolveAndPlay(track, localTracks)}
                      onLike={() => toggleLike(track)}
                      onPlaylist={() => openPlaylistDialog(track)}
                      onLyrics={() => void openLyrics(track)}
                      onDownload={() => void downloadTrack(track)}
                      onCoverDownload={() => void downloadCover(track)}
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

            {selectedPlaylist && (<>
              <section id="selected-playlist-detail" className="library-section playlist-detail" aria-labelledby="selected-playlist-title">
                <div className="section-heading">
                  <div><span className="section-index">{String(selectedPlaylist.tracks.length).padStart(2, '0')}</span><h2 id="selected-playlist-title" tabIndex={-1}>{selectedPlaylist.title}</h2></div>
                  <div className="section-actions">
                    <button disabled={!selectedPlaylistPlayableCount} onClick={() => openPlaylist(selectedPlaylist, true)}><Play />连续播放</button>
                    <button className="danger" onClick={() => deletePlaylist(selectedPlaylist.id)}><Trash2 />{pendingDeletePlaylistId === selectedPlaylist.id ? '确认删除' : '删除歌单'}</button>
                  </div>
                </div>
                <div className="track-list" role="list">
                  {selectedPlaylist.tracks.map((track, index) => (
                    <TrackRow
                      key={trackKey(track)} track={track} index={index}
                      current={currentKey === trackKey(track)} playing={isPlaying}
                      pending={pendingTrackKey === trackKey(track)}
                      buffering={isBuffering && currentKey === trackKey(track)}
                      liked={liked.has(trackKey(track))}
                      onPlay={() => void resolveAndPlay(track, selectedPlaylist.tracks, 'toggle', selectedPlaylist.id)}
                      onLike={() => toggleLike(track)}
                      onPlaylist={() => openPlaylistDialog(track)}
                      onLyrics={() => void openLyrics(track)}
                      onDownload={() => void downloadTrack(track)}
                      onCoverDownload={() => void downloadCover(track)}
                      onRemove={(event) => {
                        focusAfterRemoval(event.currentTarget, '#selected-playlist-detail', '.track-row__remove', '#selected-playlist-title')
                        removeTrackFromPlaylist(selectedPlaylist.id, track)
                      }}
                    />
                  ))}
                  {!selectedPlaylist.tracks.length && <div className="compact-empty"><ListMusic /><span>歌单还是空的</span><button onClick={() => navigate('search')}>去搜索音乐</button></div>}
                </div>
              </section>
              {!!selectedPlaylist.tracks.length && (
                <section className="library-section playlist-recommendations" aria-labelledby="playlist-recommendations-title">
                  <div className="section-heading">
                    <div><span className="section-index"><Sparkles /></span><h2 id="playlist-recommendations-title">相似推荐</h2></div>
                    <div className="recommendation-actions">
                      <span aria-live="polite">{recommendationLoading ? '正在寻找更多相似歌曲…' : continuousPlaylistId === selectedPlaylist.id ? '连续推荐已开启' : selectedRecommendationSeed ? `基于 ${selectedRecommendationSeed.label} · ${visibleRecommendations.length} 首` : ''}</span>
                      {(playlistRecommendations.length > recommendationVisibleLimit || recommendationHasMore) && <button disabled={recommendationLoading} onClick={() => {
                        setRecommendationVisibleLimit((limit) => limit + 8)
                        if (recommendationVisibleLimit >= playlistRecommendations.length && recommendationHasMore) void loadRecommendationPage(selectedPlaylist, recommendationPage + 1, true)
                      }}>{recommendationLoading ? <LoaderCircle className="spin" /> : <Plus />}{playlistRecommendations.length > recommendationVisibleLimit ? '显示更多' : '加载更多'}</button>}
                      {continuousPlaylistId === selectedPlaylist.id && <button onClick={() => { continuousPlaylistIdRef.current = null; setContinuousPlaylistId(null) }}>停止连续推荐</button>}
                    </div>
                  </div>
                  <div className="track-list" role="list">
                    {visibleRecommendations.map(({ track, reason }, index) => (
                      <TrackRow
                        key={trackKey(track)} track={track} index={index}
                        current={currentKey === trackKey(track)} playing={isPlaying}
                        pending={pendingTrackKey === trackKey(track)}
                        buffering={isBuffering && currentKey === trackKey(track)}
                        liked={liked.has(trackKey(track))}
                        context={`推荐理由：${reason}`}
                        onPlay={() => void resolveAndPlay(track, recommendationTracks, 'toggle', selectedPlaylist.id)}
                        onLike={() => toggleLike(track)}
                        onPlaylist={() => openPlaylistDialog(track)}
                        onLyrics={() => void openLyrics(track)}
                        onDownload={() => void downloadTrack(track)}
                        onCoverDownload={() => void downloadCover(track)}
                      />
                    ))}
                    {recommendationLoading && !playlistRecommendations.length && <div className="compact-empty"><LoaderCircle className="spin" /><span>正在分析歌单里的歌手和专辑</span></div>}
                    {!recommendationLoading && recommendationError && <div className="compact-empty"><Sparkles /><span>推荐暂时不可用</span><button onClick={() => void loadRecommendationPage(selectedPlaylist, recommendationPage + 1, recommendationPage > 0)}>重新获取</button></div>}
                    {!recommendationLoading && !recommendationError && !playlistRecommendations.length && <div className="compact-empty"><Sparkles /><span>暂时没有找到不含试听的相似歌曲</span>{recommendationHasMore ? <button onClick={() => void loadRecommendationPage(selectedPlaylist, recommendationPage + 1, true)}>继续查找</button> : <button onClick={() => navigate('search')}>去搜索</button>}</div>}
                  </div>
                </section>
              )}
            </>)}

            <section className="library-section">
              <div className="section-heading">
                <div><span className="section-index">02</span><h2 ref={likedHeadingRef} tabIndex={-1}>喜欢的音乐</h2></div>
                <div className="section-actions collection-actions" role="group" aria-label="喜欢的音乐播放模式">
                  <button disabled={!liked.size} onClick={() => playCollection(likedTracks, 'order')}><Play />顺序播放</button>
                  <button disabled={!liked.size} onClick={() => playCollection(likedTracks, 'shuffle')}><Shuffle />随机播放</button>
                  <button disabled={!liked.size} onClick={() => playCollection(likedTracks, 'one')}><Repeat1 />单曲循环</button>
                </div>
              </div>
            <div className="track-list" role="list">
              {likedTracks.map((track, index) => (
                <TrackRow
                  key={trackKey(track)} track={track} index={index}
                  current={currentKey === trackKey(track)} playing={isPlaying} liked
                  pending={pendingTrackKey === trackKey(track)}
                  buffering={isBuffering && currentKey === trackKey(track)}
                  onPlay={() => void resolveAndPlay(track, likedTracks)}
                  onLike={() => toggleLike(track)}
                  onPlaylist={() => openPlaylistDialog(track)}
                  onLyrics={() => void openLyrics(track)}
                  onDownload={() => void downloadTrack(track)}
                  onCoverDownload={() => void downloadCover(track)}
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
          <div className="queue-drawer queue-drawer--open" role="dialog" aria-modal="true" aria-label="播放队列">
            <div className="queue-drawer__header"><div><span className="eyebrow">UP NEXT</span><h2>播放队列</h2></div><button className="icon-button" aria-label="关闭播放队列" autoFocus onClick={closeQueue}><X /></button></div>
            <div className="queue-drawer__count"><span>共 {queue.length} 首</span><button disabled={!queue.length} onClick={clearQueue}>停止并清空</button></div>
            <div className="queue-drawer__list">
              {queue.map((track, index) => {
                const isCurrent = trackKey(track) === currentKey
                return <div className={`queue-item ${isCurrent ? 'current' : ''}`} key={`${trackKey(track)}-${index}`}>
                  <button className="queue-item__main" aria-current={isCurrent ? 'true' : undefined} onClick={() => void resolveAndPlay(track, undefined, 'play', continuousPlaylistId)}><Cover name={track.cover} size="small" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>{isCurrent && <i><Waves /></i>}</button>
                  <button className="icon-button queue-item__remove" aria-label={`从队列移除 ${track.title}`} onClick={(event) => {
                    focusAfterRemoval(event.currentTarget, '.queue-drawer__list', '.queue-item__remove', '.queue-drawer__header .icon-button')
                    removeFromQueue(track)
                  }}><X /></button>
                </div>
              })}
              {!queue.length && <div className="compact-empty"><ListMusic /><span>播放队列为空</span></div>}
            </div>
          </div>
          <button className="queue-scrim" tabIndex={-1} onClick={closeQueue} aria-label="关闭队列背景" />
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
          <button className="dialog-scrim" tabIndex={-1} onClick={closeDialog} aria-label="关闭歌单窗口背景" />
        </>
      )}

      {lyricsTrack && (
        <>
          <section className="dialog dialog--lyrics" role="dialog" aria-modal="true" aria-labelledby="lyrics-dialog-title">
            <div className="dialog__header"><div><span className="eyebrow">LYRICS</span><h2 id="lyrics-dialog-title">{lyricsTrack.title}</h2><p>{lyricsTrack.artist}</p></div><button className="icon-button" aria-label="关闭歌词" autoFocus onClick={closeDialog}><X /></button></div>
            <span className="visually-hidden" role="status" aria-live="polite">{lyricsLoading ? '正在加载歌词' : '歌词已加载'}</span>
            <pre className="lyrics-content">{lyricsLoading ? '正在加载歌词…' : lyricsText}</pre>
          </section>
          <button className="dialog-scrim" tabIndex={-1} onClick={closeDialog} aria-label="关闭歌词窗口背景" />
        </>
      )}

      <footer className={`player ${playerVisualState === 'playing' ? 'player--playing' : ''} ${playerLoading ? 'player--loading' : ''}`} {...(queueOpen || mobileNavOpen || dialogOpen ? { inert: '' } : {})}>
        <audio
          key={currentMediaKey}
          ref={audioRef}
          src={current.audioUrl || undefined}
          preload="none"
          playsInline
          onPlay={(event) => { if (isCurrentAudio(event.currentTarget)) { setIsPlaying(true); recordHistory(current) } }}
          onPlaying={(event) => { if (isCurrentAudio(event.currentTarget)) { clearBufferingTimeout(); cancelMediaRetry(); setIsBuffering(false) } }}
          onWaiting={(event) => { if (isCurrentAudio(event.currentTarget) && !event.currentTarget.paused) watchBuffering(event.currentTarget) }}
          onStalled={(event) => { if (isCurrentAudio(event.currentTarget) && !event.currentTarget.paused) watchBuffering(event.currentTarget) }}
          onPause={(event) => { if (isCurrentAudio(event.currentTarget)) { clearBufferingTimeout(); setIsPlaying(false); setIsBuffering(false) } }}
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
          onError={(event) => { if (isCurrentAudio(event.currentTarget)) handleAudioError(event.currentTarget) }}
        />
        <div className="player__track"><Cover name={current.cover} size="small" /><div><strong>{current.title}</strong><span><b className="player__state" aria-live="polite">{playerStateLabel}{playerStateLabel ? ' · ' : ''}</b>{current.artist} · {sourceLabel(current.source)} · {qualityLabels[current.quality]}{current.capabilities.playback === 'preview' ? ' · 试听' : current.capabilities.playback === 'none' ? ' · 不可播放' : ''}</span></div><button aria-label={`${liked.has(currentKey) ? '取消收藏' : '收藏'} ${current.title}`} className={`like-button ${liked.has(currentKey) ? 'liked' : ''}`} onClick={() => toggleLike(current)}><Heart fill={liked.has(currentKey) ? 'currentColor' : 'none'} /></button></div>
        <div className="player__center">
              <div className="player__controls"><button className={shuffleMode ? 'active' : ''} aria-label={`随机播放：${shuffleMode ? '开启' : '关闭'}`} aria-pressed={shuffleMode} disabled={queue.length < 2} onClick={() => updateShuffleMode(!shuffleMode)}><Shuffle /></button><button aria-label="上一首" disabled={!queue.length} onClick={() => skip(-1)}><SkipBack fill="currentColor" /></button><button className="play-main" aria-label={playerVisualState === 'resolving' ? '取消加载' : current.capabilities.playback === 'none' ? '当前歌曲无法播放' : playerVisualState === 'buffering' ? '暂停缓冲' : playerVisualState === 'playing' ? '暂停' : '播放'} aria-busy={playerLoading} disabled={playControlDisabled(current.capabilities.playback, Boolean(pendingTrackKey))} onClick={togglePlay}>{playerLoading ? <LoaderCircle className="spin" /> : playerVisualState === 'playing' ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" disabled={!queue.length} onClick={() => skip(1)}><SkipForward fill="currentColor" /></button><button className={repeatMode === 'off' ? '' : 'active'} aria-label={`循环模式：${repeatMode === 'off' ? '关闭' : repeatMode === 'all' ? '列表循环' : '单曲循环'}`} aria-pressed={repeatMode !== 'off'} onClick={cycleRepeat}>{repeatMode === 'one' ? <Repeat1 /> : <Repeat />}</button><button aria-label="播放队列" onClick={openQueue}><ListMusic /></button></div>
          <div className="player__progress"><span>{formatTime(seekProgress)}</span><input aria-label="播放进度" aria-valuetext={`${formatTime(seekProgress)} / ${formatTime(seekDuration)}`} disabled={!seekDuration} type="range" min="0" max={seekDuration || 1} step="0.1" value={seekProgress} style={{ '--progress': `${seekDuration ? (seekProgress / seekDuration) * 100 : 0}%` } as React.CSSProperties} onChange={(event) => seekTo(Number(event.target.value))} /><span>{formatTime(seekDuration)}</span></div>
        </div>
        <div className="player__tools"><button aria-label={`将 ${current.title} 加入歌单`} onClick={() => openPlaylistDialog(current)}><ListPlus /></button><button className={current.capabilities.lyrics ? '' : 'is-unavailable'} aria-disabled={!current.capabilities.lyrics} aria-label={current.capabilities.lyrics ? `查看 ${current.title} 的歌词` : `${current.title} 的歌词不可用`} onClick={() => void openLyrics(current)}><FileText /></button><button className={current.capabilities.download ? '' : 'is-unavailable'} aria-disabled={!current.capabilities.download} aria-label={current.capabilities.download ? `下载 ${current.title}` : `${current.title} 不可下载`} onClick={() => void downloadTrack(current)}><Download /></button><button aria-label={`下载封面 ${current.title}`} title="下载封面" onClick={() => void downloadCover(current)}><ImageDown /></button><button className="volume-button" aria-label={volume > 0 ? '静音' : '取消静音'} aria-pressed={volume === 0} onClick={toggleMute}>{volume > 0 ? <Volume2 /> : <VolumeX />}</button><input aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`} type="range" min="0" max="1" step="0.01" value={volume} style={{ '--progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></div>
      </footer>
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  )
}

export default App
