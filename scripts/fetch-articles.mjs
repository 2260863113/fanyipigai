/**
 * 抓取文章库的**英文全文**，写成 `src/domain/articles-data/en-to-zh.ts`。
 *
 * ## 这一版与上一版的区别：全文，不是选段
 *
 * 上一版只存"从开头累加到 250–350 词"的一段（见 ADR 0007 的旧口径），
 * 于是用户拿到的永远是**文章的一部分**。现在的要求是：
 * 「不管字数限制，让用户可以逐段翻译整篇文章」——练习时按 100–200 词一页切
 * （`domain/sections.ts` 的 paginateArticle），因此**库里必须是完整的正文**。
 *
 * ## 为什么用脚本，而不是手工复制
 *
 *   1. **篇幅要量**：`units` 是界面上明明白白显示的数字，手工数一定不准；
 *   2. **要能复核**：脚本会打印每篇的段数、篇幅与首尾文字，谁都能重跑一遍；
 *   3. **正文要干净**：图片说明、Cookie 提示、编辑署名、"最热文章"那一摞
 *      都会混进 `<p>` 里，靠人工挑一定漏。
 *
 * ## 版权（**这一版放宽了，记在这里免得日后没人知道**）
 *
 * 仓库是公开的，只收**中国官方对外英文媒体**（新华社英文、中国日报、CGTN、
 * 人民网英文、gov.cn、china.org.cn 等），并且保留每篇的 URL 供溯源。
 * 仍不收商业媒体（路透、BBC、卫报、AP）——那类正文进公开仓库的版权风险明显更高。
 *
 * ## 用法
 *
 *   node scripts/fetch-articles.mjs --check           # 只抓取并报告，不写文件
 *   node scripts/fetch-articles.mjs --write           # 写进 src/domain/articles-data/en-to-zh.ts
 *   node scripts/fetch-articles.mjs --only=art-economy-1,art-tech-4
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) ?? '')
  .split('=')
  .slice(1)
  .join('=')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const root = process.cwd()

/**
 * 待抓取的文章。`url` 必须已经人工或子代理 fetch 验证过（HTTP 200、正文可取）。
 * 每个领域 6 篇，同一领域内主题尽量不重复。
 */
