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
 *
 * ## 第 18 轮：这一整排控件在手机上收进侧边栏
 *
 * 手机端（≤600px，见 styles.css 末尾那一段）要求"导航栏的所有东西挪到侧边栏，
 * 最上方只保留标题与三条横线"。因此：
 *   - 本组件在手机上**不渲染**（由 `App` 按 `useIsMobile` 决定），
 *     手机上渲染的是 `MobileSidebar`；
 *   - 账号那一组控件**搬进了 `AccountControl.tsx`**，两处共用同一份
 *     （DOM 与类名逐字没动，桌面端那些盯着 `.user-center` / `.user-menu` 的验收照旧）。
 */

import type { JSX } from 'react'
import { VISIBLE_MODE_TABS, type Mode } from '../domain/types'
import type { PublicUser } from './auth/api'
import type { AdminTab } from './admin-tabs'
import { AccountControl } from './AccountControl'

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
        {/* 账号那一组：登录后是「头像 + 用户名 + 下拉栏」，没登录是一颗「登录 / 注册」 */}
        <AccountControl
          user={user}
          isAdmin={isAdmin}
          panel={panel}
          onOpenAuth={onOpenAuth}
          onSelectPanel={onSelectPanel}
          onChangePassword={onChangePassword}
          onOpenAdminView={onOpenAdminView}
          onLogout={onLogout}
        />
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
