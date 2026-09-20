import { useCallback, useState } from 'react'

/**
 * 界面偏好设置。
 *
 * 为什么放在 localStorage 而不是服务端：这两项纯粹是"看着舒服不舒服"，
 * 跟作答内容无关；写进浏览器就够，也免得为它加一张表。
 */
export interface ViewSettings {
  /** 正文行距（em 倍数）。与 styles.css 的 .annotated-lines 一致 */
  lineHeight: number
  /** 是否显示"填补内容"的方框（关掉后只留荧光笔底色/弧线） */
  showFixBoxes: boolean
  /** 译文那一栏看哪种视图 */
  answerView: 'correct' | 'compare'
}

/**
 * 默认行距。
 *
 * 从 2.5 提到 3.0：用户要求"批改后的行间距加大"（他原话是"和练习记录的行间距一样"——
 * 那两处其实是同一个渲染器、同一份设置，从来就是一样的；他要的是**更长**）。
 * 加长之后每一行上方补写的正确写法、以及调序弧线都更不容易挤在一起，读起来也更省力。
 * ⚠️ 这一条会影响 FixLayer 的测量（行距是它算"这一行还放不放得下"的基准），
 * 改它之后必须跑 `npm run smoke` 与 `scripts/probe-fix-align.mjs`。
 */
export const DEFAULT_SETTINGS: ViewSettings = {
  lineHeight: 3,
  showFixBoxes: true,
  answerView: 'correct',
}

export const LINE_HEIGHT_RANGE = { min: 1.8, max: 4, step: 0.1 }

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
