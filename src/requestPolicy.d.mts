export declare const createRequestSignal: (
  signal: AbortSignal | undefined,
  timeoutMs: number,
) => AbortSignal

export declare const abortableDelay: (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>
