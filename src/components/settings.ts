import { useCallback, useState } from 'react'

/**
 * 界面偏好设置。
 *
 * 为什么放在 localStorage 而不是服务端：这两项纯粹是"看着舒服不舒服"，
 * 跟作答内容无关；写进浏览器就够，也免得为它加一张表。
 */
/** 明暗主题的取值：`system` = 跟随系统（用户拍板的默认）。 */
export type ThemeChoice = 'system' | 'light' | 'dark'

export interface ViewSettings {
  /** 正文行距（em 倍数），取值 1–3，默认 1.6（见 DEFAULT_SETTINGS） */
  lineHeight: number
  /** 是否显示"填补内容"的方框（关掉后只留荧光笔底色/弧线） */
  showFixBoxes: boolean
  /** 译文那一栏看哪种视图 */
  answerView: 'correct' | 'compare'
  /**
   * 明暗主题（第 9 条：整站暗夜模式，导航栏最右边那颗按钮切换）。
   *
   * 默认 `system`（用户拍板："跟随系统，手动切过之后记住你的选择"），
   * 手动切过之后存的就是 `light` / `dark`，从此不再看系统脸色——
   * "我按过了"这件事必须比系统设置更硬，否则用户在深色系统上切回浅色，
   * 下一次打开又被系统改回去，那颗按钮看着就是坏的。
   */
  theme: ThemeChoice
}

/**
 * 默认值（用户指定）。
 *
 * 行距范围 **1–3**、默认 **1.6**，并且取消了上一轮"批改视图再翻一倍"那条
 * （那个做法是在旧口径 3 上叠出来的，会把值推到范围之外）。
 * 现在就是"设置里多少就是多少"，批改视图与对照视图共用同一个值。
 */
export const DEFAULT_SETTINGS: ViewSettings = {
  lineHeight: 1.6,
  showFixBoxes: true,
  answerView: 'correct',
  theme: 'system',
}

/**
 * 现在到底用哪套配色：手动选过就听用户的，`system` 才去问系统。
 *
 * 抽成一个纯函数是因为它必须**可测**：`prefers-color-scheme` 在 jsdom 里不存在，
 * 而在真实浏览器里又改不动——把判断与"问系统"这件事分开，测试就能直接喂两个值。
 */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light'
  return choice
}

/** 行距的取值范围（用户指定 1–3）。 */
export const LINE_HEIGHT_RANGE = { min: 1, max: 3, step: 0.1 }

const STORAGE_KEY = 'translation-practice.settings.v1'

function clampLineHeight(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.lineHeight
  return Math.min(LINE_HEIGHT_RANGE.max, Math.max(LINE_HEIGHT_RANGE.min, Math.round(number * 10) / 10))
}

export function loadSettings(): ViewSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ViewSettings>
    return {
      lineHeight: clampLineHeight(parsed.lineHeight),
      showFixBoxes: parsed.showFixBoxes !== false,
      answerView: parsed.answerView === 'compare' ? 'compare' : 'correct',
      // 旧版本存下来的设置里没有 theme：缺它时跟随系统（与默认值一致）
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
    }
  } catch {
    // localStorage 可能被禁用、内容也可能是坏的：一律退回默认值，不打扰用户
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: ViewSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 存不下就算了，本次会话照常生效
  }
}

/** 设置面板的开关 + 修改入口。 */
export function useSettings(): {
  settings: ViewSettings
  update: (patch: Partial<ViewSettings>) => void
  reset: () => void
} {
  const [settings, setSettings] = useState<ViewSettings>(loadSettings)
  const update = useCallback((patch: Partial<ViewSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
  }, [])
  return { settings, update, reset }
}
