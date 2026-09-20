/**
 * 抓取文章库的**中文全文**，写成 `src/domain/articles-data/zh-to-en.ts`。
 *
 * 与 fetch-articles.mjs（英文侧）分开，是因为中文站的页面结构完全不同：
 * 标题在 og:title / <h1> / <title> 里，正文容器的 class 各站不同，
 * 篇幅口径也不同（汉译英按**汉字数**计，不含标点、空白、数字、拉丁字母）。
 *
 * ## 这一版与上一版的区别：全文，不是选段
 *
 * 上一版只存"从开头累加到 200–300 字"的一段（见 ADR 0007 的旧口径），
 * 于是用户拿到的永远是**文章的一部分**。现在的要求是：
 * 「不管字数限制，让用户可以逐段翻译整篇文章」——练习时按 100–200 字一页切
 * （`domain/sections.ts` 的 paginateArticle），因此**库里必须是完整的正文**。
 *
 * ## 两条约定
 *
 * 1. 只收录权威中文原文（新华社、人民日报、中国政府网、光明网、求是网、教育部等）；
 * 2. 正文**照抄原文**、不改写——改写了术语与固定表述的考查就失真了。
 *
 * ## 用法
 *
 *   node scripts/fetch-articles-zh.mjs --check
 *   node scripts/fetch-articles-zh.mjs --write
 *   node scripts/fetch-articles-zh.mjs --only=art-economy-zh-1
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

/** 待抓取的文章。每条都经过人工或子代理 fetch 验证（HTTP 200、标题对得上）。 */
const SOURCES = [
  // ── 经济建设 ────────────────────────────────────────────────
  { id: 'art-economy-zh-1', domain: 'economy', source: '中国政府网', url: 'https://www.gov.cn/lianbo/202609/content_7081268.htm', note: '8 月经济总体平稳向新向优' },
  { id: 'art-economy-zh-2', domain: 'economy', source: '新华网', url: 'http://www.news.cn/fortune/20260414/bfed2bf0a26d41af9d0ff6160b179b1e/c.html', note: '一季度民企担当外贸主力' },
  { id: 'art-economy-zh-3', domain: 'economy', source: '新华社', url: 'http://www.hubei.xinhua.org/20260916/b25057bd3500469f8ac6e2c9b1044dc5/c.html', note: '从前 8 个月数据看中国经济' },
  { id: 'art-economy-zh-4', domain: 'economy', source: '新华社', url: 'http://www.news.cn/fortune/20260128/2e785869bf0b4794b9d4ce714cf7708d/c.html', note: '超大规模市场优势' },
  { id: 'art-economy-zh-5', domain: 'economy', source: '新华社', url: 'http://www.news.cn/20260306/b0158d6de5304262ae074fc7ff09bb77/c.html', note: '就业友好型发展方式' },
  { id: 'art-economy-zh-6', domain: 'economy', source: '人民日报', url: 'http://paper.people.com.cn/rmrb/pc/content/202601/15/content_30132796.html', note: '外贸九连增' },

  // ── 政治建设 ────────────────────────────────────────────────
  { id: 'art-politics-zh-1', domain: 'politics', source: '新华社', url: 'http://www.xinhuanet.com.cn/politics/20260312/65af45969fc74859b9a3b8f9296bf633/c.html', note: '三部重要法律通过' },
  { id: 'art-politics-zh-2', domain: 'politics', source: '中国政府网', url: 'https://www.gov.cn/yaowen/liebiao/202609/content_7081464.htm', note: '国务院常务会议' },
  { id: 'art-politics-zh-3', domain: 'politics', source: '新华社', url: 'http://www.news.cn/politics/20260310/b24bd46099eb457e88133d2cb10fc638/c.html', note: '全过程人民民主新实践' },
  { id: 'art-politics-zh-4', domain: 'politics', source: '新华网', url: 'https://www.news.cn/20260228/5808af7e94e84f7497e259788846b375/c.html', note: '2025 年国家立法' },
  { id: 'art-politics-zh-5', domain: 'politics', source: '人民网', url: 'http://cpc.people.com.cn/n1/2025/0104/c64387-40395278.html', note: '反腐败斗争' },
  { id: 'art-politics-zh-6', domain: 'politics', source: '求是网', url: 'https://www.qstheory.cn/20251027/9efe8c82b67a443689bf35ca738fa646/c.html', note: '全过程人民民主的本质要求' },

  // ── 文化建设 ────────────────────────────────────────────────
  { id: 'art-culture-zh-1', domain: 'culture', source: '人民网', url: 'http://ent.people.com.cn/n1/2026/0917/c1012-40800140.html', note: '楚风汉韵融入城市日常' },
  { id: 'art-culture-zh-2', domain: 'culture', source: '光明网', url: 'https://news.gmw.cn/2026-09/18/content_39006578.htm', note: '从服贸会看非遗保护传承新貌' },
  { id: 'art-culture-zh-3', domain: 'culture', source: '新华社', url: 'http://www.news.cn/politics/leaders/20260601/2e77b6338c3b4880b8d7dde081c71615/c.html', note: '习近平文化思想引领文化传承发展' },
  { id: 'art-culture-zh-4', domain: 'culture', source: '光明网', url: 'https://news.gmw.cn/2026-05/19/content_38772053.htm', note: '博物馆：联结世界的桥梁' },
  { id: 'art-culture-zh-5', domain: 'culture', source: '中国政府网', url: 'https://www.gov.cn/zhengce/202512/content_7050624.htm', note: '访文化和旅游部部长孙业礼' },
  { id: 'art-culture-zh-6', domain: 'culture', source: '人民网', url: 'http://cpc.people.com.cn/n1/2025/0613/c64387-40499770.html', note: '让非遗融入现代生活' },

  // ── 社会建设 ────────────────────────────────────────────────
  { id: 'art-society-zh-1', domain: 'society', source: '人民网', url: 'http://society.people.com.cn/n1/2026/0919/c1008-40801512.html', note: '未成年人健康安全使用网络' },
  { id: 'art-society-zh-2', domain: 'society', source: '新华社', url: 'http://www.news.cn/politics/20260307/1533a7cddd21419f9bca2c1ce50f4f60/c.html', note: '从全国两会看民生福祉' },
  { id: 'art-society-zh-3', domain: 'society', source: '新华社', url: 'http://www2.xinhuanet.com/politics/leaders/20260331/53b5fe3e2bcd4a7bbf506f87fd1a3bfc/c.html', note: '长护险守护夕阳红' },
  { id: 'art-society-zh-4', domain: 'society', source: '新华网', url: 'https://www.news.cn/20241231/5da64c8e2b6b42aa88e3ebf2fecc1048/c.html', note: '集采药降价不降质' },
  { id: 'art-society-zh-5', domain: 'society', source: '人民网', url: 'http://m.people.cn/n4/2024/0923/c1420-21245308.html', note: '老旧小区改造' },
  { id: 'art-society-zh-6', domain: 'society', source: '新华网', url: 'https://www.news.cn/politics/20260311/4eca0a423fbf44188ffc19ea2b12304f/c.html', note: '食品安全全链条监管' },

  // ── 生态文明建设 ────────────────────────────────────────────
  { id: 'art-ecology-zh-1', domain: 'ecology', source: '人民网', url: 'http://finance.people.com.cn/n1/2026/0919/c1004-40801562.html', note: '华电清洁能源装机占比超 62%' },
  { id: 'art-ecology-zh-2', domain: 'ecology', source: '新华社', url: 'http://www.news.cn/politics/20260312/f2e0ef4a46dc4184bb0076460eec9b33/c.html', note: '生态环境部部长带芯片上通道' },
  { id: 'art-ecology-zh-3', domain: 'ecology', source: '新华社', url: 'http://www.news.cn/20260815/77f54a4a58684aff8bef83c8fec74d7f/c.html', note: '全国生态日主场活动' },
  { id: 'art-ecology-zh-4', domain: 'ecology', source: '新华社', url: 'https://www.news.cn/politics/20251016/b400236ae81d416f8aa670a857bf6975/c.html', note: '优良天数比例达 87.2%' },
  { id: 'art-ecology-zh-5', domain: 'ecology', source: '新华社', url: 'https://www.news.cn/politics/20250626/6ff19c0763d146fab4ac54844ae35003/c.html', note: '绿色低碳转型' },
  { id: 'art-ecology-zh-6', domain: 'ecology', source: '光明网', url: 'https://news.gmw.cn/2025-06/14/content_38090202.htm', note: '海洋生态保护修复' },

  // ── 科技创新 ────────────────────────────────────────────────
  { id: 'art-tech-zh-1', domain: 'tech', source: '新华网', url: 'https://www.news.cn/digital/20260910/8e6f3138eba84ca1a9cea7115fb3a9f8/c.html', note: '算电协同智能调度服务平台' },
  { id: 'art-tech-zh-2', domain: 'tech', source: '新华网', url: 'https://www.news.cn/tech/20260918/42277cf892f84d4dade743dbf2f734e1/c.html', note: '华为昇腾 960 超节点' },
  { id: 'art-tech-zh-3', domain: 'tech', source: '新华网', url: 'http://www.news.cn/fortune/20260505/059596dc8a964b41b66f2cdb798fd0de/c.html', note: '90 后团队打破技术垄断' },
  { id: 'art-tech-zh-4', domain: 'tech', source: '新华网', url: 'https://www.news.cn/tech/20251230/da9300bd0c294a7b8099ecbbdbf5f901/c.html', note: '稳居量子科技第一梯队' },
  { id: 'art-tech-zh-5', domain: 'tech', source: '新华网', url: 'http://www.news.cn/tech/20251120/3d3fb75cb5db4aafa1ae30aa72260a34/c.html', note: '6G 产业布局加速' },
  { id: 'art-tech-zh-6', domain: 'tech', source: '新华网', url: 'http://www.news.cn/20251129/a14aae38991e4322ba9ed91511510be1/c.html', note: '国产创新药驶入快车道' },

  // ── 教育强国 ────────────────────────────────────────────────
  { id: 'art-education-zh-1', domain: 'education', source: '教育部', url: 'http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/moe_1485/202603/t20260319_1431565.html', note: '教育强国建设三年行动计划试点座谈会' },
  { id: 'art-education-zh-2', domain: 'education', source: '人民网', url: 'http://gd.people.com.cn/n2/2026/0707/c123932-41631491.html', note: '教育强国建设开新局见实效' },
  { id: 'art-education-zh-3', domain: 'education', source: '教育部', url: 'https://www.moe.gov.cn/jyb_xwfb/s5147/202609/t20260916_1450979.html', note: '教育公共服务路径升级' },
  { id: 'art-education-zh-4', domain: 'education', source: '教育部', url: 'http://www.moe.gov.cn/jyb_xwfb/xw_zt/moe_357/2025/2025_zt01/zsmj/202501/t20250111_1175204.html', note: '书写人民满意的教育新答卷' },
  { id: 'art-education-zh-5', domain: 'education', source: '新华网', url: 'https://www.news.cn/edu/20240301/4974a5a9d8404247838c0077b9d7ee39/c.html', note: '高等教育发展范式' },
  { id: 'art-education-zh-6', domain: 'education', source: '教育部', url: 'http://www.moe.gov.cn/jyb_sy/sy_rdjj/rdjj_ddesjszqhyljyzhggjzsp/202507/t20250725_1199388.html', note: '职业教育新发展' },

  // ── 国际传播 ────────────────────────────────────────────────
  { id: 'art-communication-zh-1', domain: 'communication', source: '新华社', url: 'https://www2.xinhuanet.com/20260917/ab7d81ca4dad4f4196accb7cf92ee39e/c.html', note: '中国文化日走进澳大利亚校园' },
  { id: 'art-communication-zh-2', domain: 'communication', source: '求是网', url: 'http://qstheory.cn/20260114/db31d150cbb8428a9b25efbf10f5cdc4/c.html', note: '全面提升国际话语权' },
  { id: 'art-communication-zh-3', domain: 'communication', source: '新华网', url: 'http://www.qh.news.cn/20260917/284fbac8eded445296d16364a0f243d8/c.html', note: '中亚 Z 世代走进中国夏都' },
  { id: 'art-communication-zh-4', domain: 'communication', source: '人民网', url: 'http://world.people.com.cn/n1/2026/0421/c1002-40705101.html', note: '中文，点亮多彩梦想' },
  { id: 'art-communication-zh-5', domain: 'communication', source: '人民网', url: 'http://world.people.com.cn/n1/2025/1224/c1002-40631432.html', note: '这一年，我的中国故事' },
  { id: 'art-communication-zh-6', domain: 'communication', source: '新华网', url: 'https://www.news.cn/politics/20260220/ae5d4df7928d4a848187f658b1259bfe/c.html', note: '在中国过春节' },
]

