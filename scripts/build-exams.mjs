/**
 * 真题 / 样题文章库正文的**唯一生成入口**：把 `exams-src/*.json`（人工整理的卷子）
 * 变成 `src/domain/articles-data/exams.ts`。
 *
 * ## 为什么与 build-articles 分开
 *
 * 文章库那边（社会/经济/文化/生态/科技）的材料是一份 docx、结构规整，能整份机械解析；
 * 真题与样题散在 8 份真题卷 + 4 份样题卷里（pdf 与 docx 混着），**卷头、题号、答题框、
 * 评分标准都要人工剔除**，官方答案还要与原文按段对齐。那一步不可能机械化，因此：
 *
 *   - 人工整理的成果落在 `exams-src/<slug>.json`（**这就是这类题目的"材料"**，
 *     与文章库的 `文章.docx` 地位相同，进仓库、可复核）；
 *   - 本脚本负责**机械的那一半**：校验、编号、算篇幅、渲染成 TS。
 *
 * 于是"内容改了要重算"这条规矩仍然成立：改 json → 重跑本脚本。
 *
 * ## 生成命令
 *
 *   node scripts/build-exams.mjs            # 体检模式：只报告，不写文件
 *   node scripts/build-exams.mjs --write    # 写进 src/domain/articles-data/exams.ts
 *
 * ## 三条硬校验（不通过就拒绝产出，不是"警告一下")
 *
 *   1. **原文与参考译文的段数必须一致**——界面按段对照，段数不齐就是错的；
 *   2. **篇幅口径与文章库一致**：英译中数词（只数含字母/数字的词），中译英数非空白字符；
 *   3. **正文里不许出现 markdown 标记**（`**`、`#`、行首 `- `）：材料是试卷，不是笔记。
 *
 * ⚠️ 参考译文**只允许来自官方答案**。整理时没有答案就留空字符串——本脚本对"缺译文"
 * 只计数、不报错（界面本来就不显示没有译文的「参考译文」入口），但会在报告里如实列出。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC_DIR = path.join(ROOT, 'exams-src')
const OUT_FILE = path.join(ROOT, 'src', 'domain', 'articles-data', 'exams.ts')

/** 两个新领域。与文章库那五个话题领域分开（见 articles.ts 的 TOPIC_DOMAINS / EXAM_DOMAINS）。 */
const EXAM_DOMAINS = new Set(['past-paper', 'sample'])
const DIRECTIONS = new Set(['en-to-zh', 'zh-to-en'])

/** 领域名（拼标题用）。与 articles.ts 的 EXAM_DOMAINS 标签一致。 */
const DOMAIN_LABEL = { 'past-paper': '真题', sample: '样题' }

/**
 * 篇目的话题领域，**只能**从这五个里挑（用户要求标题里带话题）。
 * 注意它是"这篇材料讲的是什么"，与它被归到"真题/样题"那一格是两件事：
 * 后者是**卷子的来源**，前者是**内容的话题**（见 ADR 0029）。
 */
const TOPICS = ['社会', '经济', '文化', '生态', '科技']

/**
 * 标题格式（用户指定）：
 *
 *   真题 2025 省赛 经济领域 | 简要概括的内容
 *
 * 也就是「卷子来源（真题/样题）+ 年份 + 场次（有才写）+ 话题领域 | 一句话概括」。
 * 场次与话题是**材料里的零件**（json 的 stage 与 topic），标题由这里拼——
 * 拼标题是机械活，不该由整理的人手写（手写必然长短不一）。
 */
function composeTitle({ domain, year, stage, topic, summary }) {
  const parts = [DOMAIN_LABEL[domain], String(year)]
  if (stage) parts.push(stage)
  parts.push(`${topic}领域`)
  return `${parts.join(' ')} | ${summary}`
}

/** 与 build-articles.mjs 同一套口径（英译中数词、中译英数非空白字符）。 */
function countUnits(direction, text) {
  if (direction === 'en-to-zh') {
    return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  }
  return text.replace(/\s/g, '').length
}

function paragraphsOf(text) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function lookLikeMarkdown(text) {
  return /\*\*|^#{1,6}\s|(^|\n)[-*]\s/.test(text)
}

/* ── 读 + 校验 ─────────────────────────────────────────────────── */

