/**
 * 术语库体检：**两个范围的条数与页数、每一条两侧都干净、分页不丢不重、判分只认该认的写法**。
 *
 * 为什么需要它：143 条机关名称是 `scripts/build-terms.mjs` 从两份 docx 现算出来的，
 * 而算错**不会让任何测试变红**（界面上照样能练），只会让题库悄悄变差——
 * 少收一条、末页多出一条、两条撞成同一条、全角括号漏掉一个、"该算对的写法"少了一种。
 *
 * 最要命的一类是**假放宽**：判分表不是手写的，是**按词表做字符串替换**生成的
 * （英美拼写照词给出、英文末尾的括号拆成官方缩写、英美差异取全部组合）。
 * 这类规则一旦写宽，无关的答案会被悄悄判对——把 `-our → -or` 写成通则，
 * `four` 就会被"接受"成 `for`；而用户看到的是"我写错了它却说对"。
 * 这种错**不查就永远看不见**，因此第 5 组把口径钉死：除了互相登记过的一英多中
 * （整库唯一一对：直辖市人民政府 / 设区的市人民政府，两者官方英文同一条），
 * 任何一条术语都不许接受另一条术语的任何写法。
 *
 * 七段判据（控制台里的编号与这里一致）：
 *   1. **范围与条数**：两个范围、顺序与名字、83 条 17 页（末页 3 条）、
 *      60 条 12 页（末页 5 条，因为 60 正好整除 5）、合计 143 条；
 *   2. **每一条**：中英文非空、英文侧没有汉字/全角括号/U+2018
 *      （材料里所有格的撇号统统写成了左单引号，生成时已订正，见 build-terms.mjs 的 fixApostrophes；
 *      中文一侧不查 U+2018——中文里的「‘…’」是嵌套引号，是对的）、
 *      中文名没有半角括号（全角才对，出现半角多半是生成时改坏的）、
 *      别名（enAlt/zhAlt）都非空、都真的被判对、归一后不与主答案相同
 *      （"归一后与主答案一样"的别名是白占位，还会掩盖生成器的 bug）、
 *      英文末尾的括号里的缩写必须出现在 enAlt 里；
 *   3. **分页**：每页 1..5 条、**不满 5 条的页至多一个且必是末页**
 *      （这条边界正是"缺的行留空"能成立的原因）、越界页返回空、
 *      所有页拼起来与范围逐条同**一批对象**（不丢、不重、顺序不变）；
 *   4. **题面**：按空行切成正好"页数"段、第 k 段正好"第 k 页的条数"行、
 *      行就是题干那一侧（中译英给中文、英译中给英文），并与界面真正用的 `splitSections` 对齐；
 *   5. **题号**：`term-v3-<范围>-<方向>` 能原样回读、`term-v2-…` 与各种残缺题号一律解析失败；
 *   6. **判分**：不过度接受（逐对逐写法，跨范围也比）、acceptedAnswers 非空且归一后不重复、
 *      第 0 个就是屏幕上显示的标准答案、空作答两个方向都算错；
 *   7. **库的形状**：条数、页长分布、带别名的条数、zhAlt 分组，给人一眼看清整库。
 *
 * 用法：
 *   node scripts/check-terms.mjs            体检并逐条打印
 *   node scripts/check-terms.mjs --brief    只打印分组结论、库的形状报告与提醒
 *
 * 它**不读 docx**：读的是生成出来的 `src/domain/terms-data/*.ts`，
 * 因此与生成器相互独立（生成器自己的体检是 `node scripts/build-terms.mjs`，两份报告应当对得上）。
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

/* ── 用 esbuild 把领域模块打成一个临时包（与 check-articles.mjs 同一套做法） ── */

const root = process.cwd()
const brief = process.argv.includes('--brief')
const outDir = path.join(root, 'node_modules', '.cache', 'check-terms')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, 'terms.mjs')
const domain = (file) => JSON.stringify(path.join(root, 'src', 'domain', file))