/** 正文容器的候选锚点；按顺序试，取第一个能抽到像样正文的。 */
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

/**
 * 正文**到此为止**的标记（一撞到就停，不再往下收）。
 *
 * 中文站正文后面紧跟着"责任编辑""相关阅读""上一篇/下一篇"那一摞，
 * 它们同样在 `<p>` 里；逐条过滤一定会漏，改成"撞到就停"才收得住。
 */
const FOOTER_MARKERS =
  /^(责任编辑|编辑：|来源：|记者：|作者：|分享|扫一扫|原标题|【纠错】|上一篇|下一篇|相关阅读|相关链接|返回顶部|网站地图|版权所有|免责声明|客户端下载|阅读剩余全文|我要评论|更多精彩内容)/

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
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

/**
 * 清洗标题。中文站的 <title> 常带着站点后缀、频道名、"全部导航"这类页面残留，
 * 而 og:title / <h1> 一般是干净的标题。
 */
function cleanTitle(raw) {
  let title = raw.replace(/\s+/g, ' ').trim()
  if (/^(全部导航|首页|网站地图)$/.test(title)) title = ''
  /*
   * 去后缀，**顺序不能换**：中文站的 <title> 常是
   *   `楚风汉韵融入城市日常（解码·文化遗产系统性保护） --文旅·体育--人民网`
   * 也就是 `标题 --频道--站名`。必须**先去站名、再去频道**——
   * 反过来的话"频道"那条规则看到的是字符串末尾的 `--人民网`，
   * 而频道名后面还跟着 `--站名`，于是频道名留在标题里（实测踩过）。
   */
  title = title.replace(
    /\s*[-–—_|]{1,3}\s*(人民网|新华网|中国政府网|光明网|求是网|中国教育报|中华人民共和国教育部|央视网|中国新闻网|澎湃新闻)[^-–—_|]*$/,
    '',
  )
  title = title.replace(/\s*[-–—_|]{1,3}\s*[\u4e00-\u9fff]{0,6}(?:[·、][\u4e00-\u9fff]{0,6})?\s*$/, '')
  title = title.replace(/^(原标题：|【)/, '').replace(/】$/, '')
  return title.trim()
}