function main() {
  const write = process.argv.includes('--write')
  const problems = []
  const missingReference = []
  const papers = []

  let files = []
  try {
    files = readdirSync(SRC_DIR).filter((name) => name.endsWith('.json')).sort()
  } catch {
    console.error(`找不到 ${SRC_DIR}——真题/样题的材料目录不存在，先把它建起来。`)
    process.exit(1)
  }

  for (const file of files) {
    const full = path.join(SRC_DIR, file)
    let doc
    try {
      doc = JSON.parse(readFileSync(full, 'utf8'))
    } catch (error) {
      problems.push(`${file} 不是合法 JSON：${error.message}`)
      continue
    }

    if (typeof doc.slug !== 'string' || !doc.slug) problems.push(`${file} 缺 slug`)
    if (!EXAM_DOMAINS.has(doc.domain)) problems.push(`${file} 的 domain 只能是 past-paper 或 sample，实际是 ${doc.domain}`)
    if (typeof doc.label !== 'string' || !doc.label.trim()) problems.push(`${file} 缺 label`)
    if (!Number.isInteger(doc.year) || doc.year < 2020 || doc.year > 2100) {
      problems.push(`${file} 的 year 必须是 2020–2100 的整数，实际是 ${JSON.stringify(doc.year)}`)
    }
    if (doc.stage !== undefined && typeof doc.stage !== 'string') problems.push(`${file} 的 stage 必须是字符串（没有就写空串）`)
    if (typeof doc.sourceFile !== 'string' || !doc.sourceFile.trim()) problems.push(`${file} 缺 sourceFile（要能追回是哪一份卷子）`)
    if (!Array.isArray(doc.articles)) {
      problems.push(`${file} 缺 articles 数组`)
      continue
    }

    const articles = []
    for (const [index, item] of doc.articles.entries()) {
      const where = `${file} 的第 ${index + 1} 篇`
      if (!DIRECTIONS.has(item.direction)) {
        problems.push(`${where} 的 direction 不合法：${item.direction}`)
        continue
      }
      if (!TOPICS.includes(item.topic)) {
        problems.push(`${where} 的 topic 必须是 ${TOPICS.join('/')} 之一，实际是 ${JSON.stringify(item.topic)}`)
      }
      if (typeof item.summary !== 'string' || !item.summary.trim()) {
        problems.push(`${where} 缺 summary（标题里"|"后面那句概括）`)
      } else if (Array.from(item.summary).length > 40 || /[\n\r]/.test(item.summary)) {
        problems.push(`${where} 的 summary 太长（限 40 字）或带了换行：${item.summary}`)
      }
      if (typeof item.text !== 'string' || !item.text.trim()) {
        problems.push(`${where} 缺 text`)
        continue
      }
      const reference = typeof item.reference === 'string' ? item.reference : ''
      const textParas = paragraphsOf(item.text)
      const refParas = paragraphsOf(reference)
      if (refParas.length > 0 && refParas.length !== textParas.length) {
        problems.push(`${where} 原文 ${textParas.length} 段、译文 ${refParas.length} 段，段数必须一致`)
      }
      if (lookLikeMarkdown(item.text) || lookLikeMarkdown(reference)) {
        problems.push(`${where} 的正文里有 markdown 标记（材料是试卷，不该有 ** / # / 列表符）`)
      }
      if (refParas.length === 0) missingReference.push(`${doc.label} · ${item.direction}`)
      articles.push({
        direction: item.direction,
        topic: item.topic,
        summary: typeof item.summary === 'string' ? item.summary.trim() : '',
        text: textParas.join('\n\n'),
        reference: refParas.join('\n\n'),
      })
    }

    /*
     * ⚠️ 一个方向**可以有多篇**：2023 那份卷子就只设汉译英、而且给了两篇语篇。
     * 因此这里不限制"每方向一篇"，只挡真正的重复（同一份卷子里出现两个完全一样的概括）。
     */
    const seenTitles = new Set()
    for (const article of articles) {
      const key = `${article.direction}｜${article.summary}`
      if (seenTitles.has(key)) problems.push(`${file} 里出现了重复的篇目：${article.summary}`)
      seenTitles.add(key)
    }

    papers.push({ ...doc, articles })
  }

  if (problems.length > 0) {
    console.error('体检不通过，没有写任何文件：')
    for (const problem of problems) console.error(`  ✗ ${problem}`)
    process.exit(1)
  }

  /*
   * 编号：`art-<领域>-<方向>-<batch>`，batch = **这一篇在自己那个「领域 × 方向」里的序号**
   * （按卷子顺序、卷内篇目顺序数下来）。
   *
   * 为什么不是"第几份卷子"：一份卷子可能有两篇同方向的语篇（2023 那份就是），
   * 用卷号会撞号。题号只保证唯一与稳定，**"来自哪一份卷子"由 title 末尾的来源文件负责**——
   * 那比一个数字有用得多。
   */
  const counters = new Map()
  const rows = []
  for (const paper of papers) {
    for (const article of paper.articles) {
      const key = `${paper.domain}/${article.direction}`
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      rows.push({
        id: `art-${paper.domain}-${article.direction}-${next}`,
        domain: paper.domain,
        direction: article.direction,
        batch: next,
        // 标题由零件拼出来（见 composeTitle）：真题 2025 省赛 经济领域 | 简要概括的内容
        title: composeTitle({
          domain: paper.domain,
          year: paper.year,
          stage: paper.stage ?? '',
          topic: article.topic,
          summary: article.summary,
        }),
        units: countUnits(article.direction, article.text),
        text: article.text,
        reference: article.reference,
      })
    }
  }

  // 英译中在前，中译英在后（与文章库同一条约定：`ARTICLES[0]` 会被当作"打开就能练的一篇"）
  const order = { 'en-to-zh': 0, 'zh-to-en': 1 }
  rows.sort((a, b) => order[a.direction] - order[b.direction] || a.batch - b.batch)

  console.log(`读到 ${papers.length} 份卷子，产出 ${rows.length} 篇：`)
  for (const domain of ['past-paper', 'sample']) {
    const mine = rows.filter((row) => row.domain === domain)
    if (mine.length === 0) continue
    const label = papers.find((paper) => paper.domain === domain)?.label ?? domain
    console.log(`  ${domain}：${mine.length} 篇（${mine.filter((row) => row.direction === 'en-to-zh').length} 英译中 / ${mine.filter((row) => row.direction === 'zh-to-en').length} 中译英）`)
    for (const row of mine) {
      console.log(`    ${row.id}  ${row.units} ${row.direction === 'en-to-zh' ? '词' : '字'}  ${paragraphsOf(row.text).length} 段  ${row.reference ? '有译文' : '无译文'}  ${row.title}`)
    }
    void label
  }
  if (missingReference.length > 0) {
    console.log(`\n未找到官方参考译文的（照实列出，界面不显示「参考译文」入口）：`)
    for (const item of missingReference) console.log(`  · ${item}`)
  }

  const banner = `/**
 * 文章库 · 真题与样题（**自动生成，不要手改**）。
 *
 * 生成命令：node scripts/build-exams.mjs --write
 * 材料：仓库里的 \`exams-src/*.json\`——从「国才杯」笔译历年真题与官方样题里**人工整理**出来的
 *      原文与官方参考译文（卷头、题号、答题框、评分标准都剔除了；这一步没法机械化，
 *      因此材料以 json 的形式进仓库，可复核、可重算）。
 *      原始文件来自：桌面\\下载\\【2026】外研社（国才杯）笔译赛项\\【2023-2026】笔译历年真题（校赛、初赛、省赛）
 *      与同级的\\【2023-2026】笔译（官方）样题，每篇的 \`title\` 末尾都写着它的来源文件。
 *
 * 每篇的字段见 domain/articles.ts 的 Article。五条约定与文章库一致：
 *   1. 正文与参考译文都是**全文**，段落之间留一个空行；两边段数**完全一致**（脚本强校验）。
 *   2. **原文逐字照录**，不改写不润色；抽取造成的错字订正记在 exams-src 的 notes 里。
 *   3. **参考译文只来自官方答案**，没有答案的篇目 reference 是空串——绝不自己翻译。
 *   4. \`units\` 与文章库同一套口径：英译中数词，中译英数非空白字符。
 *   5. \`title\` 由零件拼出来，格式是「真题 2025 省赛 经济领域 | 简要概括的内容」：
 *      卷子层给 year / stage，篇目层给 topic（社会/经济/文化/生态/科技）与 summary。
 *      想改标题就改那两个字段，别改这个生成文件。*/`

  const body = rows
    .map((row) =>
      [
        '  {',
        `    id: ${JSON.stringify(row.id)},`,
        `    domain: ${JSON.stringify(row.domain)},`,
        `    direction: ${JSON.stringify(row.direction)},`,
        `    batch: ${row.batch},`,
        `    title: ${JSON.stringify(row.title)},`,
        `    units: ${row.units},`,
        `    text: ${JSON.stringify(row.text)},`,
        `    reference: ${JSON.stringify(row.reference)},`,
        '  },',
      ].join('\n'),
    )
    .join('\n')

  const content = `${banner}\n\nimport type { Article } from '../articles'\n\nexport const EXAM_ARTICLES: readonly Article[] = [\n${body}\n]\n`

  if (!write) {
    console.log('\n（体检模式：没有写文件。要写请加 --write）')
    return
  }
  writeFileSync(OUT_FILE, content, 'utf8')
  console.log(`\n已写入 ${OUT_FILE}`)
}

main()
