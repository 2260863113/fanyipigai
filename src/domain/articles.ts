/**
 * 文章库：预置的真实新闻**全文**，按「领域 × 方向」组织。
 *
 * 为什么单独一份数据、而不是塞进 mock.ts：
 * mock.ts 是**内置示例题**，每道都带 sampleAnswer（示例作答），用于离线演示与冒烟测试
 * 的桩数据；文章库是**真实新闻**，没有示例作答，两者用途不同。混在一起会让
 * "哪道题有桩、哪道没有"变得含糊。因此文章库自成一份，且**只进「文章」栏**。
 *
 * 四条约定（见 ADR 0007，改之前先读）：
 *   1. **收录整篇文章，不是选段。** 早先只存"从开头累加到赛制篇幅"的一段，
 *      用户拿到的永远是文章的一部分；现在要求"逐段翻译整篇文章"，因此存全文。
 *      练习时按 **100–200 单位一页**切（英译中计词、中译英计汉字），
 *      规则与实现都在 domain/sections.ts 的 paginateArticle 里。
 *   2. **只收录中国官方媒体**（新华英文、中国日报、CGTN、人民网英文、gov.cn、
 *      china.org.cn / 新华社、人民日报、中国政府网、光明网、求是网、教育部）。
 *      仓库是公开的，把商业媒体（路透、BBC、卫报、AP）的正文存进公开仓库是版权风险。
 *   3. **URL 必须是真的**（用于溯源与人工复核），且段落与标题照抄原文、不做改写——
 *      题库一旦被改写，术语与固定表述的考查就失真了。
 *   4. **正文由脚本抓取**（`scripts/fetch-articles.mjs` / `-zh.mjs`），
 *      产物是两个数据文件，本文件只做汇总与查询。
 *
 * `units` 是**真实篇幅**：英译中计词数，中译英计汉字数（不含空白）。
 * 界面上显示它（选文章卡片），用户据此知道这一篇有多长。
 *
 * ## 数据放在哪
 *
 * 96 篇全文加起来五十多万字符，塞进一个文件既难读也难改，
 * 因此正文按方向分成 `articles-data/en-to-zh.ts` 与 `articles-data/zh-to-en.ts`
 * 两个**自动生成**的文件；本文件保留类型、领域表与全部查询函数，
 * 于是别处 `import ... from './articles'` 的写法一个字都不用改。
 */

import type { Direction } from './types'
import { EN_ARTICLES } from './articles-data/en-to-zh'
import { ZH_ARTICLES } from './articles-data/zh-to-en'

/** 赛制的八个主题域（"五位一体" + 三个延伸）。顺序即界面上的顺序。 */
export const ARTICLE_DOMAINS = [
  { id: 'economy', label: '经济建设' },
  { id: 'politics', label: '政治建设' },
  { id: 'culture', label: '文化建设' },
  { id: 'society', label: '社会建设' },
  { id: 'ecology', label: '生态文明建设' },
  { id: 'tech', label: '科技创新' },
  { id: 'education', label: '教育强国' },
  { id: 'communication', label: '国际传播' },
] as const

export type ArticleDomain = (typeof ARTICLE_DOMAINS)[number]['id']

const DOMAIN_LABEL: Record<ArticleDomain, string> = Object.fromEntries(
  ARTICLE_DOMAINS.map((domain) => [domain.id, domain.label]),
) as Record<ArticleDomain, string>

export function labelOfDomain(domain: ArticleDomain): string {
  return DOMAIN_LABEL[domain]
}

/** 文章库的一篇。`excerpt` 这个名字是历史遗留（早先存的是选段），现在装的是**全文**。 */
export interface ArticleExcerpt {
  /** 题号，与内置题库共用同一套编号空间；前缀 `art-` 便于一眼看出它来自文章库 */
  id: string
  domain: ArticleDomain
  direction: Direction
  /** 真实标题，照抄 */
  title: string
  /** 来源媒体 */
  source: string
  /** 原文链接，供溯源与人工复核 */
  url: string
  /** 正文全文（段落之间用空行分隔，分页时按空行切段） */
  excerpt: string
  /** 真实篇幅：英译中计词数，中译英计汉字数 */
  units: number
}

/**
 * 文章库正文：每个领域 6 篇英译中 + 6 篇中译英，共 96 篇全文。
 *
 * 顺序：先英译中、后中译英（`ARTICLE_EXCERPTS[0]` 曾被当作"打开就能练的一篇"的兜底，
 * 保持英文侧在前，免得启动落点变来变去）。
 *
 * ⚠️ 段落之间**留一个空行**——分页时按空行切自然段，别随手删。
 * 数据本身在 articles-data/ 里，由脚本生成。
 */
export const ARTICLE_EXCERPTS: readonly ArticleExcerpt[] = [...EN_ARTICLES, ...ZH_ARTICLES]

/** 取某个「领域 × 方向」下的全部文章。没有就是空数组。 */
export function articlesOf(domain: ArticleDomain, direction: Direction): readonly ArticleExcerpt[] {
  return ARTICLE_EXCERPTS.filter((item) => item.domain === domain && item.direction === direction)
}

/** 按题号取一篇。 */
export function articleById(id: string): ArticleExcerpt | undefined {
  return ARTICLE_EXCERPTS.find((item) => item.id === id)
}

/**
 * 某个领域在某个方向下有没有文章。
 * 界面用它决定"方向切换"里哪一侧是可点的——没有文章的方向不该让人点进去看空白。
 */
export function hasArticles(domain: ArticleDomain, direction: Direction): boolean {
  return articlesOf(domain, direction).length > 0
}

/** 第一个有文章的「领域 × 方向」，用作界面首次打开时的落点。 */
export function firstAvailable(): { domain: ArticleDomain; direction: Direction } | null {
  const first = ARTICLE_EXCERPTS[0]
  if (!first) return null
  return { domain: first.domain, direction: first.direction }
}
