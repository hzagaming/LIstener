import { isIP } from 'node:net'

const redirectStatuses = new Set([301, 302, 303, 307, 308])
const retryStatuses = new Set([429, 502, 503, 504])
const textDecoder = new TextDecoder()

export class ProviderHttpError extends Error {
  constructor(message, { code = 'PROVIDER_REQUEST_FAILED', status } = {}) {
    super(message)
    this.name = 'ProviderHttpError'
    this.code = code
    this.status = status
  }
}

const abortReason = (signal) => signal?.reason ?? new Error('provider request aborted')

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortReason(signal))
  const cleanup = () => signal?.removeEventListener('abort', onAbort)
  const onAbort = () => {
    clearTimeout(timer)
    cleanup()
    reject(abortReason(signal))
  }
  const timer = setTimeout(() => { cleanup(); resolve() }, milliseconds)
  signal?.addEventListener('abort', onAbort, { once: true })
})

const normalizeHost = (value) => {
  const host = String(value).trim().toLocaleLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isIP(host)) return null
  return host
}

const allowedUrl = (value, allowedHosts) => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, '')
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && !isIP(hostname.replace(/^\[|\]$/g, ''))
      && hostname !== 'localhost'
      && !hostname.endsWith('.localhost')
      && allowedHosts.has(hostname)
      ? url
      : null
  } catch {
    return null
  }
}

const readLimitedText = async (response, maxBytes) => {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderHttpError('provider response is too large', { code: 'PROVIDER_RESPONSE_TOO_LARGE' })
  }
  if (!response.body) {
    const text = typeof response.text === 'function'
      ? await response.text()
      : JSON.stringify(await response.json())
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ProviderHttpError('provider response is too large', { code: 'PROVIDER_RESPONSE_TOO_LARGE' })
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ProviderHttpError('provider response is too large', { code: 'PROVIDER_RESPONSE_TOO_LARGE' })
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return textDecoder.decode(body)
}

export const createProviderHttpClient = ({
  allowedHosts,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
  maxResponseBytes = 2_097_152,
  maxRedirects = 2,
  maxRetries = 1,
  retryDelayMs = 80,
  waitImpl = wait,
  userAgent = 'Listener/1.0.0 (+https://github.com/hzagaming/LIstener)',
} = {}) => {
  const hosts = new Set((allowedHosts ?? []).map(normalizeHost).filter(Boolean))
  if (!hosts.size) throw new Error('at least one public provider host is required')
  if (typeof fetchImpl !== 'function') throw new Error('provider fetch implementation is required')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('valid provider timeout is required')
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new Error('valid response limit is required')
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new Error('valid redirect limit is required')
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) throw new Error('valid retry limit is required')

  const validateUrl = (value) => {
    const url = allowedUrl(value, hosts)
    if (!url) throw new ProviderHttpError('provider URL is not allowed', { code: 'PROVIDER_URL_BLOCKED' })
    return url
  }

  const request = async (value, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase()
    const retryable = options.retryable ?? ['GET', 'HEAD'].includes(method)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let url = validateUrl(value)
      let currentMethod = method
      let currentBody = options.body
      try {
        for (let redirects = 0; ; redirects += 1) {
          if (signal.aborted) throw abortReason(signal)
          const response = await fetchImpl(url, {
            method: currentMethod,
            headers: {
              Accept: 'application/json',
              'User-Agent': userAgent,
              ...options.headers,
            },
            body: currentBody,
            redirect: 'manual',
            signal,
          })
          if (!redirectStatuses.has(response.status)) {
            if (retryable && retryStatuses.has(response.status) && attempt < maxRetries) {
              await response.body?.cancel()
              await waitImpl(retryDelayMs * (2 ** attempt), signal)
              break
            }
            if (!response.ok) {
              await response.body?.cancel()
              throw new ProviderHttpError(`provider request failed: ${response.status}`, {
                status: response.status,
              })
            }
            return response
          }
          if (redirects >= maxRedirects) {
            await response.body?.cancel()
            throw new ProviderHttpError('provider redirect limit exceeded', { code: 'PROVIDER_REDIRECT_LIMIT' })
          }
          const location = response.headers.get('location')
          await response.body?.cancel()
          url = validateUrl(new URL(location ?? '', url))
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
            currentMethod = 'GET'
            currentBody = undefined
          }
        }
      } catch (error) {
        if (signal.aborted) throw abortReason(signal)
        if (error instanceof ProviderHttpError) throw error
        if (!retryable || attempt >= maxRetries) {
          throw new ProviderHttpError('provider request failed')
        }
        await waitImpl(retryDelayMs * (2 ** attempt), signal)
      }
    }
    throw new ProviderHttpError('provider request failed')
  }

  return {
    validateUrl,
    request,
    async json(value, options) {
      const response = await request(value, options)
      const text = await readLimitedText(response, maxResponseBytes)
      try {
        return JSON.parse(text)
      } catch {
        throw new ProviderHttpError('invalid provider JSON response', { code: 'PROVIDER_INVALID_JSON' })
      }
    },
  }
}
