import type { MusicProvider } from '../types/music'

export declare const createPublicAppleProvider: (options?: {
  fetchImpl?: typeof fetch
  fallback: MusicProvider
  country?: string
  retryDelayMs?: number
  waitImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  randomImpl?: () => number
}) => MusicProvider
