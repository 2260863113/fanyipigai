/**
 * 顶栏：站名 + 题型导航 + 「设置」+ 当前这一篇的元信息。
 *
 * 元信息那一组只在练习类页面显示（记录页与收藏页没有"当前这一篇"可言），
 * 因此由调用方通过 `meta` 传进来或传 null。
 */

import type { JSX, ReactNode } from 'react'
import { MODE_TABS, type Mode } from '../domain/types'

/** 顶栏导航的取值：四类题型 + 三个独立页面（它们不是题型）。 */
export type NavTab = Mode | 'records' | 'custom' | 'favorites'

export function TopBar({
  tab,
  onSelectTab,
  onOpenSettings,
  meta,
}: {
  tab: NavTab
  onSelectTab: (tab: NavTab) => void
  onOpenSettings: () => void
  /** 当前题目的方向/文体/领域等小标签；记录页与收藏页传 null */
  meta: ReactNode
}): JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1>英语翻译练习站</h1>
        <span className="tagline">外研社·国才杯 笔译赛项</span>
      </div>

      <nav className="mode-tabs" aria-label="题型与记录">
        {MODE_TABS.map((item) => (
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

      <div className="topbar-right">
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
