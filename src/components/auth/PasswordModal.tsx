/**
 * 修改密码弹窗（用户第 17 条第 9 条）。
 *
 * 它原先长在**个人中心**那张卡片里（与头像、用户名同一张表单、同一个「保存」按钮）。
 * 用户要求把「修改密码」也搬进个人中心的下拉栏，于是它单独成一件：
 * 三格（旧密码 / 新密码 / 确认新密码）+ 保存 / 取消。
 *
 * **三格与「确认」这一格是照「地图记忆」的 `renderPassword()` 来的**
 * （它那边是 `auth.password.oldPassword / newPassword / confirm` 三格 + 保存 + 取消，
 * 用户要求这一批功能"就跟地图记忆一样"）。卡片内的结构、类名（`.form-row` /
 * `.auth-message` / `.card-actions` + `primary` / `ghost`）与登录弹窗同一套。
 *
 * ⚠️ 密码**从不上网**：旧密码在这里用服务端给的盐算一遍哈希、新密码在这里全新加盐算一遍，
 * 只把两串哈希发给 `/api/auth/profile`（服务端拿旧哈希跟库里的比，见 ADR 0028）。
 * 因此这个弹窗要等两次哈希计算（各 12 万次 PBKDF2），忙的时候按钮上写「正在计算密码…」。
 *
 * ⚠️ 改密码**不会踢掉其它设备上的登录**：会话是浏览器里的 token（`translation_practice.session.v1`），
 * 服务端没有"按用户撤销全部会话"这一步（见 ADR 0028 记的代价）。因此提示语里不写那句话
 * ——写了就是骗人。
 */

import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Modal } from '../Modal'
import { MAX_PASSWORD_LEN, MIN_PASSWORD_LEN } from './api'
import { useAuth } from './store'

export function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const auth = useAuth()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* 每次打开都从空白开始：上一次的密码不该留在框里 */
  useEffect(() => {
    if (!open) return
    setOldPassword('')
    setNewPassword('')
    setConfirm('')
    setMessage(null)
    setError(null)
    setBusy(false)
  }, [open])

  if (!open) return null

  const user = auth.user
  if (!user) {
    /* 没登录时这个弹窗无从谈起（菜单里那一项也只在登录后才画），给一个能走的出口 */
    return (
      <Modal title="修改密码" onClose={onClose}>
        <form className="auth-card" onSubmit={(event) => event.preventDefault()}>
          <p className="auth-message">先登录才能改密码。</p>
          <div className="card-actions">
            <button type="button" className="ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  /* 改密码只改哈希，用户名/头像原样带回（保存接口是三件事一次请求，这两格留空就等于"不动"） */
  const username = user.username

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    /* 「确认」这一格是**客户端**的把关：服务端只认新旧两串哈希，它没参与 */
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一样')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await auth.saveProfile({ username, oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirm('')
      setMessage('密码已改好')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="修改密码" note="只改密码，用户名与头像不动" onClose={onClose}>
      <form className="auth-card" onSubmit={submit}>
        <label className="form-row">
          旧密码
          <input
            type="password"
            value={oldPassword}
            maxLength={MAX_PASSWORD_LEN}
            autoComplete="current-password"
            onChange={(event) => setOldPassword(event.target.value)}
            required
          />
        </label>
        <label className="form-row">
          新密码
          <input
            type="password"
            value={newPassword}
            maxLength={MAX_PASSWORD_LEN}
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>
        <label className="form-row">
          确认新密码
          <input
            type="password"
            value={confirm}
            maxLength={MAX_PASSWORD_LEN}
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </label>

        <p className="auth-message">
          {error ?? message ?? `新密码至少 ${MIN_PASSWORD_LEN} 位；改完用新密码登录（本机这次不用重登）`}
        </p>

        <div className="card-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? '正在计算密码…' : '保存'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  )
}