const SOURCES = [
  // ── 经济建设 ────────────────────────────────────────────────
  { id: 'art-economy-1', domain: 'economy', source: 'China Daily', url: 'http://en.cppcc.gov.cn/2026-03/05/c_1164665.htm', note: '政府工作报告 GDP 目标' },
  { id: 'art-economy-2', domain: 'economy', source: 'Xinhua', url: 'http://english.news.cn/20260509/50ea713a34c448269fc8ec2ded0b90e6/c.html', note: '外贸数据；标题带 Update: 前缀要去掉' },
  { id: 'art-economy-3', domain: 'economy', source: 'Xinhua', url: 'https://english.news.cn/20260507/d2a1b56437944f299ed83474676f69c0/c.html', note: '五一假期消费' },
  { id: 'art-economy-4', domain: 'economy', source: 'Xinhua', url: 'https://english.news.cn/20260119/43923cfa73c944aeb94489228f817116/c.html', note: '2025 年 GDP 增长 5%' },
  { id: 'art-economy-5', domain: 'economy', source: 'Xinhua', url: 'http://english.news.cn/20251107/55c6dd1630544d5e81f506d5a9def3a8/c.html', note: '粤港澳大湾区' },
  { id: 'art-economy-6', domain: 'economy', source: "People's Daily Online", url: 'https://en.people.cn/n3/2026/0708/c90000-20475454.html', note: 'AI 时代的青年就业' },

  // ── 政治建设 ────────────────────────────────────────────────
  { id: 'art-politics-1', domain: 'politics', source: 'China Daily', url: 'https://www.chinadaily.com.cn/a/202606/05/WS6a22264aa310d6866eb4c99d.html', note: '规范涉企执法' },
  { id: 'art-politics-2', domain: 'politics', source: 'Xinhua', url: 'https://english.news.cn/20260309/855eedae757b421ba74bf825c7e19bb8/c.html', note: '人大立法工作；标题带 Update:' },
  { id: 'art-politics-3', domain: 'politics', source: 'Xinhua', url: 'http://english.news.cn/20260825/3f961152e4ed47dc92fa211f4fd1c4a4/c.html', note: '跨境反腐立法草案；标题带 Update:' },
  { id: 'art-politics-4', domain: 'politics', source: 'Xinhua', url: 'http://english.news.cn/20250105/86caf8147778464e984a0ad3aa3be51a/c.html', note: '持续高压反腐' },
  { id: 'art-politics-5', domain: 'politics', source: 'China Daily', url: 'https://www.chinadaily.com.cn/a/202603/09/WS69aec146a310d6866eb3cd52.html', note: '依法治国与高质量发展（社论）' },
  { id: 'art-politics-6', domain: 'politics', source: 'CGTN', url: 'https://news.cgtn.com/news/2026-06-24/For-the-people-by-the-people-Whole-process-people-s-democracy-1OeswDClEze/p.html', note: '全过程人民民主' },

  // ── 文化建设 ────────────────────────────────────────────────
  { id: 'art-culture-1', domain: 'culture', source: 'Xinhua', url: 'http://english.news.cn/20241223/8c60003429364792ab204e78b7305487/c.html', note: '非遗保护' },
  { id: 'art-culture-2', domain: 'culture', source: 'China Daily', url: 'https://www.chinadaily.com.cn/a/202609/08/WS6aa01dbae4b06d4aa055cfa9.html', note: '非遗版权保护研讨会' },
  { id: 'art-culture-3', domain: 'culture', source: "People's Daily Online", url: 'http://en.people.cn/n3/2026/0918/c90000-20501231.html', note: '伦敦非遗与当代设计展' },
  { id: 'art-culture-4', domain: 'culture', source: "People's Daily Online", url: 'http://en.people.cn/n3/2025/0513/c90000-20314005.html', note: '文房四宝的传承' },
  { id: 'art-culture-5', domain: 'culture', source: 'China Daily', url: 'https://global.chinadaily.com.cn/a/202507/18/WS6879841ba310ad07b5d908f9.html', note: '博物馆里的文明互鉴' },
  { id: 'art-culture-6', domain: 'culture', source: 'Xinhua', url: 'https://english.news.cn/20251218/efe36c0da65d48c19c19ce3a18ed0f37/c.html', note: '木拱桥营造技艺的数字化保护' },

  // ── 社会建设 ────────────────────────────────────────────────
  { id: 'art-society-1', domain: 'society', source: 'CGTN', url: 'https://news.cgtn.com/news/2026-08-27/China-vows-to-consolidate-poverty-alleviation-gains-1PWp9whciLC/p.html', note: '脱贫成果与乡村振兴' },
  { id: 'art-society-2', domain: 'society', source: 'gov.cn', url: 'https://english.www.gov.cn/archive/statistics/202503/09/content_WS67cd5849c6d0868f4e8f0a42.html', note: '村卫生室医保覆盖' },
  { id: 'art-society-3', domain: 'society', source: 'SCIO', url: 'http://english.scio.gov.cn/topnews/2024-09/20/content_117438470.html', note: '延迟退休改革' },
  { id: 'art-society-4', domain: 'society', source: 'Xinhua', url: 'http://english.news.cn/20240910/42b98b3517ee4e6a8225672da1e4e377/c.html', note: '社区居家养老' },
  { id: 'art-society-5', domain: 'society', source: 'China Daily', url: 'https://global.chinadaily.com.cn/a/202501/22/WS6790304ba310a2ab06ea86bd.html', note: '就业稳定与青年失业率' },
  { id: 'art-society-6', domain: 'society', source: "People's Daily Online", url: 'http://en.people.cn/n3/2024/1109/c90000-20239464.html', note: '特色产业带动乡村振兴' },

  // ── 生态文明建设 ────────────────────────────────────────────
  { id: 'art-ecology-1', domain: 'ecology', source: 'china.org.cn', url: 'http://www.china.org.cn/2026-08/14/content_118647000.shtml', note: '空气质量改善行动计划' },
  { id: 'art-ecology-2', domain: 'ecology', source: 'China Development Gateway', url: 'http://en.chinagate.cn/2026-09/18/content_118702293.htm', note: '碳市场成交量创新高' },
  { id: 'art-ecology-3', domain: 'ecology', source: 'Xinhua', url: 'http://english.news.cn/20260901/c45a7fc896364cb5aa41810a90686e33/c.html', note: '光伏装机首超煤电' },
  { id: 'art-ecology-4', domain: 'ecology', source: 'gov.cn', url: 'https://english.www.gov.cn/news/202605/23/content_WS6a1101c9c6d00ca5f9a0b313.html', note: '生物多样性保护的中国方案' },
  { id: 'art-ecology-5', domain: 'ecology', source: 'China Daily', url: 'https://global.chinadaily.com.cn/a/202604/01/WS69cd0415a310d6866eb413b0.html', note: '能源结构与绿色转型' },
  { id: 'art-ecology-6', domain: 'ecology', source: "People's Daily Online", url: 'http://en.people.cn/n3/2025/0928/c90000-20372277.html', note: '长江保护（评论）' },

  // ── 科技创新 ────────────────────────────────────────────────
  { id: 'art-tech-1', domain: 'tech', source: 'Xinhua', url: 'https://english.news.cn/20260514/db28783f4b34466096e9cde2dd7afecc/c.html', note: '九章四号' },
  { id: 'art-tech-2', domain: 'tech', source: 'Xinhua', url: 'http://english.news.cn/20250122/3b265f0ba8c6459d8156c77ee3757f93/c.html', note: '2024 十大科技进展' },
  { id: 'art-tech-3', domain: 'tech', source: 'China Daily', url: 'http://www.chinadaily.com.cn/a/202609/07/WS6a9e750be4b06d4aa055cc0a.html', note: '信息基础设施投资' },
  { id: 'art-tech-4', domain: 'tech', source: 'Xinhua', url: 'https://english.news.cn/20251024/6dadeddac3f34ee8ba66ca4e4c41f29d/c.html', note: '固态电池突破' },
  { id: 'art-tech-5', domain: 'tech', source: "People's Daily Online", url: 'http://en.people.cn/n3/2025/1106/c90000-20387229.html', note: '高水平科技自立自强' },
  { id: 'art-tech-6', domain: 'tech', source: "People's Daily Online", url: 'http://en.people.cn/n3/2025/1124/c90000-20393950.html', note: '量子技术成果转化' },

  // ── 教育强国 ────────────────────────────────────────────────
  { id: 'art-education-1', domain: 'education', source: 'Xinhua', url: 'https://english.news.cn/20260411/98609f94226549b09bb7cb4ceaf58471/c.html', note: 'AI 进课堂' },
  { id: 'art-education-2', domain: 'education', source: 'Xinhua', url: 'https://english.news.cn/20250115/54d76973a15442d7895e59af2d75fec6/c.html', note: '技能人才培养' },
  { id: 'art-education-3', domain: 'education', source: 'Xinhua', url: 'https://english.news.cn/20260509/07f6a1c9bf964ed5a3cbae385980949e/c.html', note: '教育推动现代化' },
  { id: 'art-education-4', domain: 'education', source: 'CGTN', url: 'https://news.cgtn.com/news/2026-02-27/How-China-s-vocational-education-is-powering-its-next-growth-phase-1L6dIIMwv7i/index.html', note: '职业教育支撑产业升级' },
  { id: 'art-education-5', domain: 'education', source: "People's Daily Online", url: 'http://en.people.cn/n3/2026/0105/c90000-20410405.html', note: '国家智慧教育平台' },
  { id: 'art-education-6', domain: 'education', source: 'china.org.cn', url: 'http://www.china.org.cn/2025-05/12/content_117869800.shtml', note: '教师队伍建设' },

  // ── 国际传播 ────────────────────────────────────────────────
  { id: 'art-communication-1', domain: 'communication', source: 'Xinhua', url: 'http://english.news.cn/20260421/ab2873cf40924c199c90aee98d9b58c3/c.html', note: '阿塞拜疆中文热' },
  { id: 'art-communication-2', domain: 'communication', source: 'China Daily', url: 'http://www.chinadaily.com.cn/a/202406/07/WS6662d42ba31082fc043cb83a.html', note: '气候周与可持续发展' },
  { id: 'art-communication-3', domain: 'communication', source: 'Xinhua', url: 'https://english.news.cn/20251114/e9a7317830444d8b9456003dbdfbdb9d/c.html', note: '支持国际中文教育' },
  { id: 'art-communication-4', domain: 'communication', source: 'Xinhua', url: 'https://english.news.cn/20251205/092d72e33505455a85e3e6a942f460e1/c.html', note: '人文交流弥合分歧（评论）' },
  { id: 'art-communication-5', domain: 'communication', source: 'Xinhua', url: 'https://english.news.cn/20251129/e2b722fec5774cdb91de31d0800d40ab/c.html', note: '外国游客的汉服热' },
  { id: 'art-communication-6', domain: 'communication', source: 'Xinhua', url: 'http://english.news.cn/africa/20260421/5303a610f63d4845a2eed579c5361e0c/c.html', note: '开罗的联合国中文日' },
]

