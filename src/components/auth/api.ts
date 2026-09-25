/**
 * 账号、留言板、管理接口的前端封装，以及**浏览器端**的密码哈希。
 *
 * 复用自「地图记忆」的 `src/api.ts` 与 `src/authStore.ts`（哈希那一段），改写要点：
 * - 这里只保留这个站用得到的接口（那边还有排行榜、公告、家乡）；
 * - 失败统一抛 `ApiFailure`，把服务端的 `{ error: { code, message } }` 原样带出来，
 *   由 `store.ts` 翻成人话——**界面不该自己拼错误文案**，否则同一个错会在几处写得不一样。
 *
 * ⚠️ 密码**从不上网**：注册时在浏览器里随机取盐、算 PBKDF2，只把结果发给服务端；
 * 登录时先要服务端返回盐，再在这里算一遍。服务端因此永远拿不到明文（见 ADR 0028）。
 */

export interface UserAvatar {
  dataUrl: string
  name: string
  size: number
  type: string
}

export interface PublicUser {
  username: string
  avatar: UserAvatar | null
  isAdmin: boolean
  createdAt: number
  updatedAt: number
}

export interface PasswordHashPayload {
  algorithm: 'PBKDF2-SHA-256'
  salt: string
  hash: string
  iterations: number
}

export interface BoardReply {
  id: number
  postId: number
  content: string
  createdAt: number
  username: string
  avatar: string | null
}

export interface BoardPost {
  id: number
  content: string
  createdAt: number
  username: string
  avatar: string | null
  replyCount: number
  replies: BoardReply[]
}

export interface AdminUser {
  id: number
  username: string
  avatar: string | null
  isAdmin: boolean
  createdAt: number
}

export interface AccessLogEntry {
  id: number
  username: string | null
  ua: string
  createdAt: number
}

export interface TrafficPoint {
  label: string
  count: number
}

export interface AccessStats {
  range: 'day' | 'week' | 'month'
  unit: 'hour' | 'day'
  points: TrafficPoint[]
}

/** 与 `src/server/limits.ts`、`src/server/validate.ts` 必须一致（两处一起改） */
export const HASH_ITERATIONS = 120_000
export const MIN_PASSWORD_LEN = 6
export const MAX_PASSWORD_LEN = 128
export const MAX_POST_LEN = 200
export const MAX_REPLY_LEN = 100

