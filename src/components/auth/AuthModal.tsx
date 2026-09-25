/**
 * 登录 / 注册弹窗。
 *
 * 什么时候出现：用户点顶栏的「登录」；或者**按了「提交批改」但没登录**（那时带着 `reason`，
 * 把"为什么现在要你登录"写在最上面——不说清楚用户会以为按钮坏了，见 App.tsx 的提交门）。
 *
 * **表单的结构、类名与文案照搬「地图记忆」的 `src/ui/authPanel.ts`**（用户要求这一批功能
 * 的 UI 完全仿造那个项目）：`.form-row`（标签与输入框同一行）、`.auth-message`（提示/报错）、
 * `.auth-switch`（去注册 / 返回登录）、`.card-actions` + `.primary` / `.ghost`（按钮）。
 * 那边是侧栏里的一张卡片，这边是弹窗（用户要求"提交时弹出登录/注册窗口"）——
 * 弹窗外壳还是本项目的 `Modal`，**卡片里面的结构与样式照它的来**。
 *
 * 照它做的两个取舍：注册**不填第二遍密码**（它也没有），密码要求写在 `.auth-message` 里；
 * 两边用一个切换按钮互相跳（它的 `auth-go-register` / `auth-register-back`）。
 */

import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Modal } from '../Modal'
import { useAuth } from './store'

export type AuthMode = 'login' | 'register'

export function AuthModal({
  open,
  reason,
  defaultMode = 'login',
  onClose,
}: {
  open: boolean
  /** 被提交门拦下来时的那句话；用户自己点登录时为空 */
  reason?: string | null
  defaultMode?: AuthMode
  onClose: () => void
}): JSX.Element | null {
  const auth = useAuth()
  const [mode, setMode] = useState<AuthMode>(defaultMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 每次打开都从干净状态开始：上一次的密码不该留在输入框里
  useEffect(() => {
    if (!open) return
    setMode(defaultMode)
    setPassword('')
    setError(null)
    setBusy(false)
  }, [open, defaultMode])

  if (!open) return null

  const switchMode = (next: AuthMode): void => {
    setMode(next)
    setError(null)
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') await auth.register(username, password)
      else await auth.login(username, password)
      setPassword('')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'login' ? '登录' : '注册'}
      onClose={onClose}
    >
      <form className="auth-card" onSubmit={submit}>
        {reason ? <p className="auth-reason">{reason}</p> : null}

        <label className="form-row">
          用户名
          <input
            type="text"
            value={username}
            maxLength={24}
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>

        <label className="form-row">
          密码
          <input
            type="password"
            value={password}
            maxLength={128}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <p className="auth-message">{error ?? (mode === 'register' ? '密码至少 6 位' : '')}</p>

        <div className="auth-switch">
          {mode === 'login' ? (
            <button type="button" onClick={() => switchMode('register')}>
              还没有账号？去注册
            </button>
          ) : (
            <button type="button" onClick={() => switchMode('login')}>
              已有账号？返回登录
            </button>
          )}
        </div>

        <div className="card-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? '正在计算密码…' : mode === 'login' ? '登录' : '注册'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  )
}
