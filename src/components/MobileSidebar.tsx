/**
 * 手机端的顶栏与侧边栏（第 18 轮）。
 *
 * ## 用户的要求
 *
 * 原话（意思）：「将导航栏的所有东西挪到侧边栏，最上方只保留『翻译批改』这个标题
 * 和它左边的三条横线，点击三条横线可以打开侧边栏，然后进行选择。」
 *
 * 因此最上方那条只剩两样东西：**三条横线**与**标题**。顶栏原先那些东西
 * ——六个导航项（文章 / 句子 / 术语 / 自定义 / 收藏 / 练习记录）、留言板、
 * 账号入口（个人中心 · 修改密码 · 管理三项 · 退出登录）、暗夜模式、设置——
 * **一样都不留在最上面**，全在侧边栏里。侧边栏里的按钮**一个都不少**：
 * 六颗带 `mode-tab` 类名的按钮（文案与 `TopBar` 里那六颗逐字相同），
 * 便于手机端的验收脚本按同一套选择器去点。
 *
 * ## 为什么不是"给 TopBar 加一个 CSS 类"
 *
 * 侧边栏不是"把顶栏横过来"：顶上要多一颗开关（三条横线）、
 * 那六个标签在侧边栏里是竖排的整宽按钮、账号那一组从右上角挪到底部一段。
 * 用一套 DOM 靠媒体查询掰成两种形态，改任何一处都得同时想着两种形态；
 * 分两个组件反而清楚——代价是两边都要维护，因此**账号那一组抽成了
 * `AccountControl.tsx`**（那一组是最容易分家的：菜单开合、点别处收起、退出登录后收起）。
 *
 * ## 三条交互
 *
 * 1. **点任意一项就自动收起**（用户选的）：切完页面侧边栏还挂着会挡住刚打开的那一页；
 * 2. **点背景空白处收起**（用户选的）；
 * 3. **按 Esc 收起**——与顶栏那个账号下拉栏同一条口径（见 `AccountControl.tsx`）。
 *
 * 侧边栏开着时还会把背后的页面锁住不滚（`overflow: hidden` 加在 `<html>` 上）：
 * 手机屏幕上侧边栏之外的区域本来就不该动，加这一条是因为那一层没有顶到屏幕边
 * （留了一条能看到背景的缝），手指在缝上划会带着背后那一页一起滚。
 */

import { useEffect, type JSX } from 'react'
import { VISIBLE_MODE_TABS } from '../domain/types'
import type { PublicUser } from './auth/api'
import type { AdminTab } from './admin-tabs'
import type { NavPanel, NavTab } from './TopBar'
import { AccountControl } from './AccountControl'

export function MobileSidebar({
  open,
  onToggle,
  onClose,
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
  open: boolean
  /** 三条横线按一下：开着就收起、关着就打开（状态在 `App` 那边，见下面对这颗按钮的说明） */
  onToggle: () => void
  onClose: () => void
  tab: NavTab
  /** 当前打开的账号页面；为 null 表示正在练习/记录/收藏那一侧 */
  panel: NavPanel | null
  user: PublicUser | null
  isAdmin: boolean
  onSelectTab: (tab: NavTab) => void
  onSelectPanel: (panel: NavPanel) => void
  onOpenAuth: () => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onChangePassword: () => void
  onOpenAdminView: (view: AdminTab) => void
  onLogout: () => void
  theme: 'light' | 'dark'
}): JSX.Element {
  /* 按 Esc 收起（点背景收起走的是那一层自己的 onClick） */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /*
   * 侧边栏开着时锁住背后的页面。
   *
   * ⚠️ 加在 `<html>` 上、卸载时**原样撤掉**（不写回 `''`）：别的样式表里
   * `html` 本来没有 `overflow` 这一项，写回空串会留下一份"内联样式"，
   * 以后想靠样式表改这一项就改不动了。
   */
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.style.overflow = 'hidden'
    return () => {
      root.style.removeProperty('overflow')
    }
  }, [open])

  /** 点侧边栏里任意一项：先收起，再办事（办事会切页面，侧边栏留着会挡着它） */
  const pick = (work: () => void) => (): void => {
    onClose()
    work()
  }

  return (
    <>
      <header className="topbar topbar-mobile">
        <button
          type="button"
          className="hamburger"
          onClick={onToggle}
          /*
           * 这颗按钮**只负责开合**（开着再点一下就收起）。收起还有三条路：
           * 侧边栏里点任意一项、点背景、按 Esc——`open` 这个状态在 `App` 那边，
           * 因此这里不自己存一份（存两份迟早对不上）。
           */
          aria-label="打开导航"
          aria-expanded={open}
          aria-controls="mobile-sidebar"
          title="打开导航（题型、记录、账号与设置都在里面）"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <h1>翻译批改</h1>
      </header>

      {open && (
        <div className="drawer-backdrop" onClick={onClose} role="presentation">
          <aside
            id="mobile-sidebar"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="导航"
            /* 点侧边栏内部不该收起它——事件冒泡到那一层就会触发 onClick */
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>翻译批改</h2>
              <button type="button" className="drawer-close" onClick={onClose} aria-label="收起导航">
                ×
              </button>
            </div>

            <nav className="drawer-nav" aria-label="题型与记录">
              {VISIBLE_MODE_TABS.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  className={panel === null && item.mode === tab ? 'mode-tab mode-tab-active' : 'mode-tab'}
                  onClick={pick(() => onSelectTab(item.mode))}
                  title={item.hint}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={panel === 'board' ? 'mode-tab mode-tab-active' : 'mode-tab'}
                onClick={pick(() => onSelectPanel('board'))}
                title="留言板"
              >
                留言板
              </button>
            </nav>

            <div className="drawer-foot">
              <AccountControl
                user={user}
                isAdmin={isAdmin}
                panel={panel}
                onOpenAuth={() => pick(onOpenAuth)()}
                onSelectPanel={onSelectPanel}
                onChangePassword={onChangePassword}
                onOpenAdminView={onOpenAdminView}
                onLogout={onLogout}
              />
              <div className="drawer-actions">
                <button
                  type="button"
                  className="btn btn-ghost theme-toggle"
                  onClick={pick(onToggleTheme)}
                  aria-pressed={theme === 'dark'}
                  title={
                    theme === 'dark'
                      ? '切回日间配色（切过之后就按你选的来，不再跟随系统）'
                      : '整站换成暗夜配色（切过之后就按你选的来，不再跟随系统）'
                  }
                >
                  {theme === 'dark' ? '☀ 日间' : '☾ 暗夜'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={pick(onOpenSettings)} title="行距、填补的文字、译文视图">
                  设置
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
