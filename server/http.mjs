import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword, sessionTokenHash, verifyPassword } from './accountStore.mjs'
import { normalizeUserState } from './userState.mjs'
import { pipeAudioDownload } from './audioDownload.mjs'

const writeJson = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

const errorPayload = (code, message) => ({ error: { code, message } })
const versionedPayload = (data, meta) => ({ success: true, data, meta, error: null })
const versionedError = (code, message, meta) => ({
  success: false,
  data: null,
  meta,
  error: { code, message },
})

const bodyError = (message, code) => Object.assign(new Error(message), { code })
const readJson = async (request, maximum = 1_048_576) => {
  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maximum) throw bodyError('request body is too large', 'BODY_TOO_LARGE')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximum) throw bodyError('request body is too large', 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw bodyError('request body must be valid JSON', 'INVALID_BODY')
  }
}

const cookieValue = (request, name) => {
  for (const entry of String(request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return value.join('=')
  }
  return ''
}

const sessionCookie = (token, { secure = false, maxAge }) => [
  `listener_session=${token}`,
  'Path=/api',
  'HttpOnly',
  'SameSite=Lax',
  secure ? 'Secure' : '',
  `Max-Age=${maxAge}`,
].filter(Boolean).join('; ')

const attachmentHeader = (filename) => {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'cover'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

const trackRoute = (pathname) => /^\/api\/music\/tracks\/([^/]+)\/([^/]+)(?:\/(lyrics|playback))?$/.exec(pathname)

const decodePathPart = (value) => {
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return ''
  }
}

export const createApiHandler = ({
  service,
  allowedOrigin = 'http://localhost:5173',
  rateLimit = 60,
  rateWindowMs = 60_000,
  now = Date.now,
  requestId = randomUUID,
  logger,
  accountStore,
  artworkDownloader,
  audioDownloader,
  sessionTtlMs = 30 * 24 * 60 * 60 * 1_000,
  secureCookies = false,
  countryHeader = '',
}) => {
  const clients = new Map()
  const runAbortable = async (request, response, operation) => {
    const controller = new AbortController()
    const abort = () => controller.abort(new Error('client disconnected'))
    const handleClose = () => { if (!response.writableEnded) abort() }
    request.once('aborted', abort)
    response.once('close', handleClose)
    if (request.aborted || response.destroyed) abort()
    try {
      const value = await operation(controller.signal)
      return controller.signal.aborted || response.destroyed ? null : { value }
    } finally {
      request.removeListener('aborted', abort)
      response.removeListener('close', handleClose)
    }
  }
  const streamAudioAttachment = async (request, response, operation, corsHeaders) => {
    const controller = new AbortController()
    const abort = () => controller.abort(new Error('client disconnected'))
    const handleClose = () => { if (!response.writableEnded) abort() }
    request.once('aborted', abort)
    response.once('close', handleClose)
    if (request.aborted || response.destroyed) abort()
    try {
      const { upstream, filename } = await operation(controller.signal)
      response.writeHead(200, {
        ...corsHeaders,
        'Cache-Control': 'no-store',
        'Content-Type': upstream.contentType,
        ...(upstream.contentLength === null ? {} : { 'Content-Length': upstream.contentLength }),
        'Content-Disposition': attachmentHeader(filename),
        'X-Content-Type-Options': 'nosniff',
      })
      try {
        await pipeAudioDownload(upstream, response, controller.signal)
      } catch (error) {
        if (!response.destroyed) response.destroy(error)
      }
    } finally {
      request.removeListener('aborted', abort)
      response.removeListener('close', handleClose)
    }
  }

  return async (request, response) => {
    const id = requestId()
    const startedAt = now()
    response.once('finish', () => logger?.info('music_api_request', {
      requestId: id,
      method: request.method,
      path: request.url?.split('?')[0] ?? '/',
      status: response.statusCode,
      elapsedMs: Math.max(0, now() - startedAt),
    }))
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
      'X-Request-ID': id,
    }
    if (request.method === 'OPTIONS') return writeJson(response, 204, null, corsHeaders)

    const url = new URL(request.url ?? '/', 'http://listener.local')
    const isVersionedRequest = url.pathname.startsWith('/api/music/')
    const requestMeta = (extra = {}) => ({
      request_id: id,
      elapsed_ms: Math.max(0, now() - startedAt),
      ...extra,
    })
    if (!url.pathname.startsWith('/api/')) {
      return writeJson(response, 404, errorPayload('NOT_FOUND', 'route not found'), corsHeaders)
    }
    const versionedTrack = trackRoute(url.pathname)
    const isPlayback = versionedTrack?.[3] === 'playback'
    const isAccountPost = ['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(url.pathname)
    const isStatePut = url.pathname === '/api/user/state'
    if (request.method !== 'GET'
      && !(request.method === 'POST' && (isPlayback || isAccountPost))
      && !(request.method === 'PUT' && isStatePut)) {
      const payload = isVersionedRequest
        ? versionedError('METHOD_NOT_ALLOWED', 'GET is required', requestMeta())
        : errorPayload('METHOD_NOT_ALLOWED', 'GET is required')
      return writeJson(response, 405, payload, corsHeaders)
    }
    if ((isAccountPost || isStatePut) && request.headers.origin !== allowedOrigin) {
      return writeJson(response, 403, errorPayload('ORIGIN_REJECTED', 'request origin is not allowed'), corsHeaders)
    }

    const clientId = request.socket.remoteAddress ?? 'unknown'
    const timestamp = now()
    const client = clients.get(clientId)
    const bucket = !client || client.resetAt <= timestamp
      ? { count: 1, resetAt: timestamp + rateWindowMs }
      : { ...client, count: client.count + 1 }
    if (clients.size >= 10_000) {
      for (const [id, value] of clients) {
        if (value.resetAt <= timestamp) clients.delete(id)
      }
      if (clients.size >= 10_000) clients.delete(clients.keys().next().value)
    }
    clients.set(clientId, bucket)
    if (bucket.count > rateLimit) {
      const payload = isVersionedRequest
        ? versionedError('RATE_LIMITED', 'too many requests', requestMeta())
        : errorPayload('RATE_LIMITED', 'too many requests')
      return writeJson(response, 429, payload, {
        ...corsHeaders,
        'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000))),
      })
    }

    try {
      const meta = requestMeta
      const authenticatedUser = () => {
        if (!accountStore) return null
        const token = cookieValue(request, 'listener_session')
        return token ? accountStore.findSession(sessionTokenHash(token)) : null
      }
      const createSession = (user) => {
        const token = randomBytes(32).toString('base64url')
        accountStore.createSession(user.id, sessionTokenHash(token), now() + sessionTtlMs)
        return token
      }
      if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') {
        if (!accountStore) return writeJson(response, 503, errorPayload('ACCOUNT_UNAVAILABLE', 'account service is unavailable'), corsHeaders)
        const body = await readJson(request)
        const email = typeof body?.email === 'string' ? body.email.trim().toLocaleLowerCase() : ''
        const password = typeof body?.password === 'string' ? body.password : ''
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200) {
          return writeJson(response, 400, errorPayload('INVALID_ACCOUNT', 'valid email and a 12 to 200 character password are required'), corsHeaders)
        }
        let user
        if (url.pathname.endsWith('/register')) {
          user = accountStore.createUser(email, await hashPassword(password))
        } else {
          const record = accountStore.findUserByEmail(email)
          if (!record || !await verifyPassword(password, record.passwordHash)) {
            return writeJson(response, 401, errorPayload('INVALID_CREDENTIALS', 'email or password is incorrect'), corsHeaders)
          }
          user = { id: record.id, email: record.email }
        }
        const token = createSession(user)
        return writeJson(response, url.pathname.endsWith('/register') ? 201 : 200, { user }, {
          ...corsHeaders,
          'Set-Cookie': sessionCookie(token, { secure: secureCookies, maxAge: Math.floor(sessionTtlMs / 1_000) }),
        })
      }
      if (url.pathname === '/api/auth/me') {
        const user = authenticatedUser()
        return writeJson(response, 200, { user }, corsHeaders)
      }
      if (url.pathname === '/api/auth/logout') {
        const token = cookieValue(request, 'listener_session')
        if (token && accountStore) accountStore.deleteSession(sessionTokenHash(token))
        return writeJson(response, 200, { success: true }, {
          ...corsHeaders,
          'Set-Cookie': sessionCookie('', { secure: secureCookies, maxAge: 0 }),
        })
      }
      if (url.pathname === '/api/user/state') {
        const user = authenticatedUser()
        if (!user) return writeJson(response, 401, errorPayload('AUTH_REQUIRED', 'sign in is required'), corsHeaders)
        if (request.method === 'GET') return writeJson(response, 200, accountStore.getUserState(user.id), corsHeaders)
        const body = await readJson(request)
        if (!Number.isInteger(body?.revision) || body.revision < 0) {
          return writeJson(response, 400, errorPayload('INVALID_REVISION', 'revision must be a non-negative integer'), corsHeaders)
        }
        const state = normalizeUserState(body.state)
        return writeJson(response, 200, accountStore.saveUserState(user.id, state, body.revision), corsHeaders)
      }
      if (url.pathname === '/api/recommendations/region') {
        const header = countryHeader ? request.headers[countryHeader.toLocaleLowerCase()] : ''
        const value = Array.isArray(header) ? header[0] : header
        const country = typeof value === 'string' && /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : null
        return writeJson(response, 200, {
          country,
          source: country ? 'trusted-proxy' : 'browser-fallback',
          storesRawIp: false,
        }, corsHeaders)
      }
      if (url.pathname === '/api/artwork') {
        if (!artworkDownloader) return writeJson(response, 503, errorPayload('ARTWORK_UNAVAILABLE', 'artwork download is unavailable'), corsHeaders)
        const source = url.searchParams.get('source')?.trim()
        const trackId = url.searchParams.get('id')?.trim()
        if (!source || !trackId || trackId.length > 256 || !service.sources?.includes(source)) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        const result = await runAbortable(request, response, async (signal) => {
          const track = await service.lookup(source, trackId, signal)
          return artworkDownloader({ source, url: track.cover, title: track.title, signal })
        })
        if (!result) return
        const { bytes, contentType, filename } = result.value
        response.writeHead(200, {
          ...corsHeaders,
          'Cache-Control': 'private, max-age=300',
          'Content-Type': contentType,
          'Content-Length': bytes.byteLength,
          'Content-Disposition': attachmentHeader(filename),
          'X-Content-Type-Options': 'nosniff',
        })
        return response.end(bytes)
      }
      if (url.pathname === '/api/download/file') {
        if (!audioDownloader) return writeJson(response, 503, errorPayload('DOWNLOAD_UNAVAILABLE', 'audio download is unavailable'), corsHeaders)
        const source = url.searchParams.get('source')?.trim()
        const trackId = url.searchParams.get('id')?.trim()
        if (!source || !trackId || trackId.length > 256 || !service.sources?.includes(source)) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        await streamAudioAttachment(request, response, async (signal) => {
          const descriptor = await service.download(source, trackId, signal)
          const upstream = await audioDownloader({ source, url: descriptor.url, signal })
          return { upstream, filename: descriptor.filename }
        }, corsHeaders)
        return
      }
      if (url.pathname === '/api/music/providers') {
        return writeJson(response, 200, versionedPayload({ providers: service.providerDetails ?? [] }, meta()), corsHeaders)
      }
      if (url.pathname === '/api/music/search') {
        const query = url.searchParams.get('q')?.trim()
        const provider = url.searchParams.get('provider')?.trim() || 'all'
        const page = Number(url.searchParams.get('page') ?? 1)
        const pageSize = Number(url.searchParams.get('page_size') ?? 20)
        if (!query || query.length > 100) {
          return writeJson(response, 400, versionedError('INVALID_QUERY', 'q must contain 1 to 100 characters', meta()), corsHeaders)
        }
        if (provider !== 'all' && !service.sources?.includes(provider)) {
          return writeJson(response, 400, versionedError('INVALID_PROVIDER', 'provider is not enabled', meta()), corsHeaders)
        }
        if (!Number.isInteger(page) || page < 1 || page > 100) {
          return writeJson(response, 400, versionedError('INVALID_PAGE', 'page must be between 1 and 100', meta()), corsHeaders)
        }
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
          return writeJson(response, 400, versionedError('INVALID_PAGE_SIZE', 'page_size must be between 1 and 50', meta()), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => service.searchDetailed({
          query,
          provider,
          page,
          pageSize,
        }, signal))
        if (!result) return
        return writeJson(response, 200, versionedPayload({
          query,
          provider,
          page,
          page_size: pageSize,
          has_more: result.value.hasMore,
          items: result.value.tracks,
        }, meta({
          cached: result.value.cached,
          provider_errors: result.value.providerErrors,
        })), corsHeaders)
      }
      if (versionedTrack) {
        const source = decodePathPart(versionedTrack[1])
        const trackId = decodePathPart(versionedTrack[2])
        const operation = versionedTrack[3]
        if (!source || !trackId || trackId.length > 256 || !service.sources?.includes(source)) {
          return writeJson(response, 400, versionedError('INVALID_TRACK', 'provider and track id are required', meta()), corsHeaders)
        }
        if (isPlayback && request.method !== 'POST') {
          return writeJson(response, 405, versionedError('METHOD_NOT_ALLOWED', 'POST is required', meta()), corsHeaders)
        }
        if (!isPlayback && request.method !== 'GET') {
          return writeJson(response, 405, versionedError('METHOD_NOT_ALLOWED', 'GET is required', meta()), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => operation === 'lyrics'
          ? service.lyrics(source, trackId, signal)
          : operation === 'playback'
            ? service.resolve(source, trackId, signal)
            : service.lookup(source, trackId, signal))
        if (!result) return
        const data = operation === 'lyrics'
          ? { lyrics: result.value }
          : operation === 'playback'
            ? { playback: { url: result.value } }
            : { track: result.value }
        return writeJson(response, 200, versionedPayload(data, meta()), corsHeaders)
      }
      if (url.pathname === '/api/health') {
        return writeJson(response, 200, {
          status: 'ok',
          sources: service.sources,
          capabilities: service.sourceCapabilities,
        }, corsHeaders)
      }
      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q')?.trim()
        if (!query) return writeJson(response, 400, errorPayload('INVALID_QUERY', 'q is required'), corsHeaders)
        if (query.length > 100) return writeJson(response, 400, errorPayload('INVALID_QUERY', 'q is too long'), corsHeaders)

        const rawLimit = url.searchParams.get('limit')
        const limit = rawLimit == null ? 20 : Number(rawLimit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          return writeJson(response, 400, errorPayload('INVALID_LIMIT', 'limit must be between 1 and 50'), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => service.search(query, limit, signal))
        if (!result) return
        return writeJson(response, 200, { tracks: result.value }, corsHeaders)
      }
      if (url.pathname === '/api/resolve') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => service.resolve(source, id, signal))
        if (!result) return
        return writeJson(response, 200, { url: result.value }, corsHeaders)
      }
      if (url.pathname === '/api/identify') {
        const input = url.searchParams.get('input')?.trim()
        const source = url.searchParams.get('source')?.trim()
        if (!input) return writeJson(response, 400, errorPayload('INVALID_INPUT', 'input is required'), corsHeaders)
        const match = service.identify(input, source)
        return writeJson(response, 200, { match }, corsHeaders)
      }
      if (url.pathname === '/api/lyrics' || url.pathname === '/api/download') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => url.pathname === '/api/lyrics'
          ? service.lyrics(source, id, signal)
          : service.download(source, id, signal))
        if (!result) return
        return writeJson(response, 200, result.value, corsHeaders)
      }
      if (url.pathname === '/api/track') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        const result = await runAbortable(request, response, (signal) => service.lookup(source, id, signal))
        if (!result) return
        return writeJson(response, 200, { track: result.value }, corsHeaders)
      }
      return writeJson(response, 404, errorPayload('NOT_FOUND', 'route not found'), corsHeaders)
    } catch (error) {
      if (response.destroyed || response.writableEnded) return
      const message = error instanceof Error ? error.message : 'unknown error'
      const isVersioned = isVersionedRequest
      const errorMeta = { request_id: id, elapsed_ms: Math.max(0, now() - startedAt) }
      const writeError = (status, code, safeMessage) => writeJson(
        response,
        status,
        isVersioned ? versionedError(code, safeMessage, errorMeta) : errorPayload(code, safeMessage),
        corsHeaders,
      )
      if (error?.code === 'BODY_TOO_LARGE') return writeError(413, error.code, message)
      if (error?.code === 'INVALID_BODY') return writeError(400, error.code, message)
      if (error?.code === 'ACCOUNT_EXISTS') return writeError(409, error.code, message)
      if (error?.code === 'STATE_CONFLICT') {
        return writeJson(response, 409, { error: { code: error.code, message }, current: error.current }, corsHeaders)
      }
      if (message === 'invalid user state' || message === 'user state is too large') {
        return writeError(message.includes('too large') ? 413 : 400, 'INVALID_USER_STATE', message)
      }
      if (message === 'unknown music source') {
        return writeError(404, 'UNKNOWN_SOURCE', message)
      }
      if (error && typeof error === 'object' && error.code === 'TRACK_NOT_FOUND') {
        return writeError(404, 'TRACK_NOT_FOUND', message)
      }
      if (/^invalid .+ track id$/i.test(message)) {
        return writeError(400, 'INVALID_TRACK', message)
      }
      if ((error && typeof error === 'object' && error.code === 'CAPABILITY_UNAVAILABLE')
        || message.includes('unavailable for this source') || message === 'music source is disabled') {
        return writeError(403, 'CAPABILITY_UNAVAILABLE', message)
      }
      return writeError(502, 'UPSTREAM_FAILED', 'music provider request failed')
    }
  }
}
