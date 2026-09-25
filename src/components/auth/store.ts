/**
 * 登录态：一个模块级的 store + `useAuth()` 钩子。
 *
 * 为什么不用 React Context：这个站的界面是一棵树（App 往下传 props），
 * 而"当前登录的是谁"有十几个地方要用（顶栏、提交门、留言板、个人中心、管理页）。
 * 走 Context 就得把 Provider 塞进树的顶上、再逐层消费；走 `useSyncExternalStore`
 * 则是"谁需要谁订阅"，和现有的 localStorage 类模块（settings/page-state/split-layout）
 * 是同一种写法。
 *
 * 登录凭证存在浏览器里（`localStorage`，键名沿用本站既有的 `translation-practice.` 前缀——
 * 前缀是**数据地址**不是项目名，见 README）。**它不是 HttpOnly cookie**，
 * 因此 XSS 能偷走它——这是这套方案的已知代价，见 ADR 0028。
 */

import { useSyncExternalStore } from 'react'
import {
  ApiFailure,
  authApi,
  cleanUsername,
  hashPassword,
  hashWithSalt,
  validPassword,
  type PasswordHashPayload,
  type PublicUser,
  type UserAvatar,
} from './api'

export interface Session {
  token: string
  user: PublicUser
}

const SESSION_KEY = 'translation-practice.session.v1'

/** 把接口错误翻成人话。界面只显示这里返回的句子，不自己拼。 */
function humanize(error: unknown): string {
  if (!(error instanceof ApiFailure)) return error instanceof Error ? error.message : String(error)
  switch (error.code) {
    case 'username_exists':
      return '这个用户名已经有人用了，换一个吧'
    case 'wrong_password':
      return '用户名或密码不对'
    case 'old_password_wrong':
      return '旧密码不对'
    case 'unauthorized':
      return '登录状态已经失效，请重新登录'
    case 'forbidden':
      return '这个操作需要管理员权限'
    case 'invalid_password_hash':
      return '密码格式不被接受，请换个更长的密码重试'
    case 'network':
      return '连不上服务器，检查一下网络再试'
    default:
      return error.message
  }
}

class AuthStore {
  private session: Session | null
  private listeners = new Set<() => void>()

  constructor() {
    this.session = load()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** `useSyncExternalStore` 要求同一份状态返回**同一个引用**，因此这里存的就是那个对象。 */
  getSnapshot = (): Session | null => this.session

  private commit(session: Session | null): void {
    this.session = session
    try {
      if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      else window.localStorage.removeItem(SESSION_KEY)
    } catch {
      /* 无痕模式、存储被禁：这一次照常能用，只是下次要重新登录 */
    }
    for (const listener of this.listeners) listener()
  }

  async register(username: string, password: string): Promise<void> {
    const name = cleanUsername(username)
    if (!name) throw new Error('请输入用户名')
    if (!/^[^\s].*$/.test(name)) throw new Error('用户名不能以空格开头')
    if (!validPassword(password)) throw new Error('密码至少 6 位')
    const passwordHash = await hashPassword(password)
    const res = await guard(() => authApi.register(name, passwordHash))
    this.commit({ token: res.token, user: res.user })
  }

  async login(username: string, password: string): Promise<void> {
    const name = cleanUsername(username)
    if (!name) throw new Error('请输入用户名')
    if (!password) throw new Error('请输入密码')
    const res = await guard(async () => {
      // 先用服务端给的盐算哈希：盐是每个账号一个，取不到就说明这个用户名还没注册过
      const saltInfo = await authApi.salt(name)
      const payload = await hashWithSalt(password, saltInfo.salt, saltInfo.iterations)
      return authApi.login(name, payload)
    })
    this.commit({ token: res.token, user: res.user })
  }

  logout(): void {
    const token = this.session?.token
    if (token) void authApi.logout(token).catch(() => {})
    this.commit(null)
  }

  /** 打开站点时校验本地凭证：401 就清掉；网络错误保留（下一次请求再说）。 */
  async restore(): Promise<void> {
    const session = this.session
    if (!session) return
    try {
      const res = await authApi.me(session.token)
      this.commit({ token: session.token, user: res.user })
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) this.commit(null)
    }
  }

  /** 个人中心保存：改用户名、换头像、改密码，三件事一次请求。 */
  async saveProfile(input: {
    username: string
    avatar?: UserAvatar | null
    oldPassword?: string
    newPassword?: string
  }): Promise<void> {
    const session = this.session
    if (!session) throw new Error('请先登录')
    const name = cleanUsername(input.username)
    if (!name) throw new Error('请输入用户名')

    const wantsPassword = Boolean(input.oldPassword || input.newPassword)
    let oldPasswordHash: PasswordHashPayload | undefined
    let newPasswordHash: PasswordHashPayload | undefined
    if (wantsPassword) {
      if (!input.oldPassword) throw new Error('请输入旧密码')
      if (!validPassword(input.newPassword ?? '')) throw new Error('新密码至少 6 位')
      const saltInfo = await guard(() => authApi.salt(session.user.username))
      oldPasswordHash = await hashWithSalt(input.oldPassword, saltInfo.salt, saltInfo.iterations)
      newPasswordHash = await hashPassword(input.newPassword ?? '')
    }

    const res = await guard(() =>
      authApi.updateProfile(session.token, {
        username: name,
        ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
        ...(oldPasswordHash ? { oldPasswordHash } : {}),
        ...(newPasswordHash ? { newPasswordHash } : {}),
      }),
    )
    this.commit({ token: session.token, user: res.user })
  }
}

/** 把 `ApiFailure` 翻成人话再抛；其它异常原样传（它们本来就是给人看的）。 */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(humanize(error))
  }
}

function load(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    if (typeof parsed.token !== 'string' || !parsed.token) return null
    if (!parsed.user || typeof parsed.user.username !== 'string') return null
    return { token: parsed.token, user: parsed.user as PublicUser }
  } catch {
    return null
  }
}

export const authStore = new AuthStore()

export interface AuthApi {
  session: Session | null
  user: PublicUser | null
  isAdmin: boolean
  register: (username: string, password: string) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  saveProfile: AuthStore['saveProfile']
}

export function useAuth(): AuthApi {
  const session = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, () => null)
  return {
    session,
    user: session?.user ?? null,
    isAdmin: session?.user.isAdmin ?? false,
    register: (username, password) => authStore.register(username, password),
    login: (username, password) => authStore.login(username, password),
    logout: () => authStore.logout(),
    saveProfile: (input) => authStore.saveProfile(input),
  }
}
