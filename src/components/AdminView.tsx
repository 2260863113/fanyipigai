/**
 * 管理页：用户 / 日志 / 公告 三个视图。
 *
 * **结构、类名与文案照搬「地图记忆」的 `src/ui/adminPanel.ts`**（用户要求这一批功能的
 * UI 完全仿造那个项目），样式来自 `src/styles-map-memory.css`：
 * `.admin-container / admin-heading / admin-tabs / admin-tab(.active) / admin-body /
 *  admin-loading / admin-empty / admin-user-list / admin-user-row / admin-user-name /
 *  admin-user-date / admin-badge-admin / admin-section-title / admin-traffic /
 *  admin-traffic-head / mode-segmented / admin-traffic-unit / admin-traffic-chart /
 *  admin-log-list / log-row / log-time / log-user / log-ua / board-load-more /
 *  admin-ann-form / form-row / row / card-actions / admin-ann-list / admin-ann-row /
 *  admin-ann-main / admin-ann-title / announcement-badge / admin-ann-content /
 *  admin-ann-time / admin-ann-actions / admin-ann-delete`。
 *
 * 与那边不一样的只有两处，都是这边的前置条件：
 *  1. 它没有"用户管理里显示所在地"以外的差别——我们这边没有 hometown 字段，因此不画 `admin-user-loc`。
 *  2. 流量图它用 canvas 画折线；这边**没有引图表库**，就用同样那几个类名画成长条
 *     （`.admin-traffic-chart` 里每根条一个 `.admin-bar`，高度按比例），观感一致、不引依赖。
 *
 * ⚠️ 界面上的 `isAdmin` 判断只是"不给看"：真正的权限在 `requireAdmin` 那一层（见 guard.ts）。
 */

import { useCallback, useEffect, useState, type JSX } from 'react'
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
import { formatTime, shortenUserAgent } from './auth/format'
import { useAuth } from './auth/store'

type AdminTab = 'users' | 'logs' | 'announcements'

const TAB_LABEL: Record<AdminTab, string> = {
  users: '用户管理',
  logs: '日志记录',
  announcements: '发布公告',
}

const RANGE_LABEL: Record<AccessStats['range'], string> = {
  day: '近一天',
  week: '近七天',
  month: '近一个月',
}

