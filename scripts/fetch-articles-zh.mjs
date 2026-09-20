/**
 * 抓取**中文原文**并生成连续选段，供文章库的中译英方向使用。
 *
 * 与 fetch-articles.mjs（英文侧）分开，是因为中文站的页面结构完全不同：
 * 标题在 <h1> / <title> / og:title 里，正文容器的 class 各站不同，
 * 篇幅口径也不同（汉译英按**汉字数**计，不含标点空白数字英文）。
 *
 * ## 用法
 *
 *   node scripts/fetch-articles-zh.mjs --check     # 抓取并报告字数，不写文件
 *   node scripts/fetch-articles-zh.mjs --emit      # 输出可粘进 articles.ts 的数据
 *   node scripts/fetch-articles-zh.mjs --check --target=260
 *
 * `--emit` 只写到 node_modules/.cache，**不直接改源码**：选段进仓库需人工过目。
 *
 * ## 两条约定（见 ADR 0007）
 *
 * 1. 只收录权威中文原文（人民日报、新华社、中国政府网、教育部、求是网等），
 *    且**只存截取的连续片段**，不存全文。
 * 2. 选段**照抄原文**、保留完整段落，不改写——改写了术语与固定表述的考查就失真了。
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const TARGET = Number((process.argv.find((a) => a.startsWith('--target=')) ?? '--target=260').split('=')[1])
const EMIT = process.argv.includes('--emit')
const root = process.cwd()

/**
 * 候选文章。每条都经过人工/子代理 fetch 验证（HTTP 200、标题对得上）。
 * 优先选**本身就接近 200–300 字**或段落切分干净的；太长的靠选段取开头。
 */
