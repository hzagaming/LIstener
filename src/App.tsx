import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, ChevronDown, Disc3, Heart, Home, Library,
  ListMusic, Menu, MoreHorizontal, Pause, Play, Plus,
  Radio, Search, Shuffle, SkipBack, SkipForward, Sparkles,
  Volume2, Waves, X,
} from 'lucide-react'
import { playlists, tracks as initialTracks } from './data/catalog'
import { musicProvider, sourceLabel } from './services/musicProvider'
import type { MusicSource, Playlist, Track } from './types/music'

type View = 'discover' | 'search' | 'library'

const readStoredIds = (key: string, fallback: string[]) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback
  } catch {
    return fallback
  }
}

const readStoredNumber = (key: string, fallback: number) => {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) ? value : fallback
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function Cover({ name, size = 'medium' }: { name: string; size?: 'small' | 'medium' | 'large' }) {
  return (
    <div className={`cover cover--${name} cover--${size}`} aria-hidden="true">
      <div className="cover__grain" />
      <Disc3 className="cover__disc" />
      <span className="cover__mark">L.</span>
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
  const [queue, setQueue] = useState<Track[]>(() => {
    const ids = readStoredIds('listener.queue', initialTracks.slice(0, 6).map((track) => track.id))
    const restored = ids.map((id) => initialTracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track))
    return restored.length ? restored : initialTracks.slice(0, 6)
  })
  const [current, setCurrent] = useState<Track>(() => initialTracks.find((track) => track.id === localStorage.getItem('listener.current')) ?? initialTracks[0])
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(current.duration)
  const [volume, setVolume] = useState(() => Math.min(1, Math.max(0, readStoredNumber('listener.volume', 0.72))))
  const [queueOpen, setQueueOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [liked, setLiked] = useState(() => new Set(readStoredIds('listener.liked', initialTracks.filter((t) => t.liked).map((t) => t.id))))
  const [notice, setNotice] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
  }, [volume])

  useEffect(() => {
    localStorage.setItem('listener.volume', String(volume))
  }, [volume])

  useEffect(() => {
    localStorage.setItem('listener.liked', JSON.stringify([...liked]))
  }, [liked])

  useEffect(() => {
    localStorage.setItem('listener.queue', JSON.stringify(queue.map((track) => track.id)))
  }, [queue])

  useEffect(() => {
    localStorage.setItem('listener.current', current.id)
    document.title = `${current.title} · ${current.artist} — Listener`
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album })
    }
  }, [current])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        navigate('search')
      } else if (event.code === 'Space' && !isTyping) {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'Escape') {
        setQueueOpen(false)
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
    const timeout = window.setTimeout(async () => {
      setIsSearching(true)
      const found = await musicProvider.search(query)
      if (active) {
        setResults(found)
        setIsSearching(false)
      }
    }, 180)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [query])

  const currentIndex = useMemo(() => queue.findIndex((track) => track.id === current.id), [queue, current])
  const displayResults = useMemo(
    () => sourceFilter === 'all' ? results : results.filter((track) => track.source === sourceFilter),
    [results, sourceFilter],
  )

  const playTrack = (track: Track, list = queue) => {
    setQueue(list.some((item) => item.id === track.id) ? list : [track, ...list])
    if (current.id === track.id) {
      if (current.audioUrl !== track.audioUrl) {
        setCurrent(track)
        setProgress(0)
        setIsPlaying(true)
        return
      }
      const audio = audioRef.current
      if (audio?.paused) void audio.play()
      else audio?.pause()
      return
    }
    setCurrent(track)
    setProgress(0)
    setIsPlaying(true)
  }

  const resolveAndPlay = async (track: Track, list = queue) => {
    const resolvedUrl = await musicProvider.resolve(track)
    playTrack({ ...track, audioUrl: resolvedUrl }, list.map((item) => item.id === track.id ? { ...item, audioUrl: resolvedUrl } : item))
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const skip = (direction: 1 | -1) => {
    if (!queue.length) return
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + queue.length) % queue.length
    playTrack(queue[nextIndex], queue)
  }

  const toggleLike = (id: string) => {
    setLiked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setNotice(liked.has(id) ? '已从收藏中移除' : '已加入喜欢的音乐')
    window.setTimeout(() => setNotice(''), 1800)
  }

  const openPlaylist = (playlist: Playlist) => {
    if (playlist.tracks[0]) void resolveAndPlay(playlist.tracks[0], playlist.tracks)
  }

  const navigate = (next: View) => {
    setView(next)
    setMobileNavOpen(false)
    if (next === 'search') window.setTimeout(() => document.querySelector<HTMLInputElement>('#search-input')?.focus(), 0)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`}>
        <button className="sidebar__close icon-button" onClick={() => setMobileNavOpen(false)} aria-label="关闭菜单"><X /></button>
        <button className="brand" onClick={() => navigate('discover')}>
          <span className="brand__symbol"><Waves /></span>
          <span>Listener</span>
        </button>

        <nav className="nav-group" aria-label="主导航">
          <button className={view === 'discover' ? 'active' : ''} onClick={() => navigate('discover')}><Home />发现音乐</button>
          <button className={view === 'search' ? 'active' : ''} onClick={() => navigate('search')}><Search />聚合搜索</button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => navigate('library')}><Library />我的收藏</button>
        </nav>

        <div className="sidebar__section-label">我的音乐</div>
        <nav className="nav-group nav-group--sub">
          <button onClick={() => navigate('library')}><Heart />喜欢的音乐 <span>{liked.size}</span></button>
          <button onClick={() => setQueueOpen(true)}><ListMusic />最近播放</button>
          <button><Radio />私人电台</button>
        </nav>

        <div className="sidebar__playlist">
          <div className="sidebar__section-label">收藏歌单 <button aria-label="创建歌单"><Plus /></button></div>
          <button>午夜飞行指南</button>
          <button>在岛屿写信</button>
          <button>有点浪漫</button>
        </div>

        <div className="source-card">
          <span><Sparkles /> 3 个音乐源在线</span>
          <p>聚合搜索已就绪</p>
          <div className="source-card__dots"><i /><i /><i /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="scrim" onClick={() => setMobileNavOpen(false)} aria-label="关闭菜单" />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNavOpen(true)} aria-label="打开菜单"><Menu /></button>
          <button className="search-box" onClick={() => navigate('search')}>
            <Search />
            <span>搜索歌曲、歌手或专辑</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar__actions">
            <button className="source-selector"><span className="status-dot" />全部音乐源<ChevronDown /></button>
            <button className="avatar" aria-label="个人中心">Z</button>
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
                <div className="hero__record"><span>LISTENER<br /><small>DAILY 07·21</small></span></div>
                <div className="hero__line hero__line--one" />
                <div className="hero__line hero__line--two" />
                <span className="hero__note">07 / 21</span>
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div><span className="section-index">01</span><h2>最近很对味</h2></div>
                <button onClick={() => navigate('search')}>查看全部 <ArrowRight /></button>
              </div>
              <div className="track-grid">
                {initialTracks.slice(0, 4).map((track, index) => (
                  <article className={`track-card ${current.id === track.id ? 'track-card--current' : ''}`} key={track.id} onDoubleClick={() => void resolveAndPlay(track, initialTracks)}>
                    <div className="track-card__number">0{index + 1}</div>
                    <button className="track-card__cover" onClick={() => void resolveAndPlay(track, initialTracks)} aria-label={`播放 ${track.title}`}>
                      <Cover name={track.cover} />
                      <span className="cover-play">{current.id === track.id && isPlaying ? <Pause /> : <Play fill="currentColor" />}</span>
                    </button>
                    <div className="track-card__meta">
                      <h3>{track.title}</h3>
                      <p>{track.artist}</p>
                      <SourceBadge track={track} />
                    </div>
                    <button className={`like-button ${liked.has(track.id) ? 'liked' : ''}`} onClick={() => toggleLike(track.id)} aria-label="收藏"><Heart fill={liked.has(track.id) ? 'currentColor' : 'none'} /></button>
                  </article>
                ))}
              </div>
            </section>

            <section className="content-section">
              <div className="section-heading">
                <div><span className="section-index">02</span><h2>听点不一样的</h2></div>
                <button>换一批 <Shuffle /></button>
              </div>
              <div className="playlist-grid">
                {playlists.map((playlist, index) => (
                  <button className="playlist-card" key={playlist.id} onClick={() => openPlaylist(playlist)}>
                    <div className="playlist-card__visual">
                      <Cover name={playlist.cover} size="large" />
                      <span className="playlist-card__count">{playlist.count} 首</span>
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
              <label className="search-input-wrap" htmlFor="search-input">
                <Search />
                <input id="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌曲、歌手、专辑……" />
                {query && <button onClick={() => setQuery('')} aria-label="清空"><X /></button>}
              </label>
              <div className="search-hints"><span>试试：</span>{['橘子海', '郭顶', 'Golden Hour'].map((word) => <button key={word} onClick={() => setQuery(word)}>{word}</button>)}</div>
              <div className="source-filters" aria-label="音乐源筛选">
                {([
                  ['all', '全部来源'],
                  ['netease', '网易云'],
                  ['qq', 'QQ 音乐'],
                  ['kugou', '酷狗'],
                ] as const).map(([value, label]) => (
                  <button key={value} className={sourceFilter === value ? 'active' : ''} onClick={() => setSourceFilter(value)}>{label}</button>
                ))}
              </div>
            </div>
            <section className="results-section">
              <div className="section-heading"><div><span className="section-index">{String(displayResults.length).padStart(2, '0')}</span><h2>{query ? `“${query}” 的结果` : '全部音乐'}</h2></div><span className="searching-state">{isSearching ? '正在检索多个音乐源…' : '已合并重复结果'}</span></div>
              <div className="track-list">
                {displayResults.length ? displayResults.map((track, index) => (
                  <div className={`track-row ${current.id === track.id ? 'track-row--current' : ''}`} key={track.id}>
                    <button className="track-row__play" aria-label={`播放 ${track.title}`} onClick={() => void resolveAndPlay(track, displayResults)}><span>{String(index + 1).padStart(2, '0')}</span>{current.id === track.id && isPlaying ? <Pause /> : <Play fill="currentColor" />}</button>
                    <Cover name={track.cover} size="small" />
                    <div className="track-row__title"><strong>{track.title}</strong><span>{track.artist}</span></div>
                    <span className="track-row__album">{track.album}</span>
                    <SourceBadge track={track} />
                    <span className="track-row__duration">{formatTime(track.duration)}</span>
                    <button aria-label={`收藏 ${track.title}`} className={`like-button ${liked.has(track.id) ? 'liked' : ''}`} onClick={() => toggleLike(track.id)}><Heart fill={liked.has(track.id) ? 'currentColor' : 'none'} /></button>
                    <button className="icon-button" aria-label={`${track.title} 的更多操作`}><MoreHorizontal /></button>
                  </div>
                )) : <div className="empty-state"><Disc3 /><h3>还没找到这首歌</h3><p>换个关键词，或者稍后接入更多音乐源。</p></div>}
              </div>
            </section>
          </div>
        )}

        {view === 'library' && (
          <div className="page page--library">
            <div className="library-heading"><span className="eyebrow">YOUR COLLECTION</span><h1>我的收藏</h1><p>{liked.size} 首歌，留住每一次心动。</p></div>
            <div className="track-list">
              {initialTracks.filter((track) => liked.has(track.id)).map((track, index) => (
                <div className="track-row" key={track.id}>
                  <button className="track-row__play" onClick={() => void resolveAndPlay(track, initialTracks)}><span>{String(index + 1).padStart(2, '0')}</span><Play fill="currentColor" /></button>
                  <Cover name={track.cover} size="small" />
                  <div className="track-row__title"><strong>{track.title}</strong><span>{track.artist}</span></div>
                  <span className="track-row__album">{track.album}</span><SourceBadge track={track} />
                  <span className="track-row__duration">{formatTime(track.duration)}</span>
                  <button className="like-button liked" onClick={() => toggleLike(track.id)}><Heart fill="currentColor" /></button>
                </div>
              ))}
              {!liked.size && <div className="empty-state"><Heart /><h3>收藏夹还是空的</h3><p>遇到喜欢的歌，就点一下心形按钮吧。</p></div>}
            </div>
          </div>
        )}
      </main>

      <aside className={`queue-drawer ${queueOpen ? 'queue-drawer--open' : ''}`}>
        <div className="queue-drawer__header"><div><span className="eyebrow">UP NEXT</span><h2>播放队列</h2></div><button className="icon-button" onClick={() => setQueueOpen(false)}><X /></button></div>
        <p className="queue-drawer__count">共 {queue.length} 首</p>
        <div className="queue-drawer__list">
          {queue.map((track, index) => <button key={`${track.id}-${index}`} className={track.id === current.id ? 'current' : ''} onClick={() => void resolveAndPlay(track, queue)}><Cover name={track.cover} size="small" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>{track.id === current.id && <i><Waves /></i>}</button>)}
        </div>
      </aside>
      {queueOpen && <button className="queue-scrim" onClick={() => setQueueOpen(false)} aria-label="关闭播放队列" />}

      <footer className="player">
        <audio
          ref={audioRef}
          src={current.audioUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onEnded={() => skip(1)}
          onError={() => { setIsPlaying(false); setNotice('音源暂时无法播放，请换一首试试') }}
        />
        <div className="player__track"><Cover name={current.cover} size="small" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button className={`like-button ${liked.has(current.id) ? 'liked' : ''}`} onClick={() => toggleLike(current.id)}><Heart fill={liked.has(current.id) ? 'currentColor' : 'none'} /></button></div>
        <div className="player__center">
          <div className="player__controls"><button aria-label="随机播放"><Shuffle /></button><button aria-label="上一首" onClick={() => skip(-1)}><SkipBack fill="currentColor" /></button><button className="play-main" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlay}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" onClick={() => skip(1)}><SkipForward fill="currentColor" /></button><button aria-label="播放队列" onClick={() => setQueueOpen(true)}><ListMusic /></button></div>
          <div className="player__progress"><span>{formatTime(progress)}</span><input type="range" min="0" max={duration || 1} step="0.1" value={progress} style={{ '--progress': `${(progress / (duration || 1)) * 100}%` } as React.CSSProperties} onChange={(event) => { const time = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = time; setProgress(time) }} /><span>{formatTime(duration)}</span></div>
        </div>
        <div className="player__tools"><button onClick={() => setQueueOpen(true)}><ListMusic /></button><Volume2 /><input type="range" min="0" max="1" step="0.01" value={volume} style={{ '--progress': `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></div>
      </footer>
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  )
}

export default App
