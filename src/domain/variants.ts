/**
 * 备选篇目：点「换一换」时轮换使用的另一份原文（含配套参考译文）。
 *
 * 为什么要有它：同一个话题只练一遍就记住了，换个说法才练得到真本事。
 * 现在题库是手写的，所以备选也是手写的、按官方字数规格写的；
 * 接入 D1 与题库生成之后，这里会换成按领域与文体自动生成并做篇长校验的内容。
 *
 * 约定：每道题的备选按位置轮换（第 0 个就是题目本身的原文），
 * 因此备选的文体与领域必须与题目一致，否则练的东西会跑偏。
 */

export interface Variant {
  /** 这一份的原文 */
  source: string
  /** 配套的参考译文 */
  referenceTranslation: string
}

export const EXERCISE_VARIANTS: Record<string, Variant[]> = {
  // 文章 · 英译中 · 生态文明建设（原文约 300 词，符合官方 250–350 词）
  'article-001': [
    {
      source:
        'A decade of restoration has brought back a stretch of wetland that had been drained for farmland in the 1970s. Where maize once grew, reeds now stand waist-high and the water table has risen by more than a metre, according to monitoring data released by the provincial forestry bureau.\n\nThe change has been good for birds. Surveys count more than 60,000 migratory waterfowl wintering here each year, up from fewer than 3,000 in 2010. Three species listed as nationally protected, including the Siberian crane, have reappeared after an absence of nearly two decades.\n\nRestoring the wetland was not straightforward. Thousands of households depended on the reclaimed land, and the first resettlement plan collapsed in the face of local opposition. Officials then shifted to a scheme that paid farmers for ecological services — a fixed annual sum for keeping fields out of production — and paired it with job training in eco-tourism and reed harvesting.\n\nEconomists caution that such payments are expensive and hard to scale. The provincial government spends roughly 400 million yuan a year on the programme, and critics argue the money would do more good if it were directed at the cities where most of the resettled families now work.\n\nSupporters counter that the wetland protects downstream communities from flooding, a service whose value is rarely counted until a flood arrives. A single major flood in 1998 caused losses estimated at 20 billion yuan across the province, a figure the programme has not approached in fifteen years of operation.',
      referenceTranslation:
        '十年的修复让一片在二十世纪七十年代被排干改作农田的湿地重新回来了。根据省林业局公布的监测数据，昔日种玉米的地方如今芦苇齐腰高，地下水位上升了一米多。\n\n这一变化对鸟类有利。调查显示，每年在此越冬的迁徙水鸟超过六万只，而 2010 年不足三千只。包括白鹤在内的三种国家保护物种，在消失了近二十年后重新出现。\n\n恢复湿地并非易事。数千户人家曾依赖这片围垦地，最初的移民安置方案因当地反对而夭折。官员随后转向一种生态补偿方案——为让农田退出生产而支付固定年费——并配套生态旅游与芦苇收割的技能培训。\n\n经济学家提醒，此类补偿成本高昂且难以推广。省政府每年在该项目上投入约四亿元，批评者认为，若把这笔钱用于安置家庭如今务工的城市，效益会更大。\n\n支持者则反驳说，湿地保护着下游社区免受洪灾，而这项服务的价值往往只在洪水到来时才被计算。1998 年的一场大洪水在全省造成的损失估计达二百亿元，而该项目运行十五年来从未接近这一数字。',
    },
  ],

  // 文章 · 中译英 · 生态文明建设（原文约 270 字，符合官方 200–300 字）
  'article-002': [
    {
      source:
        '推动经济社会发展绿色化、低碳化，是解决我国资源环境生态问题的基础之策。新时代以来，我国以年均百分之三的能源消费增速支撑了年均百分之六以上的经济增长，单位国内生产总值能耗下降超过百分之二十六，经济发展的含金量含绿量显著提升。\n\n能源结构调整取得突破性进展。风电、光伏发电装机规模均居世界第一，非化石能源消费比重提高到百分之十七以上，煤电装机占比历史性地降到四成以下。与此同时，我们坚决遏制高耗能、高排放、低水平项目盲目发展，累计淘汰落后煤电产能超过一亿千瓦。\n\n也要清醒看到，我国能源资源禀赋仍然偏煤，产业结构偏重，能源利用效率与国际先进水平相比仍有差距。实现碳达峰碳中和是一场广泛而深刻的经济社会系统性变革，不可能毕其功于一役，必须立足国情，坚持先立后破，通盘谋划，稳中求进。',
      referenceTranslation:
        'Green and low-carbon economic and social development is the fundamental solution to China\u2019s resource, environmental and ecological problems. Since the beginning of the new era, China has sustained average annual economic growth of more than six per cent with average annual energy consumption growth of three per cent; energy consumption per unit of GDP has fallen by over 26 per cent, and the quality and green content of economic growth have improved markedly.\n\nBreakthroughs have been made in adjusting the energy mix. Installed wind and solar capacity both rank first in the world, the share of non-fossil energy in total consumption has risen above 17 per cent, and the share of coal-fired capacity has fallen below 40 per cent for the first time. At the same time, we have resolutely curbed the blind expansion of high-energy, high-emission and low-level projects, retiring more than 100 million kilowatts of outdated coal-fired capacity.\n\nWe must also be clear-eyed that China\u2019s energy endowment remains coal-heavy and its industrial structure heavy, and that energy efficiency still lags advanced international levels. Reaching peak carbon emissions and carbon neutrality is a broad and profound systemic economic and social transformation. It cannot be accomplished in one move; we must ground our approach in national conditions, establish the new before abolishing the old, plan comprehensively, and pursue progress while ensuring stability.',
    },
  ],

  // 段落 · 英译中 · 科技
  'paragraph-002': [
    {
      source:
        'Falling costs have made grid-scale batteries the fastest-growing part of the power system. Utilities that once dismissed storage as too expensive now sign fifteen-year contracts for it, because a battery can be built in eighteen months while a gas plant takes five years and a transmission line takes a decade. Regulators are still working out how to pay for a device that earns money only occasionally, and the rules they settle on will shape which technologies win.',
      referenceTranslation:
        '成本下降使电网级储能成为电力系统中增长最快的部分。曾经认为储能过于昂贵而不予考虑的电力公司，如今开始签订十五年的合同，因为电池十八个月就能建成，燃气电厂要五年，输电线路要十年。监管机构仍在研究如何为这种只在少数时段赚钱的设备付费，而他们定下的规则将决定哪些技术胜出。',
    },
  ],

  // 句子 · 英译中 · 生态文明建设
  'sentence-001': [
    {
      source:
        'Protecting the environment is not a burden on growth but a precondition for it, since no economy can prosper for long on a degraded resource base.',
      referenceTranslation: '保护环境不是增长的负担，而是增长的前提，因为没有哪个经济体能在退化的资源基础上长久繁荣。',
    },
    {
      source:
        'The wetland park draws more than two million visitors a year, yet the revenue it generates covers only a fraction of the cost of keeping the water clean.',
      referenceTranslation: '湿地公园每年吸引逾两百万游客，但它带来的收入只够支付保持水质所需成本的一小部分。',
    },
  ],

  // 术语 · 中译英
  'term-002': [
    { source: '碳中和', referenceTranslation: 'carbon neutrality' },
    { source: '高质量发展', referenceTranslation: 'high-quality development' },
  ],

  // 术语 · 英译中
  'term-001': [
    { source: 'ecological civilization', referenceTranslation: '生态文明' },
    { source: 'rural revitalization', referenceTranslation: '乡村振兴' },
  ],
}

/** 取某道题的备选列表（不含题目本身的那一份）。 */
export function variantsFor(exerciseId: string): Variant[] {
  return EXERCISE_VARIANTS[exerciseId] ?? []
}
