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
 *
 * ## 账号区改成一个**下拉栏**（用户第 17 条第 9 条）
 *
 * 用户原话："对于日志管理，用户管理，发布公告，个人中心，修改密码这些内容，
 * 都放到点击个人中心后的下拉栏中，就跟『地图记忆』一样。"
 *
 * 因此：
 *   - 顶栏导航里那颗常驻的「管理」**撤掉了**（它原来是第三样入口，只给管理员看）；
 *   - 登录之后右上角那颗「头像 + 用户名」变成**菜单触发器**：点一下弹出
 *     「个人中心 / 修改密码 /（管理员才有）用户管理 · 日志管理 · 发布公告 / 退出登录」；
 *   - 菜单项的**顺序与名字照「地图记忆」的 `renderMenu()`**
 *     （那边是 profile → changePassword → adminUsers → adminLogs → adminAnnouncements → logout）。
 *
 * 结构与类名也照它：`.user-center-wrap` / `.user-center` / `.user-menu`（见 styles.css 里
 * 那一段"照搬地图记忆"的说明）。**没登录**时仍然是一颗「登录 / 注册」按钮，没有菜单
 * ——那时候菜单里每一项都是灰的，点不动的东西不如不画。
 *
 * ## 菜单怎么关
 *
 * 三条都按它那边的手法：点菜单项、点页面别处、按 Esc。少了"点别处"与 Esc 的话，
 * 菜单会一直挂在屏幕上挡住下面那颗「设置」按钮（实测过）。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { VISIBLE_MODE_TABS, type Mode } from '../domain/types'
import type { PublicUser } from './auth/api'
import { initialOf } from './auth/format'
import { ADMIN_TABS, type AdminTab } from './admin-tabs'

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
  onChangePassword,
  onOpenAdminView,
  onLogout,
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
  /** 下拉栏里的「修改密码」：打开改密码弹窗（第 17 条第 9 条） */
  onChangePassword: () => void
  /** 下拉栏里的三个管理入口：直接落到管理页的那一屏（只有管理员看得到这几项） */
  onOpenAdminView: (view: AdminTab) => void
  onLogout: () => void
  /** **当前实际生效**的主题（可能是跟随系统算出来的），按钮文案由它决定 */
  theme: 'light' | 'dark'
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  /* 点别处、按 Esc 都收起来；菜单开着的时候才挂监听（不然每次点界面都要跑一遍） */
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  /* 退出登录之后菜单不该还开着——那时下拉栏里已经没有一项能点了 */
  useEffect(() => {
    if (!user) setMenuOpen(false)
  }, [user])

  /** 点菜单里的一项：先收起菜单，再办事（办事会切页面，菜单留着会跟着漂过去） */
  const pick = (work: () => void) => (): void => {
    setMenuOpen(false)
    work()
  }

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
      </nav>

      {/*
        右侧四样从右往左：设置 → 暗夜 → 账号。
        前两样的顺序是用户定的（"设置最右边，暗夜次右边"），
        账号按钮放在它们左边，因此**没有动**那两颗的位置。
      */}
      <div className="topbar-right">
        {user ? (
          <div className="user-center-wrap" ref={wrapRef}>
            <button
              type="button"
              className={`btn btn-ghost account-button user-center${panel === 'profile' ? ' account-button-active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              title="个人中心、修改密码与管理入口"
            >
              <span className="account-avatar">
                {user.avatar ? <img src={user.avatar.dataUrl} alt="" /> : initialOf(user.username)}
              </span>
              <span className="account-name">{user.username}</span>
              <span className="account-caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {menuOpen && (
              <div className="user-menu" role="menu" aria-label="账号菜单">
                <button type="button" role="menuitem" onClick={pick(() => onSelectPanel('profile'))}>
                  个人中心
                </button>
                <button type="button" role="menuitem" onClick={pick(onChangePassword)}>
                  修改密码
                </button>
                {/*
                  三项管理入口只给管理员看（与顶栏那颗被撤掉的「管理」同一个判据）。
                  ⚠️ 界面上的判断只是"不给看"：真正的权限在服务端的 `requireAdmin`（见 guard.ts）。
                */}
                {isAdmin &&
                  ADMIN_TABS.map((item) => (
                    <button key={item.id} type="button" role="menuitem" onClick={pick(() => onOpenAdminView(item.id))}>
                      {item.label}
                    </button>
                  ))}
                <button type="button" role="menuitem" className="user-menu-danger" onClick={pick(onLogout)}>
                  退出登录
                </button>
              </div>
            )}
          </div>
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
