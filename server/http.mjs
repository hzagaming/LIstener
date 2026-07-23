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
        return writeJson(response, 200, { status: 'ok', sources: service.sources }, corsHeaders)
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
        return writeJson(response, 200, { tracks: await service.search(query, limit) }, corsHeaders)
      }
      if (url.pathname === '/api/resolve') {
        const source = url.searchParams.get('source')?.trim()
        const id = url.searchParams.get('id')?.trim()
        if (!source || !id) {
          return writeJson(response, 400, errorPayload('INVALID_TRACK', 'source and id are required'), corsHeaders)
        }
        return writeJson(response, 200, { url: await service.resolve(source, id) }, corsHeaders)
      }
      return writeJson(response, 404, errorPayload('NOT_FOUND', 'route not found'), corsHeaders)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      if (message === 'unknown music source') {
        return writeJson(response, 404, errorPayload('UNKNOWN_SOURCE', message), corsHeaders)
      }
      return writeJson(response, 502, errorPayload('UPSTREAM_FAILED', message), corsHeaders)
    }
  }
}
