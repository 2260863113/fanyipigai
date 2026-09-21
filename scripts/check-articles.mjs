/**
 * 文章库体检：**每一格够篇数、每一篇完整、同一格不雷同、译文逐段对齐、分页守住两条硬规矩**。
 *
 * 为什么需要它：正文是 `scripts/build-articles.mjs` 从《文章.docx》现算出来的，
 * 而算错**不会让任何测试变红**（界面上照样能练），只会让题库悄悄变差——
 * 少收一篇、两段粘成一段、译文与原文错开一段、某一段被切断。因此这里把口径写成断言。
 *
 * 五组判据：
 *   1. **篇数与格子**：五个板块 × 两个方向，各格几篇必须与 `EXPECTED` 完全一致；
 *   2. **每篇完整**：题号形状、事件锚点非空、没有来源/链接字段（那两样已随 ADR 0010 取消）、
 *      正文与译文段数相等、units 与实际一致、每段以句末标点收尾；
 *   3. **不雷同**：同一格里标题不重复、8 字片段相似度不过线
 *      （上一批材料里"南岭猕猴"在三个组里各出现一次，就是这么查出来的）；
 *   4. **译文对齐**：每一页的每一段都有译文；
 *   5. **分页**：一页 = 一个自然段，不足 50 单位的与相邻段合并——够长的段必须独占一页、
 *      不许出现不足 50 单位的小页、所有页拼起来一字不丢。
 *
 * 用法：
 *   node scripts/check-articles.mjs            体检并逐篇打印
 *   node scripts/check-articles.mjs --brief    只打印每格统计与页数分布
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const brief = process.argv.includes('--brief')
const outDir = path.join(root, 'node_modules', '.cache', 'check-articles')
await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, 'articles.mjs')
await writeFile(
  path.join(outDir, 'entry.ts'),
  `export * from ${JSON.stringify(path.join(root, 'src', 'domain', 'articles.ts'))}\n` +
    `export { paginateArticle, countUnits, splitSections, PAGE_RULE } from ${JSON.stringify(path.join(root, 'src', 'domain', 'sections.ts'))}\n`,
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
const { ARTICLE_DOMAINS, ARTICLES, articlesOf, countUnits, paginateArticle, splitSections, PAGE_RULE } = mod

const results = []
function check(ok, label, detail) {
  results.push({ ok })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail !== undefined ? ` — ${detail}` : ''}`)
}

/**
 * 每一格应有的篇数。用户要求"每个板块的每一个翻译方向有五篇文章"，
 * 唯一的例外是**生态 / 英译中**：那五组材料里有三组讲的是同一件事（南岭猕猴），
 * 去重后只剩 3 篇（用户的选择：宁可这一格少两篇，也不要三张几乎一样的卡片）。
 */
const EXPECTED = {
  society: { 'en-to-zh': 5, 'zh-to-en': 5 },
  economy: { 'en-to-zh': 5, 'zh-to-en': 5 },
  culture: { 'en-to-zh': 5, 'zh-to-en': 5 },
  ecology: { 'en-to-zh': 3, 'zh-to-en': 5 },
  tech: { 'en-to-zh': 5, 'zh-to-en': 5 },
}
const DIRECTIONS = ['en-to-zh', 'zh-to-en']
const EXPECTED_TOTAL = Object.values(EXPECTED).reduce((sum, cell) => sum + cell['en-to-zh'] + cell['zh-to-en'], 0)

console.log('=== 1. 每一格的篇数 ===')
{
  let total = 0
  for (const domain of ARTICLE_DOMAINS) {
    for (const direction of DIRECTIONS) {
      const list = articlesOf(domain.id, direction)
      total += list.length
      const unit = direction === 'en-to-zh' ? '词' : '字'
      const sum = list.reduce((acc, item) => acc + item.units, 0)
      const want = EXPECTED[domain.id][direction]
      check(
        list.length === want,
        `${domain.label} · ${direction === 'en-to-zh' ? '英译中' : '中译英'}：${list.length} 篇（应为 ${want}），共 ${sum} ${unit}`,
      )
    }
  }
  check(total === EXPECTED_TOTAL, `全库 ${total} 篇（应为 ${EXPECTED_TOTAL}）`)
}

