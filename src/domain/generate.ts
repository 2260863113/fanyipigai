/**
 * AI 出题：按「领域 + 文体 + 方向」生成一篇同规格的原创原文与参考译文。
 *
 * 为什么要有它：内置示例与手写备选就那么几篇，练完就记住了。
 * 生成的结果**按题目留存**，之后用「换一换」还能翻回来接着练。
 *
 * 三件事分得很清楚，不要混：
 *   1. 提示词在 prompt.ts（AI 层的唯一真相来源）；
 *   2. 调用与重试在 ai.ts（与批改共用同一套模型调用、失败分类、超时策略）；
 *   3. 本文件只管**解析、篇幅硬校验、按题型截取**——纯函数，不碰网络。
 */

import type { Direction, Genre, Mode } from './types'
import { extractJson } from './parse'

/**
 * 出题时可选的领域（也可以自己输入）。
 *
 * 前五个就是赛事命题的固定主题域——"五位一体"（经济建设、政治建设、文化建设、
 * 社会建设、生态文明建设）；后面几个是官方素材里最常出现的延伸领域。
 * 不往这几个之外列（娱乐、体育、个人生活之类），免得把学生往偏题上引。
 */
export const GENERATION_TOPICS: readonly string[] = [
  '经济建设',
  '政治建设',
  '文化建设',
  '社会建设',
  '生态文明建设',
  '科技创新',
  '教育强国',
  '国际传播',
]

/**
 * 官方篇长规格（与 README 的规格表一致）。
 * 口径：英文按**词数**、中文按**字符数**（不含空白）。
 */
export const LENGTH_RULE: Record<Direction, { min: number; max: number; unit: string }> = {
  'en-to-zh': { min: 250, max: 350, unit: '词' },
  'zh-to-en': { min: 200, max: 300, unit: '字' },
}

/** 按方向的口径数一遍：英文数词，中文数非空白字符。 */
export function measureLength(direction: Direction, text: string): number {
  if (direction === 'en-to-zh') {
    const trimmed = text.trim()
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
  }
  return text.replace(/\s/g, '').length
}

/** 篇幅是否达标，附一句可以直接回给模型的话。 */
export function checkLength(direction: Direction, text: string): { ok: boolean; message: string } {
  const rule = LENGTH_RULE[direction]
  const actual = measureLength(direction, text)
  if (actual < rule.min || actual > rule.max) {
    return {
      ok: false,
      message: `原文篇幅是 ${actual} ${rule.unit}，不符合要求（${rule.min}-${rule.max} ${rule.unit}）`,
    }
  }
  return { ok: true, message: `原文篇幅 ${actual} ${rule.unit}，符合 ${rule.min}-${rule.max} 的要求` }
}

export interface GeneratedParagraph {
  source: string
  translation: string
}

export interface GeneratedArticle {
  topic: string
  genre: Genre
  /** 按自然段组织的全文 */
  paragraphs: GeneratedParagraph[]
  /** 文章里的关键术语（可能为空数组） */
  terms: GeneratedParagraph[]
}

/** 生成好、并已按当前题型截取好的一道题。 */
export interface GeneratedExercise {
  /** 完整文章——留着的，将来接题库后可以跨题型复用 */
  article: GeneratedArticle
  /** 这道题实际要翻译的那一段 */
  source: string
  referenceTranslation: string
  topic: string
  genre: Genre
}

const GENRES: readonly Genre[] = ['political', 'news', 'literature', 'expository']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export type ParseGeneratedOutcome =
  | { ok: true; article: GeneratedArticle }
  | { ok: false; problems: string[] }

/**
 * 解析模型返回的命题 JSON，并做**篇幅硬校验**。
 * 不合格时给出具体原因，交给上层原样回传重试。
 */