/**
 * 取 `<meta property="og:title">` 的 content。
 *
 * ⚠️ 属性值里的引号必须按**引号种类**配对去取，不能写成 `content=["']([^"']+)["']`：
 * 那样会连撇号一起排除掉，英文标题里 `China's …` 会被截成 `China`（英文侧实测踩过）。
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

/** 标题：og:title → <h1> → <title>（去掉站点后缀）。 */
function extractTitle(html) {
  const fromOg = metaTitle(html)
  if (fromOg.length > 4) return cleanTitle(fromOg)
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (h1) {
    const cleaned = cleanTitle(stripTags(h1[1]))
    if (cleaned.length > 4) return cleaned
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (title) return cleanTitle(stripTags(title[1]))
  return ''
}

/** 抽正文段落；过滤掉导航、署名、分享、图片说明一类。 */
function paragraphsFrom(segment) {
  const paragraphs = []
  let collected = 0
  for (const match of segment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    let text = stripTags(match[1]).replace(/\s+/g, ' ').trim()
    // 去掉正文里的内嵌图片说明与署名：`…（无人机照片）。新华社发（俞方平摄）`
    text = text
      .replace(/（[^）]{0,20}(照片|摄|图)[^）]{0,20}）/g, '')
      .replace(/新华社发（[^）]{0,20}摄）/g, '')
      .replace(/新华社记者[^。，]{0,12}摄/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    /*
     * 页眉页脚那些词到处都是，但**只有正文已经收了一截之后**撞到才算"正文到头了"；
     * 否则只跳过这一条——不然开头一条"来源：xxx"就能把整篇砍成空的。
     */
    if (FOOTER_MARKERS.test(text)) {
      if (collected > 300) break
      continue
    }
    if (text.length < 20) continue
    /*
     * 站点页脚。中文站把"主办单位""ICP 备""版权所有"这些东西也放在 `<p>` 里，
     * 位置在正文之后，但**不是**每篇都有可以"撞到就停"的统一标记，因此逐条丢掉。
     */
    if (
      /主办单位|运行维护单位|中国政府网运行中心|京ICP备|京公网安备|网络出版服务许可证|增值电信业务经营许可证|举报邮箱|举报电话|网站声明|网站律师|信息保护|联系我们|all rights reserved|版权所有|请刷新本页面|阅读剩余全文|客户端|网站地图/i.test(
        text,
      )
    ) {
      continue
    }
    /*
     * 报眉（"《光明日报》（2026年09月18日 05版）"）与分享提示（"点击浏览器下方…分享微信好友…"）。
     *
     * 它们都不是正文，但都很像正文：报眉长度刚好够长（8–20 字）、分享提示又长又完整，
     * 靠"太短"或"含关键词"都拦不住。实测它们会各自变成一页的尾巴／开头——
     * 用户翻开第一页看到的第一句就是"点击浏览器下方…"，很扎眼。因此按形状拦。
     */
    if (/^《\s*[^》]{1,12}\s*》\s*[（(]\s*\d{4}\s*年/.test(text)) continue
    if (/点击浏览器下方|分享微信好友|Safari浏览器请点击/.test(text)) continue
    if (/^[\w.@]+@[\w.]+$/.test(text)) continue
    // 纯图注（去掉了说明之后没剩下什么实质内容）或只剩一个来源署名
    if (/^[（(【].{0,30}[）)】]$/.test(text)) continue
    if (/^新华社发$|^新华社$|^资料图$|^图\/新华社$|^新华社记者.{0,10}$/.test(text)) continue
    if (/^(新华网|人民网|光明网|央视网)\s*[·|]/.test(text)) continue
    paragraphs.push(text)
    collected += text.length
  }
  return paragraphs
}

/**
 * 抽正文段落。
 *
 * 先按锚点把范围缩小到正文容器，**抽不出三段就换下一个**，全都不行再退回整页找。
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

/** 中译英按**汉字数**计：只数 U+4E00–U+9FFF（不含标点、空白、数字、拉丁字母）。 */
function countHan(text) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length
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
    html = new TextDecoder('gbk').decode(buffer)
  }
  const title = extractTitle(html)
  const paragraphs = extractParagraphs(html)
  if (paragraphs.length === 0) throw new Error('抽不出正文段落（容器选择器需要补）')
  const text = paragraphs.join('\n\n').trim()
  return { title, paragraphs, text, chars: countHan(text) }
}

const wanted = ONLY.length > 0 ? SOURCES.filter((entry) => ONLY.includes(entry.id)) : SOURCES
const results = []
const failures = []
const warnings = []

console.log(`抓取 ${wanted.length} 篇中文全文${ONLY.length > 0 ? `（--only=${ONLY.join(',')}）` : ''}\n`)

for (const entry of wanted) {
  try {
    const got = await fetchOne(entry)
    results.push({ entry, ...got })
    const tail = got.text.trim().slice(-30).replace(/\s+/g, ' ')
    const flags = []
    if (got.chars < 250) flags.push('太短')
    if (!/[。！？…”』）】]$/.test(got.text.trim())) flags.push('结尾没有句末标点')
    if (flags.length > 0) warnings.push(`${entry.id}（${flags.join('；')}）`)
    console.log(
      `${flags.length === 0 ? '✓' : '·'} ${entry.id.padEnd(24)} ${String(got.paragraphs.length).padStart(3)}段 ` +
        `${String(got.chars).padStart(5)}字  ${entry.source.padEnd(10)} ${got.title.slice(0, 36)}`,
    )
    console.log(`    …${tail}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ entry, message })
    console.log(`✗ ${entry.id.padEnd(24)} ${entry.source.padEnd(10)} ${message}`)
  }
}

console.log('')
console.log(`成功 ${results.length} / ${wanted.length}；失败 ${failures.length}；有疑点 ${warnings.length}`)
for (const failure of failures) console.log(`  - ${failure.entry.id}: ${failure.entry.url} （${failure.message}）`)
if (warnings.length > 0) console.log(`疑点：${warnings.join('；')}`)

if (WRITE) {
  const body = results
    .map(
      ({ entry, title, text, chars }) =>
        `  {\n` +
        `    id: ${JSON.stringify(entry.id)},\n` +
        `    domain: ${JSON.stringify(entry.domain)},\n` +
        `    direction: "zh-to-en",\n` +
        `    title: ${JSON.stringify(title)},\n` +
        `    source: ${JSON.stringify(entry.source)},\n` +
        `    url: ${JSON.stringify(entry.url)},\n` +
        `    units: ${chars},\n` +
        `    excerpt: ${JSON.stringify(text)},\n` +
        `  },`,
    )
    .join('\n')
  const file = [
    '/**',
    ' * 文章库 · 中译英（**自动生成，不要手改**）。',
    ' *',
    ' * 生成命令：node scripts/fetch-articles-zh.mjs --write',
    ' * 内容是**整篇正文**（新华社、人民日报、中国政府网、光明网、求是网、教育部等权威中文来源），',
    ' * 每篇保留 URL 供溯源。练习时按 100–200 字一页切，规则见 domain/sections.ts 的 paginateArticle。',
    ' */',
    '',
    "import type { ArticleExcerpt } from '../articles'",
    '',
    'export const ZH_ARTICLES: readonly ArticleExcerpt[] = [',
    body,
    ']',
    '',
  ].join('\n')
  const outDir = path.join(root, 'src', 'domain', 'articles-data')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'zh-to-en.ts')
  writeFileSync(outFile, file, 'utf8')
  console.log(`\n已写入 ${path.relative(root, outFile)}（${results.length} 篇）`)
}

process.exitCode = failures.length === 0 ? 0 : 1