console.log('\n=== 2. 每一篇都是完整的一篇 ===')
for (const item of ARTICLES) {
  const problems = []
  const shape = /^art-([a-z]+)-(en-to-zh|zh-to-en)-(\d+)$/.exec(item.id)
  if (!shape) problems.push('题号形状不对（应为 art-<领域>-<方向>-<组号>）')
  else {
    if (shape[1] !== item.domain) problems.push(`题号里的领域是 ${shape[1]}，字段却是 ${item.domain}`)
    if (shape[2] !== item.direction) problems.push(`题号里的方向是 ${shape[2]}，字段却是 ${item.direction}`)
    if (Number(shape[3]) !== item.batch) problems.push(`题号里的组号是 ${shape[3]}，字段却是 ${item.batch}`)
  }
  // 来源与链接已经随 ADR 0010 取消：这批材料不是新闻原文，编不出真实出处
  if ('source' in item) problems.push('不该再有 source（来源媒体）字段')
  if ('url' in item) problems.push('不该再有 url（原文链接）字段')
  if (item.title.trim().length < 10) problems.push(`事件锚点太短：「${item.title}」`)
  if (item.title.length > 140) problems.push(`事件锚点太长（${item.title.length} 字）`)

  const paragraphs = splitSections(item.text)
  const translations = splitSections(item.reference)
  if (paragraphs.length < 2) problems.push(`正文只有 ${paragraphs.length} 段`)
  if (paragraphs.length !== translations.length) {
    problems.push(`正文 ${paragraphs.length} 段、译文 ${translations.length} 段，对不齐`)
  }
  const units = countUnits(item.text, item.direction)
  if (units !== item.units) problems.push(`units 写的是 ${item.units}，实际 ${units}`)
  for (const [index, paragraph] of paragraphs.entries()) {
    if (!/[。！？.!?”’）)]$/.test(paragraph.text.trim())) {
      problems.push(`第 ${index + 1} 段结尾不是句末标点：「${paragraph.text.trim().slice(-14)}」`)
    }
  }
  /*
   * 英文段落里不该再出现 U+2018：那份材料里所有格的撇号统统写成了左单引号，
   * 生成时已经订正（见 build-articles.mjs 的 fixApostrophes）。中文里的 「‘…’」
   * 是嵌套引号、是对的，因此只查英文段落。
   */
  for (const [index, paragraph] of paragraphs.entries()) {
    if (!/[\u4e00-\u9fff]/.test(paragraph.text) && paragraph.text.includes('\u2018')) {
      problems.push(`第 ${index + 1} 段（英文）里还有没订正的撇号 U+2018`)
    }
  }
  check(
    problems.length === 0,
    `${item.id}（${item.units} 单位，${paragraphs.length} 段）${brief ? '' : ` ${item.title.slice(0, 30)}…`}`,
    problems.join('；'),
  )
}

console.log('\n=== 3. 同一格里不雷同 ===')
{
  const normalized = (text) => text.replace(/\s+/g, '')
  const shingles = (text) => {
    const body = normalized(text)
    const set = new Set()
    for (let index = 0; index + 8 <= body.length; index += 1) set.add(body.slice(index, index + 8))
    return set
  }
  const similarity = (left, right) => {
    const a = shingles(left)
    const b = shingles(right)
    let shared = 0
    for (const piece of a) if (b.has(piece)) shared += 1
    return shared / (a.size + b.size - shared)
  }
  /*
   * 同一件事被写了两遍，算不算"雷同"？分两档：
   *
   *   - **太像（> 0.5）**：同一篇文章的两个版本，作为练习材料是纯重复——**判失败**。
   *     上一批材料里"南岭猕猴"在三个组里各出现一次（相似度 87%–98%），就是这么查出来的，
   *     已按用户决定只留第 1 组。
   *   - **同题不同文（开头一样、但整篇相似度低）**：像同一场活动被两家媒体各写一篇，
   *     事实与措辞都不同、译文也不同，练起来是两篇材料而不是一篇——**只提醒，不判失败**。
   *     现有材料里文化板块有两对属于这一档（见下），因此把口径写清楚，
   *     免得下一批材料里混进真正重复的东西时被这条"提醒"放过。
   */
  const warnings = []
  for (const domain of ARTICLE_DOMAINS) {
    for (const direction of DIRECTIONS) {
      const list = articlesOf(domain.id, direction)
      const problems = []
      const titles = new Map()
      const openings = new Map()
      for (const item of list) {
        const key = item.title.replace(/[\s“”"《》·—-]/g, '')
        if (titles.has(key)) problems.push(`标题重复：${item.title.slice(0, 24)}…`)
        titles.set(key, item.id)
        const opening = normalized(item.text).slice(0, 40)
        if (openings.has(opening)) {
          warnings.push(`${domain.label}/${direction === 'en-to-zh' ? '英译中' : '中译英'}：${item.id} 与 ${openings.get(opening)} 讲的是同一件事（文字不同）`)
        }
        openings.set(opening, item.id)
      }
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          const score = similarity(list[a].text, list[b].text)
          if (score > 0.5) {
            problems.push(`${list[a].id} 与 ${list[b].id} 太像（相似度 ${score.toFixed(2)}）——这是同一篇文章的两个版本，该去重`)
          }
        }
      }
      check(
        problems.length === 0,
        `${domain.label} · ${direction === 'en-to-zh' ? '英译中' : '中译英'}：${list.length} 篇互不雷同`,
        problems.join('；'),
      )
    }
  }
  for (const line of warnings) console.log(`  ⚠ ${line}`)
  if (warnings.length > 0) {
    console.log('    （这一档不判失败：事实与措辞都不同、参考译文也不同，练的是两篇材料。')
    console.log('      要按"宁可少一篇也不要两张同题卡片"的口径去重，就在 build-articles.mjs 的 DROPPED 里加一行。）')
  }
}