const SOURCES = [
  // ── 经济建设 ────────────────────────────────────────────────
  { id: 'art-economy-1-zh', domain: 'economy', source: '中国政府网', url: 'https://www.gov.cn/lianbo/202609/content_7081268.htm', note: '8 月经济总体平稳向新向优' },
  { id: 'art-economy-2-zh', domain: 'economy', source: '新华网', url: 'http://www.news.cn/fortune/20260414/bfed2bf0a26d41af9d0ff6160b179b1e/c.html', note: '一季度民企担当外贸主力' },
  { id: 'art-economy-3-zh', domain: 'economy', source: '新华社', url: 'http://www.hubei.xinhua.org/20260916/b25057bd3500469f8ac6e2c9b1044dc5/c.html', note: '从前 8 个月数据看中国经济' },

  // ── 政治建设 ────────────────────────────────────────────────
  { id: 'art-politics-1-zh', domain: 'politics', source: '新华社', url: 'http://www.xinhuanet.com.cn/politics/20260312/65af45969fc74859b9a3b8f9296bf633/c.html', note: '三部重要法律通过' },
  { id: 'art-politics-2-zh', domain: 'politics', source: '中国政府网', url: 'https://www.gov.cn/yaowen/liebiao/202609/content_7081464.htm', note: '国务院常务会议' },
  { id: 'art-politics-3-zh', domain: 'politics', source: '新华社', url: 'http://www.news.cn/politics/20260310/b24bd46099eb457e88133d2cb10fc638/c.html', note: '全过程人民民主新实践' },

  // ── 文化建设 ────────────────────────────────────────────────
  { id: 'art-culture-1-zh', domain: 'culture', source: '人民网', url: 'http://ent.people.com.cn/n1/2026/0917/c1012-40800140.html', note: '楚风汉韵融入城市日常（段落长度理想）' },
  { id: 'art-culture-2-zh', domain: 'culture', source: '光明网', url: 'https://news.gmw.cn/2026-09/18/content_39006578.htm', note: '从服贸会看非遗保护传承新貌' },
  { id: 'art-culture-3-zh', domain: 'culture', source: '新华社', url: 'http://www.news.cn/politics/leaders/20260601/2e77b6338c3b4880b8d7dde081c71615/c.html', note: '习近平文化思想引领文化传承发展' },

  // ── 社会建设 ────────────────────────────────────────────────
  { id: 'art-society-1-zh', domain: 'society', source: '人民网', url: 'http://society.people.com.cn/n1/2026/0919/c1008-40801512.html', note: '未成年人健康安全使用网络（最贴篇幅）' },
  { id: 'art-society-2-zh', domain: 'society', source: '新华社', url: 'http://www.news.cn/politics/20260307/1533a7cddd21419f9bca2c1ce50f4f60/c.html', note: '从全国两会看民生福祉' },
  { id: 'art-society-3-zh', domain: 'society', source: '新华社', url: 'http://www2.xinhuanet.com/politics/leaders/20260331/53b5fe3e2bcd4a7bbf506f87fd1a3bfc/c.html', note: '长护险守护夕阳红' },

  // ── 生态文明建设 ────────────────────────────────────────────
  { id: 'art-ecology-1-zh', domain: 'ecology', source: '人民网', url: 'http://finance.people.com.cn/n1/2026/0919/c1004-40801562.html', note: '华电清洁能源装机占比超 62%（篇幅贴）' },
  { id: 'art-ecology-2-zh', domain: 'ecology', source: '新华社', url: 'http://www.news.cn/politics/20260312/f2e0ef4a46dc4184bb0076460eec9b33/c.html', note: '生态环境部部长带芯片上通道' },
  { id: 'art-ecology-3-zh', domain: 'ecology', source: '新华社', url: 'http://www.news.cn/20260815/77f54a4a58684aff8bef83c8fec74d7f/c.html', note: '全国生态日主场活动' },

  // ── 科技创新 ────────────────────────────────────────────────
  { id: 'art-tech-1-zh', domain: 'tech', source: '新华网', url: 'https://www.news.cn/digital/20260910/8e6f3138eba84ca1a9cea7115fb3a9f8/c.html', note: '算电协同智能调度服务平台' },
  { id: 'art-tech-2-zh', domain: 'tech', source: '新华网', url: 'https://www.news.cn/tech/20260918/42277cf892f84d4dade743dbf2f734e1/c.html', note: '华为昇腾 960 超节点' },
  { id: 'art-tech-3-zh', domain: 'tech', source: '新华网', url: 'http://www.news.cn/fortune/20260505/059596dc8a964b41b66f2cdb798fd0de/c.html', note: '90 后团队打破技术垄断' },

  // ── 教育强国 ────────────────────────────────────────────────
  { id: 'art-education-1-zh', domain: 'education', source: '教育部', url: 'http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/moe_1485/202603/t20260319_1431565.html', note: '教育强国建设三年行动计划试点座谈会' },
  { id: 'art-education-2-zh', domain: 'education', source: '人民网', url: 'http://gd.people.com.cn/n2/2026/0707/c123932-41631491.html', note: '教育强国建设开新局见实效' },
  { id: 'art-education-3-zh', domain: 'education', source: '教育部', url: 'https://www.moe.gov.cn/jyb_xwfb/s5147/202609/t20260916_1450979.html', note: '教育公共服务路径升级' },

  // ── 国际传播 ────────────────────────────────────────────────
  { id: 'art-communication-1-zh', domain: 'communication', source: '新华社', url: 'https://www2.xinhuanet.com/20260917/ab7d81ca4dad4f4196accb7cf92ee39e/c.html', note: '中国文化日走进澳大利亚校园' },
  { id: 'art-communication-2-zh', domain: 'communication', source: '求是网', url: 'http://qstheory.cn/20260114/db31d150cbb8428a9b25efbf10f5cdc4/c.html', note: '全面提升国际话语权' },
  { id: 'art-communication-3-zh', domain: 'communication', source: '新华网', url: 'http://www.qh.news.cn/20260917/284fbac8eded445296d16364a0f243d8/c.html', note: '中亚 Z 世代走进中国夏都' },
]

/** 正文容器的候选锚点；按顺序试，取第一个找得到的。 */
const BODY_ANCHORS = [
  'id="UCAP-CONTENT"', // 中国政府网
  'id="detail"', // 新华网 / xinhuanet
  'class="rm_txt_con"', // 人民网
  'id="rwb_zw"', // 人民网（部分频道）
  'class="article-content"',
  'class="content"',
  'id="content"',
  'class="TRS_Editor"', // 教育部等政府站常见
  'class="pages_content"',
  'class="article"',
]

