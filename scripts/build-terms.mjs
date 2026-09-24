/**
 * 术语库的**唯一生成入口**：从仓库根目录的 `国内机构.docx` 与 `国际机构.docx`
 * 生成 `src/domain/terms-data/cn-org.ts` 与 `intl-org.ts`。
 *
 * ## 为什么要有这一步（而不是手写数据）
 *
 * 与文章库同一个道理：材料进仓库、正文一律重算。两份 docx 共 143 条机关名称，
 * 手抄一遍必然出错（全角括号、法语重音、一行两对、一行三列都是坑），
 * 而且以后再改 docx 还要再抄一遍。数据文件顶上写着"自动生成，不要手改"。
 *
 * ## 两份 docx 的格式**不一样**，各自一套认法
 *
 * - `国内机构.docx`：markdown 表格**当纯文本写在一个个自然段里**
 *   （`| 中文名称 | 官方英文名称 |` / `|---|---|` / `| 中文 | English |`），
 *   另有 `## 一、…` 小标题、`---` 分隔线、说明段，以及人民政府那 9 行多出来的
 *   第三列（`省级`／`地级`／`县级`／`乡级`）。
 * - `国际机构.docx`：**一行一条** `中文 — English`（U+2014 + 结尾两个空格），
 *   前 45 行带 `N. ` 序号、后 14 行带 `- ` 项目符号。
 *
 * ## 按用户拍板丢掉的四样东西（都写在这里，改之前先读）
 *
 * 1. **小标题整条丢掉**（`## 一、中国共产党中央委员会（党中央）` 这类共 8 个）：
 *    对照表就是一张平表，分页按顺序切、可跨章节。
 * 2. **第三列丢掉**（`省级`／`地级`／`县级`／`乡级`）：那一列是分类、不是术语。
 * 3. **中文括注丢掉**（`（区域组织）`／`（区域军事同盟）`）：那是对国际组织的旁注。
 * 4. **说明段与 `---` 丢掉**：那是文档的开场白与分隔线，不是题目。
 *
 * ## 保留下来的、要特判的三样
 *
 * 1. **英文里的括号是官方缩写**：`National People's Congress（NPC）` 的 `NPC`
 *    进 `enAlt`，**与全称一样算对**（用户拍板）。主译法 `en` 保留括号原样。
 * 2. **一行两对**：国际那份第 5 行 `世界银行集团 — World Bank Group (WBG) / 世界银行 — World Bank`
 *    按用户拍板**拆成两条**（注意不能盲切 `/`：第 28 行有 `HIV/AIDS`，
 *    因此判据是"斜杠两侧都有空格"）。
 * 3. **一英多中**：`直辖市人民政府` 与 `设区的市人民政府` 的官方英文**都是**
 *    `Municipal People's Government`。两条各自的 `zhAlt` 互相登记，
 *    于是英译中方向下写哪个都算对（用户拍板）。
 *
 * 用法：
 *   node scripts/build-terms.mjs            # 体检，只报告不写文件
 *   node scripts/build-terms.mjs --write    # 写进 src/domain/terms-data/
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = {
  'cn-org': resolve(ROOT, '国内机构.docx'),
  'intl-org': resolve(ROOT, '国际机构.docx'),
}
const OUT = {
  'cn-org': resolve(ROOT, 'src/domain/terms-data/cn-org.ts'),
  'intl-org': resolve(ROOT, 'src/domain/terms-data/intl-org.ts'),
}

/** 两个范围，顺序即界面上两张卡片的顺序（用户定的）。 */
const SCOPES = [
  { id: 'cn-org', label: '国内机关名称', const: 'CN_ORG_TERMS', zh: '国内机构.docx' },
  { id: 'intl-org', label: '国际机关名称', const: 'INTL_ORG_TERMS', zh: '国际机构.docx' },
]

/**
 * 英美拼写对照表：**照词给出，不写通则**。
 *
 * 为什么不写成 `-our → -or` 这种通则：那么 `four` 就会被"接受"成 `for`、
 * `precise` 会被"接受"成 `precize`——假放宽比不放宽更坏（用户看到的是"我写错了它却说对"）。
 * 因此这里只列这批材料里**真的出现过的**英美差异词，生成 `enAlt`。
 */
