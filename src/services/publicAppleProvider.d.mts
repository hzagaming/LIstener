import type { MusicProvider } from '../types/music'

export declare const createPublicAppleProvider: (options?: {
  fetchImpl?: typeof fetch
  fallback: MusicProvider
  country?: string
}) => MusicProvider
