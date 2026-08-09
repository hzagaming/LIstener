import { createRequestSignal } from './requestPolicy.mjs'

const allowedMediaTypes = new Set(['application/ogg', 'application/octet-stream'])

const safeHttpsUrl = (value) => {
  if (typeof value !== 'string' || !value || value.length > 8_192) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.toString() : ''
  } catch {
    return ''
  }
}

const unavailable = () => Object.assign(new Error('public audio verification failed'), {
  code: 'CAPABILITY_UNAVAILABLE',
})

export const verifyPublicAudioUrl = async (value, {
  fetchImpl = globalThis.fetch,
  signal,
  attempts = 3,
  timeoutMs = 4_000,
  now = Date.now,
} = {}) => {
  const source = safeHttpsUrl(value)
  if (!source) throw new Error('valid HTTPS media URL is required')
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw new Error('valid media probe dependencies are required')
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('valid media probe attempts are required')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('valid media probe timeout is required')

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const requestUrl = new URL(source)
    if (requestUrl.hostname === 'api.audius.co') requestUrl.searchParams.set('_probe', `${now()}-${attempt}`)
    let response
    try {
      response = await fetchImpl(requestUrl, {
        credentials: 'omit',
        headers: {
          Accept: 'audio/*,application/ogg,application/octet-stream',
          Range: 'bytes=0-1023',
        },
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: createRequestSignal(signal, timeoutMs),
      })
      const type = String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLocaleLowerCase()
      const finalUrl = safeHttpsUrl(response.url)
      if ([200, 206].includes(response.status) && finalUrl && (type.startsWith('audio/') || allowedMediaTypes.has(type))) return finalUrl
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
    } finally {
      try { await response?.body?.cancel?.() } catch { /* ignore probe cleanup failures */ }
    }
  }
  throw unavailable()
}
