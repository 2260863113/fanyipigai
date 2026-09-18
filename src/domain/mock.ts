/**
 * 第一版的假数据题库与假批改器。
 *
 * 目的：在接入真实 AI 之前，先把「批改怎么画」这件事验证清楚。
 * 五道句子题各覆盖一种改法类型（替换、插入、删除、整句重写、语序调换），
 * 每题都带一处绿色亮点。
 *
 * 批注位置**不由手工数**，而是由 anchorAt() 用 indexOf 定位。
 * 理由：真实 AI 给的正是字符序号，而人工数序号极易出错，验证时无法区分
 * 「是校验器有问题」还是「序号本身写错了」。用程序定位后，假数据的序号必然正确，
 * 于是冒烟测试里任何失败都指向真实的程序缺陷。
 * 序号本身仍会经过与真实 AI 输出完全相同的校验流程，校验器依旧被真实地检验。
 */

import type { Anchor, Correction, ErrorObject, Exercise, Highlight } from './types'

/** 按出现次序定位片段，得到带原文片段的锚点。occ 从 1 开始。 */
function anchorAt(text: string, sub: string, occ = 1): Anchor {
  let index = text.indexOf(sub)
  for (let i = 1; i < occ; i += 1) {
    if (index < 0) break
    index = text.indexOf(sub, index + 1)
  }
  if (index < 0) {
    // 这里抛错而不是悄悄降级：假数据写错片段时，应当在构建阶段立刻暴露。
    // 真实 AI 的输出走的是另一条路——校验器会拒绝渲染并告知用户，不会让页面崩掉。
    throw new Error(
      `假数据有误：在当前作答中找不到片段「${sub}」（第 ${occ} 次出现）。\n` +
        `  作答长度 ${text.length}，前 60 字符：${JSON.stringify(text.slice(0, 60))}`,
    )
  }
  return { start: index, end: index + sub.length, snippet: sub }
}

/** 假批改的结果。错误列表显式标注类型，避免写错分类或改法类型却无人发现。 */
export interface MockCorrection extends Omit<Correction, 'errors' | 'highlights'> {
  errors: ErrorObject[]
  highlights: Highlight[]
}

export interface MockCase {
  exercise: Exercise
  /** 故意写错的作答，用来演示批改 */
  sampleAnswer: string
  correction: MockCorrection
  /** 作答中值得肯定的片段，用于验证绿色标记 */
  highlight: (answer: string) => Highlight
}

