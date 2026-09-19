/**
 * 抓取文章库的原文，并生成「连续选段」。
 *
 * ## 为什么用脚本，而不是手工复制
 *
 * 三条理由，每条都是"手工做会出错"：
 *   1. **篇幅要量**：赛制要求英译汉 250–350 词、汉译英 200–300 字。手工数字数一定不准，
 *      而篇幅是这道题的硬性属性，界面上要显示、用户会拿它核对。
 *   2. **要能复核**：脚本会打印每篇的真实篇幅与选段结果，谁都能重跑一遍验证。
 *   3. **选段要一致**：都从正文第一段开始、按段落累加到目标篇幅、**不剪断句子**。
 *      手工截取时每个人停的地方都不一样。
 *
 * ## 只存选段，不存全文（见 ADR 0007）
 *
 * 仓库是公开的，把商业媒体正文存进公开仓库再附参考译文是版权风险；
 * 因此只收中国官方对外媒体，且只存截取片段。
 *
 * ## 用法
 *
 *   node scripts/fetch-articles.mjs --check            # 只体检：抓取并报告篇幅，不写文件
 *   node scripts/fetch-articles.mjs --emit            # 打印可粘进 src/domain/articles.ts 的数据
 *   node scripts/fetch-articles.mjs --emit --target=300
 *
 * `--emit` 的输出会写到 `node_modules/.cache/article-emit.txt`（**不直接改源码**）：
 * 选段进仓库是题库变更，应该由人看过之后再落进 articles.ts。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const TARGET = Number((process.argv.find((a) => a.startsWith('--target=')) ?? '--target=300').split('=')[1])
const EMIT = process.argv.includes('--emit')
const root = process.cwd()

/**
 * 待抓取的文章。`url` 必须已经人工核对过（子代理逐条 fetch 验证）。
 * `note` 记录那条的已知情况，落进 articles.ts 前应当处理掉。
 */