export function AdminView(): JSX.Element {
  const auth = useAuth()
  const token = auth.session?.token ?? ''
  const [view, setView] = useState<AdminTab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [logs, setLogs] = useState<AccessLogEntry[]>([])
  const [stats, setStats] = useState<AccessStats | null>(null)
  const [range, setRange] = useState<AccessStats['range']>('week')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pinned, setPinned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setLoading(true)
    try {
      await work()
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!auth.isAdmin) return
    if (view === 'users') {
      void run(async () => setUsers((await adminApi.users(token)).users))
    } else if (view === 'logs') {
      void run(async () => {
        const [logRes, statRes] = await Promise.all([adminApi.logs(token), adminApi.stats(token, range)])
        setLogs(logRes.logs)
        setStats(statRes)
      })
    } else {
      void run(async () => setAnnouncements((await announcementApi.list()).announcements))
    }
  }, [auth.isAdmin, view, range, run, token])

  if (!auth.isAdmin) {
    return (
      <div className="admin-container">
        <h2 className="admin-heading">管理</h2>
        <div className="admin-empty">这里只有管理员能看</div>
      </div>
    )
  }

  const peak = stats ? Math.max(1, ...stats.points.map((point) => point.count)) : 1

  function resetForm(): void {
    setEditingId(null)
    setTitle('')
    setContent('')
    setPinned(false)
  }

  function submitAnnouncement(): void {
    void run(async () => {
      if (editingId === null) {
        await adminApi.createAnnouncement(token, { title, content, pinned })
      } else {
        await adminApi.updateAnnouncement(token, editingId, { title, content, pinned })
      }
      resetForm()
      setAnnouncements((await announcementApi.list()).announcements)
    })
  }

  return (
    <div className="admin-container">
      <h2 className="admin-heading">管理</h2>

      <div className="admin-tabs">
        {(Object.keys(TAB_LABEL) as AdminTab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`admin-tab${view === item ? ' active' : ''}`}
            onClick={() => setView(item)}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>

      <div className="admin-body">
        {loading ? <div className="admin-loading">正在读…</div> : null}
        {!loading && failed ? <div className="admin-empty">读不到数据，刷新再试</div> : null}

        {view === 'users' && !loading && !failed ? (
          <div className="admin-user-list">
            {users.map((user) => (
              <div key={user.id} className="admin-user-row">
                <span className="admin-user-name">{user.username}</span>
                <span className="admin-user-date">{formatTime(user.createdAt)}</span>
                {user.isAdmin ? <span className="admin-badge-admin">管理员</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {view === 'logs' && !loading && !failed ? (
          <>
            <div className="admin-section-title">访问量</div>
            <div className="admin-traffic">
              <div className="admin-traffic-head">
                <div className="mode-segmented">
                  {(Object.keys(RANGE_LABEL) as AccessStats['range'][]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={range === item ? 'active' : undefined}
                      onClick={() => setRange(item)}
                    >
                      {RANGE_LABEL[item]}
                    </button>
                  ))}
                </div>
                <span className="admin-traffic-unit">{stats?.unit === 'hour' ? '每小时' : '每天'}</span>
              </div>
              <div className="admin-traffic-chart">
                {stats?.points.map((point) => (
                  <div key={point.label} className="admin-bar-col" title={`${point.label} · ${point.count} 次`}>
                    <div className="admin-bar" style={{ height: `${Math.round((point.count / peak) * 100)}%` }} />
                  </div>
                ))}
              </div>
              {stats && stats.points.every((point) => point.count === 0) ? (
                <div className="admin-traffic-empty admin-empty">这段时间还没有访问</div>
              ) : null}
            </div>

            <div className="admin-section-title">访问日志</div>
            <div className="admin-log-list">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <div key={log.id} className="log-row">
                    <span className="log-time">{formatTime(log.createdAt)}</span>
                    <span className="log-user">{log.username ?? '游客'}</span>
                    <span className="log-ua" title={log.ua}>
                      {shortenUserAgent(log.ua)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="admin-empty">还没有访问记录</div>
              )}
            </div>
          </>
        ) : null}

        {view === 'announcements' ? (
          <>
            <div className="admin-ann-form">
              <label className="form-row">
                标题
                <input
                  type="text"
                  maxLength={MAX_ANNOUNCEMENT_TITLE}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="form-row">
                正文
                <textarea
                  maxLength={MAX_ANNOUNCEMENT_CONTENT}
                  rows={4}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <label className="row">
                <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                置顶
              </label>
              <div className="card-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={loading || !title.trim() || !content.trim()}
                  onClick={submitAnnouncement}
                >
                  {editingId === null ? '发布' : '保存修改'}
                </button>
                {editingId === null ? null : (
                  <button type="button" className="ghost" onClick={resetForm}>
                    取消
                  </button>
                )}
              </div>
            </div>

            <div className="admin-ann-list">
              {!loading && announcements.length === 0 ? <div className="admin-empty">还没有公告</div> : null}
              {announcements.map((item) => (
                <div key={item.id} className="admin-ann-row">
                  <div className="admin-ann-main">
                    <span className="admin-ann-title">{item.title}</span>
                    {item.pinned ? <span className="announcement-badge">置顶</span> : null}
                    <div className="admin-ann-content">{item.content}</div>
                  </div>
                  <span className="admin-ann-time">{formatTime(item.createdAt)}</span>
                  <div className="admin-ann-actions">
                    <button
                      type="button"
                      className="ghost"
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
                      className="admin-ann-delete"
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
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
