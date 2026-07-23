import type { Playlist, Track } from '../types/music'

const audio = (index: number) =>
  `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${index}.mp3`

export const tracks: Track[] = [
  { id: '1', title: '橘子海', artist: '夏日入侵企画', album: '想去海边', duration: 278, source: 'netease', audioUrl: audio(1), cover: 'sunset', liked: true },
  { id: '2', title: '晚风心里吹', artist: '阿梨粤', album: '晚风心里吹', duration: 189, source: 'qq', audioUrl: audio(2), cover: 'blue' },
  { id: '3', title: 'Somewhere Only We Know', artist: 'Keane', album: 'Hopes and Fears', duration: 237, source: 'kugou', audioUrl: audio(3), cover: 'field' },
  { id: '4', title: '我想念', artist: '汪苏泷', album: '联名', duration: 205, source: 'netease', audioUrl: audio(4), cover: 'night' },
  { id: '5', title: 'Golden Hour', artist: 'JVKE', album: 'this is what ____ feels like', duration: 209, source: 'qq', audioUrl: audio(5), cover: 'gold' },
  { id: '6', title: '凄美地', artist: '郭顶', album: '飞行器的执行周期', duration: 250, source: 'netease', audioUrl: audio(6), cover: 'forest' },
  { id: '7', title: 'City of Stars', artist: 'Ryan Gosling', album: 'La La Land', duration: 149, source: 'kugou', audioUrl: audio(7), cover: 'violet' },
  { id: '8', title: '鲜花', artist: '回春丹', album: '鲜花', duration: 267, source: 'qq', audioUrl: audio(8), cover: 'flower' },
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
