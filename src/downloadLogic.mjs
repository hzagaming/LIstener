const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

const escapeXml = (value) => String(value).replace(/[<>&'\"]/g, (character) => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
})[character])

export const artworkFilename = (title, contentType) => {
  const stem = String(title || 'listener').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'listener'
  return `${stem}-cover.${extensions[contentType] || 'img'}`
}

export const builtInArtwork = (theme, title, artist) => {
  const palettes = {
    blue: ['#829dac', '#416075'], field: ['#c5c0a5', '#394a3c'], night: ['#344356', '#161d29'],
    gold: ['#eed292', '#685039'], forest: ['#4d5a48', '#1f2f27'], violet: ['#96758c', '#554b6d'],
    flower: ['#dc8b62', '#4a6653'], coast: ['#a9c2c0', '#6e8e91'], afterwork: ['#6f6670', '#2f3542'],
    radio: ['#d9c596', '#302f2a'], rain: ['#7c8c8c', '#3d4b50'], local: ['#596d68', '#273532'],
  }
  const colors = palettes[theme] || ['#d8d1c3', '#6f6b63']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/><circle cx="600" cy="510" r="265" fill="#181817" opacity=".9"/><circle cx="600" cy="510" r="78" fill="#f1e5ca"/><text x="70" y="1025" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" font-size="72">${escapeXml(title)}</text><text x="73" y="1100" fill="#fff" opacity=".75" font-family="system-ui,sans-serif" font-size="36">${escapeXml(artist)}</text></svg>`
  return { svg, type: 'image/svg+xml' }
}

export const readArtworkResponse = async (response, maximum = 8_388_608) => {
  if (!response.ok) throw new Error('artwork download failed')
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLocaleLowerCase() ?? ''
  if (!extensions[type] || type === 'image/svg+xml') throw new Error('artwork response is not a supported image')
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
  return new Blob(chunks, { type })
}
