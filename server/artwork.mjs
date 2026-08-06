const sourceHosts = {
  apple: ['mzstatic.com'],
  netease: ['music.126.net'],
  audius: ['audius.co'],
  youtube: ['ytimg.com'],
}
const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
])

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

const readBounded = async (response, maximum) => {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maximum) throw new Error('artwork is too large')
  if (!response.body) throw new Error('artwork response is empty')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) throw new Error('artwork is too large')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export const createArtworkDownloader = ({ fetchImpl = globalThis.fetch, maxBytes = 8_388_608, timeoutMs = 15_000 } = {}) => async ({
  source,
  url,
  title,
  signal,
}) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let target = trustedUrl(url, source)
  if (!target) throw new Error('artwork host is not allowed')
  let response
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    response = await fetchImpl(target, {
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      redirect: 'manual',
      signal: requestSignal,
    })
    if (response.status < 300 || response.status >= 400) break
    const next = response.headers.get('location')
    target = next ? trustedUrl(new URL(next, target).toString(), source) : null
    if (!target) throw new Error('artwork redirect is not allowed')
  }
  if (!response?.ok) throw new Error('artwork request failed')
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLocaleLowerCase() ?? ''
  const extension = extensions.get(contentType)
  if (!extension) throw new Error('artwork response is not a supported image')
  const bytes = await readBounded(response, maxBytes)
  const stem = String(title || 'listener').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'listener'
  return { bytes, contentType, filename: `${stem}-cover.${extension}` }
}
