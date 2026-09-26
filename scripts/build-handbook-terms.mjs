/**
 * 手册术语库的**唯一生成入口**：把 `handbook-src/*.json` 生成
 * `src/domain/terms-data/modern-term.ts`、`core-term.ts`、`classics.ts`。
 *
 * ## 材料是怎么来的（改之前先读完这一段）
 *
 * 用户给的是一本**扫描版** PDF《理解当代中国 核心术语学习手册》（166 页，**没有文字层**）。
 * 因此这条链子上游没有可以解析的文本，只有一条 OCR 链：
 *
 *   PDF → 逐页渲染成 PNG → Windows OCR（**只有中文引擎**，英文是按字形硬凑的）
 *       → `%TEMP%\handbook-chunks\*.txt`（每 8 页一块，页分隔标记 `===== pNNN =====`）
 *       → 逐块人工整理成 `handbook-src/<部分>-pNNN-pNNN.json`
 *       → **这个脚本** → `src/domain/terms-data/*.ts`
 *
 * ⚠️ 所以这批数据的英文里**必然残留 OCR 错误**（约 6%：句中 `Of`/`tO` 误大写、
 * 单词被空格劈开如 `ta lent`、`0f`、`l`↔`I`、`m`↔`rn`）。整理者在每个 JSON 的
 * `notes` 里逐处登记了「原样 → 订正（依据）」，这个脚本**不重做也不覆盖**那些订正，
 * 它只把已经定稿的条目装配成术语数据。要改内容请改 `handbook-src/` 下的 JSON，
 * 然后重跑本脚本——**不要手改生成出来的 .ts**（那些文件顶上写着自动生成）。
 *
 * ## 三部分各是一个板块，而且**组大小不一样**
 *
 * | 手册部分 | 板块（scope id） | 材料里的组大小 | 为什么 |
 * |---|---|---|---|
 * | 第一部分「术语英译」 | `modern-term` 当代术语 | **每 50 条一组** | 用户按材料体量定的（718 条 → 15 组） |
 * | 第二部分「术语解读」 | `core-term` 必背核心术语 | 每 20 条一组 | 用户第 14 条（60 条 → 3 组） |
 * | 第三部分「用典阐释」 | `classics` 必背用典 | 每 20 条一组 | 用户第 14 条（80 条 → 4 组） |
 *
 * ⚠️ 这里的 `perGroup` 与 `src/domain/term-scopes.ts` 里 `TERM_SCOPES` 的 `perGroup`
 * 是**同一件事的两份登记**（这个脚本跑在 Node 里，不 import 那个模块）。
 * 两处**必须一致**——`scripts/check-terms.mjs` 会盯着这一点。改一处就要改另一处。
 *
 * ## 第二部分只收「术语 + 译法」，两段解读一律不要
 *
 * 用户拍板：第二部分（术语解读）**只要术语与译法**，不要解读正文。
 * 所以 `core-*` 那些 JSON 里每一页只有 1–3 条，正文两段（中文解读、英文解读）
 * 全被整理者丢掉了。第三部分同理：只要「中文典故 + 英文译法」，
 * 「出自…意思是…」的出处解释与成段英文阐释都不收。
 *
 * ## 一个判分口径：**末尾句号写不写都算对**
 *
 * 第三部分的条目是整句（`Compassion means loving and helping others.`），
 * 中文条目也常常带句末「。」。硬按字符比会变成"少打一个句号就算错"——那是把
 * 标点当成了知识。因此生成时给每一侧都补一条**去掉末尾句号/句号的写法**进 `enAlt`/`zhAlt`，
 * 于是「同一答案的两种写法」里两种都算对（这与 `terms.ts` 里既有的放宽口径同一性质，
 * 都不做同义替换）。**屏幕上显示的标准答案仍是带标点的原样**（`en`）。
 *
 * ## 另一个判分口径：**手册自己写在纸面上的并列写法都算对**
 *
 * 手册用两种记号把"同一个答案的几种写法"直接印在行里：`Chinese (path to) modernization`
 * 的括号表示可省略，`a new form/model/type of international relations` 的斜杠表示三者之一。
 * 照着字符串比会冤枉人——用户照第一部分那一版写 `Chinese path to modernization`，
 * 在第二部分这边会被判错。因此这两类记号展开出来的写法也进 `enAlt`（见 `printedVariants`）；
 * 它们与官方缩写、英美拼写是同一性质（"同一个答案的不同写法"），**不是同义替换**。
 *
 * 用法：
 *   node scripts/build-handbook-terms.mjs            # 体检，只报告不写文件
 *   node scripts/build-handbook-terms.mjs --write    # 写进 src/domain/terms-data/
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MATERIAL_DIR = resolve(ROOT, 'handbook-src')

/** 三个板块，顺序即手册的三部分顺序（也是下拉栏里后三行的顺序）。 */
const PARTS = [
  {
    part: 'contemporary',
    id: 'modern-term',
    label: '当代术语',
    handle: '第一部分「术语英译」',
    const: 'MODERN_TERM_TERMS',
    out: 'src/domain/terms-data/modern-term.ts',
    perGroup: 50,
  },
  {
    part: 'core',
    id: 'core-term',
    label: '必背核心术语',
    handle: '第二部分「术语解读」',
    const: 'CORE_TERM_TERMS',
    out: 'src/domain/terms-data/core-term.ts',
    perGroup: 20,
  },
  {
    part: 'classics',
    id: 'classics',
    label: '必背用典',
    handle: '第三部分「用典阐释」',
    const: 'CLASSICS_TERMS',
    out: 'src/domain/terms-data/classics.ts',
    perGroup: 20,
  },
]