/** 正文容器的候选选择器；按顺序试，取第一个能抽到**像样正文**的。 */
const BODY_ANCHORS = [
  'id="detail"', // 新华英文
  'id="cmsMainContent"', // CGTN
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

/**
 * 取 `<meta property="og:title">` 的 content。
 *
 * ⚠️ 属性值里的引号必须按**引号种类**配对去取，不能写成 `content=["']([^"']+)["']`：
 * 那样会连**撇号**一起排除掉，于是 `China's foreign trade grows…` 被截成 `China`——
 * 卡片上就会出现一张标题只写着"China"的文章（实测踩过，被"每张卡片都有标题"抓出来）。
 */
function metaTitle(html) {
  const patterns = [
    /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i,
    /<meta[^>]+property='og:title'[^>]+content='([^']+)'/i,
  ]
  for (const pattern of patterns) {
    const hit = pattern.exec(html)
    if (hit?.[1]) return decodeEntities(hit[1]).trim()
  }
  return ''
}

/**
 * 标题：og:title → <h1> → <title>。
 *
 * `<title>` 是兜底，**不能省**：SCIO 那类政府站的页面里 h1 是导航用的空壳、
 * 也没有 og:title，只认前两个的话标题会是空串——卡片上就会出现一张"没有标题"的
 * 文章（实测踩过：社会建设那一格两篇空标题，被"同领域不雷同"的断言抓出来）。
 */
