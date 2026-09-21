/**
 * 文章库正文的**唯一生成入口**：从仓库根目录的 `文章.docx` 生成
 * `src/domain/articles-data/en-to-zh.ts` 与 `zh-to-en.ts`。
 *
 * ## 为什么要有这一步（而不是手写那两个数据文件）
 *
 * 题库正文将来还要增补（用户会再给一组材料），而"哪些篇收、正文有没有被手改过"
 * 这两件事必须能**重算**。所以材料本身进仓库（`文章.docx`），正文一律由本脚本产出；
 * 数据文件顶上写着"自动生成，不要手改"，改动只发生在 docx 与这个脚本里。
 *
 * ## docx 怎么读（不装第三方依赖）
 *
 * docx 就是个 zip。这里用 node 自带的 `zlib` 自己解中央目录，把 `word/document.xml`
 * 取出来，再按 `<w:p>` 切自然段、把 `<w:t>` 里的文字拼起来。
 * 为的是**跨平台**：仓库里同时有 `start.ps1` 与 `start.sh`，
 * 生成步骤不该只在 Windows 上跑得起来（`Expand-Archive` 就是 Windows 专属）。
 *
 * ## 四件事写在这里，改之前先读
 *
 * 1. **只收五个板块**：社会、经济、文化、生态、科技（`DOMAINS`）。
 *    文档里的板块顺序与它无关，id 一律按本表的顺序排。
 * 2. **一篇文章 = 一条数据**：原文按空行切成自然段存全文，参考译文**逐段对齐**存全文。
 *    已核对：文档里每一篇的译文段数与原文段数完全相同，对不上就报错退出（见 `main`）。
 * 3. **只删重复的那两篇**：生态 / 英译中 的第 2、4 组与第 1 组是同一件事
 *    （南岭猕猴，文本相似度 98%），按用户决定只留第 1 组，其余两篇丢掉并在报告里点名。
 * 4. **只修一个字符**：英文正文与英文译文里所有格的撇号写成了 `‘`（U+2018），
 *    正确是 `’`（U+2019）。只做这一处订正（`fixApostrophes`），其余一字不动——
 *    中文那一侧的 `‘…’` 是嵌套引号，是对的，不能碰。
 *
 * 用法：
 *   node scripts/build-articles.mjs            # 体检，只报告不写文件
 *   node scripts/build-articles.mjs --write    # 写进 src/domain/articles-data/
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCX = resolve(ROOT, '文章.docx')
const OUT_EN = resolve(ROOT, 'src/domain/articles-data/en-to-zh.ts')
const OUT_ZH = resolve(ROOT, 'src/domain/articles-data/zh-to-en.ts')

/**
 * 五个板块，顺序即界面下拉里的顺序（用户定的：社会 → 经济 → 文化 → 生态 → 科技）。
 * `zh` 是文档里「板块」的名字，用来认章节标题。
 */
const DOMAINS = [
  { id: 'society', zh: '社会' },
  { id: 'economy', zh: '经济' },
  { id: 'culture', zh: '文化' },
  { id: 'ecology', zh: '生态' },
  { id: 'tech', zh: '科技' },
]

/**
 * 丢掉的重复杂志：`<板块>/<方向>/<组号>`。
 * 生态 / 英译中 的第 2、4 组与第 1 组是同一件事（南岭猕猴），只留第 1 组。
 */
const DROPPED = new Set(['ecology/en-to-zh/2', 'ecology/en-to-zh/4'])

/* ── docx → 自然段 ─────────────────────────────────────────────── */

/** 从 zip 里取出某个条目（自己解中央目录，只认 deflate 与 store）。 */
function readZipEntry(buffer, wanted) {
  // 末尾扫描 End of Central Directory（注释最长 65535，所以从后往前找签名）
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('文章.docx 不是有效的 zip：找不到中央目录')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('中央目录条目损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    if (name === wanted) {
      // 本地头的 name/extra 长度可能与中央目录不同，必须按本地头算数据起点
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.subarray(dataStart, dataStart + compressedSize)
      return method === 0 ? data : inflateRawSync(data)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`文章.docx 里找不到 ${wanted}`)
}