const PART_OF = new Map(PARTS.map((part) => [part.part, part]))

/* ── 读材料 ────────────────────────────────────────────────────── */

/** 读一个 JSON（顺手吃掉 BOM——整理代理在 Windows 上写的文件可能带）。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

/** `p017-p024` → `{ from: 17, to: 24 }`；认不出来就抛（拼错的页范围不该被静默跳过）。 */
function parsePageRange(text) {
  const match = /^p(\d+)\s*-\s*p(\d+)$/.exec(String(text ?? '').trim())
  if (!match) throw new Error(`页范围认不出来（要形如 p017-p024）：${JSON.stringify(text)}`)
  return { from: Number(match[1]), to: Number(match[2]) }
}

/**
 * 把 `handbook-src/` 下的块读进来，**按部分分组、组内按起始页排序**。
 *
 * 排序按材料自身的页范围而不是文件名，这样文件名写错也乱不了顺序；
 * 同时用文件名里的部分前缀与 JSON 里的 `part` 互相校验，
 * 一个块被贴错标签（比如 classics 的内容存成 contemporary-*.json）能当场抓住。
 */
function readBlocks() {
  const names = readdirSync(MATERIAL_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (names.length === 0) throw new Error(`handbook-src 里一个 JSON 都没有：${MATERIAL_DIR}`)

  const blocks = []
  for (const name of names) {
    const path = resolve(MATERIAL_DIR, name)
    const json = readJson(path)
    const meta = PART_OF.get(json.part)
    if (!meta) throw new Error(`${name} 的 part 不认识：${JSON.stringify(json.part)}`)
    if (!name.startsWith(`${json.part}-`)) {
      throw new Error(`${name} 的文件名前缀与文件里的 part（${json.part}）不一致`)
    }
    const range = parsePageRange(json.pages)
    if (!Array.isArray(json.entries)) throw new Error(`${name} 没有 entries 数组`)
    blocks.push({ name, path, meta, range, entries: json.entries, notes: String(json.notes ?? '') })
  }

  for (const meta of PARTS) {
    const mine = blocks.filter((block) => block.meta.part === meta.part)
    if (mine.length === 0) throw new Error(`${meta.handle}（${meta.part}）一个块都没有`)
    mine.sort((a, b) => a.range.from - b.range.from || a.range.to - b.range.to)
    meta.blocks = mine
  }
  return blocks
}

/* ── 体检 ──────────────────────────────────────────────────────── */

/** 英文里**一定**是 OCR 残留的字形错误：这些串都不是英文单词，出现即错。 */
const BROKEN_WORDS = /\b(tO|t0|0f|dO|whO|alSO|AII|lt|iS|aS|hiS|ofthe|Ofwords)\b/

/**
 * 英文里不该出现的**中文标点与全角标点**。
 *
 * ⚠️ 弯引号 `“ ”` **不在**这一列：手册自己在英文译法里就用中文弯引号圈口号
 * （`to adopt multiple forms/models of distribution with “to each according to their work”
 * as the principal form`），那是原书的写法，照原样留着；而 `terms.ts` 的 `normalizeAnswer`
 * 本来就把 `“ ”` 折成直引号，所以用户打直引号一样判对，不影响判分。
 * 真正该拦的是 `。，、；：！？（）` 这类中文标点混进英文。
 */
const CHINESE_PUNCTUATION = /[\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\uff08\uff09\u3000]/

/**
 * 逐条体检。**返回 { errors, warnings }**：errors 非空就不写文件。
 *
 * 这里查的四类正好是对应关系里的四种硬伤：
 *   1. **页对应**：`page` 必须落在这个块自己的页范围里（整理时把一个块的内容写到另一个块里，
 *      页码最先露馅）；
 *   2. **重复**：同一个部分里同一条中文出现两次（同一页被两块各收了一遍这件事真的发生过）；
 *   3. **中英都在**：缺英文的条目按规矩应当是 `en: []`，但那种条目**没法出题**，
 *      所以这里当错误报出来让人决定，而不是悄悄生成一条永远判错的题；
 *   4. **残留 OCR 字形**：见上面两个正则。
 */
function audit(blocks) {
  const errors = []
  const warnings = []
  const crossPart = []
  const seenZh = new Map()

  for (const block of blocks) {
    for (const [index, entry] of block.entries.entries()) {
      const where = `${block.name} 第 ${index + 1} 条`
      const cn = entry?.cn
      const en = entry?.en
      const page = entry?.page

      if (typeof cn !== 'string' || cn.trim().length === 0) {
        errors.push(`${where}：cn 不是非空字符串`)
        continue
      }
      if (cn !== cn.trim() || /[\s\u3000]/.test(cn)) {
        errors.push(`${where}：cn 里还有空白（OCR 的汉字间空格没去干净）：${JSON.stringify(cn)}`)
      }
      if (!Array.isArray(en) || en.length === 0) {
        errors.push(`${where}（${cn}）：en 是空的——这条没法出题，要人工决定补还是删`)
      } else {
        for (const text of en) {
          if (typeof text !== 'string' || text.trim().length === 0) {
            errors.push(`${where}（${cn}）：en 里有一条空的译法`)
            continue
          }
          if (text !== text.trim() || /\s{2,}/.test(text)) {
            errors.push(`${where}（${cn}）：译法里有连续/首尾空白：${JSON.stringify(text)}`)
          }
          if (BROKEN_WORDS.test(text)) {
            errors.push(`${where}（${cn}）：译法里还有 OCR 字形残留：${JSON.stringify(text)}`)
          }
          if (CHINESE_PUNCTUATION.test(text)) {
            errors.push(`${where}（${cn}）：译法里有中文/全角标点：${JSON.stringify(text)}`)
          }
          if (/[\u4e00-\u9fff]/.test(text)) {
            errors.push(`${where}（${cn}）：译法里混进了汉字：${JSON.stringify(text)}`)
          }
        }
      }
      if (!Number.isInteger(page) || page < block.range.from || page > block.range.to) {
        errors.push(
          `${where}（${cn}）：page=${JSON.stringify(page)} 不在本块的页范围 ${block.range.from}-${block.range.to} 里`,
        )
      }

      const key = cn.replace(/[\s\u3000]/g, '')
      if (seenZh.has(key)) {
        const first = seenZh.get(key)
        if (first.part === block.meta.part) {
          errors.push(`中文重复：${JSON.stringify(cn)}（${first.block} 与 ${block.name}）`)
        } else {
          crossPart.push({ cn, a: first.block, b: block.name })
        }
      } else {
        seenZh.set(key, { block: block.name, part: block.meta.part })
      }
    }
  }
  return { errors, warnings, crossPart }
}

/* ── 装配 ──────────────────────────────────────────────────────── */

/**
 * 撇号订正：手册与 `文章.docx` 犯的是同一个错——所有格的撇号写成了 `‘`（U+2018）。
 * 只修这一个字符，且只修**不含汉字**的串（中文里的 `‘…’` 是嵌套引号，是对的）。
 * 与 `build-terms.mjs` 的 `fixApostrophes` 同一口径。
 */
function fixApostrophes(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return text
  return text.split('\u2018').join('\u2019')
}

/** 全角括号 → 半角（存储、显示、比对三处都用半角）。 */
function halfWidthParens(text) {
  return text.replace(/\uff08/g, '(').replace(/\uff09/g, ')')
}

/**
 * 去掉**末尾**的句号/句号（`. 。`），只用于生成"另一个写法"，不用于显示。
 *
 * 只去末尾、且必须还剩东西：`...others.` → `...others`；`U.S.` 这类缩写整串都是点的情况
 * 不会出现在这批材料里（都是句子或短语），真出现了也只是多一条别名，不影响判分。
 */
function withoutTrailingPeriod(text) {
  const stripped = text.replace(/[.\u3002]+$/, '').trim()
  return stripped.length > 0 ? stripped : text
}

/** 一条译法最多展开出几条"并列写法"（防止某个句子里的斜杠多到组合爆炸）。 */
const MAX_PRINTED_VARIANTS = 8

/**
 * 把手册自己用来表示**并列写法**的两种记号展开成"另外几种也算对的写法"。
 *
 * 手册在排版上用了两套记号，读者一眼就懂，但程序照着字符串比会**冤枉人**：
 *
 * 1. **括号 = 可省略**：`Chinese (path to) modernization` 意思是"带不带 `path to` 都对"，
 *    而第一部分同一本书里印的就是 `Chinese path to modernization`——用户照第一部分那一版写，
 *    在第二部分这边会被判错，那是"我明明写对了它却说错"（本项目最忌讳的一类）。
 *    因此把"带括号里那段"与"整段省掉"两种写法都补上。
 *   ⚠️ 只管**中间的**括号（前后都有内容）。**结尾**的括号是官方缩写，那件事由
 *   `terms.ts` 的 `primaryEnglish` 管（它会把尾部括号单独列出来），这里不重复也不越权。
 * 2. **斜杠 = 并列可选**：`a new form/model/type of international relations` 意思是三者之一，
 *    `to remain/stay true to…` 是两个动词都行。因此把斜杠两侧的每一段各自代入，
 *    得到"只写其中一个"的那些写法（多组斜杠取**全部组合**，`form/model` × `advancement/progress` 四种都算对）。
 *
 * 这两类都**不是同义替换**：它们是**手册自己写在纸面上的同一个答案的不同写法**，
 * 与官方缩写、英美拼写是同一性质（口径见 `terms.ts` ADR 0023 那一段）。
 * 展开出来的写法一律进 `enAlt`（"一并算对的其它写法"），**绝不替换 `en`**——
 * 屏幕上显示的标准答案永远是手册印的那一串。
 */
function printedVariants(text) {
  const out = []
  const tidy = (value) => value.replace(/\s+/g, ' ').trim()

  // ① 中间的括号：带与不带都补上
  const paren = /^([^()]*)\(([^()]*)\)([^()]*)$/.exec(text)
  if (paren && paren[1].trim().length > 0 && paren[3].trim().length > 0) {
    out.push(tidy(`${paren[1]}${paren[2]}${paren[3]}`))
    out.push(tidy(`${paren[1]}${paren[3]}`))
  }

  // ② 斜杠隔开的并列词：每个组合各生成一条
  const groups = [...text.matchAll(/[A-Za-z][A-Za-z'\u2019-]*(?:\/[A-Za-z][A-Za-z'\u2019-]*)+/g)]
  if (groups.length > 0) {
    let combos = [text]
    for (const group of groups) {
      const choices = group[0].split('/')
      const next = []
      for (const base of combos) {
        for (const choice of choices) next.push(base.split(group[0]).join(choice))
      }
      combos = next
      if (combos.length > MAX_PRINTED_VARIANTS) break
    }
    out.push(...combos)
  }

  return [...new Set(out.filter((value) => value !== text && value.length > 0))]
}

