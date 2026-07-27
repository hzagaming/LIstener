import { normalizeLyrics } from '../lyrics.mjs'

const sourceUrl = 'https://creativecommons.org/publicdomain/zero/1.0/'
const fixtures = [
  {
    id: 'fixture-1', title: '海風 + Dawn', artist: 'Listener Lab', album: 'Offline Core', duration: 92,
    lyrics: '[00:00.00]海風掠過清晨\n[00:04.50]Dawn opens the quiet road', cover: 'blue',
  },
  {
    id: 'fixture-2', title: 'こんにちは Signal', artist: 'Listener Lab', album: 'Offline Core', duration: 108,
    lyrics: '[00:00.00]こんにちは\n[00:03.20]Signal in the morning', cover: 'violet',
  },
  {
    id: 'fixture-3', title: 'Open Field', artist: 'Test Ensemble', album: 'Public Test Set', duration: 75,
    lyrics: 'An original fixture lyric\nCreated only for automated tests', cover: 'field',
  },
  {
    id: 'fixture-4', title: '夜行 Sample', artist: 'Test Ensemble', album: 'Public Test Set', duration: 64,
    lyrics: '[00:00.10]夜行列车\n[00:02.00]No commercial recording attached', cover: 'night',
  },
]

const track = ({ lyrics: _lyrics, ...item }) => ({
  ...item,
  source: 'fixture',
  audioUrl: '',
  sourceUrl,
  quality: 'unknown',
  capabilities: { playback: 'none', lyrics: true, download: false },
})

export const createLocalFixtureProvider = () => ({
  id: 'fixture',
  name: 'Local Fixture',
  enabled: true,
  experimental: false,
  official: false,
  allowedHosts: [],
  capabilities: { search: true, playback: false, lyrics: true, download: false },

  async search(query, limit = 20, signal, page = 1) {
    if (signal?.aborted) throw signal.reason
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase()
    const matches = fixtures.filter((item) => !normalized
      || [item.title, item.artist, item.album].some((value) => value.normalize('NFKC').toLocaleLowerCase().includes(normalized)))
    const start = Math.max(0, page - 1) * limit
    return matches.slice(start, start + limit).map(track)
  },

  async lookup(id, signal) {
    if (signal?.aborted) throw signal.reason
    if (!/^fixture-\d+$/.test(id)) throw new Error('invalid fixture track id')
    const item = fixtures.find((candidate) => candidate.id === id)
    if (!item) throw Object.assign(new Error('fixture track not found'), { code: 'TRACK_NOT_FOUND' })
    return track(item)
  },

  async lyrics(id, signal) {
    if (signal?.aborted) throw signal.reason
    if (!/^fixture-\d+$/.test(id)) throw new Error('invalid fixture track id')
    const item = fixtures.find((candidate) => candidate.id === id)
    if (!item) throw Object.assign(new Error('fixture track not found'), { code: 'TRACK_NOT_FOUND' })
    return normalizeLyrics(item.lyrics)
  },

  async healthCheck() {
    return { status: 'healthy' }
  },
})
