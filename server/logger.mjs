const sensitiveKey = /authorization|cookie|api[-_]?key|token|secret|password|signature|signed|credential/i
const sensitiveQuery = /token|key|signature|sig|auth|expires|credential|policy/i

const redactText = (value) => value
  .replace(/\b(authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/\b(api[-_]?key|token|secret|password|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')

const redactUrl = (value) => {
  try {
    const url = new URL(value)
    for (const key of url.searchParams.keys()) {
      if (sensitiveQuery.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    return url.toString()
  } catch {
    return value
  }
}

export const redactLogValue = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? redactUrl(value) : redactText(value)
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), code: value.code }
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : redactLogValue(item, seen),
  ]))
}

export const createStructuredLogger = ({
  sink = (line) => console.log(line),
  now = () => new Date(),
} = {}) => {
  const write = (level, event, fields = {}) => sink(JSON.stringify(redactLogValue({
    timestamp: now().toISOString(),
    level,
    event,
    ...fields,
  })))
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  }
}
