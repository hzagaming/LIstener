import type { Playlist, Track } from '../types/music'

const audio = (index: number) =>
  `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${index}.mp3`

const demo = (id: string, title: string, cover: string): Track => ({
  id,
  title,
  artist: 'SoundHelix',
  album: 'Listener 合法演示音频',
  duration: 0,
  source: 'demo',
  audioUrl: audio(Number(id)),
  cover,
  sourceUrl: audio(Number(id)),
  quality: 'standard',
  capabilities: { playback: 'full', lyrics: false, download: false },
})

export const tracks: Track[] = [
  { ...demo('1', 'Coastal Motion', 'sunset'), liked: true },
  demo('2', 'Blue Hour', 'blue'),
  demo('3', 'Open Field', 'field'),
  demo('4', 'Night Walk', 'night'),
  demo('5', 'Golden Light', 'gold'),
  demo('6', 'Green Signal', 'forest'),
  demo('7', 'Violet City', 'violet'),
  demo('8', 'Late Flowers', 'flower'),
]

export const playlists: Playlist[] = [
  {
    id: 'p1', title: '沿海公路', description: '风把心事吹向很远的地方', cover: 'coast',
    tracks: tracks.slice(0, 5),
  },
  {
    id: 'p2', title: '下班后失踪', description: '把所有消息都设为免打扰', cover: 'afterwork',
    tracks: [tracks[5], tracks[1], tracks[6], tracks[3]],
  },
  {
    id: 'p3', title: '卧室独立电台', description: '唱针落下，世界暂时静音', cover: 'radio',
    tracks: [tracks[2], tracks[4], tracks[7]],
  },
  {
    id: 'p4', title: '雨天便利店', description: '凌晨两点还有一盏灯亮着', cover: 'rain',
    tracks: [tracks[3], tracks[5], tracks[0]],
  },
]
