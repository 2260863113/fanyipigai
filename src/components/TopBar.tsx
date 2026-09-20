/**
 * 顶栏：站名 + 题型导航 + 「设置」+ 当前这一篇的元信息。
 *
 * 元信息那一组只在练习类页面显示（记录页与收藏页没有"当前这一篇"可言），
 * 因此由调用方通过 `meta` 传进来或传 null。
 */

import type { JSX, ReactNode } from 'react'
import { VISIBLE_MODE_TABS, type Mode } from '../domain/types'

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
        「设置」留在顶栏，**不进文章库那一行**：那一行只在「文章」栏出现，
        而设置（行距、译文视图、是否显示填补文字）是每一栏都要用的，
        放到那里会导致段落/句子/术语栏没有设置入口。
      */}
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