await writeFile(
  path.join(outDir, 'entry.ts'),
  // 显式列出要用的名字：`export *` 两个模块一旦撞名会变成含糊导出，
  // 显式写出来也顺便说明"这个脚本到底依赖哪几个函数"。
  `export { TERMS_BY_SCOPE, TERMS_PER_PAGE, termsOfScope, termPageCount, termsOfPage, pageOfTerm, allTerms, primaryEnglish, acceptedAnswers, standardAnswer, normalizeAnswer, isTermCorrect } from ${domain('terms.ts')}\n` +
    `export { TERM_SCOPES, labelOfScope } from ${domain('term-scopes.ts')}\n` +
    `export { termExerciseId, parseTermExerciseId, isLegacyTermExerciseId, termSourceText, termPagesOfExercise, termsForPageOfExercise, termsForExerciseId, questionSideOf } from ${domain('term-exercise.ts')}\n` +
    `export { splitSections } from ${domain('sections.ts')}\n`,
  'utf8',
)
await build({
  entryPoints: [path.join(outDir, 'entry.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})

const mod = await import(pathToFileURL(outFile).href)
const {
  TERMS_BY_SCOPE,
  TERMS_PER_PAGE,
  TERM_SCOPES,
  termsOfScope,
  termPageCount,
  termsOfPage,
  pageOfTerm,
  allTerms,
  primaryEnglish,
  acceptedAnswers,
  standardAnswer,
  normalizeAnswer,
  isTermCorrect,
  labelOfScope,
  termExerciseId,
  parseTermExerciseId,
  isLegacyTermExerciseId,
  termSourceText,
  termPagesOfExercise,
  termsForPageOfExercise,
  termsForExerciseId,
  questionSideOf,
  splitSections,
} = mod

/* ── 断言与输出 ───────────────────────────────────────────────────── */

const results = []
/**
 * 记一条断言。`quiet` 只在通过时静音（`--brief` 靠它压掉逐条那一百多行），
 * **失败的永远打印**——否则 --brief 会把问题藏起来。
 */
function check(ok, label, detail, quiet = false) {
  results.push({ ok })
  if (ok && quiet) return
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail !== undefined ? ` — ${detail}` : ''}`)
}

/** 数据一旦缺字段，断言要能说清是哪儿缺，而不是把体检脚本自己搞崩。 */
const textOf = (value) => (typeof value === 'string' ? value : '')
const enAltsOf = (term) => (Array.isArray(term.enAlt) ? term.enAlt : [])
const zhAltsOf = (term) => (Array.isArray(term.zhAlt) ? term.zhAlt : [])

const SCOPES = TERM_SCOPES.map((scope) => scope.id)
const DIRECTIONS = ['zh-to-en', 'en-to-zh']
const directionLabel = (direction) => (direction === 'zh-to-en' ? '中译英' : '英译中')

/*
 * 体检开始前，先把整库在**内存里**平一遍：缺的字段补空串/空数组，别名表里的非字符串换成空串，
 * 连"根本不是对象"的那一格也换成一个空壳。
 *
 * 为什么要平：数据文件一旦缺字段，交给 domain 的 `primaryEnglish(term)`（内部读 `term.en`）
 * 和 `isTermCorrect(term, …)` 会**直接抛错**——而"缺字段"恰恰是体检最该说清楚的那一刻，
 * 不该只甩一串调用栈。平过之后每一条断言都照常跑，输出的就是
 * "国内机关名称 第 3 条「…」的英文名是空的"这种指名道姓的话。
 *
 * 两条边界：
 *   - 只动内存里的副本：磁盘上 `terms-data/*.ts` 一个字都不改（体检脚本绝不写数据）；
 *   - 原始字段名与原始类型先记下来（`ORIGINAL_KEYS` / `REPAIRED`），第 2 组按**原始数据**判
 *     "是不是少了一个字段 / 类型不对"——否则"enAlt 整个字段没了"会被平成一个合法的空数组、
 *     看上去就像"这一条本来就没有别名"，悄悄地蒙过去。
 */
const ORIGINAL_KEYS = new Map()
const REPAIRED = new Map()
for (const scopeId of SCOPES) {
  const list = termsOfScope(scopeId)
  list.forEach((term, index) => {
    if (!term || typeof term !== 'object') {
      list[index] = { zh: '', en: '', enAlt: [], zhAlt: [] }
      REPAIRED.set(list[index], ['这一格根本不是一条术语（不是对象）'])
      return
    }
    ORIGINAL_KEYS.set(term, Object.keys(term).sort().join(','))
    const notes = []
    if (typeof term.zh !== 'string') notes.push(`zh 不是字符串（实际是 ${typeof term.zh}）`)
    if (typeof term.en !== 'string') notes.push(`en 不是字符串（实际是 ${typeof term.en}）`)
    if (!Array.isArray(term.enAlt)) notes.push(`enAlt 不是数组（实际是 ${typeof term.enAlt}）`)
    if (!Array.isArray(term.zhAlt)) notes.push(`zhAlt 不是数组（实际是 ${typeof term.zhAlt}）`)
    if (notes.length > 0) REPAIRED.set(term, notes)
    if (typeof term.zh !== 'string') term.zh = ''
    if (typeof term.en !== 'string') term.en = ''
    term.enAlt = Array.isArray(term.enAlt) ? term.enAlt.map(textOf) : []
    term.zhAlt = Array.isArray(term.zhAlt) ? term.zhAlt.map(textOf) : []
  })
}

/**
 * 每个范围应有的条数、页数与末页条数。
 *
 * 国内那份 83 条 = 16 × 5 + 3，末页因此只有 3 条、界面上空两行；
 * 国际那份 60 条正好 12 × 5，**末页也是满的**——"缺的行留空"这条规则
 * 在整库里只在国内那份的末页真的发生（第 3 组把这件事写成断言）。
 */
const EXPECTED = {
  'cn-org': { label: '国内机关名称', count: 83, pages: 17, lastPage: 3 },
  'intl-org': { label: '国际机关名称', count: 60, pages: 12, lastPage: 5 },
}

/* ── 1. 两个范围与条数 ────────────────────────────────────────────── */

console.log('=== 1. 两个范围与条数 ===')
check(
  TERM_SCOPES.length === 2 && SCOPES.join(',') === 'cn-org,intl-org',
  `范围表正好两行，顺序是 ${TERM_SCOPES.map((scope) => `${scope.id}（${scope.label}）`).join(' → ')}`,
  `实际的 id 顺序是 ${SCOPES.join(' → ')}，应为 cn-org → intl-org`,
)
check(
  TERM_SCOPES.map((scope) => scope.label).join('/') === '国内机关名称/国际机关名称',
  `两张卡片的顺序与名字：${TERM_SCOPES.map((scope) => scope.label).join(' → ')}`,
  `名字是 ${TERM_SCOPES.map((scope) => scope.label).join('/')}，应为 国内机关名称/国际机关名称`,
)
check(
  TERMS_PER_PAGE === 5,
  `一页 ${TERMS_PER_PAGE} 条（用户要的是五栏）`,
  `TERMS_PER_PAGE 是 ${TERMS_PER_PAGE}，应为 5`,
)
check(
  Object.keys(TERMS_BY_SCOPE).length === TERM_SCOPES.length && SCOPES.every((id) => id in TERMS_BY_SCOPE),
  `TERMS_BY_SCOPE 的键与范围表一一对应：${Object.keys(TERMS_BY_SCOPE).join('、')}`,
  `键是 ${Object.keys(TERMS_BY_SCOPE).join('、')}，范围表是 ${SCOPES.join('、')}`,
)

for (const id of SCOPES) {
  const want = EXPECTED[id]
  const list = termsOfScope(id)
  const pages = termPageCount(id)
  const last = termsOfPage(id, pages - 1).length
  const shapeOk = pages === Math.ceil(list.length / TERMS_PER_PAGE) && last === (list.length % TERMS_PER_PAGE || TERMS_PER_PAGE)
  check(
    list.length === want.count && pages === want.pages && last === want.lastPage && shapeOk,
    `${want.label}：${list.length} 条 / ${pages} 页（末页 ${last} 条，其余页各 5 条）`,
    `实际 ${list.length} 条 / ${pages} 页 / 末页 ${last} 条，应为 ${want.count} 条 / ${want.pages} 页 / 末页 ${want.lastPage} 条`,
  )
}

{
  const flat = SCOPES.flatMap((id) => termsOfScope(id))
  const library = allTerms()
  const expectedTotal = SCOPES.reduce((sum, id) => sum + EXPECTED[id].count, 0)
  check(
    library.length === expectedTotal && library.length === flat.length && library.every((term, index) => term === flat[index]),
    `全库 ${library.length} 条（${SCOPES.map((id) => `${labelOfScope(id)} ${termsOfScope(id).length}`).join(' ＋ ')}），顺序与两个范围一致`,
    `allTerms() 给出 ${library.length} 条，应为 ${expectedTotal} 条、且与两个范围按顺序拼起来的完全一致`,
  )
}

/* ── 2. 每一条：两侧非空、没有脏字符、别名都真的算对 ───────────────── */

console.log('\n=== 2. 每一条：两侧非空、没有脏字符、别名都真的算对 ===')

/** 中文名 → 库里的那些条目（zhAlt 必须指向真实存在的另一条）。 */
const zhIndex = new Map()
for (const id of SCOPES) {
  for (const term of termsOfScope(id)) {
    const key = textOf(term.zh)
    if (!zhIndex.has(key)) zhIndex.set(key, [])
    zhIndex.get(key).push(term)
  }
}
/** 同一个范围里中文名重复几次（重复就是同一页出现两道同题）。 */
const zhCount = new Map()
for (const id of SCOPES) {
  for (const term of termsOfScope(id)) {
    const key = `${id}\u0000${textOf(term.zh)}`
    zhCount.set(key, (zhCount.get(key) ?? 0) + 1)
  }
}
/** 空白作答的几种写法：空串、空格、制表、全角空格。归一化之后都必须不撞任何一条答案。 */
const BLANK_ANSWERS = ['', '   ', '\t', '\u3000', ' \u3000 ']

for (const id of SCOPES) {
  const list = termsOfScope(id)
  list.forEach((term, index) => {
    const problems = []
    const zh = textOf(term.zh)
    const en = textOf(term.en)
    const enAlts = enAltsOf(term)
    const zhAlts = zhAltsOf(term)
    const primary = primaryEnglish(term)

    /*
     * 形状。字段名与字段类型都按**原始数据**判（见开头"在内存里平一遍"那一段）：
     * 平过之后"缺字段"和"类型不对"都不会再抛错，所以这里必须自己把它们说出来，
     * 否则一个被平掉的 enAlt 看上去就像"这一条本来就没有别名"。
     */
    const keys = ORIGINAL_KEYS.get(term) ?? Object.keys(term).sort().join(',')
    if (keys !== 'en,enAlt,zh,zhAlt') problems.push(`字段集合是「${keys}」，应为 zh,en,enAlt,zhAlt`)
    for (const note of REPAIRED.get(term) ?? []) problems.push(`${note}——体检时按空值处理，先当它没有`)
    if (zh.trim().length === 0) problems.push('中文名是空的')
    if (en.trim().length === 0) problems.push('英文名是空的')
    if (zhCount.get(`${id}\u0000${zh}`) > 1) problems.push(`中文名「${zh}」在本范围内出现了 ${zhCount.get(`${id}\u0000${zh}`)} 次`)
    if (/[()]/.test(zh)) problems.push(`中文名「${zh}」里有半角括号（中文名一律全角，半角多半是生成时改坏的）`)

    // 英文一侧的脏字符
    const englishSide = [['en', en], ...enAlts.map((alt, i) => [`enAlt[${i}]`, textOf(alt)])]
    for (const [slot, text] of englishSide) {
      if (text.length === 0) {
        problems.push(`${slot} 是空的`)
        continue
      }
      if (/[\u4e00-\u9fff]/.test(text)) problems.push(`${slot}「${text}」里有汉字（英文一侧混进了中文）`)
      if (/[\uff08\uff09]/.test(text)) problems.push(`${slot}「${text}」里还有全角括号（全篇一律半角）`)
      if (text.includes('\u2018')) problems.push(`${slot}「${text}」里有没订正的撇号 U+2018（正确是 U+2019）`)
      if (text !== text.trim() || /\s{2,}/.test(text)) problems.push(`${slot}「${text}」有多余空白`)
    }

    // enAlt：必须是"另一种写法"。与主答案归一后相同的别名是白占位，还会掩盖生成器的 bug。
    enAlts.forEach((alt, i) => {
      const text = textOf(alt)
      if (text.trim().length === 0) {
        problems.push(`enAlt[${i}] 是空的`)
        return
      }
      const key = normalizeAnswer(text)
      if (key === normalizeAnswer(en)) problems.push(`enAlt[${i}]「${text}」归一后与 en 相同——这条"别名"是白占位`)
      else if (key === normalizeAnswer(primary)) problems.push(`enAlt[${i}]「${text}」归一后与主译法「${primary}」相同——这条"别名"是白占位`)
      if (!isTermCorrect(term, text, 'zh-to-en')) problems.push(`enAlt[${i}]「${text}」没有被 isTermCorrect 认（别名必须真的算对）`)
    })

    // 英文末尾那对括号里的官方缩写必须出现在 enAlt 里（生成器靠 splitAlias 接线，接错了没人会发现）
    const tail = /\(([^()]*)\)\s*$/.exec(en)
    if (tail) {
      const inner = tail[1].trim()
      if (!enAlts.some((alt) => normalizeAnswer(textOf(alt)) === normalizeAnswer(inner))) {
        problems.push(`en 末尾括号里的「${inner}」不在 enAlt 里（官方缩写必须一并算对）`)
      }
    }

    // zhAlt：一英多中。必须真的算对，而且必须指向库里**主译法相同**的另一条。
    zhAlts.forEach((alt, i) => {
      const text = textOf(alt)
      if (text.trim().length === 0) {
        problems.push(`zhAlt[${i}] 是空的`)
        return
      }
      if (!isTermCorrect(term, text, 'en-to-zh')) problems.push(`zhAlt[${i}]「${text}」没有被 isTermCorrect 认（一英多中必须真的算对）`)
      const targets = zhIndex.get(text) ?? []
      if (targets.length === 0) problems.push(`zhAlt[${i}]「${text}」在库里找不到同名术语`)
      else if (!targets.some((other) => normalizeAnswer(primaryEnglish(other)) === normalizeAnswer(primary))) {
        problems.push(`zhAlt[${i}]「${text}」与「${zh}」的官方英文不是同一条（一英多中才有别名）`)
      }
    })

    // 判分表本身：非空、归一后不重复、第 0 个就是屏幕上显示的标准答案、空作答一律算错
    for (const direction of DIRECTIONS) {
      const label = directionLabel(direction)
      const accepted = acceptedAnswers(term, direction)
      if (accepted.length === 0) {
        // 空表就不必再说"第 0 个不对"了——上一句已经把话说清楚
        problems.push(`${label}：acceptedAnswers 是空的（屏幕上没有标准答案可显示）`)
      } else {
        const seen = new Set()
        for (const answer of accepted) {
          const key = normalizeAnswer(answer)
          if (key.length === 0) problems.push(`${label}：acceptedAnswers 里有一条归一后是空的（「${answer}」）`)
          if (seen.has(key)) problems.push(`${label}：acceptedAnswers 里有归一后重复的写法「${answer}」`)
          seen.add(key)
        }
        if (direction === 'zh-to-en') {
          if (accepted[0] !== en) problems.push(`${label}：acceptedAnswers 的第 0 个是「${accepted[0]}」，标准答案应显示照材料原样的「${en}」`)
          if (standardAnswer(term, direction) !== en) problems.push(`${label}：standardAnswer 给的是「${standardAnswer(term, direction)}」，应为「${en}」`)
        } else {
          if (accepted[0] !== zh) problems.push(`${label}：acceptedAnswers 的第 0 个是「${accepted[0]}」，应为中文名「${zh}」`)
          if (standardAnswer(term, direction) !== accepted.join('／')) {
            problems.push(`${label}：standardAnswer 给的是「${standardAnswer(term, direction)}」，应为算对的写法用「／」连起来「${accepted.join('／')}」`)
          }
        }
      }
      for (const blank of BLANK_ANSWERS) {
        if (isTermCorrect(term, blank, direction)) problems.push(`${label}：空白作答 ${JSON.stringify(blank)} 被判对了`)
      }
    }

    check(problems.length === 0, `${labelOfScope(id)} 第 ${index + 1} 条「${zh}」→ ${en}`, problems.join('；'), brief)
  })
}

/* ── 3. 分页：每页 5 条、末页可以不满、拼起来一条不丢 ─────────────── */

console.log('\n=== 3. 分页：每页 5 条、不满的页至多一个且必是末页、拼起来一条不丢 ===')

for (const id of SCOPES) {
  const list = termsOfScope(id)
  const pages = termPageCount(id)
  const sizes = Array.from({ length: pages }, (_, page) => termsOfPage(id, page).length)
  const problems = []
  sizes.forEach((size, page) => {
    // 一页至少一条（空页会让界面上整整五栏都是空的，那是"少收了一条"的症状）
    if (size < 1) problems.push(`第 ${page + 1} 页一条也没有`)
    // termsOfPage 一次最多给 5 条（多出来的第 6 条会挤掉下一页的一条）
    if (size > TERMS_PER_PAGE) problems.push(`第 ${page + 1} 页给了 ${size} 条，超过一页 ${TERMS_PER_PAGE} 条`)
  })
  /*
   * "不满 5 条的页"这条边界只允许出现在**末页**，而且整库至多一个。
   * 这正是用户拍板的"末页照旧五等分，缺的那两行留空、不可填也不计分"能成立的原因：
   * 空行只可能出现在最后那一页，界面不需要猜"这一页为什么少了两行"。
   */
  const short = sizes.map((size, page) => ({ size, page })).filter((item) => item.size < TERMS_PER_PAGE)
  if (short.length > 1) problems.push(`有 ${short.length} 个不满 ${TERMS_PER_PAGE} 条的页（第 ${short.map((item) => item.page + 1).join('、')} 页），至多只能有一个`)
  for (const item of short) {
    if (item.page !== pages - 1) problems.push(`第 ${item.page + 1} 页只有 ${item.size} 条、却不是末页（第 ${pages} 页）`)
  }
  check(
    problems.length === 0,
    `${labelOfScope(id)}：${pages} 页、页长 ${sizes.join(', ')}${short.length === 0 ? `（每页都满 ${TERMS_PER_PAGE} 条——${list.length} 正好整除）` : `（只有末页不满，空 ${TERMS_PER_PAGE - short[0].size} 行）`}`,
    problems.join('；'),
  )

  // 所有页拼起来必须与范围**逐条同一批对象**：同一个引用比字符串更严——丢了、重了、换了顺序都会露出来
  const joined = []
  for (let page = 0; page < pages; page += 1) joined.push(...termsOfPage(id, page))
  const mismatch = []
  if (joined.length !== list.length) mismatch.push(`拼起来 ${joined.length} 条，范围里 ${list.length} 条`)
  else {
    joined.forEach((term, index) => {
      if (term !== list[index]) mismatch.push(`第 ${index + 1} 条对不上（拼出来的是「${textOf(term.zh)}」）`)
    })
  }
  check(mismatch.length === 0, `${labelOfScope(id)}：所有页拼起来与 termsOfScope 逐条一致（${joined.length} 条，不丢不重、顺序不变）`, mismatch.slice(0, 6).join('；'))

  // pageOfTerm 是记录与收藏按页对回来的依据，写错只会"记住的页不是他做的那一页"
  const badPage = []
  list.forEach((term, index) => {
    const page = pageOfTerm(id, term)
    if (page !== Math.floor(index / TERMS_PER_PAGE)) badPage.push(`「${textOf(term.zh)}」算在第 ${page + 1} 页，应为第 ${Math.floor(index / TERMS_PER_PAGE) + 1} 页`)
  })
  check(badPage.length === 0, `${labelOfScope(id)}：每条术语都回得到它自己的那一页（pageOfTerm 与每页 ${TERMS_PER_PAGE} 条的切法一致）`, badPage.slice(0, 6).join('；'))
}

{
  const outOfRange = []
  for (const id of SCOPES) {
    const pages = termPageCount(id)
    for (const page of [-1, -5, pages, pages + 3, 99]) {
      const got = termsOfPage(id, page)
      if (got.length !== 0) outOfRange.push(`${labelOfScope(id)} 第 ${page} 页返回了 ${got.length} 条`)
    }
  }
  check(
    outOfRange.length === 0,
    `越界页一律返回空（合法页是 0..${termPageCount('cn-org') - 1} / 0..${termPageCount('intl-org') - 1}）`,
    outOfRange.join('；'),
  )
}

/* ── 4. 题面与题号 ────────────────────────────────────────────────── */

console.log('\n=== 4. 题面：按空行切正好一页一段、段内正好一行一条 ===')

for (const id of SCOPES) {
  for (const direction of DIRECTIONS) {
    const pages = termPageCount(id)
    const text = termSourceText(id, direction)
    // 界面按空行切段（domain/sections.ts 的 splitSections），因此"一页一段"是这里唯一的形状
    const blocks = text.split(/\n[ \t\u3000]*\n/)
    const problems = []
    if (blocks.length !== pages) problems.push(`按空行切成 ${blocks.length} 段，应为 ${pages} 段（一页一段）`)
    blocks.forEach((block, page) => {
      const lines = block.split('\n')
      const want = termsOfPage(id, page)
      if (lines.length !== want.length) {
        problems.push(`第 ${page + 1} 页有 ${lines.length} 行，应为 ${want.length} 行`)
        return
      }
      want.forEach((term, row) => {
        const expected = questionSideOf(term, direction)
        if (lines[row] !== expected) problems.push(`第 ${page + 1} 页第 ${row + 1} 行是「${lines[row]}」，应为「${expected}」`)
      })
      if (lines.some((line) => line.trim().length === 0)) problems.push(`第 ${page + 1} 页里有空行（页内是一行一条，空行会把自己切成两页）`)
    })
    if (text.startsWith('\n') || text.endsWith('\n')) problems.push('整段题面前后还有空行')
    if (/\n[ \t\u3000]*\n[ \t\u3000]*\n/.test(text)) problems.push('出现了连续两个空行')

    /*
     * 再和**界面真正用的那一份分页实现**对一遍：题面必须能被 splitSections 切成同样的页。
     * 只查"有几行"是不够的——行对不上、段被合并，界面上一页就会显示别页的术语。
     */
    const sections = splitSections(text)
    if (sections.length !== blocks.length) problems.push(`splitSections 切出 ${sections.length} 段，与按空行切的 ${blocks.length} 段不一致`)
    else {
      sections.forEach((section, page) => {
        if (section.text !== blocks[page].trim()) problems.push(`splitSections 第 ${page + 1} 段与题面第 ${page + 1} 页不一致`)
      })
    }
    check(
      problems.length === 0,
      `${labelOfScope(id)} · ${directionLabel(direction)}：题面 ${blocks.length} 段 / ${blocks.reduce((sum, block) => sum + block.split('\n').length, 0)} 行（${pages} 页、末页 ${termsOfPage(id, pages - 1).length} 行）`,
      problems.slice(0, 6).join('；'),
    )
  }
}

console.log('\n=== 5. 题号：term-v3 能回读，term-v2 与残缺题号一律拒绝 ===')
{
  const idProblems = []
  const ids = []
  for (const id of SCOPES) {
    for (const direction of DIRECTIONS) {
      const exerciseId = termExerciseId(id, direction)
      ids.push(exerciseId)
      if (exerciseId !== `term-v3-${id}-${direction}`) idProblems.push(`termExerciseId(${id}, ${direction}) 给出「${exerciseId}」，形状应为 term-v3-<范围>-<方向>`)
      const pages = termPageCount(id)
      if (termPagesOfExercise(exerciseId) !== pages) idProblems.push(`「${exerciseId}」算出 ${termPagesOfExercise(exerciseId)} 页，应为 ${pages} 页`)
      const whole = termsForExerciseId(exerciseId)
      if (whole.length !== termsOfScope(id).length) idProblems.push(`「${exerciseId}」取出 ${whole.length} 条，应为 ${termsOfScope(id).length} 条`)
      for (let page = 0; page < pages; page += 1) {
        const rows = termsForPageOfExercise(exerciseId, page)
        const want = termsOfPage(id, page)
        if (rows.length !== want.length || rows.some((term, row) => term !== want[row])) {
          idProblems.push(`「${exerciseId}」第 ${page + 1} 页与 termsOfPage 给的不是同一批（${rows.length} 条 / 应为 ${want.length} 条）`)
        }
      }
    }
  }
  check(idProblems.length === 0, `四个题号的页数、条目、逐页取数都与范围一致：${ids.join('、')}`, idProblems.slice(0, 6).join('；'))

  const parsed = []
  for (const id of SCOPES) {
    for (const direction of DIRECTIONS) {
      const exerciseId = termExerciseId(id, direction)
      const back = parseTermExerciseId(exerciseId)
      if (!back || back.scope !== id || back.direction !== direction) {
        parsed.push(`「${exerciseId}」回读成 ${back ? `${back.scope}/${back.direction}` : 'null'}`)
      }
    }
  }
  check(parsed.length === 0, `parseTermExerciseId 把四个题号原样回读（范围与方向都对）`, parsed.join('；'))
}

{
  /*
   * 该被拒掉的题号。`term-v2-…` 是上一代（一组 5 条、排的是政论固定表述）：
   * 同一个题号在两代里指向完全不同的内容，因此**必须**解析失败，否则旧记录会张冠李戴。
   */
  const INVALID = [
    'term-v2-cn-org-1',
    'term-v2-cn-org-zh-to-en',
    'term-v3-unknown-zh-to-en',
    'term-v3-cn-org',
    'term-v3-cn-org-to-en',
    'term-v3--zh-to-en',
    'term-v3-cn-org-zh-to-en-x',
    'term-v3-cn-org-en-to-zh-2',
    'art-society-zh-to-en-1',
    '',
  ]
  const wronglyAccepted = INVALID.filter((id) => parseTermExerciseId(id) !== null)
  check(
    wronglyAccepted.length === 0,
    `不是本代次的题号一律返回 null（试了 ${INVALID.length} 个：上一代、未知范围、缺方向、多余后缀、文章题号、空串）`,
    `这些被误认了：${wronglyAccepted.join('、')}`,
  )
}

{
  const newIds = SCOPES.flatMap((id) => DIRECTIONS.map((direction) => termExerciseId(id, direction)))
  const legacyOnNew = newIds.filter((id) => isLegacyTermExerciseId(id))
  const legacyOnOld = ['term-v2-cn-org-1', 'term-v2-intl-org-3'].filter((id) => !isLegacyTermExerciseId(id))
  check(
    legacyOnNew.length === 0 && legacyOnOld.length === 0,
    `isLegacyTermExerciseId 只认 term-v2（新手记号 ${newIds.length} 个都不算旧，旧题号 ${legacyOnOld.length === 0 ? '都算旧' : '有漏网的'}）`,
    [...legacyOnNew, ...legacyOnOld].join('；'),
  )
  // 旧题号在界面层拿到的应该是"空题"：页数 0、页面为空，不会被当成新题渲染出来
  const oldId = 'term-v2-cn-org-3'
  check(
    termPagesOfExercise(oldId) === 0 && termsForPageOfExercise(oldId, 0).length === 0 && termsForExerciseId(oldId).length === 0,
    `旧题号「${oldId}」在界面层是空题（页数 0、页面为空、条目为空）`,
    `页数 ${termPagesOfExercise(oldId)}、第一页 ${termsForPageOfExercise(oldId, 0).length} 条、条目 ${termsForExerciseId(oldId).length} 条`,
  )
}

/* ── 5. 判分：该认的认、不该认的绝不认 ────────────────────────────── */

console.log('\n=== 6. 判分：不过度接受（假放宽就在这一组现形）===')
{
  const entries = SCOPES.flatMap((id) => termsOfScope(id).map((term) => ({ scope: id, label: labelOfScope(id), term })))

  /** 一条术语"算对的英文写法"清单，带上是哪一种，便于报错时说清是谁的什么写法。 */
  const englishWritings = (term) => {
    const out = [['英文原名', textOf(term.en)]]
    const primary = primaryEnglish(term)
    if (primary !== textOf(term.en)) out.push(['去掉括号的主译法', primary])
    enAltsOf(term).forEach((alt) => out.push(['别名', textOf(alt)]))
    return out
  }
  /**
   * 合法的唯一例外：两条**互相登记**在 zhAlt 里、且官方英文是同一条。
   * 整库只有一对（直辖市人民政府 / 设区的市人民政府，官方英文都是 Municipal People's Government）。
   * 判据要求"互相登记"而不是"一条登记了另一条"——单边登记同样是生成器的 bug。
   */
  const registeredPair = (a, b) =>
    zhAltsOf(a.term).includes(textOf(b.term.zh)) &&
    zhAltsOf(b.term).includes(textOf(a.term.zh)) &&
    normalizeAnswer(primaryEnglish(a.term)) === normalizeAnswer(primaryEnglish(b.term))

  const overlapsEn = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = 0; j < entries.length; j += 1) {
      if (i === j) continue
      const a = entries[i]
      const b = entries[j]
      if (registeredPair(a, b)) continue
      for (const [kind, answer] of englishWritings(b.term)) {
        if (answer.length === 0) continue
        if (isTermCorrect(a.term, answer, 'zh-to-en')) {
          overlapsEn.push(`「${a.label} ${textOf(a.term.zh)}」会接受「${b.label} ${textOf(b.term.zh)}」的${kind}「${answer}」`)
        }
      }
    }
  }
  check(
    overlapsEn.length === 0,
    `中译英：任何一条术语都不接受别的术语的译法（比了 ${entries.length * (entries.length - 1)} 对，跨范围也比）`,
    `${overlapsEn.length} 处：${overlapsEn.slice(0, 8).join('；')}`,
  )

  const overlapsZh = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = 0; j < entries.length; j += 1) {
      if (i === j) continue
      const a = entries[i]
      const b = entries[j]
      const other = textOf(b.term.zh)
      if (other.length === 0) continue
      /*
       * 例外只对"登记在这一条自己的 zhAlt 里"的中文名成立（一英多中）。
       * 注意这里比的是**别的条目自己的中文名**，不是它算对的那一串写法——
       * 后者里含有这一条自己的中文名（b 的 zhAlt 记着 a 的中文名），
       * 拿它来比会把"自己认自己"当成越界，那是断言写错了，不是数据错了。
       */
      if (zhAltsOf(a.term).includes(other)) continue
      if (!isTermCorrect(a.term, other, 'en-to-zh')) continue
      if (other === textOf(a.term.zh)) {
        overlapsZh.push(`「${a.label} ${textOf(a.term.zh)}」与「${b.label} ${other}」的中文名相同，却不是登记过的一英多中`)
      } else {
        overlapsZh.push(`「${a.label} ${textOf(a.term.zh)}」会接受「${b.label} ${other}」的中文名「${other}」`)
      }
    }
  }
  check(
    overlapsZh.length === 0,
    `英译中：任何一条术语都不接受别的术语的中文名（一英多中只限登记在 zhAlt 里的那一对）`,
    `${overlapsZh.length} 处：${overlapsZh.slice(0, 8).join('；')}`,
  )

  /*
   * 反过来独立算一遍"同一条官方英文、不同中文名"的组（生成器的 attachZhAlt 就是这么找的），
   * 再要求组内**互相登记、且没有多登记**。少登记会让某一页漏判一种正确写法，
   * 多登记则会让风马牛不相及的两条互通——两个方向都要挡住。
   */
  const byPrimary = new Map()
  for (const entry of entries) {
    const key = normalizeAnswer(primaryEnglish(entry.term))
    if (!byPrimary.has(key)) byPrimary.set(key, [])
    byPrimary.get(key).push(entry)
  }
  const groups = [...byPrimary.values()].filter((members) => new Set(members.map((member) => textOf(member.term.zh))).size > 1)
  const registration = []
  for (const members of groups) {
    for (const member of members) {
      const others = members.map((other) => textOf(other.term.zh)).filter((zh) => zh !== textOf(member.term.zh))
      for (const zh of others) {
        if (!zhAltsOf(member.term).includes(zh)) registration.push(`「${textOf(member.term.zh)}」漏登记了「${zh}」`)
      }
      for (const zh of zhAltsOf(member.term)) {
        if (!others.includes(textOf(zh))) registration.push(`「${textOf(member.term.zh)}」多登记了「${textOf(zh)}」（两者官方英文不是同一条）`)
      }
    }
  }
  check(
    registration.length === 0,
    `官方英文同一条的中文名组共 ${groups.length} 组，组内互相登记、且没有多登记`,
    registration.slice(0, 8).join('；'),
  )

  /*
   * 正面对照：唯一那一对必须真的互通——否则上面两条断言里的"例外"形同虚设，
   * 而"一英多中"这条口径（用户拍板：英译中方向下写哪个都算对、标准答案用「／」连起来）就是假的。
   */
  const pairs = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) if (registeredPair(entries[i], entries[j])) pairs.push([entries[i], entries[j]])
  }
  const pairNames = pairs.map(([a, b]) => `${textOf(a.term.zh)} ／ ${textOf(b.term.zh)}`).join('；') || '（一对都没有）'
  const pairProblems = []
  if (pairs.length !== 1) pairProblems.push(`互相登记的一英多中共有 ${pairs.length} 对`)
  for (const [a, b] of pairs) {
    const shared = primaryEnglish(a.term)
    if (normalizeAnswer(primaryEnglish(b.term)) !== normalizeAnswer(shared)) pairProblems.push(`这一对的主译法并不相同（${primaryEnglish(b.term)} / ${shared}）`)
    if (!isTermCorrect(a.term, textOf(b.term.zh), 'en-to-zh')) pairProblems.push(`英译中写「${textOf(b.term.zh)}」没被判对`)
    if (!isTermCorrect(b.term, textOf(a.term.zh), 'en-to-zh')) pairProblems.push(`英译中写「${textOf(a.term.zh)}」没被判对`)
    // 这一对同时会踩到"不过度接受"的例外，正好证明例外不是死代码
    if (!isTermCorrect(a.term, textOf(b.term.en), 'zh-to-en')) pairProblems.push(`两条官方英文相同、中译英却互不认（例外没被用上）`)
    if (!standardAnswer(a.term, 'en-to-zh').includes('／')) pairProblems.push(`标准答案没有用「／」把两个中文名列出来（${standardAnswer(a.term, 'en-to-zh')}）`)
  }
  check(
    pairProblems.length === 0,
    `一英多中确实只有一对、且两条互通：${pairNames} ← 官方英文同为「${pairs.length > 0 ? primaryEnglish(pairs[0][0].term) : '—'}」`,
    pairProblems.join('；'),
  )
}

