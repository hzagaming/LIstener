import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const sourceHosts = { wikimedia: ['upload.wikimedia.org'] }

const trustedUrl = (value, source) => {
  const allowed = sourceHosts[source]
  if (!allowed) return null
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLocaleLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

const audioType = (value) => {
  const type = value?.split(';')[0].trim().toLocaleLowerCase() ?? ''
  return type.startsWith('audio/') || type === 'application/ogg' ? type : ''
}

export const createAudioDownloader = ({ fetchImpl = globalThis.fetch, maxBytes = 134_217_728, timeoutMs = 120_000 } = {}) => async ({
  source,
  url,
  signal,
}) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let target = trustedUrl(url, source)
  if (!target) throw new Error('audio download host is not allowed')
  let response
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    response = await fetchImpl(target, {
      headers: {
        Accept: 'audio/*,application/ogg',
        'User-Agent': 'Listener/0.10.4 (+https://github.com/hzagaming/LIstener)',
      },
      redirect: 'manual',
      signal: requestSignal,
    })
    if (response.status < 300 || response.status >= 400) break
    await response.body?.cancel().catch(() => undefined)
    const next = response.headers.get('location')
    target = next ? trustedUrl(new URL(next, target).toString(), source) : null
    if (!target) throw new Error('audio download redirect is not allowed')
  }
  if (!response?.ok) throw new Error('audio download request failed')
  const contentType = audioType(response.headers.get('content-type'))
  if (!contentType) throw new Error('audio download response is not audio')
  if (!response.body) throw new Error('audio download response is empty')
  const lengthHeader = response.headers.get('content-length')
  const contentLength = lengthHeader === null ? null : Number(lengthHeader)
  if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes)) {
    await response.body.cancel().catch(() => undefined)
    throw new Error('audio download is too large')
  }
  return { body: response.body, contentType, contentLength, maxBytes, signal: requestSignal }
}

export const pipeAudioDownload = async ({ body, maxBytes, signal: downloadSignal }, destination, signal) => {
  let total = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length
      callback(total > maxBytes ? new Error('audio download is too large') : null, chunk)
    },
  })
  const streams = [Readable.fromWeb(body), limiter, destination]
  const pipelineSignal = signal && downloadSignal
    ? AbortSignal.any([signal, downloadSignal])
    : signal ?? downloadSignal
  return pipelineSignal ? pipeline(...streams, { signal: pipelineSignal }) : pipeline(...streams)
}