/** 接口失败。`status` 为 0 表示根本没连上（网络层）。 */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    throw new ApiFailure(0, 'network', `连不上服务器：${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new ApiFailure(response.status, 'bad_response', `服务器返回了看不懂的内容（HTTP ${response.status}）`)
  }

  if (!response.ok) {
    const failure = (parsed ?? {}) as { error?: { code?: string; message?: string } }
    throw new ApiFailure(
      response.status,
      failure.error?.code ?? 'http_error',
      failure.error?.message ?? `请求失败（HTTP ${response.status}）`,
    )
  }
  return parsed as T
}

export const authApi = {
  salt: (username: string) =>
    request<{ salt: string; iterations: number }>('/api/auth/salt', { method: 'POST', body: { username } }),
  register: (username: string, passwordHash: PasswordHashPayload) =>
    request<{ token: string; user: PublicUser }>('/api/auth/register', { method: 'POST', body: { username, passwordHash } }),
  login: (username: string, passwordHash: PasswordHashPayload) =>
    request<{ token: string; user: PublicUser }>('/api/auth/login', { method: 'POST', body: { username, passwordHash } }),
  logout: (token: string) => request<{ ok: true }>('/api/auth/logout', { method: 'POST', token }),
  me: (token: string) => request<{ user: PublicUser }>('/api/auth/me', { token }),
  updateProfile: (
    token: string,
    payload: {
      username: string
      avatar?: UserAvatar | null
      oldPasswordHash?: PasswordHashPayload
      newPasswordHash?: PasswordHashPayload
    },
  ) => request<{ user: PublicUser }>('/api/auth/profile', { method: 'POST', token, body: payload }),
}

export const boardApi = {
  list: (limit = 20) => request<{ posts: BoardPost[] }>(`/api/board?limit=${limit}`),
  replies: (postId: number, before = 0, limit = 50) =>
    request<{ replies: BoardReply[] }>(`/api/board?post=${postId}&before=${before}&limit=${limit}`),
  createPost: (token: string, content: string) =>
    request<{ post: BoardPost }>('/api/board', { method: 'POST', token, body: { content } }),
  deletePost: (token: string, id: number) => request<{ ok: true }>(`/api/board/${id}`, { method: 'DELETE', token }),
  createReply: (token: string, postId: number, content: string) =>
    request<{ reply: BoardReply }>('/api/board/reply', { method: 'POST', token, body: { postId, content } }),
  deleteReply: (token: string, id: number) =>
    request<{ ok: true }>(`/api/board/reply/${id}`, { method: 'DELETE', token }),
}

export const adminApi = {
  users: (token: string) => request<{ users: AdminUser[] }>('/api/admin/users', { token }),
  logs: (token: string, before = 0) => request<{ logs: AccessLogEntry[] }>(`/api/admin/logs?before=${before}`, { token }),
  stats: (token: string, range: 'day' | 'week' | 'month') =>
    request<AccessStats>(`/api/admin/logs?view=stats&range=${range}`, { token }),
}

/** 访问上报：不 await、失败也不打扰用户（它只是统计）。 */
export function reportVisit(token: string | null): void {
  void request<{ ok: true }>('/api/visit', { method: 'POST', token }).catch(() => {})
}

/** 用户名归一化：与 `src/server/validate.ts` 的 cleanUsername **逐字一致**。 */
export function cleanUsername(username: unknown): string {
  return typeof username === 'string' ? username.trim().replace(/\s+/g, ' ').slice(0, 24) : ''
}

export function validPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LEN && password.length <= MAX_PASSWORD_LEN
}

function textBytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', textBytes(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i)
  return out as Uint8Array<ArrayBuffer>
}

/** 注册 / 改密码：新随机盐 + 完整哈希。 */
export async function hashPassword(password: string): Promise<PasswordHashPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt as Uint8Array<ArrayBuffer>, HASH_ITERATIONS)
  return {
    algorithm: 'PBKDF2-SHA-256',
    salt: bytesToBase64(salt),
    hash: bytesToBase64(new Uint8Array(hash)),
    iterations: HASH_ITERATIONS,
  }
}

/** 登录：用服务端给的盐重算一遍。 */
export async function hashWithSalt(password: string, saltB64: string, iterations: number): Promise<PasswordHashPayload> {
  const hash = await derive(password, base64ToBytes(saltB64), iterations)
  return { algorithm: 'PBKDF2-SHA-256', salt: saltB64, hash: bytesToBase64(new Uint8Array(hash)), iterations }
}

/**
 * 把用户选的图片压成一张 **≤20KB 的 dataUrl**。
 *
 * 为什么要在前端压：头像直接存进 D1 的 TEXT 列，原图动辄几 MB，全站列表一拉就是几 MB。
 * 压缩口径与 `src/server/profile.ts` 的上限对齐（20KB），否则会出现"看着能传、服务端拒收"。
 * 先缩边长再逐档降质量，两轮都收敛不了就报错让用户换一张。
 */
export async function compressImage(file: File): Promise<UserAvatar> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读不到这张图片'))
    reader.readAsDataURL(file)
  })

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('这张图片打不开'))
    element.src = dataUrl
  })

  const maxSide = 256
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('这个浏览器画不了图（拿不到 canvas）')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const jpeg = canvas.toDataURL('image/jpeg', quality)
    const size = Math.round((jpeg.length - 'data:image/jpeg;base64,'.length) * 0.75)
    if (size <= 20 * 1024) {
      return { dataUrl: jpeg, name: file.name, size, type: 'image/jpeg' }
    }
  }
  throw new Error('这张图压不到 20KB 以内，换一张小一点的吧')
}
