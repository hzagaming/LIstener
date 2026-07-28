export const isSafeUrl = (value, { allowEmpty = false, allowBlob = false } = {}) => {
  if (typeof value !== 'string') return false
  if (!value) return allowEmpty
  try {
    const url = new URL(value)
    const protocolAllowed = ['http:', 'https:'].includes(url.protocol) || (allowBlob && url.protocol === 'blob:')
    return protocolAllowed && !url.username && !url.password
  } catch {
    return false
  }
}

const artworkToken = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export const isSafeArtwork = (value) => (
  typeof value === 'string' && (artworkToken.test(value) || isSafeUrl(value))
)