/* ── 7. 库的形状（给人看的） ──────────────────────────────────────── */

console.log('\n=== 7. 库的形状（给人看的）===')
{
  const library = allTerms()
  const byPrimary = new Map()
  for (const term of library) {
    const key = normalizeAnswer(primaryEnglish(term))
    if (!byPrimary.has(key)) byPrimary.set(key, [])
    byPrimary.get(key).push(term)
  }
  const groups = [...byPrimary.values()].filter((members) => new Set(members.map((term) => textOf(term.zh))).size > 1)

  let totalPages = 0
  let totalAlts = 0
  let totalParen = 0
  /** 页长分布：`5 条 × 16 页 ／ 3 条 × 1 页`。 */
  const distribution = (sizes) => {
    const counts = new Map()
    for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([size, pages]) => `${size} 条 × ${pages} 页`)
      .join(' ／ ')
  }

  for (const id of SCOPES) {
    const list = termsOfScope(id)
    const pages = termPageCount(id)
    const sizes = Array.from({ length: pages }, (_, page) => termsOfPage(id, page).length)
    const withAlts = list.filter((term) => enAltsOf(term).length > 0)
    const withParen = list.filter((term) => /\([^()]*\)\s*$/.test(textOf(term.en)))
    totalPages += pages
    totalAlts += withAlts.length
    totalParen += withParen.length
    console.log(`  ${labelOfScope(id)}（${id}）：${list.length} 条 → ${pages} 页，页长 ${distribution(sizes)}`)
    console.log(`    带其它英文写法的 ${withAlts.length} 条；其中英文末尾带括号（官方缩写）的 ${withParen.length} 条；一条别的写法都没有的 ${list.length - withAlts.length} 条`)
    const zhAltCount = list.filter((term) => zhAltsOf(term).length > 0).length
    if (zhAltCount > 0) console.log(`    一英多中（zhAlt 非空）的 ${zhAltCount} 条`)
  }
  console.log(`  合计 ${library.length} 条 / ${totalPages} 页；带其它英文写法的 ${totalAlts} 条，英文末尾带括号的 ${totalParen} 条`)

  /*
   * 一英多中的分组：两条（或多条）中文名的官方英文是同一条，英译中方向下写哪个都算对，
   * 标准答案用「／」把它们都列出来。整库现在只有一对。
   */
  if (groups.length === 0) console.log('  zhAlt 分组：没有（英译中的标准答案一律只有一个中文名）')
  else {
    console.log(`  zhAlt 分组（共 ${groups.length} 组）：`)
    for (const members of groups) console.log(`    ${members.map((term) => textOf(term.zh)).join(' ／ ')}  ← 同为 ${primaryEnglish(members[0])}`)
  }
  const withAlt = library.filter((term) => enAltsOf(term).length > 0)
  const abbrev = withAlt.reduce((sum, term) => sum + enAltsOf(term).length, 0)
  console.log(`  中译英方向一并算对的英文写法共 ${library.length + abbrev} 种（每条自己那一种 ＋ ${abbrev} 条别名）`)
}

