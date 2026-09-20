/**
 * 句子题：从**该领域文章里切出来的单句**当题目。
 *
 * ## 为什么从文章切，而不是另备一套句子
 *
 * 用户的要求是「句子模式可以选领域（不能选文章），出题就从这些文章里面挑选句子」。
 * 好处是句子**自带真实语境**——它就是从某篇真实新闻里来的，不是为出题硬造的；
 * 而文章库本来就只有 48 篇，再单独维护一套句子会多一份要同步的数据。
 *
 * ## 为什么切句是本地做的、且必须确定性
 *
 * 切句用 domain/compare.ts 里那个已经用了一路的 splitSentences（按句末标点切、
 * 返回字符区间），不调 AI：不花钱、不用等，而且**同一个题号永远得到同一个句子**——
 * 否则用户写了一半切走，回来发现题目换了。
 *
 * ## 题号
 *
 * 形如 `sentence-<领域>-<第几条>`，例如 `sentence-ecology-3`。
 * 题号是本站的通用键（作答、结果、练习记录、收藏都按它索引），
 * 因此把领域与序号编进去，那些下游功能一行都不用改。
 */

import type { Direction, Exercise } from './types'
import {
  ARTICLE_DOMAINS,
  ARTICLE_EXCERPTS,
  labelOfDomain,
  type ArticleDomain,
  type ArticleExcerpt,
} from './articles'
import { splitSentences } from './compare'

/** 句子题里，句子长于这个长度才值得练——太短的没有可译的东西。 */
const MIN_SENTENCE_CHARS = 20

const DOMAIN_IDS: readonly ArticleDomain[] = ARTICLE_DOMAINS.map((domain) => domain.id)

function isDomain(value: string): value is ArticleDomain {
  return (DOMAIN_IDS as readonly string[]).includes(value)
}

/** 一句挑出来的句子，连同它来自哪一篇（界面上要如实标出来）。 */
export interface SentenceItem {
  /** 句子本身 */
  text: string
  /** 出自哪一篇（给界面显示来源用） */
  from: ArticleExcerpt
  /** 在该篇里的序号（第几句） */
  indexInArticle: number
}

/**
 * 把一篇文章切成可用的句子。
 *
 * 只保留达到最短长度的句子：真实新闻里有不少几字的小标题式短句
 * （"生产稳。"这种），拿它们当翻译题没有训练价值。
 */
function sentencesOfArticle(article: ArticleExcerpt): SentenceItem[] {
  return splitSentences(article.excerpt)
    .map(({ start, end }) => article.excerpt.slice(start, end).trim())
    .filter((text) => [...text].length >= MIN_SENTENCE_CHARS)
    .map((text, indexInArticle) => ({ text, from: article, indexInArticle }))
}

/** 某个领域下的文章（各方向都要）。 */
function articlesOfDomainAllDirections(domain: ArticleDomain): readonly ArticleExcerpt[] {
  return ARTICLE_EXCERPTS.filter((article) => article.domain === domain)
}

/**
 * 某个领域下**全部可选句子**（跨该领域的所有文章、所有方向）。
 *
 * 句子题不选具体文章，也不分方向——领域里中英都有，练哪个方向取决于句子本身是中文还是英文。
 */
export function sentencesOfDomain(domain: ArticleDomain): readonly SentenceItem[] {
  return articlesOfDomainAllDirections(domain).flatMap(sentencesOfArticle)
}

/** 从题号解析出领域与序号；不是句子库的题号就返回 null。 */
export function parseSentenceExerciseId(id: string): { domain: ArticleDomain; index: number } | null {
  const match = /^sentence-([a-z]+)-(\d+)$/.exec(id)
  if (!match) return null
  const domain = match[1] as ArticleDomain
  if (!isDomain(domain)) return null
  const index = Number(match[2])
  if (!Number.isInteger(index) || index < 1) return null
  return { domain, index }
}

/**
 * 取某一道句子题。
 *
 * 确定性地从该领域的句子里挑一条：按题号序号取模，因此
 *   1. 同一题号永远是同一句（刷新、切走再切回都不变）；
 *   2. 序号递增时会在该领域的句子里依次走一遍，不会总撞同一句。
 */
export function sentenceForExerciseId(id: string): SentenceItem | null {
  const parsed = parseSentenceExerciseId(id)
  if (!parsed) return null
  const pool = sentencesOfDomain(parsed.domain)
  if (pool.length === 0) return null
  const picked = pool[(parsed.index - 1) % pool.length]
  return picked ?? null
}

/** 某个领域下有多少条句子可练（界面用它决定序号范围）。 */
export function sentenceCountOfDomain(domain: ArticleDomain): number {
  return sentencesOfDomain(domain).length
}

/** 该领域句子的方向：中文句子 → 中译英，其余按英译中。 */
function directionOfSentence(text: string): Direction {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh-to-en' : 'en-to-zh'
}

export function sentenceExerciseId(domain: ArticleDomain, index: number): string {
  return `sentence-${domain}-${index}`
}

/**
 * 把一条句子变成本站通用的**题目**对象。
 *
 * 领域取自句子所属的文章；方向按句子本身是中文还是英文判断
 * （领域里中英都有，一条句子是哪种语言，练的就是哪个方向）。
 */
export function exerciseOfSentence(id: string, item: SentenceItem): Exercise {
  return {
    id,
    direction: directionOfSentence(item.text),
    mode: 'sentence',
    // 文章都来自新闻媒体，语体按新闻编译算（只影响提示词里的语体要求）
    genre: 'news',
    topic: labelOfDomain(item.from.domain),
    source: item.text,
    referenceTranslation: '',
    suggestedMinutes: 5,
  }
}