function decodeEntities(text) {
  return text
    .replace(/&emsp;|&ensp;|&thinsp;/g, ' ') // 中文站常用它做首行缩进，不解码会留在正文里
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(html) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

/**
 * 清洗标题。中文站的 <title> 常带着站点后缀、频道名、"全部导航"这类页面残留，
 * 而 og:title / <h1> 一般是干净的标题。清洗规则集中在这里，
 * 因为标题会显示在卡片上，脏着很难看。
 */
function cleanTitle(raw) {
  let title = raw.replace(/\s+/g, ' ').trim()
  // 页面残留
  if (/^(全部导航|首页|网站地图)$/.test(title)) title = ''
  /*
   * 去后缀，**顺序不能换**：中文站的 <title> 常是
   *   `楚风汉韵融入城市日常（解码·文化遗产系统性保护） --文旅·体育--人民网`
   * 也就是 `标题 --频道--站名`。必须**先去站名、再去频道**——
   * 反过来的话"频道"那条规则看到的是字符串末尾的 `--人民网`，
   * 而频道名后面还跟着 `--站名`，于是频道名留在标题里（实测踩过：
   * 卡片上显示成「… · --文旅·体育」）。
   */
  title = title.replace(
    /\s*[-–—_|]{1,3}\s*(人民网|新华网|中国政府网|光明网|求是网|中国教育报|中华人民共和国教育部|央视网|中国新闻网|澎湃新闻)[^-–—_|]*$/,
    '',
  )
  // 频道名：可以是「文旅·体育」这种带间隔号的两段
  title = title.replace(/\s*[-–—_|]{1,3}\s*[\u4e00-\u9fff]{0,6}(?:[·、][\u4e00-\u9fff]{0,6})?\s*$/, '')
  title = title.replace(/^(原标题：|【)/, '').replace(/】$/, '')
  return title.trim()
}

/** 标题：og:title → <h1> → <title>（去掉站点后缀）。 */
function extractTitle(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
  if (og) {
    const cleaned = cleanTitle(decodeEntities(og[1]))
    if (cleaned.length > 4) return cleaned
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1) {
    const cleaned = cleanTitle(stripTags(h1[1]))
    if (cleaned.length > 4) return cleaned
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (title) return cleanTitle(stripTags(title[1]))
  return ''
}

/** 抓正文段落；过滤掉导航、署名、分享、图片说明一类。 */
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
    let text = stripTags(match[1]).replace(/\s+/g, ' ').trim()
    // 去掉正文里的内嵌图片说明与署名：`…（无人机照片）。新华社发（俞方平摄）`
    text = text
      .replace(/（[^）]{0,20}(照片|摄|图)[^）]{0,20}）/g, '')
      .replace(/新华社发（[^）]{0,20}摄）/g, '')
      .replace(/新华社记者[^。，]{0,12}摄/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 20) continue
    // 非正文的常见残留
    if (/^(责任编辑|编辑|来源|记者|分享|扫一扫|原标题|【纠错】|上一篇|下一篇)/.test(text)) continue
    if (/^(新华社|人民日报|光明日报).{0,12}(电|讯)$/.test(text)) continue
    if (/请刷新本页面|阅读剩余全文|客户端|网站地图|版权所有/.test(text)) continue
    if (/^[\w.@]+@[\w.]+$/.test(text)) continue
    // 纯图注（去掉了说明之后没剩下什么实质内容）或只剩一个来源署名
    if (/^[（(【].{0,30}[）)】]$/.test(text)) continue
    if (/^新华社发$|^新华社$|^资料图$|^图\/新华社$/.test(text)) continue
    paragraphs.push(text)
  }
  return paragraphs
}

/** 中译英按**汉字数**计：只数 U+4E00–U+9FFF（不含标点、空白、数字、拉丁字母）。 */
function countHan(text) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
}

/**
 * 从正文开头按段落累加，**落在赛制区间内**：汉译英要求 200–300 字。
 *
 * 规则（顺序不能换）：
 *   1. 逐段加，直到达到目标（默认 280，取区间中偏上，留出浮动余地）；
 *   2. 若加完最后一段**超过了上界**，就把这一段退掉——宁可短一点，也不要超篇长；
 *   3. 退掉之后若不到下界（200），说明段落太长、整段吞下去就超标，此时退而求其次：
 *      **按句号切**，只取到不超上界为止（句内不切，读起来仍是完整句子）；
 *   4. 仍不够就只能如实报出真实字数，由人决定要不要换一篇——
 *      界面上会标出"不符合赛制篇幅"，不假装它合规。
 */