/** XML 实体还原。`&amp;` 放最后，免得把 `&amp;lt;` 二次还原。 */
function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** `word/document.xml` → 自然段文字数组（空段也留着，位置要能对上）。 */
function paragraphsOf(xml) {
  return xml
    .split(/<w:p[ >]/)
    .slice(1)
    .map((block) => decodeXml([...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')))
    .map((text) => text.replace(/\u00a0/g, ' ').trim())
}

/* ── 自然段 → 篇 ───────────────────────────────────────────────── */

/**
 * 按标题层级把整份文档走一遍，产出每篇一条：
 * `{ batch, domain, direction, anchor, source[], reference[] }`。
 */
function parseDocument(paragraphs) {
  const articles = []
  const unknownDomains = new Set()
  let batch = 0
  let domain = null
  let direction = null
  let stage = null // 'anchor' | 'source' | 'reference'
  let buffer = []
  let anchors = []
  let current = null

  const flushBuffer = () => {
    if (!current || buffer.length === 0) return
    if (stage === 'source') current.source = buffer.slice()
    else if (stage === 'reference') current.reference = buffer.slice()
    buffer = []
  }
  const closeArticle = () => {
    flushBuffer()
    if (current) {
      const anchor = anchors.find((item) => item.direction === current.direction)
      if (anchor) current.anchor = anchor.text
      articles.push(current)
    }
    current = null
  }
  const closeAnchors = () => {
    for (const item of buffer) {
      const match = /^-\s*\*\*(中译英|英译中)\*\*：\s*([\s\S]+)$/.exec(item)
      if (match) {
        anchors.push({ direction: match[1] === '中译英' ? 'zh-to-en' : 'en-to-zh', text: match[2].trim() })
      }
    }
    buffer = []
  }

  for (const text of paragraphs) {
    if (text.length === 0) continue

    if (/^#\s*2026年/.test(text)) {
      closeArticle()
      batch += 1
      anchors = []
      stage = null
      continue
    }

    const heading = /^##\s*[一二三四五六七八九十]+、(.+?)板块\s*$/.exec(text)
    if (heading) {
      closeArticle()
      const name = heading[1]
      const found = DOMAINS.find((item) => item.zh === name)
      if (!found) unknownDomains.add(name)
      domain = found ? found.id : null
      direction = null
      anchors = []
      stage = null
      continue
    }

    if (/^###\s*事件锚点\s*$/.test(text)) {
      closeArticle()
      anchors = []
      stage = 'anchor'
      continue
    }

    const directionHeading = /^###\s*(中译英|英译中)\s*$/.exec(text)
    if (directionHeading) {
      closeArticle()
      if (stage === 'anchor') closeAnchors()
      direction = directionHeading[1] === '中译英' ? 'zh-to-en' : 'en-to-zh'
      current = { batch, domain, direction, anchor: '', source: [], reference: [] }
      stage = null
      continue
    }

    if (/^\*\*使用建议\*\*/.test(text)) {
      closeArticle()
      stage = null
      continue
    }

    if (/^>\s*说明/.test(text)) {
      stage = null
      continue
    }

    if (/^\*\*(中文|英文)原文/.test(text)) {
      stage = 'source'
      buffer = []
      continue
    }

    if (/^\*\*参考译文\*\*/.test(text)) {
      // 先把已经攒下的原文段收起来，再切到译文
      if (current && buffer.length > 0 && stage === 'source') {
        current.source = buffer.slice()
        buffer = []
      }
      stage = 'reference'
      continue
    }

    if (stage === 'anchor') {
      buffer.push(text)
      continue
    }
    if (stage === 'source' || stage === 'reference') {
      buffer.push(text)
      continue
    }
    // 标题与正文之外的东西（文档开头那句说明、各组的**使用建议**）到这里就丢掉了
  }
  closeArticle()
  if (stage === 'anchor') closeAnchors()

  return { articles, unknownDomains: [...unknownDomains] }
}

/* ── 订正与切分 ───────────────────────────────────────────────── */

/** 中文段落不动；英文段落里所有格的 `‘` 一律订正成 `’`（唯一允许的改动）。 */
function fixApostrophes(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return text
  return text.replace(/\u2018/g, '\u2019')
}

/** 计篇幅：中译英计汉字、英译中计词（与 domain/sections.ts 的 countUnits 同一口径）。 */
function countUnits(text, direction) {
  if (direction === 'zh-to-en') {
    return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  }
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/* ── 生成数据文件 ─────────────────────────────────────────────── */

const BANNER = (direction) => `/**
 * 文章库 · ${direction}（**自动生成，不要手改**）。
 *
 * 生成命令：node scripts/build-articles.mjs --write
 * 来源：仓库根目录的《文章.docx》——用户在「外研社·国才杯」练习材料里的五组内容，
 *      每组五个板块、每个板块中译英与英译中各一篇，每篇都配参考译文。
 *
 * 每篇的字段见 domain/articles.ts 的 Article。四条约定：
 *   1. 正文与参考译文都是**全文**，段落之间留一个空行；两边**段数完全一致**，
 *      因此界面上可以逐段对照（see SourcePane 的「对照」按钮）。
 *   2. 段落顺序与原文字数一字不动，只订正过英文里所有格的撇号（\u2018 → \u2019）。
 *   3. \`title\` 是文档里的「事件锚点」那一行——它同时是这篇的背景说明。
 *   4. 正文由 scripts/build-articles.mjs 从 docx 现算，改内容请改 docx。
 */`

function renderArticle(article, indent = '  ') {
  const lines = []
  lines.push(`${indent}{`)
  lines.push(`${indent}  id: ${JSON.stringify(article.id)},`)
  lines.push(`${indent}  domain: ${JSON.stringify(article.domain)},`)
  lines.push(`${indent}  direction: ${JSON.stringify(article.direction)},`)
  lines.push(`${indent}  batch: ${article.batch},`)
  lines.push(`${indent}  title: ${JSON.stringify(article.title)},`)
  lines.push(`${indent}  units: ${article.units},`)
  lines.push(`${indent}  text: ${JSON.stringify(article.source.join('\n\n'))},`)
  lines.push(`${indent}  reference: ${JSON.stringify(article.reference.join('\n\n'))},`)
  lines.push(`${indent}},`)
  return lines.join('\n')
}

function renderFile(articles, direction) {
  const name = direction === 'en-to-zh' ? 'EN_ARTICLES' : 'ZH_ARTICLES'
  const head = `${BANNER(direction === 'en-to-zh' ? '英译中' : '中译英')}\n\nimport type { Article } from '../articles'\n\nexport const ${name}: readonly Article[] = [\n`
  const body = articles.map((article) => renderArticle(article)).join('\n')
  return `${head}${body}\n]\n`
}

/* ── 主流程 ───────────────────────────────────────────────────── */

function main() {
  const write = process.argv.includes('--write')
  const xml = readZipEntry(readFileSync(DOCX), 'word/document.xml').toString('utf8')
  const { articles, unknownDomains } = parseDocument(paragraphsOf(xml))

  const problems = []
  if (unknownDomains.length > 0) problems.push(`文档里有认不出的板块：${unknownDomains.join('、')}`)

  const kept = []
  const dropped = []
  for (const article of articles) {
    const key = `${article.domain}/${article.direction}/${article.batch}`
    if (!article.domain) {
      problems.push(`第 ${article.batch} 组的「${article.direction}」没有落到任何板块上`)
      continue
    }
    if (DROPPED.has(key)) {
      dropped.push(article)
      continue
    }
    if (article.source.length === 0) problems.push(`${key} 没有原文`)
    if (article.reference.length === 0) problems.push(`${key} 没有参考译文`)
    if (article.source.length !== article.reference.length) {
      problems.push(`${key} 原文 ${article.source.length} 段、译文 ${article.reference.length} 段，对不齐`)
    }
    if (!article.anchor) problems.push(`${key} 没有「事件锚点」`)
    kept.push(article)
  }

  // 订正撇号（唯一允许的字符改动），并算出 id、篇幅
  for (const article of kept) {
    article.title = fixApostrophes(article.anchor)
    article.source = article.source.map(fixApostrophes)
    article.reference = article.reference.map(fixApostrophes)
    // 按整篇连起来数（段间用空行），与 domain/sections.ts 的 countUnits 完全同一口径
    article.units = countUnits(article.source.join('\n\n'), article.direction)
    // id 的最后一段就是**组号**：文档是五组材料，组号比"第几篇"更能说明它从哪来
    article.id = `art-${article.domain}-${article.direction}-${article.batch}`
  }

  const en = kept.filter((item) => item.direction === 'en-to-zh').sort(byCellOrder)
  const zh = kept.filter((item) => item.direction === 'zh-to-en').sort(byCellOrder)

  // 体检报告
  const report = []
  report.push(`组数：${new Set(kept.map((item) => item.batch)).size}，板块：${DOMAINS.map((d) => d.zh).join('、')}`)
  report.push(`收录 ${kept.length} 篇（英译中 ${en.length} + 中译英 ${zh.length}），丢掉重复 ${dropped.length} 篇`)
  for (const item of dropped) report.push(`  ↳ 丢掉：第 ${item.batch} 组 ${item.domain}/${item.direction}（${item.anchor.slice(0, 24)}…）`)
  report.push('每格篇数：')
  for (const domain of DOMAINS) {
    const cells = ['en-to-zh', 'zh-to-en']
      .map((direction) => `${direction} ${kept.filter((i) => i.domain === domain.id && i.direction === direction).length}`)
      .join(' · ')
    report.push(`  ${domain.zh}（${domain.id}）：${cells}`)
  }
  const paragraphs = kept.reduce((sum, item) => sum + item.source.length, 0)
  report.push(`自然段共 ${paragraphs} 段`)

  console.log(report.join('\n'))

  if (problems.length > 0) {
    console.error('\n❌ 有问题，不写文件：')
    for (const problem of problems) console.error(`   - ${problem}`)
    process.exitCode = 1
    return
  }

  if (!write) {
    console.log('\n（体检模式：没有写文件。要写请加 --write）')
    return
  }

  writeFileSync(OUT_EN, renderFile(en, 'en-to-zh'), 'utf8')
  writeFileSync(OUT_ZH, renderFile(zh, 'zh-to-en'), 'utf8')
  console.log(`\n✅ 已写入 articles-data/en-to-zh.ts（${en.length} 篇）与 zh-to-en.ts（${zh.length} 篇）`)
}

/** 按「板块表顺序 → 组号」排，界面上的顺序就是它。 */
function byCellOrder(a, b) {
  const order = DOMAINS.findIndex((item) => item.id === a.domain) - DOMAINS.findIndex((item) => item.id === b.domain)
  if (order !== 0) return order
  return a.batch - b.batch
}

main()