console.log('\n=== 4. 分页：一页 = 一个自然段（不足 50 单位与相邻段合并）===')
{
  const { mergeBelow } = PAGE_RULE
  const misaligned = []
  const lost = []
  const wrongShape = []
  const tiny = []
  const pageCounts = new Map()
  let pages = 0
  let singleParagraphPages = 0

  /*
   * 按用户口径**手写一遍**分页，再和实现逐页对照。
   *
   * 为什么不只写几个不变量：这一轮的规则有一处小弯（末页的尾巴修正），
   * 只写"不许有小页"这类不变量是**可以蒙过去的**——把整篇并成一页也不违反它。
   * 这里把"从左往右攒、够了就收口、末尾太短就并进前一页"明确算一遍，
   * 然后要求实现逐页、逐段数都对上，等于把规则本身钉死。
   */
  const expectedGroupsOf = (units) => {
    const greedy = []
    let from = 0
    let total = 0
    units.forEach((_, index) => {
      if (index === from) {
        total = units[index]
        return
      }
      if (total >= mergeBelow) {
        greedy.push({ from, to: index })
        from = index
        total = units[index]
        return
      }
      total += units[index]
    })
    greedy.push({ from, to: units.length })

    const tail = greedy[greedy.length - 1]
    const tailUnits = units.slice(tail.from).reduce((sum, value) => sum + value, 0)
    if (greedy.length > 1 && tailUnits < mergeBelow) {
      // 尾巴不足下限，又没有下一段可并 → 并进前一页
      const previous = greedy[greedy.length - 2]
      return [...greedy.slice(0, -2), { from: previous.from, to: units.length }]
    }
    return greedy
  }

  for (const item of ARTICLES) {
    const paragraphs = splitSections(item.text)
    const units = paragraphs.map((paragraph) => countUnits(paragraph.text, item.direction))
    const articlePages = paginateArticle(item.text, item.reference, item.direction)
    pages += articlePages.length
    pageCounts.set(item.id, articlePages.length)

    const expected = expectedGroupsOf(units)
    if (articlePages.length !== expected.length) {
      wrongShape.push(`${item.id}：实现切出 ${articlePages.length} 页，规则应为 ${expected.length} 页`)
    } else {
      for (const [index, group] of expected.entries()) {
        const wanted = group.to - group.from
        if (articlePages[index].pairs.length !== wanted) {
          wrongShape.push(`${item.id} 第 ${index + 1} 页应有 ${wanted} 段，实际 ${articlePages[index].pairs.length} 段`)
        }
      }
    }

    for (const [index, page] of articlePages.entries()) {
      if (page.pairs.length === 1) singleParagraphPages += 1
      // 每一页的"原文/译文对"数与该页自然段数一致，且每段都有译文
      if (page.pairs.length !== splitSections(page.text).length) misaligned.push(`${item.id} 的一页里有 ${page.pairs.length} 对`)
      for (const pair of page.pairs) {
        if (pair.reference.length === 0) misaligned.push(`${item.id}：有一段没有译文`)
      }
      if (paragraphs.length > 1 && countUnits(page.text, item.direction) < mergeBelow) {
        tiny.push(`${item.id} 第 ${index + 1} 页只有 ${countUnits(page.text, item.direction)} 单位`)
      }
    }

    // 拼起来一字不丢
    const joined = articlePages.map((page) => page.text.replace(/\s+/g, ' ').trim()).join(' ')
    if (joined !== item.text.replace(/\s+/g, ' ').trim()) lost.push(item.id)

    if (!brief) {
      const sizes = articlePages.map((page) => countUnits(page.text, item.direction))
      console.log(
        `  ${item.id.padEnd(32)} ${String(item.units).padStart(5)} 单位 → ${String(articlePages.length).padStart(2)} 页  [${sizes.join(', ')}]`,
      )
    }
  }

  check(wrongShape.length === 0, `分页结果与规则手写实现逐页一致（不一致的：${wrongShape.length}）`, wrongShape.slice(0, 6).join('；'))
  check(tiny.length === 0, `没有不足 ${mergeBelow} 单位的小页（${tiny.length} 处）`, tiny.slice(0, 6).join('；'))
  check(misaligned.length === 0, `每一页的译文都逐段对上了（${misaligned.length} 处）`, misaligned.slice(0, 6).join('；'))
  check(lost.length === 0, `所有页拼起来一字不丢（出问题的：${lost.length} 篇）`, lost.slice(0, 6).join('；'))
  const distribution = [...pageCounts.values()].reduce((acc, count) => acc.set(count, (acc.get(count) ?? 0) + 1), new Map())
  const shape = [...distribution.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([count, n]) => `${count} 页 ${n} 篇`)
    .join(' ／ ')
  console.log(`  · 全库 ${ARTICLES.length} 篇共 ${pages} 页，其中 ${singleParagraphPages} 页就是**一个自然段**（${Math.round((singleParagraphPages / pages) * 100)}%）`)
  console.log(`  · 篇长分布：${shape}`)
}

const failed = results.filter((item) => !item.ok).length
console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
process.exitCode = failed === 0 ? 0 : 1
await rm(outDir, { recursive: true, force: true })
