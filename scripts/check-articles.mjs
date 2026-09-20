/**
 * 文章库体检：**每一篇都要是完整文章、每一格都要够篇数、同一领域不许雷同**。
 *
 * 为什么需要它：文章库这轮从"每格 3 篇选段"变成"每格 6 篇**完整**文章"，
 * 而数据是脚本抓来的——抓漏一段、抓到半句、两篇其实是同一篇的不同转载，
 * 这些错**都不会让任何测试变红**（界面上照样能练），只会让题库悄悄变差。
 * 因此这里把三条口径写成断言：篇数、完整性、不雷同，另附分页体检。
 *
 * 用法：
 *   node scripts/check-articles.mjs            体检并打印清单
 *   node scripts/check-articles.mjs --brief    只打印每格统计
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
    `export { paginateArticle, countUnits, PAGE_RULE } from ${JSON.stringify(path.join(root, 'src', 'domain', 'sections.ts'))}\n`,
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
const { ARTICLE_DOMAINS, ARTICLE_EXCERPTS, articlesOf, countUnits, paginateArticle, PAGE_RULE } = mod

const results = []
function check(ok, label, detail) {
  results.push({ ok })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail !== undefined ? ` — ${detail}` : ''}`)
}

/** 每格至少几篇（用户要求：中译英 6 篇、英译中 6 篇）。 */
const PER_CELL = 6

console.log('=== 1. 每一格的篇数 ===')
for (const domain of ARTICLE_DOMAINS) {
  for (const direction of ['en-to-zh', 'zh-to-en']) {
    const list = articlesOf(domain.id, direction)
    const unit = direction === 'en-to-zh' ? '词' : '字'
    const total = list.reduce((sum, item) => sum + item.units, 0)
    check(
      list.length >= PER_CELL,
      `${domain.label} · ${direction === 'en-to-zh' ? '英译中' : '中译英'}：${list.length} 篇（要求 ≥ ${PER_CELL}），共 ${total} ${unit}`,
    )
  }
}

