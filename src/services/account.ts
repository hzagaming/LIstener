export type AccountUser = { id: string; email: string }
export type CloudState = { state: unknown; revision: number; updatedAt: number | null }

export class AccountApiError extends Error {
  code?: string
  current?: CloudState

  constructor(message: string, payload?: { error?: { code?: string }; current?: CloudState }) {
    super(message)
    this.code = payload?.error?.code
    this.current = payload?.current
  }
}

const configuredBase = import.meta.env.VITE_MUSIC_API_BASE?.trim() ?? ''
const baseUrl = configuredBase || (import.meta.env.DEV ? window.location.origin : '')
export const accountAvailable = Boolean(baseUrl)

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  if (!baseUrl) throw new AccountApiError('当前静态版本未连接账号服务')
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    credentials: 'include',
    headers: { Accept: 'application/json', ...options.headers },
  })
  const payload = await response.json().catch(() => null) as T & { error?: { message?: string; code?: string }; current?: CloudState }
  if (!response.ok) throw new AccountApiError(payload?.error?.message || `账号请求失败：${response.status}`, payload)
  return payload
}

export const accountApi = {
  async me() { return request<{ user: AccountUser | null }>('/api/auth/me') },
  async register(email: string, password: string) {
    return request<{ user: AccountUser }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  },
  async login(email: string, password: string) {
    return request<{ user: AccountUser }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  },
  async logout() { return request<{ success: true }>('/api/auth/logout', { method: 'POST' }) },
  async loadState() { return request<CloudState>('/api/user/state') },
  async saveState(state: unknown, revision: number) {
    return request<CloudState>('/api/user/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, revision }),
    })
  },
  async region() {
    return request<{ country: string | null; source: string; storesRawIp: false }>('/api/recommendations/region')
  },
}