/** 一个块里的条目 → 术语数据（`Term` 那个形状）。 */
function toTerm(entry) {
  const renderings = entry.en.map((text) => halfWidthParens(fixApostrophes(text)))
  const [primary, ...rest] = renderings

  // 手册自己写出来的并列写法（括号里的可省略、斜杠两侧的并列词，见 printedVariants）
  const printed = renderings.flatMap(printedVariants)

  const enAlt = []
  for (const text of rest) enAlt.push(text)
  for (const text of printed) enAlt.push(text)
  // "末尾句号写不写都算对"：原串与展开出来的串各补一条去句号的写法
  for (const text of [...renderings, ...printed]) {
    const bare = withoutTrailingPeriod(text)
    if (bare !== text) enAlt.push(bare)
  }

  const zhBare = withoutTrailingPeriod(entry.cn)
  const zhAlt = zhBare === entry.cn ? [] : [zhBare]

  const unique = (list, exclude) => {
    const seen = new Set([exclude])
    const out = []
    for (const text of list) {
      if (seen.has(text)) continue
      seen.add(text)
      out.push(text)
    }
    return out
  }

  return {
    zh: entry.cn,
    en: primary,
    enAlt: unique(enAlt, primary),
    zhAlt,
    page: entry.page,
    extraRenderings: rest.length,
    printedVariants: printed.length,
  }
}

