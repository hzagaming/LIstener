import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Disc3, Heart, Home, Library,
  ListMusic, Menu, Pause, Play,
  Search, Shuffle, SkipBack, SkipForward, Sparkles,
  Volume2, Waves, X,
} from 'lucide-react'
import { playlists, tracks as initialTracks } from './data/catalog'
import { musicProvider, sourceLabel } from './services/musicProvider'
import { isTrack, trackKey } from './types/music'
import type { MusicSource, Playlist, Track } from './types/music'

type View = 'discover' | 'search' | 'library'

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
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? value : fallback
}

const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Playback must keep working when storage is unavailable or full.
  }
}

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

function App() {
  const [view, setView] = useState<View>('discover')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>(initialTracks)
  const [isSearching, setIsSearching] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSource>('all')
  const [queue, setQueue] = useState<Track[]>(() => readStoredTracks('listener.queue', initialTracks.slice(0, 6)))
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
  const [providerStatus, setProviderStatus] = useState<{ online: boolean; sources: MusicSource[] }>({ online: false, sources: ['demo'] })
  const [notice, setNotice] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const playRequestRef = useRef(0)
  const noticeTimerRef = useRef<number>()
  const queueTriggerRef = useRef<HTMLElement | null>(null)

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 1800)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
  }, [volume])

  useEffect(() => {
    writeStorage('listener.volume', String(volume))
  }, [volume])

  useEffect(() => {
    writeStorage('listener.liked', [...liked.values()])
  }, [liked])

  useEffect(() => {
    writeStorage('listener.queue', queue)
  }, [queue])

  useEffect(() => {
    writeStorage('listener.current', current)
    document.title = `${current.title} · ${current.artist} — Listener`
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album })
    }
  }, [current])

  useEffect(() => {
    let active = true
    void musicProvider.status().then((status) => {
      if (active) setProviderStatus(status)
    })
    return () => {
      active = false
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInteractive = Boolean(target?.closest('button, input, textarea, select, a, [contenteditable="true"]'))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !queueOpen && !mobileNavOpen) {
        event.preventDefault()
        navigate('search')
      } else if (event.code === 'Space' && !isInteractive && !queueOpen && !mobileNavOpen) {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'Escape') {
        closeQueue()
        setMobileNavOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.load()
    if (isPlaying) void audio.play().catch(() => setIsPlaying(false))
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setIsSearching(true)
      try {
        const found = await musicProvider.search(query, controller.signal)
        if (active) setResults(found)
      } catch {
        // A superseded search is expected to abort.
      } finally {
        if (active) setIsSearching(false)
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
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit' }).format(new Date()),
    [],
  )

  useEffect(() => {
    if (sourceFilter !== 'all' && !resultSources.includes(sourceFilter)) setSourceFilter('all')
  }, [resultSources, sourceFilter])

  const playTrack = (track: Track, list = queue) => {
    const key = trackKey(track)
    setQueue(list.some((item) => trackKey(item) === key) ? list : [track, ...list])
    if (currentKey === key) {
      if (current.audioUrl !== track.audioUrl) {
        setCurrent(track)
        setProgress(0)
        setDuration(track.duration)
        setIsPlaying(true)
        return
      }
      const audio = audioRef.current
      if (audio?.paused) void audio.play().catch(() => showNotice('浏览器暂时无法开始播放'))
      else audio?.pause()
      return
    }
    setCurrent(track)
    setProgress(0)
    setDuration(track.duration)
    setIsPlaying(true)
  }

  const resolveAndPlay = async (track: Track, list = queue) => {
    const requestId = ++playRequestRef.current
    try {
      const resolvedUrl = await musicProvider.resolve(track)
      if (requestId !== playRequestRef.current) return
      const resolvedTrack = { ...track, audioUrl: resolvedUrl }
      const key = trackKey(track)
      const resolvedList = list.map((item) => trackKey(item) === key ? resolvedTrack : item)
      setLiked((previous) => previous.has(key) ? new Map(previous).set(key, resolvedTrack) : previous)
      playTrack(resolvedTrack, resolvedList)
    } catch {
      if (requestId === playRequestRef.current) showNotice('这首歌暂时没有可用音源')
    }
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => showNotice('浏览器暂时无法开始播放'))
    else audio.pause()
  }

  const skip = (direction: 1 | -1) => {
    if (!queue.length) return
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + queue.length) % queue.length
    void resolveAndPlay(queue[nextIndex], queue)
  }

  const shuffle = () => {
    const candidates = queue.filter((track) => trackKey(track) !== currentKey)
    if (!candidates.length) return showNotice('播放队列里还没有其他歌曲')
    const track = candidates[Math.floor(Math.random() * candidates.length)]
    void resolveAndPlay(track, queue)
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
    if (playlist.tracks[0]) void resolveAndPlay(playlist.tracks[0], playlist.tracks)
  }

  const navigate = (next: View) => {
    setView(next)
    setMobileNavOpen(false)
    if (next === 'search') window.setTimeout(() => document.querySelector<HTMLInputElement>('#search-input')?.focus(), 0)
  }

  const openQueue = () => {
    queueTriggerRef.current = mobileNavOpen
      ? document.querySelector<HTMLElement>('.mobile-menu')
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMobileNavOpen(false)
    setQueueOpen(true)
  }

  const closeQueue = () => {
    setQueueOpen(false)
    window.setTimeout(() => queueTriggerRef.current?.focus(), 0)
  }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => { if (audioRef.current) void audioRef.current.play() }],
      ['pause', () => audioRef.current?.pause()],
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

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`} aria-label="侧边导航" {...(queueOpen ? { inert: '' } : {})}>
        <button className="sidebar__close icon-button" onClick={() => setMobileNavOpen(false)} aria-label="关闭菜单"><X /></button>
        <button className="brand" onClick={() => navigate('discover')}>
          <span className="brand__symbol"><Waves /></span>
          <span>Listener</span>
        </button>

        <nav className="nav-group" aria-label="主导航">
          <button aria-current={view === 'discover' ? 'page' : undefined} className={view === 'discover' ? 'active' : ''} onClick={() => navigate('discover')}><Home />发现音乐</button>
          <button aria-current={view === 'search' ? 'page' : undefined} className={view === 'search' ? 'active' : ''} onClick={() => navigate('search')}><Search />聚合搜索</button>
          <button aria-current={view === 'library' ? 'page' : undefined} className={view === 'library' ? 'active' : ''} onClick={() => navigate('library')}><Library />我的收藏</button>
        </nav>

        <div className="sidebar__section-label">我的音乐</div>
        <nav className="nav-group nav-group--sub">
          <button onClick={() => navigate('library')}><Heart />喜欢的音乐 <span>{liked.size}</span></button>
          <button onClick={openQueue}><ListMusic />最近播放</button>
        </nav>

        <div className="source-card">
          <span><Sparkles /> {providerStatus.online ? `${providerStatus.sources.length} 个音乐源已接入` : '演示模式'}</span>
          <p>{providerStatus.online ? providerStatus.sources.map(sourceLabel).join(' · ') : '聚合服务暂时离线'}</p>
          <div className={`source-card__dots ${providerStatus.online ? '' : 'offline'}`}><i /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="scrim" onClick={() => setMobileNavOpen(false)} aria-label="关闭菜单" />}

      <main className="main-content" {...(queueOpen || mobileNavOpen ? { inert: '' } : {})}>
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)} aria-label="打开菜单"><Menu /></button>
          <button className="search-box" onClick={() => navigate('search')}>
            <Search />
            <span>搜索歌曲、歌手或专辑</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar__actions">
            <div className="source-selector"><span className={`status-dot ${providerStatus.online ? '' : 'offline'}`} />{providerStatus.online ? '聚合服务在线' : '演示模式'}</div>
            <div className="avatar" aria-hidden="true">L</div>
          </div>
        </header>

        {view === 'discover' && (
          <div className="page page--discover">
            <section className="hero">
              <div className="hero__content">
                <span className="eyebrow">DAILY SOUND · 每日精选</span>
                <h1>让今天的音乐<br />自己流动。</h1>
                <p>从散落各处的声音里，为你捡回几首好歌。</p>
                <div className="hero__actions">
                  <button className="primary-button" onClick={() => void resolveAndPlay(initialTracks[0], initialTracks)}><Play fill="currentColor" />开始聆听</button>
                  <button className="text-button" onClick={() => navigate('search')}>随便逛逛 <ArrowRight /></button>
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
                  return (
                  <article className={`track-card ${isCurrent ? 'track-card--current' : ''}`} key={key}>
                    <div className="track-card__number">0{index + 1}</div>
                    <button className="track-card__cover" onClick={() => void resolveAndPlay(track, initialTracks)} aria-label={`播放 ${track.title}`}>
                      <Cover name={track.cover} />
                      <span className="cover-play">{isCurrent && isPlaying ? <Pause /> : <Play fill="currentColor" />}</span>
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
              <h1>想听什么？</h1>
              <div className="search-input-wrap">
                <Search aria-hidden="true" />
                <input id="search-input" aria-label="搜索歌曲、歌手或专辑" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌曲、歌手、专辑……" />
                {query && <button onClick={() => setQuery('')} aria-label="清空"><X /></button>}
              </div>
              <div className="search-hints"><span>试试：</span>{['橘子海', '郭顶', 'Golden Hour'].map((word) => <button key={word} onClick={() => setQuery(word)}>{word}</button>)}</div>
              <div className="source-filters" aria-label="音乐源筛选">
                <button aria-pressed={sourceFilter === 'all'} className={sourceFilter === 'all' ? 'active' : ''} onClick={() => setSourceFilter('all')}>全部来源</button>
                {resultSources.map((source) => (
                  <button key={source} aria-pressed={sourceFilter === source} className={sourceFilter === source ? 'active' : ''} onClick={() => setSourceFilter(source)}>{sourceLabel(source)}</button>
                ))}
              </div>
            </div>
            <section className="results-section">
              <div className="section-heading"><div><span className="section-index">{String(displayResults.length).padStart(2, '0')}</span><h2>{query ? `“${query}” 的结果` : '全部音乐'}</h2></div><span className="searching-state" aria-live="polite">{isSearching ? '正在检索音乐源…' : `共 ${displayResults.length} 首`}</span></div>
              <div className="track-list">
                {displayResults.length ? displayResults.map((track, index) => {
                  const key = trackKey(track)
                  const isCurrent = currentKey === key
                  const isLiked = liked.has(key)
                  return (
                  <div className={`track-row ${isCurrent ? 'track-row--current' : ''}`} key={key}>
                    <button className="track-row__play" aria-label={`播放 ${track.title}`} onClick={() => void resolveAndPlay(track, displayResults)}><span>{String(index + 1).padStart(2, '0')}</span>{isCurrent && isPlaying ? <Pause /> : <Play fill="currentColor" />}</button>
                    <Cover name={track.cover} size="small" />
                    <div className="track-row__title"><strong>{track.title}</strong><span>{track.artist}</span></div>
                    <span className="track-row__album">{track.album}</span>
                    <SourceBadge track={track} />
                    <span className="track-row__duration">{formatTime(track.duration)}</span>
                    <button aria-label={`${isLiked ? '取消收藏' : '收藏'} ${track.title}`} className={`like-button ${isLiked ? 'liked' : ''}`} onClick={() => toggleLike(track)}><Heart fill={isLiked ? 'currentColor' : 'none'} /></button>
                  </div>
                  )
                }) : <div className="empty-state"><Disc3 /><h3>{isSearching ? '正在寻找好音乐' : '还没找到这首歌'}</h3><p>{isSearching ? '正在连接可用音乐源，请稍候。' : '换个关键词，或者稍后接入更多音乐源。'}</p></div>}
              </div>
            </section>
          </div>
        )}

        {view === 'library' && (
          <div className="page page--library">
            <div className="library-heading"><span className="eyebrow">YOUR COLLECTION</span><h1>我的收藏</h1><p>{liked.size} 首歌，留住每一次心动。</p></div>
            <div className="track-list">
              {likedTracks.map((track, index) => (
                <div className={`track-row ${currentKey === trackKey(track) ? 'track-row--current' : ''}`} key={trackKey(track)}>
                  <button className="track-row__play" aria-label={`播放 ${track.title}`} onClick={() => void resolveAndPlay(track, likedTracks)}><span>{String(index + 1).padStart(2, '0')}</span><Play fill="currentColor" /></button>
                  <Cover name={track.cover} size="small" />
                  <div className="track-row__title"><strong>{track.title}</strong><span>{track.artist}</span></div>
                  <span className="track-row__album">{track.album}</span><SourceBadge track={track} />
                  <span className="track-row__duration">{formatTime(track.duration)}</span>
                  <button className="like-button liked" aria-label={`取消收藏 ${track.title}`} onClick={() => toggleLike(track)}><Heart fill="currentColor" /></button>
                </div>
              ))}
              {!liked.size && <div className="empty-state"><Heart /><h3>收藏夹还是空的</h3><p>遇到喜欢的歌，就点一下心形按钮吧。</p></div>}
            </div>
          </div>
        )}
      </main>

      {queueOpen && (
        <>
          <aside className="queue-drawer queue-drawer--open" role="dialog" aria-modal="true" aria-label="播放队列">
            <div className="queue-drawer__header"><div><span className="eyebrow">UP NEXT</span><h2>播放队列</h2></div><button className="icon-button" aria-label="关闭播放队列" autoFocus onClick={closeQueue}><X /></button></div>
            <p className="queue-drawer__count">共 {queue.length} 首</p>
            <div className="queue-drawer__list">
              {queue.map((track, index) => {
                const isCurrent = trackKey(track) === currentKey
                return <button key={`${trackKey(track)}-${index}`} aria-current={isCurrent ? 'true' : undefined} className={isCurrent ? 'current' : ''} onClick={() => void resolveAndPlay(track, queue)}><Cover name={track.cover} size="small" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>{isCurrent && <i><Waves /></i>}</button>
              })}
            </div>
          </aside>
          <button className="queue-scrim" onClick={closeQueue} aria-label="关闭播放队列" />
        </>
      )}

      <footer className="player" {...(queueOpen || mobileNavOpen ? { inert: '' } : {})}>
        <audio
          ref={audioRef}
          src={current.audioUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration)
          }}
          onEnded={() => skip(1)}
          onError={() => { setIsPlaying(false); showNotice('音源暂时无法播放，请换一首试试') }}
        />
        <div className="player__track"><Cover name={current.cover} size="small" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button aria-label={`${liked.has(currentKey) ? '取消收藏' : '收藏'} ${current.title}`} className={`like-button ${liked.has(currentKey) ? 'liked' : ''}`} onClick={() => toggleLike(current)}><Heart fill={liked.has(currentKey) ? 'currentColor' : 'none'} /></button></div>
        <div className="player__center">
          <div className="player__controls"><button aria-label="随机播放" onClick={shuffle}><Shuffle /></button><button aria-label="上一首" onClick={() => skip(-1)}><SkipBack fill="currentColor" /></button><button className="play-main" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlay}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" onClick={() => skip(1)}><SkipForward fill="currentColor" /></button><button aria-label="播放队列" onClick={openQueue}><ListMusic /></button></div>
          <div className="player__progress"><span>{formatTime(progress)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={progress} style={{ '--progress': `${(progress / (duration || 1)) * 100}%` } as React.CSSProperties} onChange={(event) => { const time = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = time; setProgress(time) }} /><span>{formatTime(duration)}</span></div>
        </div>
        <div className="player__tools"><button aria-label="播放队列" onClick={openQueue}><ListMusic /></button><Volume2 aria-hidden="true" /><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} style={{ '--progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></div>
      </footer>
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  )
}

export default App
