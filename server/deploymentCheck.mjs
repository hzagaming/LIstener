import { pathToFileURL } from 'node:url'
import { platformSources } from './platforms.mjs'

const productionOrigin = (value, label) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) throw new Error()
    return url.origin
  } catch {
    throw new Error(`${label} must be a credential-free HTTPS origin`)
  }
}

export const verifyMusicDeployment = async ({
  apiBase,
  frontendOrigin,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) => {
  const apiOrigin = productionOrigin(apiBase, 'API origin')
  const allowedOrigin = productionOrigin(frontendOrigin, 'frontend origin')
  const response = await fetchImpl(new URL('/api/health', apiOrigin), {
    cache: 'no-store',
    headers: { Accept: 'application/json', Origin: allowedOrigin },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`health check returned ${response.status}`)
  if (response.headers.get('access-control-allow-origin') !== allowedOrigin) {
    throw new Error('health check returned an invalid CORS origin')
  }
  const payload = await response.json().catch(() => null)
  if (payload?.status !== 'ok' || !Array.isArray(payload.sources)
    || !payload.capabilities || typeof payload.capabilities !== 'object') {
    throw new Error('invalid health response')
  }
  const missing = platformSources.filter((source) => !payload.sources.includes(source)
    || payload.capabilities[source]?.search !== true)
  if (missing.length) throw new Error(`missing searchable sources: ${missing.join(', ')}`)
  return { apiBase: apiOrigin, sources: platformSources }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
  const apiBase = process.argv[2] || process.env.MUSIC_API_BASE_URL
  const frontendOrigin = process.argv[3] || process.env.CORS_ORIGIN || 'https://hzagaming.github.io'
  if (!apiBase) throw new Error('usage: node server/deploymentCheck.mjs <api-origin> [frontend-origin]')
  const result = await verifyMusicDeployment({ apiBase, frontendOrigin })
  console.log(`Verified ${result.apiBase} with ${result.sources.length} searchable sources`)
}
