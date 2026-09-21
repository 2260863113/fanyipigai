/**
 * 文章库：随代码进仓库的固定练习材料，按「领域 × 方向」组织。
 *
 * ## 数据从哪来
 *
 * 仓库根目录的《文章.docx》——一份「外研社·国才杯」笔译练习材料，共**五组**，
 * 每组五个板块（社会、经济、文化、生态、科技）、每个板块中译英与英译中各一篇，
 * 每篇都配参考译文。正文由 `scripts/build-articles.mjs` 从 docx 现算，
 * 产出 `articles-data/en-to-zh.ts` 与 `articles-data/zh-to-en.ts` 两个**自动生成**的文件；
 * 本文件保留类型、领域表与全部查询函数，因此别处 `import ... from './articles'` 的写法一个字都不用改。
 *
 * ## 与内置示例题、AI 出题的分工
 *
 * `mock.ts` 是**内置示例题**，每道都带 sampleAnswer（示例作答），用于离线演示与冒烟测试的桩数据；
 * 文章库是**成篇的练习材料**，自带参考译文、没有示例作答。两者用途不同，
 * 混在一起会让"哪道题有桩、哪道没有"变得含糊，因此文章库自成一份，且**只进「文章」栏**。
 *
 * ## 五条约定（见 ADR 0010，改之前先读）
 *
 *   1. **只收五个板块**：社会、经济、文化、生态、科技。赛制的"五位一体"里那个
 *      **政治建设**不在这张表里——用户明确要按手头这份材料收敛，政治、教育强国、
 *      国际传播三个领域已从全站删掉（术语库跟着删了 26 条）。
 *   2. **收录整篇文章，不是选段**，且**自带参考译文**。译文与原文**逐段一一对应**
 *      （段数必须相等，`check-articles.mjs` 逐篇验），因此界面上可以逐段对照。
 *   3. **没有来源媒体、没有 URL**。这些材料不是新闻原文，是围绕 2026 年事件编写的练习材料；
 *      编不出真实链接就不要编（旧口径要求"真实官方媒体 URL"，随 ADR 0010 作废）。
 *      每篇的**「事件锚点」**（`title`）说明它讲的是哪件事，它同时是卡片上的标题与背景说明。
 *   4. **一页 = 一个自然段**（不足 50 单位的自然段与相邻段合并），规则与实现在
 *      `domain/sections.ts` 的 `paginateArticle` 里。
 *   5. **题号里带方向**：`art-<领域>-<方向>-<组号>`，例如 `art-ecology-zh-to-en-3`。
 *      最后一段是**组号**（这份材料是五组，组号比"第几篇"更能说明它从哪来）；
 *      生态 / 英译中 只剩第 1、3、5 组，所以那个格子的组号是有断档的。
 *
 * `units` 是**真实篇幅**：英译中计词数，中译英计汉字数（不含空白）。
 * 界面上显示它（选文章卡片），用户据此知道这一篇有多长。
 */

import type { Direction } from './types'
import { EN_ARTICLES } from './articles-data/en-to-zh'
import { ZH_ARTICLES } from './articles-data/zh-to-en'

/** 五大板块。顺序即界面下拉里的顺序。 */
export const ARTICLE_DOMAINS = [
  { id: 'society', label: '社会' },
  { id: 'economy', label: '经济' },
  { id: 'culture', label: '文化' },
  { id: 'ecology', label: '生态' },
  { id: 'tech', label: '科技' },
] as const

export type ArticleDomain = (typeof ARTICLE_DOMAINS)[number]['id']

const DOMAIN_LABEL: Record<ArticleDomain, string> = Object.fromEntries(
  ARTICLE_DOMAINS.map((domain) => [domain.id, domain.label]),
) as Record<ArticleDomain, string>

export function labelOfDomain(domain: ArticleDomain): string {
  return DOMAIN_LABEL[domain]
}

/** 文章库的一篇。 */
export interface Article {
  /** 题号，与内置题库共用同一套编号空间；前缀 `art-` 便于一眼看出它来自文章库 */
  id: string
  domain: ArticleDomain
  direction: Direction
  /** 这份材料来自文档里的第几组（1–5）。id 的最后一段就是它。 */
  batch: number
  /** 「事件锚点」：这一篇讲的是哪件事。它同时是卡片上的标题与背景说明。 */
  title: string
  /** 正文全文（段落之间用空行分隔，分页时按空行切段） */
  text: string
  /** 参考译文全文，与正文**逐段一一对应**（段数相等） */
  reference: string
  /** 真实篇幅：英译中计词数，中译英计汉字数 */
  units: number
}

/**
 * 文章库正文：每个板块 5 篇英译中 + 5 篇中译英，合计 48 篇（生态英译中只有 3 篇）。
 *
 * 顺序：先英译中、后中译英（`ARTICLES[0]` 曾被当作"打开就能练的一篇"的兜底，
 * 保持英文侧在前，免得启动落点变来变去）。格子内部按组号从小到大。
 *
 * ⚠️ 段落之间**留一个空行**——分页时按空行切自然段，别随手删。
 * 数据本身在 articles-data/ 里，由脚本生成。
 */
export const ARTICLES: readonly Article[] = [...EN_ARTICLES, ...ZH_ARTICLES]

/** 取某个「领域 × 方向」下的全部文章。没有就是空数组。 */
export function articlesOf(domain: ArticleDomain, direction: Direction): readonly Article[] {
  return ARTICLES.filter((item) => item.domain === domain && item.direction === direction)
}

/** 按题号取一篇。 */
export function articleById(id: string): Article | undefined {
  return ARTICLES.find((item) => item.id === id)
}

/**
 * 某个领域在某个方向下有没有文章。
 * 界面用它决定"方向切换"里哪一侧是可点的——没有文章的方向不该让人点进去看空白。
 */
export function hasArticles(domain: ArticleDomain, direction: Direction): boolean {
  return articlesOf(domain, direction).length > 0
}
