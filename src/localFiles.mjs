const AUDIO_EXTENSION = /\.(?:aac|aiff?|alac|flac|m4a|mp3|ogg|opus|wav|webm)$/i

export const localFileStem = (name) => String(name).replace(/\.[^.]+$/, '').toLocaleLowerCase()

export const selectLocalAudioFiles = (files, limit = 100) => files
  .filter((file) => !/\.lrc$/i.test(String(file.name))
    && (String(file.type).startsWith('audio/') || AUDIO_EXTENSION.test(String(file.name))))
  .slice(0, Number.isSafeInteger(limit) && limit > 0 ? limit : 100)

export const readLocalLyrics = async (file, maxBytes = 500_000) => {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 500_000
  return (await file.slice(0, limit).text()).slice(0, limit)
}