const SPELLING_PAIRS = [
  ['Organisation', 'Organization'],
  ['organisation', 'organization'],
  ['Organisations', 'Organizations'],
  ['organisations', 'organizations'],
  ['Co-operation', 'Cooperation'],
  ['co-operation', 'cooperation'],
  ['Labour', 'Labor'],
  ['labour', 'labor'],
  ['Programme', 'Program'],
  ['programme', 'program'],
  ['Centre', 'Center'],
  ['centre', 'center'],
]

/* ── docx → 自然段（与 build-articles.mjs 同一套，不装第三方依赖） ────── */

/** 从 zip 里取出 `word/document.xml`（自己解中央目录，只认 deflate 与 store）。 */
function readZipEntry(buffer, wanted) {
  // 末尾扫描 End of Central Directory（注释最长 65535，所以从后往前找签名）
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip：找不到中央目录')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('中央目录条目损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt32LE(offset + 32)
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
  throw new Error(`docx 里找不到 ${wanted}`)
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

function readDocxParagraphs(path) {
  const xml = readZipEntry(readFileSync(path), 'word/document.xml').toString('utf8')
  return paragraphsOf(xml)
}

/* ── 英文一侧的整理 ─────────────────────────────────────────────── */

/**
 * 英文一侧的撇号订正：这份材料与 `文章.docx` 犯的是同一个错——
 * 所有格的撇号写成了 `‘`（U+2018，左单引号），正确是 `’`（U+2019）。
 * 只修这一个字符，其余一字不动（与 `build-articles.mjs` 的 `fixApostrophes` 同一口径）。
 * 中文那一侧不碰：中文里的 `‘…’` 是嵌套引号，是对的。
 */
function fixApostrophes(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return text
  return text.split('\u2018').join('\u2019')
}

/** 全角括号 → 半角（存储、显示、比对三处都用半角，免得同一份数据两种括号）。 */
function halfWidthParens(text) {
  return text.replace(/\uff08/g, '(').replace(/\uff09/g, ')')
}

/**
 * 从英文名称尾部取出**官方缩写**那一对括号。
 *
 * `Central Committee of the Communist Party of China(CPC Central Committee)`
 *   → `{ name: 'Central Committee of the Communist Party of China', alt: 'CPC Central Committee' }`
 * 只认**结尾**那一对：这批材料里缩写一律写在末尾，中间出现的括号（如 `HIV/AIDS`）
 * 与带空格的其它括注都不该当成别名。
 */
function splitAlias(en) {
  const match = /^(.*?)\s*\(([^()]*)\)$/.exec(en)
  if (!match) return { name: en.trim(), alt: null }
  const name = match[1].trim()
  const alt = match[2].trim()
  // 主译法整条都是括号（不正常）时不拆，宁可原样留着让人看见
  if (name.length === 0) return { name: en.trim(), alt: null }
  return { name, alt: alt.length > 0 ? alt : null }
}

/**
 * 这段文本里有没有**这个整词**（按字母边界判，不按子串）。
 *
 * ⚠️ 必须按整词判：`Programme` 与 `Program` 里后者是前者的**子串**，
 * 用 `includes` 的话两个方向都不成立——`'World Food Programme'.includes('Program')` 是 true，
 * 于是"英式在、美式不在"与"美式在、英式不在"同时为假，这一对**永远不触发**。
 * 实测踩到：5 条带 Programme 的机构（粮食计划署、开发计划署、环境规划署、艾滋病规划署、
 * 人类住区规划署）写美式会被判错，而 `scripts/check-terms.mjs` 把它当成一条 ⚠ 提醒盯着。
 */
function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`).test(text)
}

/** 把这个整词换成另一个（同样按字母边界，免得在别的词中间改字）。 */
function replaceWord(text, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'g'), to)
}

/**
 * 按照词表生成英美拼写变体（只在真的出现时才产生，不是通则放宽）。
 *
 * ⚠️ 必须是**组合**而不是"每次只换一处"：`Organisation for Economic Co-operation and Development`
 * 有两处英美差异，只换一处的做法会让"两处都写成美式"的答案判错——那正是假放宽
 * （用户写了美式拼写却被判错，比不放宽更糟）。因此这里对"这条文本上真正适用的那几对"
 * 取**全部组合**（2^n 种，n ≤ 6，实测最多 8 条），每一种都算对。
 */
function spellingVariants(text) {
  const applicable = SPELLING_PAIRS.map(([british, american]) => {
    if (hasWord(text, british) && !hasWord(text, american)) return [british, american]
    if (hasWord(text, american) && !hasWord(text, british)) return [american, british]
    return null
  }).filter((pair) => pair !== null)

  const out = new Set()
  const total = 1 << applicable.length
  for (let mask = 1; mask < total; mask += 1) {
    let result = text
    applicable.forEach(([from, to], index) => {
      if ((mask & (1 << index)) !== 0) result = replaceWord(result, from, to)
    })
    if (result !== text) out.add(result)
  }
  return [...out]
}

/* ── 国内机构.docx：markdown 表格文本 ────────────────────────────── */

/**
 * 逐段认表格行。
 *
 * 丢掉：空段、`---`、`## `/`### ` 小标题、`**…**：` 小标题、说明段、
 * 表头行（`| 中文名称 | 官方英文名称 |`）与分隔行（`|---|---|`）。
 * 收下：两列 `| 中文 | English |` 与三列 `| 省级 | 中文 | English |`（取后两列）。
 */
function parseTableDocx(paragraphs) {
  const terms = []
  const dropped = { headings: 0, prose: 0, headerRows: 0 }
  for (const text of paragraphs) {
    if (text.length === 0) continue
    if (!text.startsWith('|')) {
      if (text === '---') continue
      if (text.startsWith('#')) dropped.headings += 1
      else dropped.prose += 1
      continue
    }
    const cells = text
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length === 0 || cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    if (cells.length === 2 && cells[0] === '中文名称' && cells[1] === '官方英文名称') {
      dropped.headerRows += 1
      continue
    }
    if (cells.length !== 2 && cells.length !== 3) {
      throw new Error(`国内机构.docx 有一行不是 2 列或 3 列：${text}`)
    }
    const [zh, en] = cells.length === 3 ? [cells[1], cells[2]] : [cells[0], cells[1]]
    if (!zh || !en) throw new Error(`国内机构.docx 有一行拆不出「中文 / 英文」：${text}`)
    terms.push({ zh, en })
  }
  return { terms, dropped }
}

/* ── 国际机构.docx：一行一条 ─────────────────────────────────────── */

/**
 * 逐段认 `中文 — English`。
 *
 * 一行两对（`A — X / B — Y`）按用户拍板拆成两条，判据是**斜杠两侧都带空格**——
 * 第 28 行有 `HIV/AIDS`，盲切斜杠会把它劈成两条假的。
 * 英文尾部的中文括注（`（区域组织）`）整条丢掉。
 */
function parseDashedDocx(paragraphs) {
  const terms = []
  let splitRows = 0
  const dropped = { headings: 0, prose: 0, notes: 0 }
  for (const text of paragraphs) {
    if (text.length === 0) continue
    const numbered = /^(?:\d+\.|-)\s*(.+)$/.exec(text)
    if (!numbered) {
      if (text.startsWith('#')) dropped.headings += 1
      else dropped.prose += 1
      continue
    }
    const body = numbered[1].trim()
    const parts = body.split(/\s+\/\s+/)
    if (parts.length > 1) splitRows += 1
    for (const part of parts) {
      const pair = part.split(/\s*\u2014\s*/)
      if (pair.length !== 2) throw new Error(`国际机构.docx 有一行拆不出「中文 — 英文」：${text}`)
      const zh = pair[0].trim()
      // 英文尾部的中文括注是对这个组织的旁注，按用户拍板丢掉
      let en = pair[1].trim()
      if (/\uff08[^\uff09]*\uff09\s*$/.test(en)) {
        en = en.replace(/\s*\uff08[^\uff09]*\uff09\s*$/, '').trim()
        dropped.notes += 1
      }
      if (!zh || !en) throw new Error(`国际机构.docx 有一行拆出了空的中文或英文：${text}`)
      terms.push({ zh, en })
    }
  }
  return { terms, splitRows, dropped }
}

/* ── 组装 ──────────────────────────────────────────────────────── */

/** 一份原始行的英文一侧整理成 `{ zh, en, enAlt }`。 */
function normalizeRow(row) {
  const en = fixApostrophes(halfWidthParens(row.en))
  const { name, alt } = splitAlias(en)
  const enAlt = []
  if (alt) enAlt.push(alt)
  /*
   * 英美拼写变体要**两种形态都生成**：
   *   - 连着尾巴上那对括号的整串（`World Health Organisation (WHO)`）——
   *     用户照着官方全称写、顺手把缩写也写上，这也是最常见的一种写法；
   *   - 只有主译法的（`World Health Organisation`）。
   * 只生成其中一种，另一种写法就会被判错（实测：只生成主译法的话，
   * 带上缩写的官方全称一旦写成英式就判错）。
   */
  for (const variant of spellingVariants(en)) enAlt.push(variant)
  for (const variant of spellingVariants(name)) enAlt.push(variant)
  return { zh: row.zh, en, enAlt: [...new Set(enAlt)] }
}

/**
 * 一英多中：同一条英文对应的其它中文，互相登记进 `zhAlt`。
 *
 * 判据用**主译法归一后的英文**（去掉括号与英美差异），因此
 * `Municipal People's Government` 那两条会互相认到。
 */
function attachZhAlt(terms) {
  const keyOf = (term) => term.en.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const byKey = new Map()
  for (const term of terms) {
    const key = keyOf(term)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(term)
  }
  const groups = []
  for (const [, bucket] of byKey) {
    const zhSet = [...new Set(bucket.map((term) => term.zh))]
    if (zhSet.length < 2) continue
    groups.push({ key: keyOf(bucket[0]), zh: zhSet })
    for (const term of bucket) term.zhAlt = zhSet.filter((zh) => zh !== term.zh)
  }
  return groups
}

function collect() {
  const byScope = {}
  const report = []
  for (const scope of SCOPES) {
    const paragraphs = readDocxParagraphs(SRC[scope.id])
    const parsed = scope.id === 'cn-org' ? parseTableDocx(paragraphs) : parseDashedDocx(paragraphs)
    const terms = parsed.terms.map(normalizeRow)
    for (const term of terms) term.zhAlt = []
    byScope[scope.id] = terms
    report.push({ scope, paragraphs: paragraphs.length, parsed, terms })
  }

  // 一英多中在**整库**范围内认（跨范围的同名也一并接受，宁可放宽也不要冤枉）
  const all = SCOPES.flatMap((scope) => byScope[scope.id])
  const groups = attachZhAlt(all)

  return { byScope, report, groups }
}

/* ── 体检（与 --write 无关，任何时候都跑） ───────────────────────── */

function audit({ byScope, groups }) {
  const problems = []
  for (const scope of SCOPES) {
    const terms = byScope[scope.id]
    if (terms.length === 0) problems.push(`${scope.zh}：一条都没解析出来`)
    for (const term of terms) {
      if (!term.zh.trim()) problems.push(`${scope.zh}：有一条中文是空的`)
      if (!term.en.trim()) problems.push(`${scope.zh}：${term.zh} 的英文是空的`)
      if (/[\uff08\uff09]/.test(term.en)) problems.push(`${scope.zh}：${term.zh} 的英文里还留着全角括号`)
      if (/[\uff08\uff09]/.test(term.zhAlt.join(''))) problems.push(`${scope.zh}：${term.zh} 的中文别名里有全角括号（那是另一条术语的名字）`)
    }
    const zhSeen = new Map()
    for (const term of terms) {
      if (zhSeen.has(term.zh)) problems.push(`${scope.zh}：中文重复——${term.zh} 出现两次`)
      zhSeen.set(term.zh, true)
    }
  }
  return problems
}

/* ── 写文件 ────────────────────────────────────────────────────── */

function renderFile(scope, terms) {
  const lines = []
  lines.push('/**')
  lines.push(` * 术语库 · ${scope.label}（**自动生成，不要手改**）`)
  lines.push(' *')
  lines.push(` * 来源：仓库根目录的 \`${scope.zh}\`。`)
  lines.push(' * 生成命令：node scripts/build-terms.mjs --write')
  lines.push(' *')
  lines.push(' * 每条：`zh` 中文名、`en` 官方英文（照文档原样，括号统一成半角）、')
  lines.push(' * `enAlt` 一并算对的其它英文写法（官方缩写与英美拼写变体）、')
  lines.push(' * `zhAlt` 英译中方向下同样算对的其它中文名（一英多中，如「直辖市人民政府」与「设区的市人民政府」）。')
  lines.push(' */')
  lines.push('')
  lines.push("import type { Term } from '../terms'")
  lines.push('')
  lines.push(`export const ${scope.const}: readonly Term[] = [`)
  for (const term of terms) {
    lines.push(`  {`)
    lines.push(`    zh: ${JSON.stringify(term.zh)},`)
    lines.push(`    en: ${JSON.stringify(term.en)},`)
    lines.push(`    enAlt: ${JSON.stringify(term.enAlt)},`)
    lines.push(`    zhAlt: ${JSON.stringify(term.zhAlt)},`)
    lines.push(`  },`)
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

/* ── 报告 ──────────────────────────────────────────────────────── */

function perPage(count) {
  return Math.ceil(count / 5)
}

function main() {
  const write = process.argv.includes('--write')
  const data = collect()
  const problems = audit(data)

  console.log('== 术语库两份材料 ==')
  for (const { scope, paragraphs, parsed, terms } of data.report) {
    const extra = parsed.splitRows ? `，其中 ${parsed.splitRows} 行拆成了两条` : ''
    const notes = parsed.dropped.notes ? `，丢掉中文括注 ${parsed.dropped.notes} 处` : ''
    const table = parsed.dropped.headerRows ? `，丢掉表头 ${parsed.dropped.headerRows} 行` : ''
    console.log(
      `  ${scope.label}（${scope.zh}）：${terms.length} 条 · ${perPage(terms.length)} 页（每页 5 条，末页 ${terms.length % 5 || 5} 条）`,
    )
    console.log(
      `    自然段 ${paragraphs} 个；丢掉小标题 ${parsed.dropped.headings} 个、说明段 ${parsed.dropped.prose} 段${table}${extra}${notes}`,
    )
    const aliases = terms.filter((term) => term.enAlt.length > 0)
    console.log(`    带官方缩写的 ${aliases.length} 条，例如：${aliases.slice(0, 3).map((t) => `${t.en} → ${t.enAlt.join(' / ')}`).join('；')}`)
    const variants = terms.filter((term) => term.enAlt.length > 0 && term.enAlt.some((alt) => / /.test(alt)))
    console.log(`    英美拼写变体（照词表，非通则）共 ${variants.length} 条`)
  }
  console.log(`  合计 ${SCOPES.reduce((sum, scope) => sum + data.byScope[scope.id].length, 0)} 条`)
  console.log('')
  console.log('== 一英多中（英译中方向下写哪个都算对） ==')
  if (data.groups.length === 0) console.log('  没有')
  for (const group of data.groups) console.log(`  ${group.zh.join(' ／ ')}  ← 同为 ${group.key}`)
  console.log('')

  if (problems.length > 0) {
    console.log('== 问题 ==')
    for (const problem of problems) console.log(`  ✗ ${problem}`)
    process.exitCode = 1
    console.log('\n有数据问题，没有写文件。')
    return
  }
  console.log('== 数据体检通过 ==')

  if (!write) {
    console.log('\n（体检模式：没有写文件。要写请加 --write）')
    return
  }
  for (const scope of SCOPES) {
    mkdirSync(dirname(OUT[scope.id]), { recursive: true })
    writeFileSync(OUT[scope.id], renderFile(scope, data.byScope[scope.id]), 'utf8')
  }
  console.log(`\n已写入：${SCOPES.map((scope) => OUT[scope.id].replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '')).join('、')}`)
}

main()
