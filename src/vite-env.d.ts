/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MUSIC_API_BASE?: string
  readonly VITE_PUBLIC_APPLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