console.log('\n=== 2. 每篇都是完整文章（不是被截断的选段）===')
for (const item of ARTICLE_EXCERPTS) {
  const text = item.excerpt
  const problems = []
  if (item.title.trim().length < 4) problems.push('标题为空')
  if (!/^https?:/.test(item.url)) problems.push('URL 不是 http(s)')
  // 被截断的痕迹：省略号收尾、"（后续）"、脚本自己的截断标记
  if (/(\.\.\.|…)\s*$/.test(text)) problems.push('正文以省略号结尾（截断过）')
  if (/\(line truncated|\[\.\.\.\]/.test(text)) problems.push('正文里有截断标记')
  if (/^(新华社|人民日报)[^。]{0,20}(电|讯)?$/.test(text.trim())) problems.push('正文只有电头')
  // 完整文章应当以句末标点收尾
  if (!/[。！？.!?"'”’）)]$/.test(text.trim())) problems.push(`正文结尾不是句末标点：「${text.trim().slice(-18)}」`)
  // 段落：完整文章至少两段
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0)
  if (paragraphs.length < 2) problems.push(`只有 ${paragraphs.length} 段`)
  const units = countUnits(text, item.direction)
  if (units !== item.units) problems.push(`units 写的是 ${item.units}，实际 ${units}`)
  check(problems.length === 0, `${item.id}（${item.units} 单位，${paragraphs.length} 段）${brief ? '' : ` ${item.title.slice(0, 34)}`}`, problems.join('；'))
}

console.log('\n=== 3. 同一领域内不雷同 ===')
for (const domain of ARTICLE_DOMAINS) {
  for (const direction of ['en-to-zh', 'zh-to-en']) {
    const list = articlesOf(domain.id, direction)
    const titles = new Map()
    const openings = new Map()
    const duplicated = []
    for (const item of list) {
      const key = item.title.replace(/[\s“”"《》·—-]/g, '')
      if (titles.has(key)) duplicated.push(`标题重复：${item.title}`)
      titles.set(key, item.id)
      // 首段前 40 字：两篇若同源（同一篇的不同转载），开头往往一样
      const opening = item.excerpt.replace(/\s+/g, '').slice(0, 40)
      if (openings.has(opening)) duplicated.push(`开头与 ${openings.get(opening)} 相同`)
      openings.set(opening, item.id)
    }
    check(
      duplicated.length === 0,
      `${domain.label} · ${direction === 'en-to-zh' ? '英译中' : '中译英'}：${list.length} 篇互不雷同`,
      duplicated.join('；'),
    )
  }
}

console.log('\n=== 4. 分页体检（每页 100–200，绝不越过 300）===')
/*
 * 判据分三档（与 domain/sections.ts 的规则一致）：
 *   - **绝对上限 300**（`splitAbove`）：超过就是错的——那说明该切的段落没切；
 *   - **最后一页不许是"小尾巴"**（不足 100）：尾巴会被并进上一页，这是硬规矩；
 *   - 落在 201–300 的**只记一笔**：单段本身就有 200–300 单位时，按用户的规则
 *     "超过 300 才切"，那一段只能自己当一页；一小段（<100）后面紧跟一大段时
 *     也会留一页短的——两害相权取其轻（详见 paginateArticle 里的说明）。
 */
const offBand = []
const aboveIdeal = []
const shortPages = []
for (const item of ARTICLE_EXCERPTS) {
  const pages = paginateArticle(item.excerpt, item.direction)
  const units = pages.map((page) => countUnits(page.text, item.direction))
  const over = units.filter((value) => value > PAGE_RULE.splitAbove)
  if (over.length > 0) offBand.push(`${item.id}：${units.join('/')}`)
  const last = units[units.length - 1] ?? 0
  if (units.length > 1 && last < PAGE_RULE.min) shortPages.push(`${item.id}：尾巴 ${last}`)
  const short = units.filter((value, index) => value < PAGE_RULE.min && index !== units.length - 1)
  if (short.length > 0) shortPages.push(`${item.id}：中间有 ${short.join('/')}`)
  const wide = units.filter((value) => value > PAGE_RULE.max)
  if (wide.length > 0) aboveIdeal.push(`${item.id}：${wide.join('/')}`)
  if (!brief) {
    console.log(
      `  ${item.id.padEnd(24)} ${String(item.units).padStart(5)} 单位 → ${String(units.length).padStart(2)} 页  [${units.join(', ')}]`,
    )
  }
}
check(
  offBand.length === 0,
  `没有一页超过绝对上限 ${PAGE_RULE.splitAbove}（越界的篇目：${offBand.length}）`,
  offBand.slice(0, 12).join('；'),
)
check(
  shortPages.length === 0,
  `没有"小尾巴"页（不足 ${PAGE_RULE.min} 的最后一页）：${shortPages.length} 处`,
  shortPages.slice(0, 8).join('；'),
)
console.log(
  `  · 另有 ${aboveIdeal.length} 篇里有 201–${PAGE_RULE.splitAbove} 的一页（单段本身就这么长，按规则不切）：${
    aboveIdeal.slice(0, 5).join('；') || '无'
  }${aboveIdeal.length > 5 ? ' …' : ''}`,
)
/*
 * 全库的页宽分布：一句话就能看出"每页 100–200"这条口径守得怎么样。
 * 落在带外的每一页都要有解释（单段太长 / 两害相权），因此这里只报数，由上面两条断言把关。
 */
{
  const all = ARTICLE_EXCERPTS.flatMap((item) =>
    paginateArticle(item.excerpt, item.direction).map((page) => countUnits(page.text, item.direction)),
  )
  const inBand = all.filter((value) => value >= PAGE_RULE.min && value <= PAGE_RULE.max).length
  const wide = all.filter((value) => value > PAGE_RULE.max).length
  const short = all.filter((value) => value < PAGE_RULE.min).length
  const percent = all.length > 0 ? Math.round((inBand / all.length) * 100) : 0
  console.log(
    `  · 全库 ${all.length} 页：${PAGE_RULE.min}–${PAGE_RULE.max} 的 ${inBand} 页（${percent}%）／` +
      `201–${PAGE_RULE.splitAbove} 的 ${wide} 页／不足 ${PAGE_RULE.min} 的 ${short} 页`,
  )
}

const failed = results.filter((item) => !item.ok).length
console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
process.exitCode = failed === 0 ? 0 : 1
await rm(outDir, { recursive: true, force: true })