/** 一个板块的全部条目（块按页序、块内按整理顺序——这就是题号顺序）。 */
function collect() {
  const blocks = readBlocks()
  const byPart = new Map()
  for (const meta of PARTS) {
    const terms = meta.blocks.flatMap((block) => block.entries.map(toTerm))
    byPart.set(meta.part, terms)
  }
  const zhGroups = attachZhAlt(PARTS.flatMap((meta) => byPart.get(meta.part)))
  return { blocks, byPart, zhGroups }
}

/**
 * **一英多中**：同一条英文对应的其它中文名，互相登记进 `zhAlt`（与 `build-terms.mjs` 同一口径）。
 *
 * 手册里真的出现过这种一对二：
 *   `落实“六稳”“六保”任务`（第一部分）与 `落实“六稳”任务`（第二部分）
 *   的英文**是同一条** `to stabilize the Six Fronts and guarantee the Six Priorities`。
 * 英译中方向下，用户写「六稳六保」还是只写「六稳」都对——这正是 `zhAlt` 存在的理由
 * （先前的两份机关名称材料里是「直辖市人民政府／设区的市人民政府」那一对）。
 *
 * 判据用**归一化之后的主译法**（去掉尾部括号、大小写与空白归一），
 * 因为两边印的可能是同一个答案的两种写法（连字符、英文/美式拼写）。
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
    groups.push({ en: bucket[0].en, zh: zhSet })
    for (const term of bucket) {
      const others = zhSet.filter((zh) => zh !== term.zh)
      term.zhAlt = [...new Set([...term.zhAlt, ...others])]
    }
  }
  return groups
}

/** 分组（与 `terms.ts` 的 `groupsOfScope` 同一套算法，用来在报告里核对组边界）。 */
function groupsOf(terms, perGroup, label) {
  const groups = []
  for (let start = 0; start < terms.length; start += perGroup) {
    const count = Math.min(perGroup, terms.length - start)
    groups.push({
      index: groups.length,
      label: `${label}|第${groups.length + 1}组（${start + 1}-${start + count}）`,
      from: start + 1,
      to: start + count,
      count,
    })
  }
  return groups
}

