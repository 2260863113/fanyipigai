/**
 * 登录 / 注册弹窗。
 *
 * 什么时候会出现：用户自己点顶栏的「登录」；或者**按了「提交批改」但没登录**
 * （那时带着 `reason` 进来，把"为什么现在要你登录"写在最上面——不说清楚的话，
 * 用户会以为提交按钮坏了，见 App.tsx 的提交门）。
 *
 * ⚠️ 点「提交」时这里要算一次 PBKDF2（120000 次迭代），在手机上会明显卡一下，
 * 因此按钮上写着"正在计算密码…"——**实测过**：不提示的话用户会以为卡死了，然后再点一次。
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
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 每次打开都从干净状态开始：上一次的密码不该留在输入框里
  useEffect(() => {
    if (!open) return
    setMode(defaultMode)
    setPassword('')
    setConfirm('')
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
    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一样')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') await auth.register(username, password)
      else await auth.login(username, password)
      setPassword('')
      setConfirm('')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'login' ? '登录 翻译批改' : '注册 翻译批改'}
      note={mode === 'login' ? '登录之后才能提交批改' : '注册即可用，不需要邮箱'}
      onClose={onClose}
    >
      {reason ? <p className="auth-reason">{reason}</p> : null}

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={`auth-tab${mode === 'login' ? ' auth-tab-active' : ''}`}
          onClick={() => switchMode('login')}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={`auth-tab${mode === 'register' ? ' auth-tab-active' : ''}`}
          onClick={() => switchMode('register')}
        >
          注册
        </button>
      </div>

      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          <span>用户名</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            maxLength={24}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {mode === 'register' ? (
          <label className="auth-field">
            <span>再输一次</span>
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              maxLength={128}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </label>
        ) : null}

        {error ? <p className="auth-error">{error}</p> : null}

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? '正在计算密码…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>

      <p className="auth-note">
        密码不会明文离开这台设备——浏览器会先做 12 万次 PBKDF2-SHA-256，只把结果发出去。
        登录状态在浏览器里保留 30 天，个人中心里可以退出。
      </p>
    </Modal>
  )
}
