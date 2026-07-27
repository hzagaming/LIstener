const defaultMaxLength = 100_000
const timestampPattern = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g
const metadataPattern = /^\[([A-Za-z][\w-]*):(.*)\]$/

const fractionMilliseconds = (value = '') => {
  if (!value) return 0
  if (value.length === 1) return Number(value) * 100
  if (value.length === 2) return Number(value) * 10
  return Number(value.slice(0, 3))
}

const normalizedInput = (value, maxLength) => {
  if (typeof value !== 'string') throw new Error('lyrics must be a string')
  if (value.length > maxLength) throw new Error('lyrics are too long')
  return value.replace(/\r\n?/g, '\n').trim()
}

const result = ({ plain, lrc = '', lines = [], metadata = {} }) => ({
  plain,
  lrc,
  lines,
  language: null,
  translated: null,
  metadata,
})

export const parseLrc = (value, { maxLength = defaultMaxLength } = {}) => {
  const lrc = normalizedInput(value, maxLength)
  const metadata = {}
  const timed = []
  const untimed = []
  let order = 0

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const metadataMatch = metadataPattern.exec(line)
    if (metadataMatch && !/^\d+$/.test(metadataMatch[1])) {
      metadata[metadataMatch[1].toLocaleLowerCase()] = metadataMatch[2].trim()
      continue
    }

    const timestamps = [...line.matchAll(timestampPattern)]
    if (timestamps.length) {
      const text = line.replace(timestampPattern, '').trim()
      for (const match of timestamps) {
        timed.push({
          timeMs: (Number(match[1]) * 60 + Number(match[2])) * 1_000 + fractionMilliseconds(match[3]),
          text,
          order: order += 1,
        })
      }
      continue
    }
    if (!line.startsWith('[')) untimed.push(line)
  }

  const offset = Number(metadata.offset ?? 0)
  const safeOffset = Number.isFinite(offset) ? offset : 0
  const lines = timed
    .map((line) => ({ ...line, timeMs: Math.max(0, line.timeMs + safeOffset) }))
    .sort((left, right) => left.timeMs - right.timeMs || left.order - right.order)
    .map(({ timeMs, text }) => ({ timeMs, text }))
  return result({
    plain: [...lines.map(({ text }) => text), ...untimed].filter(Boolean).join('\n'),
    lrc,
    lines,
    metadata,
  })
}

export const normalizeLyrics = (value, { maxLength = defaultMaxLength } = {}) => {
  const plain = normalizedInput(value, maxLength)
  timestampPattern.lastIndex = 0
  const timed = timestampPattern.test(plain)
  timestampPattern.lastIndex = 0
  if (timed) return parseLrc(plain, { maxLength })
  return result({ plain })
}
