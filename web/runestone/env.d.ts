/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENRELIK_SERVER_URL?: string
  readonly VITE_OPENRELIK_API_VERSION?: string
  /** Comma-separated, e.g. "local,google". */
  readonly VITE_OPENRELIK_AUTH_METHODS?: string
  readonly VITE_USE_MOCK_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