const BAND = { min: 200, max: 300 }

function buildExcerpt(paragraphs, target) {
  const picked = []
  let count = 0
  for (const paragraph of paragraphs) {
    picked.push(paragraph)
    count = countHan(picked.join('\n\n'))
    if (count >= target) break
  }

  // 超上界：退掉刚加的那一段
  if (count > BAND.max && picked.length > 1) {
    picked.pop()
    count = countHan(picked.join('\n\n'))
  }

  // 退完反而不足下界：按句切，尽量贴到区间内
  if (count < BAND.min) {
    const joined = paragraphs.join('')
    if (countHan(joined) > BAND.max) {
      const sentences = joined.split(/(?<=[。！？；])/).filter((sentence) => sentence.trim().length > 0)
      const kept = []
      let running = 0
      for (const sentence of sentences) {
        const next = running + countHan(sentence)
        if (next > BAND.max) break
        kept.push(sentence)
        running = next
      }
      if (kept.length > 0 && running >= BAND.min) {
        return { text: kept.join(''), units: running }
      }
    }
  }

  if (picked.length === 0) {
    const first = paragraphs[0] ?? ''
    return { text: first, units: countHan(first) }
  }
  return { text: picked.join('\n\n'), units: count }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function fetchOne(entry) {
  const response = await fetch(entry.url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  // 中文站多为 UTF-8；少数老站是 GBK，这里按 UTF-8 读，乱码会在字数上显出来
  const buffer = Buffer.from(await response.arrayBuffer())
  let html = buffer.toString('utf8')
  if (countHan(html) < 50) {
    // 汉字极少 → 多半不是 UTF-8，用 GBK 再解一次
    html = new TextDecoder('gbk').decode(buffer)
  }
  const title = extractTitle(html)
  const paragraphs = extractParagraphs(html)
  if (paragraphs.length === 0) throw new Error('抽不出正文段落（容器选择器需要补）')
  const excerpt = buildExcerpt(paragraphs, TARGET)
  return { title, excerpt, paragraphCount: paragraphs.length }
}

const results = []
const failures = []

for (const entry of SOURCES) {
  try {
    const got = await fetchOne(entry)
    results.push({ entry, ...got })
    const inBand = got.excerpt.units >= 200 && got.excerpt.units <= 300 ? '✓' : '·'
    console.log(
      `${inBand} ${entry.id.padEnd(24)} ${String(got.paragraphCount).padStart(3)}段 ` +
        `${String(got.excerpt.units).padStart(4)}字  ${entry.source.padEnd(10)} ${got.title.slice(0, 40)}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ entry, message })
    console.log(`✗ ${entry.id.padEnd(24)} ${entry.source.padEnd(10)} ${message}`)
  }
}

console.log('')
console.log(`成功 ${results.length} / ${SOURCES.length}；失败 ${failures.length}`)
for (const failure of failures) console.log(`  - ${failure.entry.id}: ${failure.entry.url} （${failure.message}）`)

if (EMIT) {
  const lines = results.map(({ entry, title, excerpt }) => {
    const cleanTitle = title.replace(/^(原标题：|【)/, '').replace(/\s+/g, ' ').trim()
    return `  {
    id: ${JSON.stringify(entry.id)},
    domain: ${JSON.stringify(entry.domain)},
    direction: "zh-to-en",
    title: ${JSON.stringify(cleanTitle)},
    source: ${JSON.stringify(entry.source)},
    url: ${JSON.stringify(entry.url)},
    units: ${excerpt.units},
    excerpt: ${JSON.stringify(excerpt.text)},
  },`
  })
  const outDir = path.join(root, 'node_modules', '.cache')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'article-emit-zh.txt')
  writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\n已写出 ${results.length} 条到 ${path.relative(root, outFile)}（**未改源码**，请人工过目后再落进 articles.ts）`)
}

process.exitCode = failures.length === 0 ? 0 : 1
