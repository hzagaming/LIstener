import type { MusicProvider, MusicSource } from '../types/music'

export const publicMusicSources: MusicSource[]

export const createPublicMusicProvider: (options: {
  apple: MusicProvider
  fallback: MusicProvider
  fetchImpl?: typeof fetch
  musicBrainzIntervalMs?: number
  statusTimeoutMs?: number
  now?: () => number
  waitImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<unknown>
}) => MusicProvider