/* ── 提醒：不判失败，但值得看一眼 ─────────────────────────────────── */

{
  /*
   * ⚠ 英美拼写表里的 `Programme / Program` 这一对**一次也没有生效**。
   *
   * 生成器按"照词给出、不写通则"的口径做替换（build-terms.mjs 的 SPELLING_PAIRS），
   * 判据是 `text.includes(british) && !text.includes(american)`；而 `'Program'`
   * 是 `'Programme'` 的**子串**，于是 `includes('Program')` 在 `World Food Programme`
   * 上也为真——两个方向都不成立，这一对永远不适用。
   * 后果：下面这 5 条写美式 `Program` 会被判错，而 `terms.ts` 的文件头把
   * `Programme / Program` 明确列在"一并算对"的四类里，口径与实情不一致。
   * 这条要改的是**生成器的判据**（例如按词边界判断），不是数据本身；
   * 数据是生成出来的，手改会被下次 `--write` 覆盖，因此这里只提醒、不判失败。
   */
  const americanProgram = (text) => text.replace(/Programme/g, 'Program').replace(/programme/g, 'program')
  const suspects = allTerms()
    .filter((term) => /Programme|programme/.test(textOf(term.en)))
    .map((term) => ({ term, zh: textOf(term.zh), en: textOf(term.en), american: americanProgram(textOf(term.en)) }))
    .filter((item) => !isTermCorrect(item.term, item.american, 'zh-to-en'))

  if (suspects.length === 0) {
    console.log('\n  ✓ 英美拼写表里的每一对都真的生效（`Programme / Program` 也已生效）')
  } else {
    console.log('\n  ⚠ 英美拼写表里的 `Programme / Program` 这一对没有生效（这条**不判失败**，要改的是生成器）：')
    for (const item of suspects) console.log(`      ${item.zh}：en=「${item.en}」→ 写美式「${item.american}」会被判错，enAlt 里也没有它`)
    console.log('      → 原因：判据用 `includes`，而 `Program` 是 `Programme` 的子串，两个分支都不成立，这一对永远不适用。')
    console.log('      → 落点：scripts/build-terms.mjs 的 SPELLING_PAIRS 判据（改成按词边界判断），或明确把这一对从词表里删掉。')
  }
}

/* ── 收尾 ─────────────────────────────────────────────────────────── */

const failed = results.filter((item) => !item.ok).length
console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
process.exitCode = failed === 0 ? 0 : 1
await rm(outDir, { recursive: true, force: true })
