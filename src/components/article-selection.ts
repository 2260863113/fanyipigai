/**
 * 文章栏那两栏选择（领域 + 方向）的本地存储。
 *
 * 为什么单独一个文件：与 settings.ts / favorites.ts / custom.ts 同一个存法
 * （localStorage + 形状校验 + 存不下就算了），放一起便于对照；
 * 直接写在组件里会让"存坏了怎么办"这件事散落在界面代码中。
 *
 * 存的东西很少——只有"你上次选的是哪一格"。文章正文与清单随代码进仓库，
 * 本来就不会丢；每篇的作答与批改另有其存储（练习记录）；"上次看到哪一篇、第几页"
 * 另有其存储（`last-view.ts`），因为那件事对句子栏、术语栏同样成立。
 */

import { ARTICLE_BANK_DOMAINS, type ArticleDomain } from '../domain/articles'
import type { Direction } from '../domain/types'

const STORAGE_KEY = 'translation-practice.article-selection.v2'

export interface ArticleSelection {
  domain: ArticleDomain
  direction: Direction
}

/**
 * 打开页面时的落点。**只作为兜底**：正常路径由 `last-view.ts` 记住的那一格说了算，
 * 这一份管的是"没记过 / 记的那一道已经不在了"时落在哪个格子。
 * 按领域表的第一个板块 + 英译中（用户要求：默认落在第一个领域社会 + 英译中）。
 *
 * ⚠️ 这里校验的是**完整表**（含真题/样题）：用户上次选的是"真题"那一格，
 * 下次打开就该回到真题，不该被当成"记的那一格不在了"而退回社会。
 */
export const DEFAULT_SELECTION: ArticleSelection = { domain: ARTICLE_BANK_DOMAINS[0].id, direction: 'en-to-zh' }

function isDomain(value: unknown): value is ArticleDomain {
  return typeof value === 'string' && ARTICLE_BANK_DOMAINS.some((domain) => domain.id === value)
}

function isDirection(value: unknown): value is Direction {
  return value === 'en-to-zh' || value === 'zh-to-en'
}

/**
 * 读出上次的选择。存坏了、没存过、或存的是已经不存在的领域，一律退回默认值——
 * 宁可回到第一格，也不要让界面停在一个空领域上。
 */
export function loadSelection(): ArticleSelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SELECTION
    const parsed = JSON.parse(raw) as Partial<ArticleSelection>
    return {
      domain: isDomain(parsed.domain) ? parsed.domain : DEFAULT_SELECTION.domain,
      direction: isDirection(parsed.direction) ? parsed.direction : DEFAULT_SELECTION.direction,
    }
  } catch {
    // 无痕模式、localStorage 被禁用、内容不是 JSON——一律当作"没存过"
    return DEFAULT_SELECTION
  }
}

/** 存下这次的选择。存不下就算了：这次照样能用，只是下次回到默认那一格。 */
export function saveSelection(selection: ArticleSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    /* 存不下就算了 */
  }
}
