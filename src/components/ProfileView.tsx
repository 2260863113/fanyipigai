/**
 * 个人中心：头像、用户名、保存。
 *
 * **结构与类名照搬「地图记忆」的 `src/ui/authPanel.ts`** 的"个人资料"那一屏
 * （用户要求这一批功能的 UI 完全仿造那个项目）：`.profile-avatar-row` + `.user-avatar.profile-avatar`
 * + `.avatar-upload`、`.form-row`（标签与输入框同行）、`.card-actions` + `.primary` / `.ghost`。
 * 样式来自 `src/styles-map-memory.css`。
 *
 * 与那边**不一样**的两处，都是这边的前置条件：
 *  1. 它还有"所在省 / 市"两个联动输入（`location-grid` / `auth-select-wrap`）——本项目没有 hometown 字段，不画。
 *  2. 退出登录与"本机练习记录条数"是这边加的一行（`.card-actions` 里那颗 `ghost`）。
 *
 * ⚠️ 第 17 条第 9 条起这一屏**只剩"改名字 + 换头像"**：
 *   - 「旧密码 / 新密码」两格搬到了下拉栏的「修改密码」里（`PasswordModal`），
 *     与「地图记忆」一样单独一件——它那边个人资料卡里也没有密码格；
 *   - 原来那颗「管理」按钮也撤了（管理三屏现在都在下拉栏里）。
 *   因此这一屏的「保存」只提交用户名与头像，密码一个字都不碰（`saveProfile` 里那两格是可选的）。
 */

import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react'
import { compressImage } from './auth/api'
import { initialOf } from './auth/format'
import { useAuth } from './auth/store'

export function ProfileView({
  recordCount,
  onRequireLogin,
}: {
  /** 本机（这台浏览器）的练习记录条数 */
  recordCount: number
  onRequireLogin: () => void
}): JSX.Element {
  const auth = useAuth()
  const user = auth.user

  const [username, setUsername] = useState(user?.username ?? '')
  const [avatar, setAvatar] = useState<{ dataUrl: string; name: string; size: number; type: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) {
    return (
      <div className="admin-container">
        <h2 className="admin-heading">个人中心</h2>
        <div className="card-actions">
          <button type="button" className="primary" onClick={onRequireLogin}>
            登录 / 注册
          </button>
        </div>
      </div>
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
      setMessage('图片已压好，点「保存」生效')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await auth.saveProfile({ username, ...(avatar ? { avatar } : {}) })
      setMessage('已保存')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-container">
      <h2 className="admin-heading">个人中心</h2>

      <form className="auth-card" onSubmit={save}>
        <div className="profile-avatar-row">
          <div
            className="user-avatar profile-avatar"
            style={shownAvatar ? { backgroundImage: `url(${shownAvatar})` } : undefined}
          >
            {shownAvatar ? '' : initialOf(user.username)}
          </div>
          <label className="avatar-upload">
            换头像
            <input type="file" accept="image/*" onChange={pickAvatar} />
          </label>
        </div>

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

        <p className="auth-message">{error ?? message ?? `本机 ${recordCount} 条练习记录`}</p>

        <div className="card-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存'}
          </button>
          <button type="button" className="ghost" onClick={() => auth.logout()}>
            退出登录
          </button>
        </div>
      </form>
    </div>
  )
}
