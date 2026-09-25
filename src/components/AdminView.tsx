/**
 * 管理页：用户管理 + 日志记录 + 发布公告。只有 `isAdmin` 的账号进得来（服务端也会再拦一次）。
 *
 * 复用自「地图记忆」的 `ui/adminPanel.ts`（三块都有：用户列表只读、访问日志与流量分桶、
 * 公告的增删改）。界面按 React 重写。
 *
 * ⚠️ 界面上的 `isAdmin` 判断只是"不给看"：真正的权限在 `requireAdmin` 那一层（见 guard.ts）。
 * 前端藏起来的东西，改一行 JS 就能打开；这里从来不是安全边界。
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import {
  MAX_ANNOUNCEMENT_CONTENT,
  MAX_ANNOUNCEMENT_TITLE,
  adminApi,
  announcementApi,
  type AccessLogEntry,
  type AccessStats,
  type AdminUser,
  type Announcement,
} from './auth/api'
import { formatTime, initialOf, shortenUserAgent } from './auth/format'
import { useAuth } from './auth/store'

type AdminTab = 'users' | 'logs' | 'announcements'

const RANGE_LABEL: Record<AccessStats['range'], string> = {
  day: '近一天',
  week: '近七天',
  month: '近一个月',
}

export function AdminView(): JSX.Element {
  const auth = useAuth()
  const token = auth.session?.token ?? ''
  const [tab, setTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [logs, setLogs] = useState<AccessLogEntry[]>([])
  const [stats, setStats] = useState<AccessStats | null>(null)
  const [range, setRange] = useState<AccessStats['range']>('week')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pinned, setPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setLoading(true)
    try {
      await work()
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(
    () => run(async () => setUsers((await adminApi.users(token)).users)),
    [run, token],
  )
  const loadLogs = useCallback(
    (nextRange: AccessStats['range']) =>
      run(async () => {
        const [logRes, statRes] = await Promise.all([adminApi.logs(token), adminApi.stats(token, nextRange)])
        setLogs(logRes.logs)
        setStats(statRes)
      }),
    [run, token],
  )
  const loadAnnouncements = useCallback(
    () => run(async () => setAnnouncements((await announcementApi.list()).announcements)),
    [run],
  )

  useEffect(() => {
    if (!auth.isAdmin) return
    if (tab === 'users') void loadUsers()
    else if (tab === 'logs') void loadLogs(range)
    else void loadAnnouncements()
  }, [auth.isAdmin, tab, range, loadUsers, loadLogs, loadAnnouncements])

  if (!auth.isAdmin) {
    return (
      <section className="panel-page">
        <h2 className="panel-title">管理</h2>
      </section>
    )
  }

  const peak = stats ? Math.max(1, ...stats.points.map((point) => point.count)) : 1

  function resetForm(): void {
    setEditingId(null)
    setTitle('')
    setContent('')
    setPinned(false)
  }

  function submitAnnouncement(event: FormEvent): void {
    event.preventDefault()
    const payload = { title, content, pinned }
    void run(async () => {
      if (editingId === null) {
        const res = await adminApi.createAnnouncement(token, payload)
        setAnnouncements((previous) => [res.announcement, ...previous])
      } else {
        const res = await adminApi.updateAnnouncement(token, editingId, payload)
        setAnnouncements((previous) => previous.map((item) => (item.id === editingId ? res.announcement : item)))
      }
      resetForm()
      await loadAnnouncements()
    })
  }

  return (
    <section className="panel-page">
      <h2 className="panel-title">管理</h2>

      <div className="auth-tabs" role="tablist">
        {(
          [
            ['users', '用户管理'],
            ['logs', '日志记录'],
            ['announcements', '发布公告'],
          ] as Array<[AdminTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`auth-tab${tab === key ? ' auth-tab-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="auth-error">{error}</p> : null}
      {loading ? <p className="panel-lead">正在读…</p> : null}

      {tab === 'users' ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>用户</th>
              <th>身份</th>
              <th>注册时间</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>
                  <span className="board-avatar board-avatar-small">
                    {user.avatar ? <img src={user.avatar} alt="" /> : initialOf(user.username)}
                  </span>
                  {user.username}
                </td>
                <td>{user.isAdmin ? <span className="badge-admin">管理员</span> : '普通用户'}</td>
                <td>{formatTime(user.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {tab === 'logs' ? (
        <>
          <div className="admin-range">
            {(Object.keys(RANGE_LABEL) as Array<AccessStats['range']>).map((item) => (
              <button
                key={item}
                type="button"
                className={`btn btn-ghost${range === item ? ' btn-active' : ''}`}
                onClick={() => setRange(item)}
              >
                {RANGE_LABEL[item]}
              </button>
            ))}
          </div>

          {stats ? (
            <ul className="admin-chart">
              {stats.points.map((point) => (
                <li key={point.label} className="admin-bar-row">
                  <span className="admin-bar-label">{point.label.slice(-5)}</span>
                  <span className="admin-bar-track">
                    <span className="admin-bar" style={{ width: `${Math.round((point.count / peak) * 100)}%` }} />
                  </span>
                  <span className="admin-bar-count">{point.count}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>谁</th>
                <th>设备</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.id}</td>
                  <td>{log.username ?? '游客'}</td>
                  <td title={log.ua}>{shortenUserAgent(log.ua)}</td>
                  <td>{formatTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {tab === 'announcements' ? (
        <>
          <form className="announce-form" onSubmit={submitAnnouncement}>
            <input
              type="text"
              value={title}
              maxLength={MAX_ANNOUNCEMENT_TITLE}
              placeholder={`标题（≤${MAX_ANNOUNCEMENT_TITLE} 字）`}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
            <textarea
              value={content}
              maxLength={MAX_ANNOUNCEMENT_CONTENT}
              rows={5}
              placeholder={`正文（≤${MAX_ANNOUNCEMENT_CONTENT} 字）`}
              onChange={(event) => setContent(event.target.value)}
              required
            />
            <div className="announce-form-foot">
              <label className="gen-check">
                <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                置顶
              </label>
              <div className="announce-form-buttons">
                {editingId === null ? null : (
                  <button type="button" className="btn btn-ghost" onClick={resetForm}>
                    取消编辑
                  </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={loading || !title.trim() || !content.trim()}>
                  {editingId === null ? '发布' : '保存修改'}
                </button>
              </div>
            </div>
          </form>

          <ul className="announce-list">
            {announcements.map((item) => (
              <li key={item.id} className="announce-item">
                <div className="announce-head">
                  <span className="announce-title">{item.title}</span>
                  {item.pinned ? <span className="badge-admin">置顶</span> : null}
                  <span className="board-time">{formatTime(item.createdAt)}</span>
                  <div className="announce-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setEditingId(item.id)
                        setTitle(item.title)
                        setContent(item.content)
                        setPinned(item.pinned)
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() =>
                        void run(async () => {
                          await adminApi.deleteAnnouncement(token, item.id)
                          setAnnouncements((previous) => previous.filter((one) => one.id !== item.id))
                          if (editingId === item.id) resetForm()
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="announce-content">{item.content}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
