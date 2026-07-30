type NamedFile = Pick<File, 'name' | 'type'>

export const localFileStem: (name: string) => string
export const selectLocalAudioFiles: <T extends NamedFile>(files: T[], limit?: number) => T[]
export const readLocalLyrics: (file: Pick<File, 'slice'>, maxBytes?: number) => Promise<string>
