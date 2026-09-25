/**
 * 管理页：用户管理 + 日志记录。只有 `isAdmin` 的账号进得来（服务端也会再拦一次）。
 *
 * 复用自「地图记忆」的 `ui/adminPanel.ts`：**用户列表只读**（与来源项目一致，
 * 没有封禁/删号——一个练习站用不上，加了反而是风险面），访问日志能看明细，
 * 也能看按天/按小时分桶的流量。
 *
 * ⚠️ 界面上的 `isAdmin` 判断只是"不给看"：真正的权限在 `requireAdmin` 那一层（见 guard.ts）。
 * 前端藏起来的东西，改一行 JS 就能打开；这里从来不是安全边界。
 */

import { useCallback, useEffect, useState, type JSX } from 'react'
import { adminApi, type AccessLogEntry, type AccessStats, type AdminUser } from './auth/api'
import { formatTime, initialOf, shortenUserAgent } from './auth/format'
import { useAuth } from './auth/store'

type AdminTab = 'users' | 'logs'

const RANGE_LABEL: Record<AccessStats['range'], string> = {
  day: '近一天（按小时）',
  week: '近七天（按天）',
  month: '近一个月（按天）',
}

export function AdminView(): JSX.Element {
  const auth = useAuth()
  const token = auth.session?.token ?? ''
  const [tab, setTab] = useState<AdminTab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [logs, setLogs] = useState<AccessLogEntry[]>([])
  const [stats, setStats] = useState<AccessStats | null>(null)
  const [range, setRange] = useState<AccessStats['range']>('week')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadUsers = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setUsers((await adminApi.users(token)).users)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [token])

  const loadLogs = useCallback(
    async (nextRange: AccessStats['range']): Promise<void> => {
      setLoading(true)
      try {
        const [logRes, statRes] = await Promise.all([adminApi.logs(token), adminApi.stats(token, nextRange)])
        setLogs(logRes.logs)
        setStats(statRes)
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (!auth.isAdmin) return
    if (tab === 'users') void loadUsers()
    else void loadLogs(range)
  }, [auth.isAdmin, tab, range, loadUsers, loadLogs])

  if (!auth.isAdmin) {
    return (
      <section className="panel-page">
        <h2 className="panel-title">管理</h2>
        <p className="panel-lead">这个页面只有管理员能看。当前账号不是管理员。</p>
      </section>
    )
  }

  const peak = stats ? Math.max(1, ...stats.points.map((point) => point.count)) : 1

  return (
    <section className="panel-page">
      <h2 className="panel-title">管理</h2>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'users'}
          className={`auth-tab${tab === 'users' ? ' auth-tab-active' : ''}`}
          onClick={() => setTab('users')}
        >
          用户管理
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'logs'}
          className={`auth-tab${tab === 'logs' ? ' auth-tab-active' : ''}`}
          onClick={() => setTab('logs')}
        >
          日志记录
        </button>
      </div>

      {error ? <p className="auth-error">{error}</p> : null}
      {loading ? <p className="panel-lead">正在读…</p> : null}

      {tab === 'users' ? (
        <>
          <p className="panel-lead">
            共 {users.length} 个账号。管理权限没有自助入口，只能由站主用 SQL 指定
            （`UPDATE users SET is_admin = 1 WHERE username = '…'`）。
          </p>
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
        </>
      ) : (
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

          <p className="panel-lead">
            最近 {logs.length} 条访问明细（不含 IP）。登录用户显示名字，未登录显示「游客」。
          </p>
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
      )}
    </section>
  )
}