export function parseGenerated(
  raw: string,
  request: { direction: Direction; genre: Genre; topic: string },
): ParseGeneratedOutcome {
  const extracted = extractJson(raw)
  if ('error' in extracted) return { ok: false, problems: [extracted.error] }

  let value: unknown
  try {
    value = JSON.parse(extracted.text)
  } catch (error) {
    return { ok: false, problems: [`返回的不是合法 JSON：${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!isRecord(value)) return { ok: false, problems: ['顶层不是一个 JSON 对象'] }

  const rawParagraphs = value.paragraphs
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length === 0) {
    return { ok: false, problems: ['paragraphs 必须是非空数组（文章要按自然段给出）'] }
  }

  const paragraphs: GeneratedParagraph[] = []
  for (const [index, item] of rawParagraphs.entries()) {
    if (!isRecord(item)) return { ok: false, problems: [`paragraphs[${index}] 不是对象`] }
    const source = readText(item.source)
    const translation = readText(item.translation)
    if (!source) return { ok: false, problems: [`paragraphs[${index}] 缺 source`] }
    if (!translation) return { ok: false, problems: [`paragraphs[${index}] 缺 translation`] }
    paragraphs.push({ source, translation })
  }

  const terms: GeneratedParagraph[] = []
  if (Array.isArray(value.terms)) {
    for (const item of value.terms) {
      if (!isRecord(item)) continue
      const source = readText(item.source)
      const translation = readText(item.translation)
      if (source && translation) terms.push({ source, translation })
    }
  }

  // 篇幅按**全文**校验：文章题要的就是全文，其它题型是从全文里截取
  const fullSource = paragraphs.map((paragraph) => paragraph.source).join('\n\n')
  const length = checkLength(request.direction, fullSource)
  if (!length.ok) return { ok: false, problems: [length.message] }

  const genre = GENRES.includes(value.genre as Genre) ? (value.genre as Genre) : request.genre
  const topic = readText(value.topic) || request.topic

  return { ok: true, article: { topic, genre, paragraphs, terms } }
}

/** 中英各自按句末标点切开；保留标点，避免截出来的句子断在半截。 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？…!?])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** 最前面的一个意群（术语题兜底用）。 */
function firstClause(text: string): string {
  const match = /^[^，,。；;：:！!？?]*[，,。；;：:！!？?]?/.exec(text.trim())
  return (match?.[0] ?? text).trim()
}

/**
 * 按题型从全文里截取对应大小。
 *
 * 出题总是先要一篇**完整文章**（文章题直接用它，也方便以后复用），其余题型在这上面截：
 *   段落 → 第一个自然段
 *   句子 → 第一段的第一个句子
 *   术语 → 文章里列出的关键术语（模型没给就用第一个意群兜底）
 */
export function sliceForMode(mode: Mode, article: GeneratedArticle): { source: string; referenceTranslation: string } {
  const first = article.paragraphs[0] ?? { source: '', translation: '' }

  if (mode === 'article') {
    return {
      source: article.paragraphs.map((paragraph) => paragraph.source).join('\n\n'),
      referenceTranslation: article.paragraphs.map((paragraph) => paragraph.translation).join('\n\n'),
    }
  }
  if (mode === 'paragraph') {
    return { source: first.source, referenceTranslation: first.translation }
  }
  if (mode === 'sentence') {
    return {
      source: splitSentences(first.source)[0] ?? first.source,
      referenceTranslation: splitSentences(first.translation)[0] ?? first.translation,
    }
  }
  const term = article.terms[0]
  if (term) return { source: term.source, referenceTranslation: term.translation }
  return { source: firstClause(first.source), referenceTranslation: firstClause(first.translation) }
}

/** 把一篇文章按当前题型整理成可直接使用的题目。 */
export function toGeneratedExercise(article: GeneratedArticle, mode: Mode): GeneratedExercise {
  const slice = sliceForMode(mode, article)
  return {
    article,
    source: slice.source,
    referenceTranslation: slice.referenceTranslation,
    topic: article.topic,
    genre: article.genre,
  }
}