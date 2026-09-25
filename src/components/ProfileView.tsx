/**
 * 个人中心：头像、用户名、改密码、退出，外加一条"这台机器上练了多少次"。
 *
 * 复用自「地图记忆」的 `ui/authPanel.ts`，但**界面是重写的**（那边是原生 DOM，
 * 这里是 React）；沿用它的三件事：改用户名、改头像、改密码要**先算旧密码的哈希**。
 *
 * ⚠️ 最后那条不是多余的一步：会话 token 可能落在别人的设备上，
 * 光有 token 不该能改掉密码（服务端也按这条把关，见 `src/server/profile.ts`）。
 */

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react'
import { compressImage } from './auth/api'
import { initialOf } from './auth/format'
import { useAuth } from './auth/store'

export function ProfileView({
  recordCount,
  onRequireLogin,
  onOpenAdmin,
}: {
  /** 本机（这台浏览器）的练习记录条数——练习记录仍然只存在本地，不跟着账号走 */
  recordCount: number
  onRequireLogin: () => void
  onOpenAdmin: () => void
}): JSX.Element {
  const auth = useAuth()
  const user = auth.user

  const [username, setUsername] = useState(user?.username ?? '')
  const [avatar, setAvatar] = useState<{ dataUrl: string; name: string; size: number; type: string } | null>(null)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) {
    return (
      <section className="panel-page">
        <h2 className="panel-title">个人中心</h2>
        <button type="button" className="btn btn-primary" onClick={onRequireLogin}>
          登录 / 注册
        </button>
      </section>
    )
  }

  const shownAvatar = avatar?.dataUrl ?? user.avatar?.dataUrl ?? null

  async function pickAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setMessage(null)
    try {
      setAvatar(await compressImage(file))
      setMessage('图片已压好，点「保存」才会生效')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    if (newPassword && newPassword !== confirmPassword) {
      setError('两次输入的新密码不一样')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await auth.saveProfile({
        username,
        ...(avatar ? { avatar } : {}),
        ...(newPassword ? { oldPassword, newPassword } : {}),
      })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('已保存')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-page">
      <h2 className="panel-title">个人中心</h2>

      <div className="profile-head">
        <div className="profile-avatar">
          {shownAvatar ? (
            <img src={shownAvatar} alt="头像" />
          ) : (
            <span className="profile-avatar-letter">{initialOf(user.username)}</span>
          )}
        </div>
        <div className="profile-meta">
          <p className="profile-name">
            {user.username}
            {user.isAdmin ? <span className="badge-admin">管理员</span> : null}
          </p>
          <p className="panel-lead">
            注册于 {new Date(user.createdAt).toLocaleDateString('zh-CN')} · 本机 {recordCount} 条练习记录
          </p>
          <div className="profile-actions">
            <label className="btn btn-ghost profile-upload">
              换头像
              <input type="file" accept="image/*" onChange={pickAvatar} hidden />
            </label>
            {user.isAdmin ? (
              <button type="button" className="btn btn-ghost" onClick={onOpenAdmin}>
                用户管理 / 日志
              </button>
            ) : null}
            <button type="button" className="btn btn-danger" onClick={() => auth.logout()}>
              退出登录
            </button>
          </div>
        </div>
      </div>

      <form className="profile-form" onSubmit={save}>
        <fieldset className="profile-section">
          <legend>用户名</legend>
          <input
            type="text"
            value={username}
            maxLength={24}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </fieldset>

        <fieldset className="profile-section">
          <legend>改密码（不改就留空）</legend>
          <input
            type="password"
            value={oldPassword}
            placeholder="旧密码"
            autoComplete="current-password"
            onChange={(event) => setOldPassword(event.target.value)}
          />
          <input
            type="password"
            value={newPassword}
            placeholder="新密码（至少 6 位）"
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <input
            type="password"
            value={confirmPassword}
            placeholder="再输一次新密码"
            autoComplete="new-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </fieldset>

        {error ? <p className="auth-error">{error}</p> : null}
        {message ? <p className="profile-ok">{message}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '正在保存…' : '保存'}
        </button>
      </form>
    </section>
  )
}
