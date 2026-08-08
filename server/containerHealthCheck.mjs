const port = process.env.PORT?.trim() || '3000'

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(4_000),
  })
  const payload = response.ok ? await response.json() : null
  if (payload?.status !== 'ok') process.exitCode = 1
} catch {
  process.exitCode = 1
}
