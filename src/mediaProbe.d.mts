export declare const verifyPublicAudioUrl: (
  value: unknown,
  options?: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    attempts?: number
    timeoutMs?: number
    now?: () => number
  },
) => Promise<string>
