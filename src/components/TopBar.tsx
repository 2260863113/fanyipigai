/**
 * 顶栏：站名 + 题型导航 + 「暗夜 / 设置」+ 当前这一篇的元信息。
 *
 * 元信息那一组只在练习类页面显示（记录页与收藏页没有"当前这一篇"可言），
 * 因此由调用方通过 `meta` 传进来或传 null。第 9 条之后方向/文体/话题三枚小标签
 * 不再放进来，那一组最多只剩「内置示例批改」这一句提醒。
 */

import type { JSX, ReactNode } from 'react'
import { VISIBLE_MODE_TABS, type Mode } from '../domain/types'

/** 顶栏导航的取值：四类题型 + 三个独立页面（它们不是题型）。 */
export type NavTab = Mode | 'records' | 'custom' | 'favorites'

export function TopBar({
  tab,
  onSelectTab,
  onOpenSettings,
  onToggleTheme,
  theme,
  meta,
}: {
  tab: NavTab
  onSelectTab: (tab: NavTab) => void
  onOpenSettings: () => void
  /** 切换明暗主题（第 9 条）：点了就存下来，下次打开按存下来的那套 */
  onToggleTheme: () => void
  /** **当前实际生效**的主题（可能是跟随系统算出来的），按钮文案由它决定 */
  theme: 'light' | 'dark'
  /** 当前题目的元信息小标签；记录页与收藏页传 null */
  meta: ReactNode
}): JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1>英语翻译练习站</h1>
        <span className="tagline">外研社·国才杯 笔译赛项</span>
      </div>

      <nav className="mode-tabs" aria-label="题型与记录">
        {VISIBLE_MODE_TABS.map((item) => (
          <button
            key={item.mode}
            type="button"
            className={item.mode === tab ? 'mode-tab mode-tab-active' : 'mode-tab'}
            onClick={() => onSelectTab(item.mode)}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/*
        「设置」留在顶栏，**不进任何一条题目横条**：题目横条只在某一栏出现，
        而设置（行距、译文视图、是否显示填补文字）是每一栏都要用的，
        放到那里会导致段落/句子/术语栏没有设置入口。
        暗夜开关挨着它、在它左边（用户第 9 条改过一轮顺序，最后一句是
        "设置最右边，暗夜次右边"）：两颗都是"整站界面"的开关，摆在一起才对得上。
      */}
      <div className="topbar-right">
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

      {meta ? <div className="topbar-right">{meta}</div> : null}
    </header>
  )
}
