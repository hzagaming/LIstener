const integer = (env, name, fallback, minimum, maximum) => {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${name}`)
  }
  return value
}

const boolean = (env, name, fallback = false) => {
  const raw = env[name]?.trim().toLocaleLowerCase()
  if (!raw) return fallback
  if (raw !== 'true' && raw !== 'false') throw new Error(`invalid ${name}`)
  return raw === 'true'
}

const text = (env, name, fallback, maximum = 200) => {
  const value = env[name]?.trim() || fallback
  if (!value || value.length > maximum || /[\r\n]/.test(value)) throw new Error(`invalid ${name}`)
  return value
}

const corsOrigin = (value) => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error()
    }
    return url.origin
  } catch {
    throw new Error('invalid CORS_ORIGIN')
  }
}

const providerList = (value = '') => {
  const providers = [...new Set(value.split(',').map((item) => item.trim().toLocaleLowerCase()).filter(Boolean))]
  if (providers.some((provider) => !/^[a-z0-9-]{1,32}$/.test(provider))) {
    throw new Error('invalid MUSIC_ENABLED_PROVIDERS')
  }
  return providers
}

const databasePath = (value) => {
  const path = value?.trim() || 'data/listener.sqlite'
  if (path.length > 1_024 || /[\r\n\0]/.test(path)) throw new Error('invalid LISTENER_DB_PATH')
  return path
}

const countryHeader = (value) => {
  const header = value?.trim().toLocaleLowerCase() || ''
  if (header && !/^[a-z0-9-]{1,64}$/.test(header)) throw new Error('invalid LISTENER_COUNTRY_HEADER')
  return header
}

export const readMusicConfig = (env = process.env) => {
  const origin = corsOrigin(env.CORS_ORIGIN?.trim() || 'http://localhost:5173')
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: integer(env, 'PORT', 3000, 1, 65_535),
    corsOrigin: origin,
    enabledProviders: providerList(env.MUSIC_ENABLED_PROVIDERS),
    enableFixture: boolean(env, 'ENABLE_LOCAL_FIXTURE'),
    enableNetease: boolean(env, 'ENABLE_NETEASE', true),
    musicBrainzContact: text(env, 'MUSICBRAINZ_CONTACT', 'https://github.com/hzagaming/LIstener'),
    providerTimeoutMs: integer(env, 'MUSIC_PROVIDER_TIMEOUT_MS', 8_000, 100, 30_000),
    responseLimitBytes: integer(env, 'MUSIC_PROVIDER_RESPONSE_LIMIT_BYTES', 2_097_152, 1_024, 10_485_760),
    maxRetries: integer(env, 'MUSIC_MAX_RETRIES', 1, 0, 1),
    maxConcurrentProviders: integer(env, 'MUSIC_MAX_CONCURRENT_PROVIDERS', 4, 1, 10),
    searchCacheTtlMs: integer(env, 'MUSIC_CACHE_TTL_MS', 30_000, 0, 3_600_000),
    operationCacheTtlMs: integer(env, 'MUSIC_OPERATION_CACHE_TTL_MS', 60_000, 0, 3_600_000),
    negativeCacheTtlMs: integer(env, 'MUSIC_NEGATIVE_CACHE_TTL_MS', 5_000, 0, 60_000),
    apiRateLimit: integer(env, 'MUSIC_API_RATE_LIMIT', 60, 1, 1_000),
    databasePath: databasePath(env.LISTENER_DB_PATH),
    sessionTtlMs: integer(env, 'LISTENER_SESSION_TTL_MS', 2_592_000_000, 3_600_000, 31_536_000_000),
    secureCookies: boolean(env, 'LISTENER_SECURE_COOKIES', origin.startsWith('https:')),
    countryHeader: countryHeader(env.LISTENER_COUNTRY_HEADER),
    artworkMaxBytes: integer(env, 'LISTENER_ARTWORK_MAX_BYTES', 8_388_608, 1_024, 20_971_520),
    audioDownloadMaxBytes: integer(env, 'LISTENER_AUDIO_DOWNLOAD_MAX_BYTES', 134_217_728, 1_024, 1_073_741_824),
    audioDownloadTimeoutMs: integer(env, 'LISTENER_AUDIO_DOWNLOAD_TIMEOUT_MS', 120_000, 1_000, 900_000),
  }
}