function extractTitle(html) {
  const fromOg = metaTitle(html)
  if (fromOg.length > 4) return fromOg
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const fromH1 = h1 ? stripTags(h1[1]).replace(/\s+/g, ' ').trim() : ''
  if (fromH1.length > 4) return fromH1
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!title) return ''
  /*
   * 站点后缀：`标题 - Xinhua | English.news.cn`。
   * 分隔符**两侧必须有空白**才算后缀——不然标题里自带连字符的词
   * （`Whole-process people's democracy`）会被从中间切掉。
   */
  return stripTags(title[1])
    .replace(/\s+[-–—_|]\s+[^-–—_|]{2,60}$/, '')
    .replace(/\s*[-–—_|]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 正文**到此为止**的标记。
 *
 * 全文抓取最容易坏在结尾：正文后面往往跟着"最热文章""相关阅读"那一摞，
 * 它们同样在 `<p>` 里，靠"太短"或"关键词"一条条过滤会漏。
 * 因此这里改成**一撞到就停**——只要正文里不该出现这些东西。
 */
const FOOTER_MARKERS =
  /^(most read|most popular|related news|related articles|recommended|photo|video|editor:|source:|share|tags?:|copyright|all rights reserved|about us|contact us|privacy policy|terms of use|home|previous|next)\b/i

/** 图片说明：不是正文，整段丢掉（新华/中国日报的图注常排在正文最前面）。 */
const CAPTION = /^(this photo|a[n]? (aerial |file )?photo|photo:|photos?:|video:|image:|\(photo|\[photo|.*\(photo by |.*\/xinhua\)$|.*\/vcg$)/i

/** 抽正文段落：够长、像正文、撞到"正文到此为止"就停。 */
function paragraphsFrom(segment) {
  const paragraphs = []
  let collected = 0
  for (const match of segment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(match[1]).replace(/\s+/g, ' ').trim()
    /*
     * 页眉页脚那些词（Home / Photo / Video / Share…）在整页里到处都是，
     * 但**只有正文已经收了一截之后**撞到它们才算"正文到头了"；
     * 否则只能跳过这一条——不然开头一个 `<p>Home</p>` 就能把整篇砍成空的。
     */
    if (FOOTER_MARKERS.test(text)) {
      if (collected > 400) break
      continue
    }
    if (/newsletter|subscribe for free/i.test(text)) continue
    // china.org.cn 正文末尾那块"关注我们"的栏位（还夹着被截断的 HTML 注释残渣）
    if (/follow china\.org\.cn|appproperty/i.test(text)) continue
    if (text.length < 40) continue
    if (CAPTION.test(text)) continue
    // 明显的非正文：版权、分享、编辑署名、导航、Cookie 提示
    if (/\. All rights reserved/i.test(text)) continue
    if (/^(Xinhua|China Daily|CGTN)\s*\|/i.test(text)) continue
    if (/cookies?|privacy policy|terms of use|browse our site/i.test(text)) continue
    paragraphs.push(text)
    collected += text.length
  }
  return paragraphs
}

/**
 * 抽正文段落。
 *
 * 先按锚点把范围缩小到正文容器（准确、快），**抽不出三段就换下一个锚点**，
 * 全都不行再退回整页找——CGTN 这类站点的正文容器名每版都在换，
 * 只认一个锚点会在某天突然变成"抽不出正文"（这一版就遇到过）。
 */
function extractParagraphs(html) {
  for (const anchor of BODY_ANCHORS) {
    const index = html.indexOf(anchor)
    if (index < 0) continue
    const got = paragraphsFrom(html.slice(index))
    if (got.length >= 3) return got
  }
  return paragraphsFrom(html)
}

/** 英译中计词数（空白切分，标点不算词）。 */
function countWords(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
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
  const title = extractTitle(html).replace(/^Update:\s*/i, '').replace(/\s+/g, ' ').trim()
  const paragraphs = extractParagraphs(html)
  if (paragraphs.length === 0) throw new Error('抽不出正文段落（容器选择器需要补）')
  // 新华那类稿子以 ■ 收尾（版面的收尾符号），不是正文，去掉之后"结尾是否完整"才看得出来
  const text = paragraphs
    .join('\n\n')
    .replace(/\s*■\s*$/, '')
    .trim()
  return { title, paragraphs, text, words: countWords(text) }
}

const wanted = ONLY.length > 0 ? SOURCES.filter((entry) => ONLY.includes(entry.id)) : SOURCES
const results = []
const failures = []
const warnings = []

console.log(`抓取 ${wanted.length} 篇英文全文${ONLY.length > 0 ? `（--only=${ONLY.join(',')}）` : ''}\n`)

for (const entry of wanted) {
  try {
    const got = await fetchOne(entry)
    results.push({ entry, ...got })
    const tail = got.text.trim().slice(-32).replace(/\s+/g, ' ')
    const flags = []
    if (got.words < 250) flags.push('太短')
    if (!/[.!?"'”’）)]$/.test(got.text.trim())) flags.push('结尾没有句末标点')
    if (flags.length > 0) warnings.push(`${entry.id}（${flags.join('；')}）`)
    console.log(
      `${flags.length === 0 ? '✓' : '·'} ${entry.id.padEnd(22)} ${String(got.paragraphs.length).padStart(3)}段 ` +
        `${String(got.words).padStart(4)}词  ${entry.source.padEnd(24)} ${got.title.slice(0, 44)}`,
    )
    console.log(`    …${tail}`)
  } catch (error) {
    failures.push({ entry, message: error instanceof Error ? error.message : String(error) })
    console.log(`✗ ${entry.id.padEnd(22)} ${entry.source.padEnd(24)} ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('')
console.log(`成功 ${results.length} / ${wanted.length}；失败 ${failures.length}；有疑点 ${warnings.length}`)
if (failures.length > 0) {
  console.log('失败清单：')
  for (const failure of failures) console.log(`  - ${failure.entry.id}: ${failure.entry.url} （${failure.message}）`)
}
if (warnings.length > 0) console.log(`疑点：${warnings.join('；')}`)

if (WRITE) {
  const body = results
    .map(
      ({ entry, title, text, words }) =>
        `  {\n` +
        `    id: ${JSON.stringify(entry.id)},\n` +
        `    domain: ${JSON.stringify(entry.domain)},\n` +
        `    direction: "en-to-zh",\n` +
        `    title: ${JSON.stringify(title)},\n` +
        `    source: ${JSON.stringify(entry.source)},\n` +
        `    url: ${JSON.stringify(entry.url)},\n` +
        `    units: ${words},\n` +
        `    excerpt: ${JSON.stringify(text)},\n` +
        `  },`,
    )
    .join('\n')
  const file = [
    '/**',
    ' * 文章库 · 英译中（**自动生成，不要手改**）。',
    ' *',
    ' * 生成命令：node scripts/fetch-articles.mjs --write',
    ' * 内容是**整篇正文**（新华社英文、中国日报、CGTN、人民网英文、gov.cn、china.org.cn 等',
    ' * 中国官方对外英文媒体），每篇保留 URL 供溯源。练习时按 100–200 词一页切，',
    ' * 规则见 domain/sections.ts 的 paginateArticle。',
    ' */',
    '',
    "import type { ArticleExcerpt } from '../articles'",
    '',
    'export const EN_ARTICLES: readonly ArticleExcerpt[] = [',
    body,
    ']',
    '',
  ].join('\n')
  const outDir = path.join(root, 'src', 'domain', 'articles-data')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'en-to-zh.ts')
  writeFileSync(outFile, file, 'utf8')
  console.log(`\n已写入 ${path.relative(root, outFile)}（${results.length} 篇）`)
}

// 抓取失败就要报错退出——不能安静地少几篇
process.exitCode = failures.length === 0 ? 0 : 1