/* ── 写文件 ────────────────────────────────────────────────────── */

function renderFile(meta, terms, groups) {
  const pages = `${meta.blocks[0].range.from}–${meta.blocks.at(-1).range.to}`
  const lines = []
  lines.push('/**')
  lines.push(` * 术语库 · ${meta.label}（**自动生成，不要手改**）`)
  lines.push(' *')
  lines.push(` * 来源：\`handbook-src/\` 里整理好的《理解当代中国 核心术语学习手册》条目`)
  lines.push(` * （${meta.handle}，${meta.blocks.length} 个块，PDF 第 ${pages} 页），`)
  lines.push(` * 而手册是**扫描件**（没有文字层），最上游是 Windows OCR——`)
  lines.push(` * 英文里必然残留识别错误，整理者在各块的 \`notes\` 里逐处登记了订正，这里不再改动。`)
  lines.push(' * 生成命令：node scripts/build-handbook-terms.mjs --write')
  lines.push(' *')
  lines.push(
    ` * ${terms.length} 条，每 ${meta.perGroup} 条一组，共 ${groups.length} 组` +
      `（末组 ${groups.at(-1).count} 条）：`,
  )
  const first = groups[0]
  const tail = groups.at(-1)
  lines.push(
    ` *   ${first.label} … ${tail.label}；` +
      (groups.every((group) => group.count === meta.perGroup)
        ? `每组都是 ${meta.perGroup} 条`
        : `中间每组 ${meta.perGroup} 条，末组 ${tail.count} 条`),
  )
  lines.push(' *')
  lines.push(' * 每条：`zh` 中文（照手册原样，含句末标点）、`en` 手册给的英文译法（一条术语多条时取第一条）、')
  lines.push(' * `enAlt` 一并算对的其它写法（该条的其它译法 + 去掉末尾句号的写法）、')
  lines.push(' * `zhAlt` 英译中方向同样算对的其它中文写法（去掉末尾句号的写法）。')
  lines.push(' * ⚠️ **末尾句号写不写都算对**是照 `terms.ts` 的放宽口径给的（见那个文件头），')
  lines.push(' * 不是同义替换放宽；屏幕上的标准答案仍是带标点的原样。')
  lines.push(' */')
  lines.push('')
  lines.push("import type { Term } from '../terms'")
  lines.push('')
  lines.push(`export const ${meta.const}: readonly Term[] = [`)
  for (const term of terms) {
    lines.push('  {')
    lines.push(`    zh: ${JSON.stringify(term.zh)},`)
    lines.push(`    en: ${JSON.stringify(term.en)},`)
    lines.push(`    enAlt: ${JSON.stringify(term.enAlt)},`)
    lines.push(`    zhAlt: ${JSON.stringify(term.zhAlt)},`)
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

/* ── 报告 ──────────────────────────────────────────────────────── */

function main() {
  const write = process.argv.includes('--write')
  const { blocks, byPart, zhGroups } = collect()
  const { errors, warnings, crossPart } = audit(blocks)

  console.log('== 手册整理块 ==')
  for (const meta of PARTS) {
    const mine = blocks.filter((block) => block.meta.part === meta.part)
    const count = mine.reduce((sum, block) => sum + block.entries.length, 0)
    console.log(
      `  ${meta.handle} → ${meta.label}（${meta.id}）：${count} 条 · ${mine.length} 个块 · 每 ${meta.perGroup} 条一组`,
    )
    for (const block of mine) {
      const dubious = (block.notes.match(/存疑（配对）/g) ?? []).length
      console.log(
        `    ${block.name.padEnd(28)} ${String(block.entries.length).padStart(3)} 条` +
          ` · 页 ${block.range.from}-${block.range.to}` +
          (dubious > 0 ? ` · ⚠ notes 里 ${dubious} 处「存疑（配对）」` : ''),
      )
    }
    const groups = groupsOf(byPart.get(meta.part), meta.perGroup, meta.label)
    console.log(`    分组 ${groups.length} 组，边界：${groups.map((g) => `${g.from}-${g.to}`).join(' / ')}`)
    const multi = byPart.get(meta.part).filter((term) => term.extraRenderings > 0)
    console.log(
      `    多译法 ${multi.length} 条；带 aliases 的 ${byPart.get(meta.part).filter((t) => t.enAlt.length > 0).length} 条`,
    )
    const printed = byPart.get(meta.part).reduce((sum, term) => sum + term.printedVariants, 0)
    const printedTerms = byPart.get(meta.part).filter((term) => term.printedVariants > 0).length
    console.log(
      `    手册写在纸面上的并列写法：${printedTerms} 条译法展开出 ${printed} 种"也算对"的写法（括号可省略 + 斜杠并列）`,
    )
  }

  const total = PARTS.reduce((sum, meta) => sum + byPart.get(meta.part).length, 0)
  console.log(`  合计 ${total} 条`)
  console.log('')
  const pairingDoubt = blocks.reduce((sum, block) => sum + (block.notes.match(/存疑（配对）/g) ?? []).length, 0)
  console.log(`== 整理者自报的「存疑（配对）」：${pairingDoubt} 处（独立审计见 %TEMP%\\handbook-audit-pairing.md）==`)
  console.log('')

  if (crossPart.length > 0) {
    console.log(`== 跨板块重复：${crossPart.length} 条（**不是错误**，是原书体例） ==`)
    console.log('   第二部分「术语解读」讲的就是第一部分里最该背的那些术语，所以同一条')
    console.log('   在「当代术语」与「必背核心术语」两个板块里各出现一次是对的（练习角度不同）。')
    console.log(`   涉及：${crossPart.slice(0, 6).map((item) => item.cn).join('、')} …`)
    console.log('')
  }
  console.log(`== 一英多中（英译中方向写哪个都算对）：${zhGroups.length} 组 ==`)
  if (zhGroups.length === 0) console.log('  没有')
  for (const group of zhGroups) console.log(`  ${group.zh.join(' ／ ')}  ← 同为 ${group.en}`)
  console.log('')
  if (warnings.length > 0) {
    console.log('== 提醒（不拦写入） ==')
    for (const warning of warnings.slice(0, 12)) console.log(`  ⚠ ${warning}`)
    if (warnings.length > 12) console.log(`  ⚠ …另有 ${warnings.length - 12} 条同类提醒未列出`)
    console.log('')
  }
  if (errors.length > 0) {
    console.log('== 问题 ==')
    for (const error of errors) console.log(`  ✗ ${error}`)
    process.exitCode = 1
    console.log('\n有数据问题，没有写文件。')
    return
  }
  console.log('== 数据体检通过（条数 / 页对应 / 重复 / OCR 残留 四项） ==')

  if (!write) {
    console.log('\n（体检模式：没有写文件。要写请加 --write）')
    return
  }
  for (const meta of PARTS) {
    const path = resolve(ROOT, meta.out)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, renderFile(meta, byPart.get(meta.part), groupsOf(byPart.get(meta.part), meta.perGroup, meta.label)), 'utf8')
  }
  console.log(`\n已写入：${PARTS.map((meta) => meta.out).join('、')}`)
}

main()