// ─────────────────────────────────────────────────────────────
// 1. 替换 —— 主谓一致与冠词
// ─────────────────────────────────────────────────────────────
const replaceCase: MockCase = {
  exercise: {
    id: 'sentence-001',
    direction: 'en-to-zh',
    mode: 'sentence',
    genre: 'news',
    topic: '生态文明建设',
    source:
      'Ecological civilization is a form of human progress in which people and nature coexist in harmony, and it has become an essential component of China’s development strategy.',
    referenceTranslation:
      '生态文明是人与自然和谐共生的一种人类进步形态，已成为中国发展战略中至关重要的组成部分。',
    suggestedMinutes: 5,
  },
  sampleAnswer:
    'i is a form of human progress that people and nature live together in harmony, it became a important part of China development strategy.',
  correction: {
    total: 58,
    dimensions: { terminology: 14, grammar: 16, coherence: 14, register: 14 },
    summary:
      '基本意思传达完整，但主句出现主谓一致与冠词两处硬性错误，且原文的并列递进关系被拆成了两个独立分句，读起来松散。',
    dimensionComments: {
      terminology: '“生态文明”“发展战略”等概念译法正确，未出现术语偏差。',
      grammar: '“i is”“a important”属硬性语法错误；“it became”的时态与原文 has become 不对应。',
      coherence: '原文以 and it has become 承接的递进关系被逗号拼接取代，句间关系变模糊。',
      register: '整体语体偏口语，live together 未能体现 coexist 的正式表达。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 's1-h1',
    anchor: anchorAt(answer, 'people and nature live together in harmony'),
    comment: '“人与自然和谐共生”这一并列结构译得准确，语序自然，读起来没有翻译腔。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 2. 插入 —— 漏掉的冠词
// ─────────────────────────────────────────────────────────────
const insertCase: MockCase = {
  exercise: {
    id: 'sentence-002',
    direction: 'zh-to-en',
    mode: 'sentence',
    genre: 'political',
    topic: '生态文明建设',
    source: '中国坚持绿水青山就是金山银山的理念，把生态文明建设放在突出地位。',
    referenceTranslation:
      'China upholds the vision that clear waters and lush mountains are invaluable assets, and gives ecological conservation a prominent place.',
    suggestedMinutes: 5,
  },
  sampleAnswer:
    'China insist on idea that lucid waters and lush mountains are invaluable assets, and put ecological civilization construction in prominent position.',
  correction: {
    total: 62,
    dimensions: { terminology: 22, grammar: 14, coherence: 14, register: 12 },
    summary:
      '术语“绿水青山就是金山银山”译法正确，但动词缺少第三人称单数变化、名词前漏掉冠词，是典型的汉语直译残留。',
    dimensionComments: {
      terminology: 'lucid waters and lush mountains are invaluable assets 是“绿水青山就是金山银山”的通行译法。',
      grammar: '“China insist”“put”均缺少第三人称单数词尾；idea 与 position 前漏掉必要的冠词。',
      coherence: '两个动作由 and 并列，但时态与人称形式不一致，读起来像两件互不相关的事。',
      register: 'insist on 语气偏“坚持己见”，政治文献中“坚持（理念）”通常用 uphold 或 adhere to。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 's2-h1',
    anchor: anchorAt(answer, 'lucid waters and lush mountains are invaluable assets'),
    comment: '“绿水青山就是金山银山”用的是官方通行译法，术语这一维度没有失分。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 3. 删除 —— 多余内容与硬性语法错误
// ─────────────────────────────────────────────────────────────
const deleteCase: MockCase = {
  exercise: {
    id: 'sentence-003',
    direction: 'en-to-zh',
    mode: 'sentence',
    genre: 'news',
    topic: '生态文明建设',
    source:
      'A decade of ecological restoration has turned a once barren coastline into a popular destination for migratory birds, drawing visitors from across the country.',
    referenceTranslation:
      '十年的生态修复让曾经荒芜的海岸线变成候鸟青睐的栖息地，吸引了全国各地的观鸟者。',
    suggestedMinutes: 5,
  },
  sampleAnswer:
    'China made great progress in the construction of ecological civilization in recent year, and it has became a global leader in green development.',
  correction: {
    total: 66,
    dimensions: { terminology: 18, grammar: 15, coherence: 17, register: 16 },
    summary:
      '句子结构完整、话题切题，但存在冠词、时态与名词数三处硬性错误，属于最容易在比赛中被直接扣掉的类型。',
    dimensionComments: {
      terminology: '“生态文明建设”“绿色发展”译法正确。',
      grammar: '“in recent year”单复数错误；“made”在表示至今的成就时应为 has made；“has became”是形态错误。',
      coherence: '两个分句由 and 承接，逻辑通顺，没有堆砌。',
      register: '语体正式，符合新闻与政策类文本的表达习惯。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 's3-h1',
    anchor: anchorAt(answer, 'in the construction of ecological civilization'),
    comment: '“生态文明建设”译成 the construction of ecological civilization，用名词化结构处理汉语动词，非常地道。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 4. 语序调换 —— 两处常见的修饰语位置错误
// ─────────────────────────────────────────────────────────────
const reorderCase: MockCase = {
  exercise: {
    id: 'sentence-004',
    direction: 'zh-to-en',
    mode: 'sentence',
    genre: 'literature',
    topic: '文学选篇',
    source: '一位住在小城的单身母亲热爱故事，因为它们能让她暂时忘记自己的生活。',
    referenceTranslation:
      'A single mother who lives in a small town loves stories because they let her forget her own life for a while.',
    suggestedMinutes: 5,
  },
  sampleAnswer:
    'A single mother live in small town love stories because they let she forget her own life for a while.',
  correction: {
    total: 54,
    dimensions: { terminology: 16, grammar: 12, coherence: 14, register: 12 },
    summary:
      '句子骨架正确，但定语从句的引导词缺失、代词格用错，两处状语的顺序也不符合英语习惯。',
    dimensionComments: {
      terminology: '本句无关键术语，用词选择基本准确。',
      grammar: '“mother live”应为 lives；“let she”应为 let her，宾格用错；“in small town”缺冠词。',
      coherence: '缺少 who 之后，两个谓语动词并列堆在一起，句子结构断裂。',
      register: '文学选篇语体偏散文，目前表达偏口语且带有明显语法瑕疵。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 's4-h1',
    anchor: anchorAt(answer, 'because they let she forget her own life'),
    comment: '用 because 从句解释“为什么热爱故事”，逻辑连接自然，符合原文的因果关系。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 5. 整句重写 —— 语体、术语与词形多处出错
// ─────────────────────────────────────────────────────────────
const rewriteCase: MockCase = {
  exercise: {
    id: 'sentence-005',
    direction: 'zh-to-en',
    mode: 'sentence',
    genre: 'political',
    topic: '政策',
    source: '改革开放以来，她坚持自己的梦想，最终实现了它，尽管很多人曾怀疑她能否成功。',
    referenceTranslation:
      'Since the beginning of reform and opening up, she held fast to her dream and eventually made it come true, even though many people had doubted whether she could succeed.',
    suggestedMinutes: 5,
  },
  sampleAnswer:
    'In wake of reform, she insist her dream and finally make it come true, even though many people doubt that she can success.',
  correction: {
    total: 41,
    dimensions: { terminology: 12, grammar: 9, coherence: 11, register: 9 },
    summary:
      '句子的信息点齐全，但“改革开放”这一固定术语缺失、多处动词形式错误、时间状语缺失，开头需要整段重写。',
    dimensionComments: {
      terminology: '“改革开放”是固定表述，必须译为 reform and opening up，写成 reform 不足以承担这一术语含义。',
      grammar: 'insist、make、doubt 三个人称与时态形式均有问题；succeed 被误写成名词 success。',
      coherence: '时间状语缺失导致叙事起点不明，前后事件的先后关系读不出来。',
      register: '整体停留在口语层面，与政治文献的正式语体差距明显。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 's5-h1',
    anchor: anchorAt(answer, 'even though many people doubt that she can success'),
    comment:
      '用 even though 引出让步状语从句，并且补出了 that 引导的宾语从句，句子骨架搭得对——问题只出在词形，而不是结构意识。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 6. 术语 —— 中译英
// ─────────────────────────────────────────────────────────────
const termCase: MockCase = {
  exercise: {
    id: 'term-002',
    direction: 'zh-to-en',
    mode: 'term',
    genre: 'political',
    topic: '生态文明建设',
    source: '生态文明',
    referenceTranslation: 'ecological civilization',
    suggestedMinutes: 1,
  },
  sampleAnswer: 'ecological civilisation',
  correction: {
    total: 70,
    dimensions: { terminology: 60, grammar: 90, coherence: 80, register: 75 },
    summary: '意思完全正确，但用了英式拼写 civilisation，与官方术语表的写法不一致。',
    dimensionComments: {
      terminology: '“生态文明”的官方标准译法是 ecological civilization，英式拼写会被判为不一致。',
      grammar: '拼写本身是合法英文，无语法问题。',
      coherence: '术语题不涉及语篇衔接。',
      register: '固定术语应逐字采用官方写法，不做拼写变体。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 't2-h1',
    anchor: anchorAt(answer, 'ecological'),
    comment: '核心词 ecological 用对了，问题只在拼写变体。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 7. 术语 —— 英译中
// ─────────────────────────────────────────────────────────────
const termCompareCase: MockCase = {
  exercise: {
    id: 'term-001',
    direction: 'en-to-zh',
    mode: 'term',
    genre: 'political',
    topic: '生态文明建设',
    source: 'carbon neutrality',
    referenceTranslation: '碳中和',
    suggestedMinutes: 1,
  },
  sampleAnswer: '碳中性',
  correction: {
    total: 50,
    dimensions: { terminology: 30, grammar: 90, coherence: 80, register: 70 },
    summary: '“碳中性”是直译，中文官方文献一律使用“碳中和”，属于术语不统一。',
    dimensionComments: {
      terminology: '官方术语是“碳中和”，不是“碳中性”——这是有标准答案的题型。',
      grammar: '译名本身成立，不涉及语法。',
      coherence: '术语题不涉及语篇衔接。',
      register: '正式文献中术语必须与官方表述一致，自造变体不被认可。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 't1-h1',
    anchor: anchorAt(answer, '碳'),
    comment: '“碳”这一核心语素译对了，问题只在整词的固定译法。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 8. 段落 —— 中译英
// ─────────────────────────────────────────────────────────────
const paragraphCase: MockCase = {
  exercise: {
    id: 'paragraph-001',
    direction: 'zh-to-en',
    mode: 'paragraph',
    genre: 'news',
    topic: '生态文明建设',
    source:
      '过去十年，中国累计完成营造林超过七千万公顷，荒漠化和沙化土地面积连续多年净减少。三北工程区森林覆盖率由百分之五提高到近百分之十四，重点治理区的生态状况明显改善。与此同时，各地探索把生态优势转化为发展优势，生态旅游、林下经济等新业态带动了数百万农牧民增收。',
    referenceTranslation:
      'Over the past decade, China has afforested more than 70 million hectares, and the area of desertified and sandy land has shrunk year after year. In the Three-North shelterbelt project area, forest coverage rose from 5 percent to nearly 14 percent, with markedly better conditions in the worst-affected zones. Meanwhile, localities have explored ways to turn ecological strengths into developmental ones: eco-tourism and under-forest economies have lifted millions of farmers and herders.',
    suggestedMinutes: 12,
  },
  sampleAnswer:
    'In the past ten years, China finished plant forest more than seventy million hectares, and desert and sand land area reduced net for many years. In Sanbei project area forest coverage rate from five percent improve to near fourteen percent, ecology in key control area improved clearly. At the same time, each place explore turn ecology advantage into development advantage, ecology tourism and forest economy new business brought millions farmer and herdsman increase income.',
  correction: {
    total: 46,
    dimensions: { terminology: 12, grammar: 10, coherence: 12, register: 12 },
    summary:
      '数据与信息点基本齐全，但全段缺少时态与人称的一致，多处用名词堆叠代替动词结构，读起来是逐字硬译。',
    dimensionComments: {
      terminology: '“三北工程”“林下经济”等固定表述未采用通行译法。',
      grammar: '谓语普遍缺少时态变化，主动被动混用，turn … into … 结构不完整。',
      coherence: '句间缺少衔接手段，三句话并列铺开，没有层次。',
      register: '整体是中文句式的逐字对应，与新闻编译的英文行文习惯差距较大。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 'p1-h1',
    anchor: anchorAt(answer, 'brought millions farmer and herdsman increase income'),
    comment:
      '“带动……增收”用了 bring … increase income 的动宾结构，方向是对的——问题在词形而非结构意识。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 9. 段落 —— 英译中
// ─────────────────────────────────────────────────────────────
const paragraphEnCase: MockCase = {
  exercise: {
    id: 'paragraph-002',
    direction: 'en-to-zh',
    mode: 'paragraph',
    genre: 'news',
    topic: '科技',
    source:
      'The rollout of battery-swapping stations has given electric-vehicle makers a way around one of the sector’s stubborn problems: charging times. Drivers pull in, hand over a depleted pack and leave with a fresh one in under five minutes. The model has taken hold fastest among taxi and delivery fleets, whose vehicles run almost continuously and cannot afford long idle periods. Analysts caution that standardising pack designs across brands remains the main obstacle to wider adoption.',
    referenceTranslation:
      '换电站的推广为电动车厂商绕开了一个行业顽疾：充电耗时。司机开进站，交出亏电的电池包，不到五分钟就能换上一块满电的。这一模式在出租车与配送车队中普及最快——这些车几乎不间断运行，耗不起长时间停驶。分析人士提醒，跨品牌统一电池包规格仍是更大范围推广的主要障碍。',
    suggestedMinutes: 12,
  },
  sampleAnswer:
    '换电站的推出给电动车制造商一个绕开这个行业顽固问题的方法：充电时间。司机开进来，交出没电的电池包，在五分钟以内带着一个新的离开。这个模式在出租车和快递车队中发展最快，它们的车几乎一直在跑，不能承受长时间空闲。分析师提醒，让不同品牌的电池包设计标准化仍然是更广泛采用的主要障碍。',
  correction: {
    total: 78,
    dimensions: { terminology: 18, grammar: 20, coherence: 20, register: 20 },
    summary: '信息完整、句子通顺，但 take hold、cannot afford、idle periods 等处的语气与含义有明显损失。',
    dimensionComments: {
      terminology: '“电池包”“换电站”译法准确。',
      grammar: '语法没有硬性错误。',
      coherence: '句间因果关系清楚，读得下去。',
      register: '“一个绕开……的方法”“不能承受长时间空闲”偏口语，失掉了原文的语势。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 'p2-h1',
    anchor: anchorAt(answer, '交出没电的电池包'),
    comment: 'hand over a depleted pack 译成“交出没电的电池包”，简洁达意。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 10. 文章 —— 英译中（约 260 词，符合官方 250–350 词）
// ─────────────────────────────────────────────────────────────
const articleEnCase: MockCase = {
  exercise: {
    id: 'article-001',
    direction: 'en-to-zh',
    mode: 'article',
    genre: 'news',
    topic: '生态文明建设',
    source:
      'Over the past decade, China has added more installed solar capacity than the rest of the world combined, and it now accounts for roughly half of global production of solar panels, wind turbines and lithium-ion batteries. The scale of that build-out has pushed down costs worldwide: the price of a solar module has fallen by more than eighty per cent since 2015, a decline that has made renewable power the cheapest source of new electricity in most markets.\n\nYet the transition remains uneven. Coal still supplies well over half of China’s electricity, and new coal plants were approved at a rapid pace in recent years to guarantee supply during peak demand. Grid operators also struggle to absorb the variable output of wind and solar farms, and curtailment — the deliberate discarding of renewable generation — persists in several provinces where transmission lines have not kept up.\n\nThe government has responded on two fronts. It is building ultra-high-voltage lines to move power from sparsely populated western regions to coastal cities, and it is expanding storage capacity so that surplus daytime generation can be used after dark. Officials describe these investments as essential to energy security rather than a departure from climate goals.\n\nAnalysts remain divided on the outlook. Some argue that the sheer volume of clean manufacturing capacity makes deeper cuts in emissions all but inevitable. Others caution that without a faster phase-down of coal, the country risks locking in emissions for decades, no matter how much solar and wind it installs.',
    referenceTranslation:
      '过去十年，中国新增光伏装机容量超过世界其他地区的总和，如今在全球太阳能电池板、风力发电机和锂离子电池产量中约占一半。这一建设规模压低了全世界的成本：光伏组件价格自 2015 年以来下跌逾八成，这一降幅使可再生能源电力在多数市场成为新增电力的最便宜来源。\n\n然而转型仍不均衡。煤电依然供应着中国一半以上的电力；为保障用电高峰的供应，近年来新煤电项目获批速度很快。电网运营方也难以消纳风电和光伏的波动性出力，在若干输电线路建设滞后的省份，弃风弃光现象依然存在。\n\n政府从两方面作出回应。一是建设特高压线路，把电力从人口稀少的西部输往沿海城市；二是扩大储能规模，使白天富余的发电量能在夜间使用。官员称这些投资对能源安全必不可少，而非偏离气候目标。\n\n分析人士对前景看法不一。有人认为，清洁制造产能的绝对规模使更大幅度的减排几乎不可避免；也有人提醒，若煤电退出不够快，无论安装多少光伏和风电，国家都可能把排放锁定数十年。',
    suggestedMinutes: 30,
  },
  sampleAnswer:
    '过去十年，中国新增的光伏装机容量超过了世界其他国家的总和，现在它大约占全球太阳能板、风力涡轮机和锂电池产量的一半。这个建设规模拉低了全世界的成本：太阳能组件的价格从 2015 年以来下降了超过百分之八十，这个下降让可再生能源在大多数市场成为新增电力的最便宜来源。\n\n但是转型仍然不平均。煤仍然提供中国一半以上的电力，最近几年为了保证高峰需求时的供应，新的煤电厂批准得很快。电网运营商也在艰难吸收风电和光伏的波动输出，而在几条输电线路没有跟上的省份，弃风弃光仍然存在。\n\n政府从两个方面作出反应。它正在建设特高压线路，把电力从人口稀少的西部送到沿海城市，同时扩大储能容量，让白天多余的发电量可以在天黑后使用。官员把这些投资描述为对能源安全必不可少，而不是偏离气候目标。\n\n分析人士对前景有分歧。一些人认为，清洁制造产能的巨大数量让更深的减排几乎不可避免。其他人警告说，如果没有更快地淘汰煤电，这个国家冒着把排放锁定几十年的风险，无论它安装多少光伏和风电。',
  correction: {
    total: 74,
    dimensions: { terminology: 16, grammar: 19, coherence: 20, register: 19 },
    summary:
      '全篇信息完整、没有硬性语法错误，但多处保留了英文句法痕迹（“它大约占”“在几条输电线路没有跟上的省份”），中文读起来不够顺畅。',
    dimensionComments: {
      terminology: '“光伏装机”“特高压”“弃风弃光”等术语使用准确。',
      grammar: '中文表达没有语法错误。',
      coherence: '四个段落的转折与递进关系保留完整。',
      register: '“这个下降让……”“无论它安装多少”偏口语，与新闻编译的书面语体有差距。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 'a1-h1',
    anchor: anchorAt(answer, '弃风弃光仍然存在'),
    comment: 'curtailment 译成“弃风弃光”，用的是业内通行说法，比“削减”准确得多。',
  }),
}

// ─────────────────────────────────────────────────────────────
// 11. 文章 —— 中译英（约 280 字，符合官方 200–300 字）
// ─────────────────────────────────────────────────────────────
const articleZhCase: MockCase = {
  exercise: {
    id: 'article-002',
    direction: 'zh-to-en',
    mode: 'article',
    genre: 'political',
    topic: '生态文明建设',
    source:
      '生态文明建设是关系中华民族永续发展的根本大计。党的十八大以来，我们把生态文明建设作为统筹推进“五位一体”总体布局的重要内容，开展了一系列根本性、开创性、长远性工作，推动生态环境保护发生历史性、转折性、全局性变化。\n\n我们坚持绿水青山就是金山银山的理念，坚持山水林田湖草沙一体化保护和系统治理，生态文明制度体系更加健全，绿色、循环、低碳发展迈出坚实步伐，生态环境质量明显改善，美丽中国建设迈出重大步伐。\n\n同时也要看到，生态环境保护任务依然艰巨，结构性、根源性、趋势性压力尚未根本缓解。必须牢固树立和践行绿水青山就是金山银山的理念，站在人与自然和谐共生的高度谋划发展，协同推进降碳、减污、扩绿、增长，推进生态优先、节约集约、绿色低碳发展。',
    referenceTranslation:
      'Ecological conservation is of fundamental importance to the sustainable development of the Chinese nation. Since the 18th National Congress of the Communist Party of China, we have treated ecological progress as a key component of the five-sphere integrated plan, carried out a series of fundamental, pioneering and long-term initiatives, and brought about historic, transformative and comprehensive changes in environmental protection.\n\nWe have acted on the understanding that lucid waters and lush mountains are invaluable assets, and adopted a holistic and systematic approach to conserving and improving mountain, water, forest, farmland, grassland and desert ecosystems. The institutional framework for ecological progress has been strengthened, solid progress has been made in green, circular and low-carbon development, the environment has improved markedly, and major strides have been taken in building a beautiful China.\n\nAt the same time, we must be clear-eyed about the daunting tasks that remain, as the structural, root-cause and trend-related pressures on the environment have yet to be fundamentally relieved. We must firmly establish and act on the understanding that lucid waters and lush mountains are invaluable assets, plan development from the perspective of harmony between humanity and nature, and make coordinated efforts to cut carbon emissions, reduce pollution, expand green development and pursue economic growth.',
    suggestedMinutes: 30,
  },
  sampleAnswer:
    'Ecological civilization construction is a fundamental plan for the sustainable development of the Chinese nation. Since the 18th National Congress, we take ecological civilization construction as an important content of the five-in-one overall layout, carry out a series of fundamental, pioneering and long-term work, and push ecological environment protection to happen historic, turning and overall changes.\n\nWe insist the idea that green water and green mountains are gold and silver mountains, insist integrated protection and systematic management of mountain, water, forest, farmland, lake, grass and sand, the ecological civilization system is more complete, green, circular and low-carbon development takes solid steps, ecological environment quality improves obviously, and beautiful China construction takes major steps.\n\nAt the same time we should also see that the task of ecological environment protection is still hard, structural, root and trend pressure is not fundamentally relieved. We must firmly set up and practice the idea that green water and green mountains are gold and silver mountains, stand at the height of harmonious coexistence between human and nature to plan development, and together push carbon reduction, pollution reduction, green expansion and growth.',
  correction: {
    total: 39,
    dimensions: { terminology: 8, grammar: 10, coherence: 11, register: 10 },
    summary:
      '政治文献的固定表述大面积为逐字直译，“绿水青山就是金山银山”“五位一体”“降碳、减污、扩绿、增长”都未采用官方译法，且全篇缺少时态与人称的一致。',
    dimensionComments: {
      terminology: '多个关键术语未用官方译法，这是本题失分最重的一项。',
      grammar: '谓语普遍没有时态变化，长句用逗号平铺，出现多个缺少主语的并列分句。',
      coherence: '中文的意合结构被原样搬进英文，句与句之间缺少连接手段。',
      register: '政治文献需要庄重的书面语体，目前是口语化的直译，语体差距明显。',
    },
    errors: [],
    highlights: [],
  },
  highlight: (answer) => ({
    id: 'a2-h1',
    anchor: anchorAt(answer, 'harmonious coexistence between human and nature'),
    comment:
      '“人与自然和谐共生”译成 harmonious coexistence between human and nature，抓住了固定表述的核心，方向正确。',
  }),
}

/** 演示时自动填入的作答：在示例作答后面接一句中文，用来验证作答尾部能正常显示。 */
export const DEMO_ANSWER_TAIL = '，这一点在各地实践中反复得到验证。'

export const MOCK_CASES: MockCase[] = [
  replaceCase,
  insertCase,
  deleteCase,
  reorderCase,
  rewriteCase,
  termCase,
  termCompareCase,
  paragraphCase,
  paragraphEnCase,
  articleEnCase,
  articleZhCase,
]

/**
 * 在作答文本上建立批注。
 * 位置全部由 anchorAt 定位，因此这里不会出现"手数序号数错"的问题。
 *
 * 注意：只在题目 id 与作答匹配时才能定位，所以这里按 id 分派，
 * 每次只构造当前这道题的批注——否则会用甲题的作答去定位乙题的片段。
 */
function buildErrors(exerciseId: string, answer: string): ErrorObject[] {
  switch (exerciseId) {
    // 1. 替换
    case 'sentence-001':
      return [
        {
          id: 's1-e1',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'i is'),
          targetText: 'I am',
          explanation: '第一人称代词 I 在任何位置都必须大写；主语 I 搭配的 be 动词是 am，不是 is。',
        },
        {
          id: 's1-e2',
          type: 'delete',
          category: 'addition',
          anchor: anchorAt(answer, ' it '),
          explanation:
            'it 在这里是多余的。原文是并列复合句，后半段直接由 became 承接主句，不该另起一个主语加谓语的分句。',
        },
        {
          id: 's1-e3',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'became a important'),
          targetText: 'has become an important',
          explanation: '时态要与前面的 has become 对应，且 important 以元音音素开头，冠词应用 an。',
        },
      ]

    // 2. 插入
    case 'sentence-002':
      return [
        {
          id: 's2-e1',
          type: 'insert',
          category: 'function-word',
          insertAfter: anchorAt(answer, 'insist'),
          targetText: 'on ',
          explanation: 'insist 是不及物动词，后面要接介词 on：insist on the idea that …。',
        },
        {
          id: 's2-e2',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'China '),
          targetText: 'China ',
          explanation: '主语 China 是第三人称单数，谓语应为 insists on the idea that …，需要补上词尾 -s 与介词 on。',
        },
        {
          id: 's2-e3',
          type: 'insert',
          category: 'function-word',
          insertAfter: anchorAt(answer, 'in '),
          targetText: 'a ',
          explanation: 'position 是可数名词单数，前面需要不定冠词 a：in a prominent position。',
        },
      ]

    // 3. 删除
    case 'sentence-003':
      return [
        {
          id: 's3-e1',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'recent year'),
          targetText: 'recent years',
          explanation: 'in recent years 是固定搭配，year 必须用复数；写成 in recent year 属硬性错误。',
        },
        {
          id: 's3-e2',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'made'),
          targetText: 'has made',
          explanation: 'in recent years 表示从过去延续到现在的时段，谓语应当用现在完成时 has made。',
        },
        {
          id: 's3-e3',
          type: 'replace',
          category: 'function-word',
          anchor: anchorAt(answer, 'has became'),
          targetText: 'has become',
          explanation: '现在完成时由 has + 过去分词构成，become 的过去分词是 become，不是 became。',
        },
      ]

    // 4. 语序调换
    case 'sentence-004':
      return [
        {
          id: 's4-e1',
          type: 'reorder',
          category: 'word-order',
          segments: [
            { anchor: anchorAt(answer, 'live'), sourceIndex: 0, targetIndex: 1 },
            { anchor: anchorAt(answer, 'love'), sourceIndex: 1, targetIndex: 0 },
          ],
          explanation:
            '“住在小城的”是修饰“单身母亲”的定语，不能直接与主句谓语并列。正确结构是 A single mother who lives in a small town loves stories：谓语 loves 必须在定语之后，并带第三人称单数词尾。',
        },
        {
          id: 's4-e2',
          type: 'reorder',
          category: 'word-order',
          segments: [
            { anchor: anchorAt(answer, 'in small town '), sourceIndex: 0, targetIndex: 1 },
            { anchor: anchorAt(answer, 'for a while.'), sourceIndex: 1, targetIndex: 0 },
          ],
          explanation:
            '英文里修饰成分应紧跟被修饰的词，而时间状语 for a while 通常置于句末。原句把两个状语挤在一起，读起来含混。',
        },
      ]

    // 5. 整句重写
    case 'sentence-005':
      return [
        {
          id: 's5-e1',
          type: 'rewrite',
          category: 'register',
          anchor: anchorAt(answer, 'In wake of reform'),
          targetText: 'Since the beginning of reform and opening up',
          explanation:
            '开头这一段需要整段重写：“改革开放以来”是“固定术语 + 时点”结构，必须写成 since the beginning of reform and opening up。in wake of reform 既丢了“开放”这一半术语，也丢掉了“以来”所标记的时间起点。',
        },
        {
          id: 's5-e2',
          type: 'delete',
          category: 'collocation',
          anchor: anchorAt(answer, 'her dream '),
          targetText: 'to her dream',
          explanation:
            'insist 不能直接带宾语，不能说 insist her dream。保留 insist 时必须写成 insisted on；“坚持梦想”更地道的说法是 hold fast to her dream。',
        },
        {
          id: 's5-e3',
          type: 'insert',
          category: 'function-word',
          insertAfter: anchorAt(answer, 'can '),
          targetText: 'succeed',
          explanation:
            'succeed 是动词，误写成了名词 success。could 后面必须接动词原形，这里应写成 could succeed。',
        },
      ]

    default:
      return []
  }
}

/** 建立某道题的假批改。仅在"查看内置示例"时使用，正常批改走真实 AI。 */
export function fixtureCorrectionFor(exerciseId: string, answer: string): MockCorrection {
  const testCase = MOCK_CASES.find((item) => item.exercise.id === exerciseId)
  if (!testCase) throw new Error(`未知的题目：${exerciseId}`)
  return {
    ...testCase.correction,
    errors: buildErrors(exerciseId, answer),
    highlights: [testCase.highlight(answer)],
  }
}

/** 五道内置示例的标准作答（含演示时追加的尾部）。 */
export const DEMO_ANSWERS: readonly string[] = MOCK_CASES.map((item) => item.sampleAnswer + DEMO_ANSWER_TAIL)