const SOURCES = [
  // ── 经济建设 ────────────────────────────────────────────────
  { id: 'art-economy-1', domain: 'economy', direction: 'en-to-zh', source: 'China Daily', url: 'http://en.cppcc.gov.cn/2026-03/05/c_1164665.htm', note: '政府工作报告 GDP 目标' },
  { id: 'art-economy-2', domain: 'economy', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20260509/50ea713a34c448269fc8ec2ded0b90e6/c.html', note: '外贸数据；标题带 Update: 前缀要去掉' },
  { id: 'art-economy-3', domain: 'economy', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20260507/d2a1b56437944f299ed83474676f69c0/c.html', note: '五一假期消费' },

  // ── 政治建设 ────────────────────────────────────────────────
  { id: 'art-politics-1', domain: 'politics', direction: 'en-to-zh', source: 'China Daily', url: 'https://www.chinadaily.com.cn/a/202606/05/WS6a22264aa310d6866eb4c99d.html', note: '规范涉企执法' },
  { id: 'art-politics-2', domain: 'politics', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20260309/855eedae757b421ba74bf825c7e19bb8/c.html', note: '人大立法工作；标题带 Update:' },
  { id: 'art-politics-3', domain: 'politics', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20260825/3f961152e4ed47dc92fa211f4fd1c4a4/c.html', note: '跨境反腐立法草案；标题带 Update:' },

  // ── 文化建设 ────────────────────────────────────────────────
  { id: 'art-culture-1', domain: 'culture', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20241223/8c60003429364792ab204e78b7305487/c.html', note: '非遗保护（实测 302 词，正在区间内）' },
  { id: 'art-culture-2', domain: 'culture', direction: 'en-to-zh', source: 'China Daily', url: 'https://www.chinadaily.com.cn/a/202609/08/WS6aa01dbae4b06d4aa055cfa9.html', note: '非遗版权保护研讨会' },
  { id: 'art-culture-3', domain: 'culture', direction: 'en-to-zh', source: 'People\'s Daily Online', url: 'http://en.people.cn/n3/2026/0918/c90000-20501231.html', note: '伦敦非遗展（来源换成人民网英文，比 2018 年的 CGTN 那条新）' },

  // ── 社会建设 ────────────────────────────────────────────────
  { id: 'art-society-1', domain: 'society', direction: 'en-to-zh', source: 'CGTN', url: 'https://news.cgtn.com/news/2026-08-27/China-vows-to-consolidate-poverty-alleviation-gains-1PWp9whciLC/p.html', note: '脱贫成果与乡村振兴' },
  { id: 'art-society-2', domain: 'society', direction: 'en-to-zh', source: 'gov.cn', url: 'https://english.www.gov.cn/archive/statistics/202503/09/content_WS67cd5849c6d0868f4e8f0a42.html', note: '村卫生室医保覆盖' },
  { id: 'art-society-3', domain: 'society', direction: 'en-to-zh', source: 'SCIO', url: 'http://english.scio.gov.cn/topnews/2024-09/20/content_117438470.html', note: '延迟退休改革' },

  // ── 生态文明建设 ────────────────────────────────────────────
  { id: 'art-ecology-1', domain: 'ecology', direction: 'en-to-zh', source: 'china.org.cn', url: 'http://www.china.org.cn/2026-08/14/content_118647000.shtml', note: '空气质量改善行动计划' },
  { id: 'art-ecology-2', domain: 'ecology', direction: 'en-to-zh', source: 'China Development Gateway', url: 'http://en.chinagate.cn/2026-09/18/content_118702293.htm', note: '碳市场成交量创新高' },
  { id: 'art-ecology-3', domain: 'ecology', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20260901/c45a7fc896364cb5aa41810a90686e33/c.html', note: '光伏装机首超煤电' },

  // ── 科技创新 ────────────────────────────────────────────────
  { id: 'art-tech-1', domain: 'tech', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20260514/db28783f4b34466096e9cde2dd7afecc/c.html', note: '九章四号；标题带 Update:' },
  { id: 'art-tech-2', domain: 'tech', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20250122/3b265f0ba8c6459d8156c77ee3757f93/c.html', note: '2024 十大科技进展（比半导体那条更贴区间）' },
  { id: 'art-tech-3', domain: 'tech', direction: 'en-to-zh', source: 'China Daily', url: 'http://www.chinadaily.com.cn/a/202609/07/WS6a9e750be4b06d4aa055cc0a.html', note: '信息基础设施投资' },

  // ── 教育强国 ────────────────────────────────────────────────
  { id: 'art-education-1', domain: 'education', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20260411/98609f94226549b09bb7cb4ceaf58471/c.html', note: 'AI 进课堂' },
  { id: 'art-education-2', domain: 'education', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20250115/54d76973a15442d7895e59af2d75fec6/c.html', note: '技能人才培养' },
  { id: 'art-education-3', domain: 'education', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20260509/07f6a1c9bf964ed5a3cbae385980949e/c.html', note: '教育推动现代化（原文约 700 词，只能靠选段）' },

  // ── 国际传播 ────────────────────────────────────────────────
  { id: 'art-communication-1', domain: 'communication', direction: 'en-to-zh', source: 'Xinhua', url: 'http://english.news.cn/20260421/ab2873cf40924c199c90aee98d9b58c3/c.html', note: '阿塞拜疆中文热' },
  { id: 'art-communication-2', domain: 'communication', direction: 'en-to-zh', source: 'China Daily', url: 'http://www.chinadaily.com.cn/a/202406/07/WS6662d42ba31082fc043cb83a.html', note: '气候周可持续发展' },
  { id: 'art-communication-3', domain: 'communication', direction: 'en-to-zh', source: 'Xinhua', url: 'https://english.news.cn/20251114/e9a7317830444d8b9456003dbdfbdb9d/c.html', note: '支持国际中文教育' },
]

/** 正文容器的候选选择器；按顺序试，取第一个找得到的。 */
const BODY_ANCHORS = [
  'id="detail"', // 新华英文
  'id="Content"', // 中国日报
  'class="article-content"',
  'class="content"',
  'id="content"',
  'class="main-content"',
  'class="article"',
]

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(html) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

function extractTitle(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1) return stripTags(h1[1]).replace(/\s+/g, ' ').trim()
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
  return og ? decodeEntities(og[1]).trim() : ''
}

/** 抓正文段落。只保留像正文的段落（够长、不是导航/版权/分享那些）。 */
function extractParagraphs(html) {
  let segment = html
  for (const anchor of BODY_ANCHORS) {
    const index = html.indexOf(anchor)
    if (index >= 0) {
      segment = html.slice(index)
      break
    }
  }
  const paragraphs = []
  for (const match of segment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(match[1]).replace(/\s+/g, ' ').trim()
    if (text.length < 40) continue
    // 明显的非正文：版权、分享、编辑署名、导航
    if (/^(copyright|all rights reserved|editor:|source:|share|related|most read)/i.test(text)) continue
    if (/\. All rights reserved/i.test(text)) continue
    if (/^(Xinhua|China Daily|CGTN)\s*\|/i.test(text)) continue
    paragraphs.push(text)
  }
  return paragraphs
}

/** 英译中计词数（空白切分）；中译英计汉字数。 */
function countUnits(text, direction) {
  if (direction === 'zh-to-en') {
    return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  }
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

/**
 * 从正文开头按段落累加，直到达到目标篇幅。
 * **不剪断段落**——多出的那一段整体保留（宁可略超，也不要半句话）。
 * 若第一段就已经超出目标许多（少见），仍保留整段：留半句更糟。
 */
function buildExcerpt(paragraphs, direction, target) {
  const picked = []
  let units = 0
  for (const paragraph of paragraphs) {
    picked.push(paragraph)
    units = countUnits(picked.join('\n\n'), direction)
    if (units >= target) break
  }
  return { text: picked.join('\n\n'), units }
}

async function fetchOne(entry) {
  const response = await fetch(entry.url, {
    headers: {
      // 有些站按 UA 拒绝脚本请求；给一个正常的浏览器 UA
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = await response.text()
  const title = extractTitle(html)
  const paragraphs = extractParagraphs(html)
  if (paragraphs.length === 0) throw new Error('抽不出正文段落（容器选择器需要补）')
  const excerpt = buildExcerpt(paragraphs, entry.direction, TARGET)
  return { title, paragraphs, excerpt }
}

const results = []
const failures = []

for (const entry of SOURCES) {
  try {
    const got = await fetchOne(entry)
    results.push({ entry, ...got })
    const flag = got.excerpt.units >= 250 && got.excerpt.units <= 350 ? '✓' : '·'
    console.log(
      `${flag} ${entry.id.padEnd(20)} ${String(got.excerpt.paragraphs ?? got.paragraphs.length).padStart(3)}段 ` +
        `${String(got.excerpt.units).padStart(4)}单位  ${entry.source.padEnd(22)} ${got.title.slice(0, 56)}`,
    )
  } catch (error) {
    failures.push({ entry, message: error instanceof Error ? error.message : String(error) })
    console.log(`✗ ${entry.id.padEnd(20)} ${entry.source.padEnd(22)} ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('')
console.log(`成功 ${results.length} / ${SOURCES.length}；失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('失败清单：')
  for (const failure of failures) console.log(`  - ${failure.entry.id}: ${failure.entry.url} （${failure.message}）`)
}

if (EMIT) {
  const lines = results.map(({ entry, title, excerpt }) => {
    const cleanTitle = title.replace(/^Update:\s*/i, '').replace(/\s+/g, ' ')
    return `  {
    id: ${JSON.stringify(entry.id)},
    domain: ${JSON.stringify(entry.domain)},
    direction: ${JSON.stringify(entry.direction)},
    title: ${JSON.stringify(cleanTitle)},
    source: ${JSON.stringify(entry.source)},
    url: ${JSON.stringify(entry.url)},
    units: ${excerpt.units},
    excerpt: ${JSON.stringify(excerpt.text)},
  },`
  })
  const outDir = path.join(root, 'node_modules', '.cache')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'article-emit.txt')
  writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\n已写出 ${results.length} 条到 ${path.relative(root, outFile)}（**未改源码**，请人工过目后再落进 articles.ts）`)
}

// 失败就要报错退出——不能安静地少几篇
process.exitCode = failures.length === 0 ? 0 : 1
