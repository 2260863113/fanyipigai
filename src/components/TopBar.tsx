/**
 * 顶栏：站名 + 题型导航 + 账号区 + 「暗夜 / 设置」。
 *
 * ⚠️ 这里**没有 `meta` 参数了**（第 13 轮）。它原先是"当前这一题的元信息"，最后只剩
 * 「内置示例批改」那一枚警告芯片——用户要求"去掉右上角内置示例批改标志"，于是整枚删掉。
 * `.topbar-right` 本来就是 `margin-left: auto`，因此"把暗夜模式和设置按钮挪到右边"
 * 这条要求不需要改任何布局。
 *
 * ⚠️ 账号那一组（留言板 / 个人中心 / 管理）**不放在 `MODE_TABS` 里**：
 * 那个表是"题型的四个栏位 + 收藏/记录"，会被 last-view 当作"练习位置"记下来；
 * 而留言板这类页面是"去看别的东西"，不该把下次打开的落点抢走
 * （与「记录页与收藏页不记」同一条理由，见 last-view.ts 的注释）。
 */

import type { JSX } from 'react'
import { VISIBLE_MODE_TABS, type Mode } from '../domain/types'
import type { PublicUser } from './auth/api'
import { initialOf } from './auth/format'

/** 顶栏导航的取值：四类题型 + 三个独立页面（它们不是题型）。 */
export type NavTab = Mode | 'records' | 'custom' | 'favorites'

/** 账号那一组页面：留言板人人都能进，个人中心要登录，管理要管理员。 */
export type NavPanel = 'board' | 'profile' | 'admin'

export function TopBar({
  tab,
  panel,
  user,
  isAdmin,
  onSelectTab,
  onSelectPanel,
  onOpenAuth,
  onOpenSettings,
  onToggleTheme,
  theme,
}: {
  tab: NavTab
  /** 当前打开的账号页面；为 null 表示正在练习/记录/收藏那一侧 */
  panel: NavPanel | null
  user: PublicUser | null
  isAdmin: boolean
  onSelectTab: (tab: NavTab) => void
  onSelectPanel: (panel: NavPanel) => void
  /** 没登录时点「登录 / 注册」：打开登录弹窗 */
  onOpenAuth: () => void
  onOpenSettings: () => void
  /** 切换明暗主题（第 9 条）：点了就存下来，下次打开按存下来的那套 */
  onToggleTheme: () => void
  /** **当前实际生效**的主题（可能是跟随系统算出来的），按钮文案由它决定 */
  theme: 'light' | 'dark'
}): JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1>翻译批改</h1>
        <span className="tagline">外研社·国才杯 笔译赛项</span>
      </div>

      <nav className="mode-tabs" aria-label="题型与记录">
        {VISIBLE_MODE_TABS.map((item) => (
          <button
            key={item.mode}
            type="button"
            className={panel === null && item.mode === tab ? 'mode-tab mode-tab-active' : 'mode-tab'}
            onClick={() => onSelectTab(item.mode)}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={panel === 'board' ? 'mode-tab mode-tab-active' : 'mode-tab'}
          onClick={() => onSelectPanel('board')}
          title="留言板"
        >
          留言板
        </button>
        {isAdmin ? (
          <button
            type="button"
            className={panel === 'admin' ? 'mode-tab mode-tab-active' : 'mode-tab'}
            onClick={() => onSelectPanel('admin')}
            title="用户管理、日志与公告"
          >
            管理
          </button>
        ) : null}
      </nav>

      {/*
        右侧四样从右往左：设置 → 暗夜 → 账号。
        前两样的顺序是用户定的（"设置最右边，暗夜次右边"），
        账号按钮放在它们左边，因此**没有动**那两颗的位置。
      */}
      <div className="topbar-right">
        {user ? (
          <button
            type="button"
            className={`btn btn-ghost account-button${panel === 'profile' ? ' account-button-active' : ''}`}
            onClick={() => onSelectPanel('profile')}
            title="个人中心"
          >
            <span className="account-avatar">
              {user.avatar ? <img src={user.avatar.dataUrl} alt="" /> : initialOf(user.username)}
            </span>
            <span className="account-name">{user.username}</span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary account-button" onClick={onOpenAuth} title="登录或注册后才能提交批改">
            登录 / 注册
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost theme-toggle"
          onClick={onToggleTheme}
          aria-pressed={theme === 'dark'}
          title={
            theme === 'dark'
              ? '切回日间配色（切过之后就按你选的来，不再跟随系统）'
              : '整站换成暗夜配色（切过之后就按你选的来，不再跟随系统）'
          }
        >
          {theme === 'dark' ? '☀ 日间' : '☾ 暗夜'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onOpenSettings}
          title="行距、填补的文字、译文视图"
        >
          设置
        </button>
      </div>
    </header>
  )
}
