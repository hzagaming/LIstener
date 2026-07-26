const writeJson = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

const errorPayload = (code, message) => ({ error: { code, message } })

export const createApiHandler = ({
  service,
  allowedOrigin = 'http://localhost:5173',
  rateLimit = 60,
  rateWindowMs = 60_000,
  now = Date.now,
}) => {
  const clients = new Map()

  return async (request, response) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      Vary: 'Origin',
    }
    if (request.method === 'OPTIONS') return writeJson(response, 204, null, corsHeaders)

    const url = new URL(request.url ?? '/', 'http://listener.local')
    if (!url.pathname.startsWith('/api/')) {
      return writeJson(response, 404, errorPayload('NOT_FOUND', 'route not found'), corsHeaders)
    }
    if (request.method !== 'GET') {
      return writeJson(response, 405, errorPayload('METHOD_NOT_ALLOWED', 'GET is required'), corsHeaders)
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
      return writeJson(response, 429, errorPayload('RATE_LIMITED', 'too many requests'), {
        ...corsHeaders,
        'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000))),
      })
    }

    try {
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
        const controller = new AbortController()
        const abortSearch = () => controller.abort(new Error('search client disconnected'))
        const handleResponseClose = () => {
          if (!response.writableEnded) abortSearch()
        }
        request.once('aborted', abortSearch)
        response.once('close', handleResponseClose)
        try {
          const tracks = await service.search(query, limit, controller.signal)
          if (controller.signal.aborted || response.destroyed) return
          return writeJson(response, 200, { tracks }, corsHeaders)
        } finally {
          request.removeListener('aborted', abortSearch)
          response.removeListener('close', handleResponseClose)
        }
      }
      if (url.pathname === '/api/resolve') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        const controller = new AbortController()
        const abortResolve = () => controller.abort(new Error('resolve client disconnected'))
        const handleResponseClose = () => {
          if (!response.writableEnded) abortResolve()
        }
        request.once('aborted', abortResolve)
        response.once('close', handleResponseClose)
        try {
          const audioUrl = await service.resolve(source, id, controller.signal)
          if (controller.signal.aborted || response.destroyed) return
          return writeJson(response, 200, { url: audioUrl }, corsHeaders)
        } finally {
          request.removeListener('aborted', abortResolve)
          response.removeListener('close', handleResponseClose)
        }
      }
      if (url.pathname === '/api/identify') {
        const input = url.searchParams.get('input')?.trim()
        const source = url.searchParams.get('source')?.trim()
        if (!input) return writeJson(response, 400, errorPayload('INVALID_INPUT', 'input is required'), corsHeaders)
        const match = service.identify(input, source)
        if (!match) return writeJson(response, 404, errorPayload('UNRECOGNIZED_INPUT', 'music input was not recognized'), corsHeaders)
        return writeJson(response, 200, { match }, corsHeaders)
      }
      if (url.pathname === '/api/lyrics' || url.pathname === '/api/download') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        if (url.pathname === '/api/lyrics') {
          return writeJson(response, 200, await service.lyrics(source, id), corsHeaders)
        }
        return writeJson(response, 200, await service.download(source, id), corsHeaders)
      }
      if (url.pathname === '/api/track') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        return writeJson(response, 200, { track: await service.lookup(source, id) }, corsHeaders)
      }
      return writeJson(response, 404, errorPayload('NOT_FOUND', 'route not found'), corsHeaders)
    } catch (error) {
      if (response.destroyed || response.writableEnded) return
      const message = error instanceof Error ? error.message : 'unknown error'
      if (message === 'unknown music source') {
        return writeJson(response, 404, errorPayload('UNKNOWN_SOURCE', message), corsHeaders)
      }
      if (error && typeof error === 'object' && error.code === 'TRACK_NOT_FOUND') {
        return writeJson(response, 404, errorPayload('TRACK_NOT_FOUND', message), corsHeaders)
      }
      if (/^invalid .+ track id$/i.test(message)) {
        return writeJson(response, 400, errorPayload('INVALID_TRACK', message), corsHeaders)
      }
      if ((error && typeof error === 'object' && error.code === 'CAPABILITY_UNAVAILABLE')
        || message.includes('unavailable for this source')) {
        return writeJson(response, 403, errorPayload('CAPABILITY_UNAVAILABLE', message), corsHeaders)
      }
      return writeJson(response, 502, errorPayload('UPSTREAM_FAILED', message), corsHeaders)
    }
  }
}
