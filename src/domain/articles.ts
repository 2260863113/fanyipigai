/**
 * 文章库：预置的真实新闻选段，按「领域 × 方向」组织。
 *
 * 为什么单独一份数据、而不是塞进 mock.ts：
 * mock.ts 是**内置示例题**，每道都带 sampleAnswer（示例作答），用于离线演示与冒烟测试
 * 的桩数据；文章库是**真实新闻**，没有示例作答，两者用途不同。混在一起会让
 * "哪道题有桩、哪道没有"变得含糊。因此文章库自成一份，且**只进「文章」栏**。
 *
 * 三条约定（见 ADR 0007，改之前先读）：
 *   1. **只存截取的连续片段**，不是全文——赛制篇幅是英译汉 250–350 词、汉译英 200–300 字，
 *      而实测真实新闻多在 380–1200 词，存全文等于每次练习都先超篇长。
 *      截取时保留完整段落、不剪断句子。
 *   2. **只收录中国官方对外英文媒体与权威中文原文**（新华英文、中国日报、CGTN、
 *      人民网英文、gov.cn / 人民日报、新华社、中国政府网）。仓库是公开的，
 *      把商业媒体（路透、BBC、卫报、AP）的正文存进公开仓库再附参考译文是版权风险。
 *   3. **URL 必须是真的**（用于溯源与人工复核），且段落与标题照抄原文、不做改写——
 *      题库一旦被改写，术语与固定表述的考查就失真了。
 *
 * `words` / `chars` 是**真实篇幅**：英译中计词数，中译英计汉字数（不含空白）。
 * 界面上显示它，用户据此知道够不够赛制篇幅。数值由 scripts/measure-articles.mjs 核对。
 */

import type { Direction } from './types'

/** 赛制的八个主题域（"五位一体" + 三个延伸）。顺序即界面上的顺序。 */
export const ARTICLE_DOMAINS = [
  { id: 'economy', label: '经济建设' },
  { id: 'politics', label: '政治建设' },
  { id: 'culture', label: '文化建设' },
  { id: 'society', label: '社会建设' },
  { id: 'ecology', label: '生态文明建设' },
  { id: 'tech', label: '科技创新' },
  { id: 'education', label: '教育强国' },
  { id: 'communication', label: '国际传播' },
] as const

export type ArticleDomain = (typeof ARTICLE_DOMAINS)[number]['id']

const DOMAIN_LABEL: Record<ArticleDomain, string> = Object.fromEntries(
  ARTICLE_DOMAINS.map((domain) => [domain.id, domain.label]),
) as Record<ArticleDomain, string>

export function labelOfDomain(domain: ArticleDomain): string {
  return DOMAIN_LABEL[domain]
}

/** 文章库的一篇选段。注意 `excerpt` 是**选段**，不是原文全文。 */
export interface ArticleExcerpt {
  /** 题号，与内置题库共用同一套编号空间；前缀 `art-` 便于一眼看出它来自文章库 */
  id: string
  domain: ArticleDomain
  direction: Direction
  /** 真实标题，照抄 */
  title: string
  /** 来源媒体 */
  source: string
  /** 原文链接，供溯源与人工复核 */
  url: string
  /** 截取出来的连续片段 */
  excerpt: string
  /** 真实篇幅：英译中计词数，中译英计汉字数 */
  units: number
}

/**
 * 文章库正文。
 *
 * 排版说明：每篇的 `excerpt` 用模板字符串写，段落之间**留一个空行**——
 * splitSections 按空行切段，因此空行就是"这段落"的边界，别随手删。
 */
export const ARTICLE_EXCERPTS: readonly ArticleExcerpt[] = [
{
    id: "art-economy-1",
    domain: "economy",
    direction: "en-to-zh",
    title: "",
    source: "China Daily",
    url: "http://en.cppcc.gov.cn/2026-03/05/c_1164665.htm",
    units: 327,
    excerpt: "China is aiming for a GDP growth rate of at least 4.5 to 5 percent in 2026, according to a government work report that was submitted Thursday to the country's top legislature for deliberation.\n\nPremier Li Qiang, who delivered the report at the opening of the fourth session of the 14th National People's Congress in Beijing, said that the growth target is well aligned with the country's long-range objectives through the year 2035 and is broadly in line with the long-term growth potential of China's economy, with favorable conditions in place for achieving this target.\n\nGovernment at local level should, taking into account their own conditions, make solid efforts to deliver positive outcomes, Li said.\n\nHe added that this year's targets, including the economic growth target, took into account the need to leave some room for structural adjustments, risk prevention and reform in what is the opening year of the 15th Five-Year Plan (2026-30) period, so as to lay a solid foundation for delivering better performance in the coming years.\n\nAnalysts have said the 2026 target reflects the government's pragmatic approach in recognizing the structural and cyclical challenges faced by the world's second-largest economy, while proactively pursuing a reasonable growth rate in line with high-quality development.\n\nSetting this year's GDP growth target at between 4.5 percent and 5 percent is \"reasonable and necessary\", said Sun Xuegong, director-general of the department of policy study and consultation at the Chinese Academy of Macroeconomic Research. The academy is an affiliated research institution of the National Development and Reform Commission.\n\nIf China is to double its per capita GDP from its 2020 level by 2035 to achieve socialist modernization, Sun says the economy would need to grow by around 4.2 percent annually in the coming years, making this year's target necessary.\n\nCalling the target achievable, Sun cited the fact that macroeconomic policy support is poised to continue, laying the foundations for steady growth in consumption and a potential rebound in investment.",
  },
{
    id: "art-economy-2",
    domain: "economy",
    direction: "en-to-zh",
    title: "China's foreign trade maintains solid growth as resilience holds",
    source: "Xinhua",
    url: "http://english.news.cn/20260509/50ea713a34c448269fc8ec2ded0b90e6/c.html",
    units: 335,
    excerpt: "BEIJING, May 9 (Xinhua) -- China's foreign trade maintained solid growth as coordinated policy efforts across regions and departments boosted momentum, highlighting the resilience and vitality of imports and exports, official data showed Saturday.\n\nChina's foreign trade in yuan-denominated terms grew 14.2 percent year on year to reach 4.38 trillion yuan (about 639.4 billion U.S. dollars) last month, according to data from the General Administration of Customs (GAC).\n\nExports rose 9.8 percent to 2.48 trillion yuan, while imports went up 20.6 percent to 1.9 trillion yuan. In the first four months, total foreign trade reached 16.23 trillion yuan, up 14.9 percent year on year.\n\nLyu Daliang, director of GAC's Department of Statistics and Analysis, said April's trade maintained double-digit year-on-year growth and recorded a 6.5 percent increase from March, underscoring strong resilience and vitality in China's foreign trade.\n\n\"Foreign trade has performed well since the start of the year, supported by coordinated policy measures and proactive efforts across regions and departments,\" Lyu noted.\n\nExports of mechanical and electrical products, which account for the bulk of China's outbound shipments, rose 17.6 percent in the first four months to 5.92 trillion yuan, making up 63.5 percent of total exports, up 3.4 percentage points from a year earlier.\n\nAmong them, exports of green and low-carbon products grew rapidly, with electric vehicles, lithium batteries and wind turbines rising 68.1 percent, 43.2 percent, and 40.7 percent, respectively.\n\nPrivate enterprises remained the largest contributor to trade, with imports and exports rising 15.9 percent to 9.31 trillion yuan, accounting for 57.4 percent of the total.\n\nAnalysts said the strong export performance reflected a combination of recovering global demand and China's ability to provide reliable, cost-effective supply, supported by a comprehensive industrial ecosystem.\n\nOn the import side, continued expansion of China's domestic market and industrial upgrading have driven demand for raw materials and advanced equipment. Imports of key commodities such as crude oil, iron ore and soybeans continued to grow, while purchases of high-tech components and machinery increased as new quality productive forces developed.",
  },
{
    id: "art-economy-3",
    domain: "economy",
    direction: "en-to-zh",
    title: "China Focus: China's May Day holiday trips, spending both rise year on year",
    source: "Xinhua",
    url: "https://english.news.cn/20260507/d2a1b56437944f299ed83474676f69c0/c.html",
    units: 301,
    excerpt: "An aerial drone photo taken on May 1, 2026 shows people visiting the Laoling World Studios, a film and television shooting and cultural tourism base, in Laoling, east China's Shandong Province. (Photo by Jia Peng/Xinhua)\n\nBEIJING, May 7 (Xinhua) -- China's cultural and tourism market sustained stable expansion during the 2026 May Day holiday, with domestic trips and total spending both registering year-on-year growth, according to official data released on Thursday.\n\nThe Ministry of Culture and Tourism announced that a total of 325 million domestic trips were made across the country during the May 1-5 period, representing a 3.6-percent increase from the same period last year.\n\nDomestic tourism expenditure reached 185.49 billion yuan (about 27.08 billion U.S. dollars), up 2.9 percent year on year, the ministry said, citing calculations from its data center.\n\nPublic cultural institutions across the country organized around 49,400 cultural events during this holiday, attracting approximately 88 million visits, the ministry noted.\n\nNighttime cultural and tourism consumption remained robust, with national-level nighttime cultural and tourism consumption clusters receiving more than 80.41 million visits, an increase of 6.44 percent year on year.\n\nAdditionally, China saw strong growth in its performance market during the holiday period. Roughly 32,000 commercial performances, excluding entertainment venue shows, were staged nationwide, generating box office revenue of 2.48 billion yuan, up 14.66 percent year on year.\n\nThese favorable holiday figures underscored the growing importance of the cultural and tourism sector in China's broader economic landscape.\n\nOfficial data previously released by the National Bureau of Statistics revealed that the added value of the country's culture-related industries accounted for 4.61 percent of gross domestic product (GDP), while tourism-related industries contributed 4.35 percent.\n\nThis shift reflects deeper structural changes in the Chinese economy, where service consumption is playing an increasingly prominent role in driving domestic demand and economic growth.",
  },
{
    id: "art-politics-1",
    domain: "politics",
    direction: "en-to-zh",
    title: "China curbs excessive policing of enterprises",
    source: "China Daily",
    url: "https://www.chinadaily.com.cn/a/202606/05/WS6a22264aa310d6866eb4c99d.html",
    units: 311,
    excerpt: "China is improving long-term mechanisms to regulate enterprise-related administrative law enforcement, aiming to curb excessive inspections, arbitrary fines and improper asset seizures while making supervision more targeted and effective, central government officials said recently.\n\nSince the onset of a nationwide special operation in March 2025, authorities have addressed more than 66,000 case tip-offs involving notable law enforcement problems related to businesses, helping companies recover 30.7 billion yuan ($4.51 billion) in losses, according to the Ministry of Justice.\n\nAdministrative inspections fell 34 percent year-on-year, while the average rate of problems identified during inspections rose by nearly 19 percentage points. Officials said the improvement demonstrates that regulation should rely more on precision rather than frequency.\n\nThe operation targets issues including excessive inspections, arbitrary fines and fees, improper asset seizures, irregular cross-regional enforcement and profit-driven enforcement. This year's Government Work Report and the outline of the 15th Five-Year Plan (2026-30) also called for improving long-term mechanisms to regulate the sector.\n\nHu Weilie, vice-minister of justice, said the campaign has produced clear results after more than a year of focused rectification. Authorities have removed more than 7,000 law enforcement bodies that failed to meet legal requirements, dismissed more than 300,000 unqualified personnel and eliminated more than 400,000 unnecessary enforcement items.\n\n\"After more than a year of systematic governance, inspection frequency has dropped significantly, while the precision and effectiveness of inspections have improved,\" Hu said. \"The effect of regulation is not measured by quantity, but by quality; not by frequency, but by precision.\"\n\nHu stressed that regulating enforcement does not mean weakening supervision. Strict standards must be upheld in key areas related to public health and safety, including food and drug safety, workplace safety as well as environmental protection.\n\nAt the same time, local authorities have applied policies such as exempting first-time or minor violations from penalties, sparing enterprises more than 11 billion yuan in fines.",
  },
{
    id: "art-politics-2",
    domain: "politics",
    direction: "en-to-zh",
    title: "China's top legislature supports reform, development through quality legislation",
    source: "Xinhua",
    url: "https://english.news.cn/20260309/855eedae757b421ba74bf825c7e19bb8/c.html",
    units: 304,
    excerpt: "BEIJING, March 9 (Xinhua) -- The Standing Committee of the National People's Congress (NPC), China's top legislature, served and supported reform and development through high-quality legislation in the past year, according to a report.\n\nThe work report of the NPC Standing Committee was submitted on Monday to the ongoing fourth session of the 14th NPC for deliberation.\n\nIn 2025, the NPC Standing Committee strengthened the implementation of the Constitution and enhanced compliance oversight, ensuring the unity of the rule of law, the report said.\n\nOver the past year, the top legislature deliberated 40 draft laws, legal interpretations, and decisions and adopted 24 of them, including six new laws, 14 revised laws, one legal interpretation, and three decisions on legal matters and other significant issues. It also made decisions on the ratification of nine treaties and important agreements.\n\nIn strengthening economic legislation, the NPC Standing Committee enacted the Private Sector Promotion Law last year, explicitly establishing the principles of impartial treatment, fair competition, equal protection, and common development, according to the report.\n\nThe NPC Standing Committee revised the Unfair Competition Law, which is instrumental in the development of a credit-based economy under the rule of law, and revised the Maritime Law, the Arbitration Law, and the Foreign Trade Law to further align with established international rules, thereby better serving high-standard opening up.\n\nIn advancing laws for social governance and public well-being, the top legislature enacted the Law on Public Health Emergency Response and revised the Law on the Prevention and Control of Infectious Diseases, according to the report.\n\nIn fortifying legislation on national and public security, the NPC Standing Committee enacted the Atomic Energy Law to support research, development, and peaceful utilization of atomic energy in accordance with the law, and revised the Cybersecurity Law to enhance data security and personal information protection, the report said.",
  },
{
    id: "art-politics-3",
    domain: "politics",
    direction: "en-to-zh",
    title: "China mulls draft law against cross-border corruption",
    source: "Xinhua",
    url: "http://english.news.cn/20260825/3f961152e4ed47dc92fa211f4fd1c4a4/c.html",
    units: 302,
    excerpt: "BEIJING, Aug. 25 (Xinhua) -- Chinese lawmakers on Tuesday began reviewing a draft law on countering transnational corruption, a move to fill a legislative gap in China's efforts to combat cross-border corruption.\n\nThe formulation of the law is an important step by China to put in place a systematic and comprehensive foreign-related legal framework for anti-corruption, according to the top legislature.\n\nThe draft law was submitted for its first reading to the ongoing session of the Standing Committee of the National People's Congress, the country's top legislature.\n\nThe draft underscores China's firm stance against corruption, a move that safeguards the country's national security and development interests.\n\nChina has maintained a zero-tolerance approach to corruption and strengthened efforts to ensure that officials do not have the audacity, opportunity or desire to engage in corrupt practices.\n\nChina has also been deepening its efforts in international anti-corruption cooperation, with 963 corrupt fugitives repatriated to the country in 2025, according to the country's top anti-graft body.\n\nStructured into six chapters and 47 articles, the draft sets out the principles, scope and key positions underpinning China's efforts to combat cross-border corruption.\n\nIt also defines relevant operational mechanisms and institutional responsibilities, and seeks to strengthen case handling and international cooperation.\n\nThe draft further clarifies enterprises' obligations regarding integrity and compliance, and specifies legal liabilities for violations.\n\nThe draft law is a practical measure to regulate the development of cross-border businesses and help build a world-class business environment aligned with market principles, the rule of law and international standards.\n\nChina is a major trading partner for more than 160 countries and regions, and its total trade in goods had ranked first in the world for eight consecutive years as of 2024. By the end of 2025, Chinese investors had established more than 50,000 overseas enterprises across 190 countries and regions.",
  },
{
    id: "art-culture-1",
    domain: "culture",
    direction: "en-to-zh",
    title: "China sees remarkable progress in keeping intangible cultural heritage alive",
    source: "Xinhua",
    url: "http://english.news.cn/20241223/8c60003429364792ab204e78b7305487/c.html",
    units: 300,
    excerpt: "BEIJING, Dec. 23 (Xinhua) -- China held a national meeting on Monday on intangible cultural heritage (ICH) preservation. At the meeting, individuals and groups were honored for their outstanding work in this regard.\n\nAmong them was Yang Changqin, a craftswoman and representative inheritor of Chishui bamboo weaving craftwork, a provincial-level ICH in southwest China's Guizhou Province.\n\nThe craftwork features around 20 procedures, including stripping, dyeing, weaving and using bamboo threads to form pictures of various designs or making them into items such as bags or parts of cups and vases.\n\n\"Bamboo weaving is my lifelong passion, and I hope it can be continuously passed on for generations to come,\" Yang said.\n\nYang is among the over 90,000 ICH representative inheritors of different levels in China who are working to keep the country's intangible cultural treasures alive.\n\nThis year marks the 20th anniversary of China joining UNESCO's Convention for the Safeguarding of Intangible Cultural Heritage. Over the past two decades, China has made remarkable achievements in preserving and promoting the development of ICH.\n\nThe country in 2011 enacted a law on ICH, and provincial-level regions nationwide have also issued their local regulations on ICH protection.\n\nTo date, China has over 100,000 ICH items of various levels, including 1,557 featured on the national list. A total of 3,056 people are recognized as national-level ICH inheritors.\n\nChinese central authorities have also conducted training programs for the inheritors, providing relevant training for over 40,000 people over the past 10 years.\n\nEarlier this month, UNESCO inscribed the Spring Festival, the social practices of the Chinese people in celebration of the traditional new year, on the Representative List of the Intangible Cultural Heritage of Humanity, bringing the number of intangible cultural heritage items in China on the UNESCO list to 44, the most of its kind worldwide. ■",
  },
{
    id: "art-culture-2",
    domain: "culture",
    direction: "en-to-zh",
    title: "Symposium explores copyright protection of traditional cultural heritage",
    source: "China Daily",
    url: "https://www.chinadaily.com.cn/a/202609/08/WS6aa01dbae4b06d4aa055cfa9.html",
    units: 285,
    excerpt: "The International Symposium on Intellectual Property and Traditional Cultural Expressions opened on Tuesday in Fuzhou, Jiangxi province, bringing together nearly 400 participants from more than 30 countries to discuss how to safeguard cultural heritage in the age of artificial intelligence and establish a fair governance system amid cross-border exchanges.\n\nJointly organized by China's National Copyright Administration and the World Intellectual Property Organization, the symposium attracted representatives from intellectual property authorities, academia and the folklore industry.\n\nParticipants called for stronger copyright protection, greater integration between culture and related industries, and digital empowerment to promote cultural innovation in an era of rapid digitalization and increasingly frequent cross-border exchanges.\n\nThey also emphasized the need to deepen international cooperation and explore more effective approaches to protecting traditional cultural expressions through copyright, highlighting the importance of collective efforts to address challenges arising from their transmission and use across borders.\n\nFolklore embodies the cultural DNA and spiritual aspirations of nations while also constituting a shared spiritual heritage of humanity, participants said.\n\nWIPO Assistant Director General Edward Kwakwa said China is rich in traditional cultural expressions and praised Fuzhou's efforts to protect, inherit and revitalize folk arts through copyright.\n\nDuring a visit and inspection on Monday, Kwakwa said he was deeply impressed by how Fuzhou has leveraged its rich local cultural heritage to explore practical approaches to protecting and revitalizing traditional folk arts through copyright systems.\n\nHis observations reflect the Chinese government's support for local enterprises in using intellectual property rights, particularly copyrights, to protect and promote traditional Chinese cultural expressions, he said.\n\nKwakwa expressed hope that participants would engage in open and candid discussions to jointly explore the challenges, opportunities and pathways for protecting traditional cultural expressions at the international level.",
  },
{
    id: "art-culture-3",
    domain: "culture",
    direction: "en-to-zh",
    title: "Chinese intangible cultural heritage exhibition in London showcases contemporary design",
    source: "People's Daily Online",
    url: "http://en.people.cn/n3/2026/0918/c90000-20501231.html",
    units: 331,
    excerpt: "This photo taken on Sept. 17, 2026 shows an exhibit on display in an exhibition titled \"Reviving Craft: Reflection of the Mind,\" in London, Britain. An exhibition bringing together Chinese intangible cultural heritage and contemporary design opened at Somerset House in London on Wednesday, featuring nearly 150 works and sets of works by more than 70 Chinese and international artists. Titled \"Reviving Craft: Reflection of the Mind,\" the exhibition is part of the 2026 London Design Festival and runs until Sept. 27. It features works in ceramics, lacquer, embroidery, glass, fiber art, furniture and installation. (Xinhua/Li Ying)\n\nLONDON, Sept. 17 (Xinhua) -- An exhibition bringing together Chinese intangible cultural heritage and contemporary design opened at Somerset House in London on Wednesday, featuring nearly 150 works and sets of works by more than 70 Chinese and international artists.\n\nTitled \"Reviving Craft: Reflection of the Mind,\" the exhibition is part of the 2026 London Design Festival and runs until Sept. 27. It features works in ceramics, lacquer, embroidery, glass, fiber art, furniture and installation.\n\nThe exhibition is jointly curated by Su Dan, professor at the Academy of Arts and Design of Tsinghua University, and Yang Lan, chairperson of Sun Media Group.\n\nFollowing previous editions in Paris in 2024 and Milan in 2025, the London exhibition focuses on the relationship between people and their inner world. It is divided into three sections themed around the Chinese concepts of Chengxin, or clearing the mind, Xiuxin, refining the mind, and Yangxin, nourishing the mind.\n\nAmong the works on display are Chinese sculptor Zhi Min's ceramic and metal work Moon, Shi Hui's paper-fiber work Seal Stone, lacquer artist Xue Xiaodong's screen inspired by The Ode to the Goddess of the Luo River, and Suzhou embroidery artist Yao Jianping's double-sided embroidery screen Nine Carps.\n\nTraditional techniques including lacquerware, cloisonne, Suzhou embroidery, gambiered Guangdong silk and glassmaking are presented alongside contemporary art and design. Some works also bring traditional craftsmanship into furniture, fashion and other objects intended for everyday use.",
  },
{
    id: "art-society-1",
    domain: "society",
    direction: "en-to-zh",
    title: "China vows to consolidate poverty alleviation gains, advance rural revitalization",
    source: "CGTN",
    url: "https://news.cgtn.com/news/2026-08-27/China-vows-to-consolidate-poverty-alleviation-gains-1PWp9whciLC/p.html",
    units: 251,
    excerpt: "Chenxiong Village, Yongzhou, central China's Hunan Province, August 26, 2026. /VCG\n\nSenior officials from the Chinese government have pledged continued efforts to consolidate and expand the achievements of poverty alleviation and promote rural revitalization.\n\nThese officials, including Vice Premier Liu Guozhong and representatives from several ministries and relevant authorities, made the remarks on Wednesday at a meeting held during an ongoing session of the National People's Congress (NPC) Standing Committee.\n\nLawmakers deliberated a report on efforts to consolidate and expand achievements in poverty alleviation and advance all-around rural revitalization. They also launched a joint inquiry at the meeting, which was attended by Zhao Leji, chairman of the NPC Standing Committee.\n\nAt the meeting, lawmakers raised questions about improving basic pension insurance for urban and rural residents, sustaining poverty-relief industries and increasing incomes for people lifted out of poverty, as well as addressing the aging of the rural population, among other issues.\n\nLiu and the officials listened to the lawmakers' comments and addressed their questions.\n\nLiu said regular support should be incorporated into the rural revitalization strategy, with targeted monitoring and assistance to prevent a large-scale return to or emergence of poverty.\n\nHe also called for further development of rural industries, infrastructure and governance.\n\nPresiding over the meeting, Wu Weihua, vice chairman of the NPC Standing Committee, called on the State Council and relevant departments to study and address the suggestions raised by lawmakers, and submit a report on their follow-up actions to the NPC Standing Committee in accordance with the law.",
  },
{
    id: "art-society-2",
    domain: "society",
    direction: "en-to-zh",
    title: "",
    source: "gov.cn",
    url: "https://english.www.gov.cn/archive/statistics/202503/09/content_WS67cd5849c6d0868f4e8f0a42.html",
    units: 252,
    excerpt: "BEIJING, March 9 -- More than 90 percent of village clinics in China have their services covered by the basic medical insurance, a senior health official said on Sunday.\n\nLei Haichao, head of the National Health Commission, announced the figure at a press conference held on the sidelines of the ongoing annual session of China's national legislature.\n\nThere are more than 600,000 grassroots healthcare institutions in towns, communities and villages nationwide, with over 5 million health workers in service, Lei said.\n\nOver the past two years, the Ministry of Finance has spent approximately 900 million yuan (around 128.6 million U.S. dollars) to help township-level health centers in central and western regions upgrade their medical equipment, according to Lei.\n\nLooking forward, Lei said China will step up efforts to improve grassroots public medical services.\n\nBy 2027, the medical resources and services of the county, townships and villages within the jurisdiction of a county will be integrated to bring more quality medical services closer to people's doorsteps, according to Lei.\n\nArtificial intelligence will also be employed to boost the capacity of grassroots medical services, said the official.\n\nThe government also plans to spend more on medical and health services in 2025, according to Lei. The per capita government subsidy for basic public health services is expected to increase by 5 yuan this year, reaching 99 yuan per person, said the official, citing the government work report, which is being deliberated by national lawmakers.\n\nThe adjustment will translate into further optimized public medical services, Lei noted.",
  },
{
    id: "art-society-3",
    domain: "society",
    direction: "en-to-zh",
    title: "",
    source: "SCIO",
    url: "http://english.scio.gov.cn/topnews/2024-09/20/content_117438470.html",
    units: 336,
    excerpt: "Chinese Premier Li Qiang, also a member of the Standing Committee of the Political Bureau of the Communist Party of China (CPC) Central Committee, speaks while attending a State Council meeting on mobilizing efforts for the reform on gradually raising statutory retirement age in Beijing, capital of China, Sept. 19, 2024. Ding Xuexiang, a member of the Standing Committee of the Political Bureau of the CPC Central Committee and vice premier of the State Council, attended the meeting. (Xinhua/Liu Bin)\n\nChinese Premier Li Qiang on Thursday called for the steady and orderly implementation of the reform on gradually raising statutory retirement age to provide important support for advancing Chinese modernization.\n\nLi, also a member of the Standing Committee of the Political Bureau of the Communist Party of China (CPC) Central Committee, made the remarks during a State Council meeting on mobilizing efforts for the reform.\n\nLi said the reform aligns with the objective requirement to proactively address an aging population and promote high-quality population development as well as the practical necessity for fully unleashing talent dividends and facilitating Chinese modernization.\n\nHe noted that the reform is a significant move to improve the social security system and better safeguard and improve people's livelihoods.\n\nThe Chinese premier emphasized adhering to the principle of voluntary participation and flexibility in implementing the delayed retirement policy, ensuring it truly reflects employees' intentions.\n\nHe urged the prompt formulation and improvement of supporting policies and measures, noting that policies that need to directly align with the reform plan should be introduced and implemented as early as possible.\n\nExpanding employment should be a crucial measure supporting the reform's advancement, Li said. He stressed implementing and refining employment policies for college graduates and other young people while ensuring the protection of workers' rights and interests.\n\nHe also called for concrete efforts to strengthen old-age security and services, effective implementation of policies to raise basic pensions for urban and rural residents and retirees, and enhancing the coordination and adjustment of pension insurance at the national level.",
  },
{
    id: "art-ecology-1",
    domain: "ecology",
    direction: "en-to-zh",
    title: "China drafting new action plan for sustained air quality improvement",
    source: "china.org.cn",
    url: "http://www.china.org.cn/2026-08/14/content_118647000.shtml",
    units: 339,
    excerpt: "This photo taken on Sept. 27, 2025 shows the city view of Beijing, capital of China. [Photo/Xinhua]\n\nChina is formulating a new action plan for sustained air quality improvement, placing emphasis on higher quality standards and more targeted region-specific policies, an official said Thursday.\n\nThe plan will tighten the concentration limit for PM2.5, with stricter limits on other pollutants including PM10, sulfur dioxide and nitrogen oxides, Xu Bijiu, vice minister of ecology and environment, said at a press briefing held by the State Council Information Office.\n\nThe plan seeks to tailor pollution control to local conditions. Key areas, including the Beijing-Tianjin-Hebei region and its surrounding areas, as well as the Yangtze River Delta region and the Fenwei Plain, will maintain strict controls.\n\nCity clusters along the middle reaches of the Yangtze River, the Chengdu-Chongqing region and some areas in Xinjiang Uygur Autonomous Region, will be designated as areas for intensified action, with comprehensive pollution-control measures benchmarked against those in the key regions.\n\nThe Guangdong-Hong Kong-Macao Greater Bay Area as well as Fujian and Hainan provinces will serve as pioneer regions, aiming for world-class standards and exploring new approaches to achieving further air-quality improvements.\n\nThe plan will also focus on optimizing industrial, energy and transportation structures, strengthening pollution control in key sectors, and updating emission standards and supporting policies, according to Xu.\n\nChina has made significant progress in improving air quality in recent years. The annual average PM2.5 concentration, a key indicator of air quality, fell to 28 micrograms per cubic meter in 2025, down 59 percent from 2013, while the proportion of days with heavy air pollution dropped to 0.9 percent, both reaching their best levels on record.\n\nDespite the progress, challenges remain as improvement in air pollution control is still \"insufficient, unstable and uneven,\" Xu noted.\n\nThe new plan came as China is intensifying its green efforts. A recently released plan to build a Beautiful China during the 15th Five-Year Plan period (2026-2030) has called for a comprehensive improvement in the quality of the ecological environment by 2030.",
  },
{
    id: "art-ecology-2",
    domain: "ecology",
    direction: "en-to-zh",
    title: "China's carbon market expands as annual trading volume hits record high",
    source: "China Development Gateway",
    url: "http://en.chinagate.cn/2026-09/18/content_118702293.htm",
    units: 305,
    excerpt: "China's national carbon market had recorded a cumulative trading volume of 961 million tonnes of carbon dioxide equivalent by the end of August 2026, with total turnover reaching 65.7 billion yuan (about 9.71 billion U.S. dollars), according to an ongoing carbon market conference in central China.\n\nIn 2025, this market operated for 243 trading days, with annual trading volume hitting a record 235 million tonnes, up 24.36 percent year on year, while transaction value reached 14.63 billion yuan, according to a report released Tuesday at the China Carbon Market Conference 2026 in Wuhan, Hubei Province.\n\nChina expanded the market's industry coverage for the first time in 2025. As of 2026, a total of 3,680 key emitters from the power generation, steel, cement and aluminum smelting sectors have been included, covering around 8.3 billion tonnes of carbon dioxide emissions, or more than 65 percent of the national total.\n\nPreparatory work is also underway to bring sectors like petrochemicals, chemicals, papermaking and civil aviation into the market.\n\nChina officially launched its national carbon emissions trading market in July 2021, which has since evolved into the world's largest carbon market in terms of total greenhouse gas emissions traded.\n\nChina's voluntary greenhouse gas emissions reduction market has also gathered pace. By the end of August, 41 projects had been registered, with cumulative trading volume reaching 21.71 million tonnes and transaction value totaling 1.74 billion yuan.\n\nIn March, a mangrove restoration project in Xiapu County of east China's Fujian Province became the first such project to complete registration under the voluntary emissions reduction market, marking a milestone in safeguarding and restoring China's marine ecosystems.\n\nAddressing the conference in Wuhan, Minister of Ecology and Environment Huang Runqiu said China will further strengthen the carbon market's role in cutting emissions, diversify trading products and market participants, and expand international exchanges and cooperation.",
  },
{
    id: "art-ecology-3",
    domain: "ecology",
    direction: "en-to-zh",
    title: "China's photovoltaic power capacity overtakes coal-fired power for first time",
    source: "Xinhua",
    url: "http://english.news.cn/20260901/c45a7fc896364cb5aa41810a90686e33/c.html",
    units: 313,
    excerpt: "A drone photo taken on Sept. 2, 2025 shows a new energy base in Kubuqi Desert, north China's Inner Mongolia Autonomous Region. China's installed photovoltaic (PV) power capacity surpassed coal-fired power capacity for the first time, making PV the country's largest power source by installed capacity, the National Energy Administration said Tuesday. China's installed PV power capacity reached 1.286 billion kilowatts at the end of July, according to the administration. (Xinhua/Li Zhipeng)\n\nBEIJING, Sept. 1 (Xinhua) -- China's installed photovoltaic (PV) power capacity has surpassed coal-fired power capacity for the first time, making PV the country's largest power source by installed capacity, the National Energy Administration said on Tuesday.\n\nChina's installed PV power capacity reached 1.286 billion kilowatts at the end of July, edging past the coal-fired power capacity of 1.285 billion kilowatts, according to the administration.\n\n\"This marks a milestone in China's green and low-carbon energy transition,\" said Liu Zhiqiang, an expert from the China Electricity Council, adding that the country's new power system, with new energy as the mainstay, is taking shape at an accelerated pace.\n\nBy the end of July, PV power had accounted for more than 30 percent of China's total installed power generation capacity. Measured by newly added capacity, the share rose to over 40 percent in the first seven months of 2026, underscoring the rapid expansion of the PV sector.\n\nChina has built a complete PV industry chain covering research and development, design and integrated manufacturing. Technological advances, including repeated breakthroughs in PV conversion efficiency, have helped drive continuous upgrades and swift cost reductions.\n\nChina's speedy development of PV power and other forms of new energy is also making a positive contribution globally.\n\nWith the world's largest and fastest-growing renewable energy system, the country supplies over 80 percent of PV modules and 70 percent of wind power equipment around the world, assisting the green transition in many countries.",
  },
{
    id: "art-tech-1",
    domain: "tech",
    direction: "en-to-zh",
    title: "Chinese scientists develop \"Jiuzhang 4.0,\" setting new world record in quantum computing",
    source: "Xinhua",
    url: "https://english.news.cn/20260514/db28783f4b34466096e9cde2dd7afecc/c.html",
    units: 302,
    excerpt: "HEFEI, May 14 (Xinhua) -- Chinese scientists have developed a programmable quantum computing prototype called \"Jiuzhang 4.0\" that has set a new world record for optical quantum information technology, according to a study published on Wednesday in the journal Nature.\n\nLed by the University of Science and Technology of China (USTC), the team used the prototype to solve the Gaussian boson sampling problem at a speed more than 10 to the 54th times that of the world's most powerful supercomputer, the study said.\n\nThe researchers said they manipulated and detected quantum states of up to 3,050 photons -- a significant leap from the 255 photons achieved with the previous \"Jiuzhang 3.0.\"\n\nCurrent mainstream quantum computing technological routes include superconducting, ion trap, photonic, and neutral atom systems. The \"Jiuzhang\" series of prototypes encodes quantum bits using photons and performs quantum computation through the manipulation and measurement of these photons.\n\nSince its successful construction in 2020, the series has undergone several upgrades, achieving \"quantum computational advantage\" and repeatedly setting world records.\n\nLu Chaoyang, a professor at the USTC, said the research team developed a high-efficiency optical parametric oscillator light source and a spatiotemporally hybrid-coded interferometer.\n\nBy integrating 1,024 high-efficiency squeezed-state optical fields into an 8,176-mode spatiotemporally hybrid-coded circuit, the team was able to manipulate and detect up to 3,050 photons.\n\n\"This means that the most complex data sample generated by 'Jiuzhang 4.0' takes only 25 microseconds to produce -- shorter than the blink of an eye. In contrast, the world's most powerful supercomputer would require more than 10 to the 42nd years to calculate the same result,\" Lu said.\n\nLu noted that the results from \"Jiuzhang 4.0\" represent a major leap in the scale and complexity of low-loss photonic quantum processors, offering new possibilities for constructing \"trillion-qubit-mode three-dimensional cluster states\" and future \"fault-tolerant optical quantum computing hardware.\" ■",
  },
{
    id: "art-tech-2",
    domain: "tech",
    direction: "en-to-zh",
    title: "China unveils country's top 10 sci-tech achievements in 2024",
    source: "Xinhua",
    url: "http://english.news.cn/20250122/3b265f0ba8c6459d8156c77ee3757f93/c.html",
    units: 317,
    excerpt: "NANJING, Jan. 22 (Xinhua) -- The Chinese Academy of Sciences (CAS) and the Chinese Academy of Engineering (CAE) on Wednesday announced the country's top 10 sci-tech achievements of 2024, with the list including a lunar exploration mission, a brain-inspired chip and a super microscope.\n\nCAS vice president Wu Zhaohui unveiled the list of top 10 achievements during a press conference in Nanjing, capital of east China's Jiangsu Province. The list is based on selections made by academicians of the CAS and the CAE, who hold the country's highest national academic titles in science and engineering.\n\nTop 10 achievements of 2024 include the Chang'e-6 lunar mission, which collected lunar samples from the far side of the moon; the world's first brain-inspired complementary visual chip based on primal language; and the first domestically-built ocean drilling vessel, which is named Mengxiang or Dream in English, and was officially commissioned last year.\n\nThe list also includes the world's first petabyte-level ultra-high-capacity optical disc storage device; the Einstein Probe astronomical satellite, also known as the Tianguan satellite, which was successfully launched and has achieved a series of results; a new solution for helium-free ultra-low-temperature refrigeration; and the world's first universal CAR-T therapy that uses donor-derived CAR-T cells to treat rheumatic and autoimmune diseases.\n\nIn addition, the 2024 list features the super microscope which can provide a panoramic view of large-scale cell interactions; the first successful observation of graviton modes in condensed matter in the world; and the second Qinghai-Xizang Plateau scientific research expedition, which drilled the world's longest mountain glacier core and achieved a series of breakthroughs.\n\nThis 2024 list is the 31st annual list of its kind. The list has gained widespread media attention both at home and abroad, and helps to promote the understanding of science and technology among the public.\n\nThe list containing the world's top 10 sci-tech achievements of 2024 was also released at the press conference in Nanjing. ■",
  },
{
    id: "art-tech-3",
    domain: "tech",
    direction: "en-to-zh",
    title: "China to invest 3.8 trillion yuan in information infrastructure by 2030",
    source: "China Daily",
    url: "http://www.chinadaily.com.cn/a/202609/07/WS6a9e750be4b06d4aa055cc0a.html",
    units: 303,
    excerpt: "China will invest a cumulative 3.8 trillion yuan ($566 billion) in information infrastructure by 2030 and boost its intelligent computing power to 9,800 EFLOPS, according to a new industry blueprint unveiled on Monday by the Ministry of Industry and Information Technology.\n\nThe 15th Five-Year Plan (2026-30) for the information and communication sector, officially published on Monday, sets a clear roadmap for high-quality development over the next five years, focusing on five priorities: consolidating infrastructure, improving public services, optimizing governance, mitigating risks, and expanding opening-up.\n\nA key highlight is the intelligent computing power target of 9,800 EFLOPS — equivalent to 9,800 quintillion floating-point operations per second — marking a significant leap from the capacity of 2,185 EFLOPS.\n\nBy 2030, China aims to build a fully covered, performance-leading, next-generation communications network, forming a technologically advanced and secure information and communication industrial system. The plan also seeks to establish an agile and efficient governance system, strengthen cybersecurity and data protection capabilities, and enhance the sector's ability to empower other industries while raising its global competitiveness.\n\nThe plan outlines 13 major indicators across five dimensions: overall industry development, innovation, green growth, infrastructure, and application adoption.\n\nBy 2030, the information and communication industry is projected to generate 4.1 trillion yuan in revenue, with telecom business volume growing at an average annual rate of 7 percent. The number of 5G (including 5G-A) base stations per 10,000 people will reach 50, while 5G (including 5G-A) user penetration is targeted at 95 percent. Gigabit broadband subscribers are expected to hit 320 million.\n\nThe plan identifies six priority tasks: building information infrastructure with moderate overcapacity, cultivating and expanding the information and communication industrial system, systematically optimizing the industry governance system, comprehensively strengthening network and data security capabilities, continuously expanding the depth and breadth of integrated applications, and steadily enhancing the industry's global development level.",
  },
{
    id: "art-education-1",
    domain: "education",
    direction: "en-to-zh",
    title: "China moves to bring AI into classrooms as it accelerates digital push",
    source: "Xinhua",
    url: "https://english.news.cn/20260411/98609f94226549b09bb7cb4ceaf58471/c.html",
    units: 318,
    excerpt: "BEIJING, April 11 (Xinhua) -- China plans to launch an \"AI Plus Education\" initiative, aiming to integrate artificial intelligence (AI) into classrooms from an early age as the country accelerates efforts to develop the technology and adapt its economy to an increasingly digital future.\n\nBy 2030, China aims to establish a comprehensive AI education system that spans all levels of schooling and extends to the broader public, the Ministry of Education said Friday.\n\nThe plan lays out steps to speed the rollout of AI education in primary and secondary schools, including the introduction of dedicated courses and efforts to weave the subject across disciplines.\n\nIt also encourages schools to extend AI-related learning into after-school programs and hands-on activities, expanding students' exposure beyond the classroom.\n\nAt universities, the proposal goes even further, calling for AI to become part of the basic curriculum for all students. Colleges are urged to design interdisciplinary courses that pair AI with other fields.\n\nIn parallel, universities will be steered to realign programs with evolving industries, and add majors to meet the demands of emerging technologies and new business models, according to the plan.\n\nThe plan envisions using AI to support teaching, such as expanding the use of digital tools to ease teachers' workloads and improve efficiency. It calls for applying the technology to assist teachers in homework management, advancing intelligent grading, Q&A, and tutoring.\n\nIt also proposes using AI to analyze classroom interactions, offering teachers insights to refine their instruction. The plan further suggests incorporating AI into teacher qualification exams and certification processes.\n\nChina began laying the groundwork for AI early, incorporating it into national planning as far back as the 13th Five-Year Plan a decade ago. The industry has expanded rapidly, with companies racing to build large-scale models, the number of AI firms climbing past 6,000, and the core sector projected to have surpassed 1.2 trillion yuan (about 174 billion U.S. dollars) in 2025.",
  },
{
    id: "art-education-2",
    domain: "education",
    direction: "en-to-zh",
    title: "China to strengthen skilled workforce cultivation to promote economic transformation",
    source: "Xinhua",
    url: "https://english.news.cn/20250115/54d76973a15442d7895e59af2d75fec6/c.html",
    units: 313,
    excerpt: "BEIJING, Jan. 15 (Xinhua) -- China will ramp up policy support for companies to cultivate skilled workers as part of its efforts to accelerate its economic transformation.\n\nThe government announced a series of major measures on Wednesday, from establishing talent training bases to increasing welfare benefits for skilled workers, according to guidelines released by eight government departments, including the Ministry of Human Resources and Social Security and the National Development and Reform Commission.\n\nOne of the goals is to cultivate more than 15,000 leading talents and 5 million highly skilled workers nationwide within a three-year period, according to the guidelines.\n\nThe country has over 200 million skilled workers, accounting for more than 26 percent of its total workforce. However, there is still a structural imbalance with a lack of supply of highly skilled workers.\n\nAn official of the ministry said China's evolving industrial landscape, which features the upgrading of traditional industries and emerging new quality productive forces, requires a higher caliber of skilled labor.\n\nEfforts will be made to cultivate master craftspeople and highly skilled workers and develop a first-rate industrial technical workforce, according to the third plenary session of the 20th Communist Party of China Central Committee in July.\n\nWednesday's new policy focuses on encouraging enterprises to invest in talent development.\n\nFor instance, by the end of 2025, China plans to support the establishment of over 400 national skilled talent training bases, covering areas from advanced manufacturing to childcare.\n\nEnterprises will receive support in establishing vocational schools and training institutions, as well as in conducting independent vocational skills assessments and issuing certificates.\n\nTo address mismatches between labor supply and industry demand, the guidelines suggest creating a collaborative talent development ecosystem involving businesses, educational institutions and governments. In response to the digital revolution, the policy emphasizes cultivating new digital professions in areas like big data, artificial intelligence, smart manufacturing, integrated circuits and data security.",
  },
{
    id: "art-education-3",
    domain: "education",
    direction: "en-to-zh",
    title: "China Focus: From classrooms to talent hubs: China looks to education to drive modernization",
    source: "Xinhua",
    url: "https://english.news.cn/20260509/07f6a1c9bf964ed5a3cbae385980949e/c.html",
    units: 317,
    excerpt: "BEIJING, May 9 (Xinhua) -- In the thin air of China's southwest plateau, where bridges must endure extreme weather and fragile geology, engineering students are being asked: \"How do you prevent concrete from cracking at ultra-high altitude?\"\n\nThe question, raised by an industry mentor at a university-enterprise workshop at Southwest Jiaotong University, was not theoretical but drawn from real infrastructure challenges in China's mountainous regions.\n\nStudents and faculty responded with immediate design ideas. \"At our school, the interaction between 'real problems' and 'real research' is constant,\" said Ai Changfa, a professor at the university's National Elite Engineers School, noting that such industrial challenges are embedded across the talent training process.\n\nSessions like this at the university are part of broader efforts in China to better align education, technological innovation, and talent development to support its modernization drive, an approach that also underpins its ambition to become a leading country in education.\n\nChina operates one of the world's largest higher education systems. As of June 2025, it had 3,167 higher education institutions, with the number of university graduates projected to reach 12.7 million in 2026, according to the Ministry of Education.\n\nThat scale is being reshaped as China adapts its education system to the needs of industrial upgrading and innovation-driven growth.\n\n\"Over the past five years, China has stepped up efforts to build a strong education system, strengthening the development and utilization of human resources and delivering notable progress in talent cultivation,\" said Li Lu, a researcher at the Chinese Academy of Macroeconomic Research under the National Development and Reform Commission.\n\nRising demand for talent has driven expanded enrollment in key fields and prompted reforms to align higher education with both frontier and foundational disciplines, Li said.\n\nDuring the 14th Five-Year Plan period (2021-2025), Chinese universities added 10,200 undergraduate programs while canceling or suspending 12,200, with more than 30 percent of programs adjusted overall, according to the education ministry.",
  },
{
    id: "art-communication-1",
    domain: "communication",
    direction: "en-to-zh",
    title: "Feature: From curiosity to passion, Chinese learning gains popularity in Azerbaijan",
    source: "Xinhua",
    url: "http://english.news.cn/20260421/ab2873cf40924c199c90aee98d9b58c3/c.html",
    units: 323,
    excerpt: "Baku, April 21 (Xinhua) -- \"Look! This is what my name looks like in Chinese!\"\n\nStanding at the entrance of Baku State University's auditorium, an Azerbaijani student showed his friend a red card with apparent excitement. It bore the name \"Qasim,\" rendered in elegant black ink by a teacher from the university's Confucius Institute. It is a small souvenir he had queued for nearly half an hour.\n\nApril 20 marked the 7th International Chinese Language Day. Outside the auditorium, cultural booths featuring calligraphy, paper-cutting, tea art, and character puzzles attracted crowds of visitors. Inside, performances prepared by teachers and students from the Confucius Institute drew waves of applause.\n\n\"My Chinese name is Bai Yuchen, given by my teacher. Today I performed The 24 Solar Terms Song,\" said 11-year-old Huseyn Alakbarov. He and his classmates rehearsed regularly for nearly 20 days. \"Chinese can be challenging, but the more I learn, the more interesting it becomes,\" he added.\n\nAccompanied by the Chinese-style piece Ru Hua (\"Like a Painting\"), students dressed in Hanfu presented the evolution of the Chinese character for \"horse,\" from ancient pictographs to its modern form. Behind the stage, 18-year-old Omar Mammadov narrated the transformation in Azerbaijani.\n\nA second-year Chinese major and winner of the 2025 \"Chinese Bridge\" competition in Azerbaijan, Mammadov also hosted the event. \"Learning Chinese has made me more confident and outgoing,\" he said. As a child, he was fascinated by classical Chinese stories like Journey to the West. Now, he can perform \"face-changing,\" or \"Bian Lian\" in Chinese, an ancient Chinese dramatic art of Sichuan Opera. \"I once admired the Monkey King's transformations -- now I can do something similar myself.\"\n\nSeventeen-year-old Midina Abutalybova performed the song Sorry, My Chinese Is Not Good, accompanying herself on guitar. \"The rhythm is upbeat, and the lyrics are easy to memorize -- it perfectly captures how I feel while learning Chinese,\" she said. A first-year student majoring in Chinese, she noted the program's growing popularity.",
  },
{
    id: "art-communication-2",
    domain: "communication",
    direction: "en-to-zh",
    title: "China steps up efforts for sustainable development at climate week",
    source: "China Daily",
    url: "http://www.chinadaily.com.cn/a/202406/07/WS6662d42ba31082fc043cb83a.html",
    units: 320,
    excerpt: "China's commitment to environmental protection took center stage this week at a climate event organized by SEE Conservation, a prominent Chinese environmental NGO. The event, titled \"Climate Week,\" aims to foster public dialogue and collaboration among citizens, scholars, and businesses around achieving a greener, more sustainable future.\n\nZhu Chunquan, head of China Nature Initiatives at the World Economic Forum, delivered a keynote address highlighting China's role in global ecological conservation efforts. He pointed to the recent import of \"zero-deforestation\" soybeans from Brazil as a concrete example of China's dedication to reducing its environmental footprint. This move aligns with similar regulations recently enacted by the European Union.\n\nZhu emphasized the importance of integrated land-use management strategies. He stressed the need to balance ecological restoration, climate goals, and economic prosperity. He cautioned against practices like large-scale rainforest conversion in Brazil, which while stimulating economic growth, can lead to significant environmental consequences.\n\nHe presented the photovoltaic industry park in Qinghai province as a successful example of achieving ecological and economic benefits simultaneously. Solar panel installation in this previously desertified region has not only curbed wind erosion but also fostered vegetation growth, boosting local livestock populations.\n\n\"Most countries, including China, are now embracing production methods that prioritize environmental well-being,\" Zhu noted. He highlighted the potential of \"nature-based solutions\" to contribute significantly to carbon emission reduction targets.\n\nZhang Linxiu, director of the UNEP-IEMP, echoed Zhu's call for a sustainable development approach. Zhang stressed the need to move beyond trade-offs and integrate environmental protection into development strategies. She identified climate change, extreme weather events, and biodiversity loss as three major interconnected environmental challenges that require immediate attention.\n\nShe advocated for a two-pronged approach: addressing unsustainable practices like overexploitation and invasive species, while also allowing nature room for self-healing and regeneration. Zhang cited a successful project in Yunnan province where experts helped a remote village capitalize on its rich biodiversity, fostering economic development while safeguarding ecological diversity.",
  },
{
    id: "art-communication-3",
    domain: "communication",
    direction: "en-to-zh",
    title: "China vows to continue support for int'l Chinese language education",
    source: "Xinhua",
    url: "https://english.news.cn/20251114/e9a7317830444d8b9456003dbdfbdb9d/c.html",
    units: 306,
    excerpt: "Chinese Vice Premier Ding Xuexiang, also a member of the Standing Committee of the Political Bureau of the Communist Party of China Central Committee, attends the opening ceremony of the 2025 World Chinese Language Conference and delivers a speech in Beijing, capital of China, Nov. 14, 2025. (Xinhua/Ding Lin)\n\nBEIJING, Nov. 14 (Xinhua) -- Chinese Vice Premier Ding Xuexiang on Friday said China will, as always, support and serve all other countries in carrying out Chinese language education, and work together to advance language and cultural exchanges and cooperation.\n\nDing, also a member of the Standing Committee of the Political Bureau of the Communist Party of China Central Committee, made the remarks when addressing the opening ceremony of the 2025 World Chinese Language Conference in Beijing.\n\nNoting the rising popularity of the Chinese language in the international community in recent years, Ding said China's firm adherence to high-quality development and opening up will provide more opportunities for other countries, and the international community's demand for learning Chinese and understanding China will also continue to grow.\n\nTo promote Chinese language education, he called for efforts to advance innovation in line with the educational trends in the digital and intelligent era to make Chinese learning more convenient and efficient, and stressed the integrated development of international Chinese education with vocational and specialized education to expand the language's application scenarios.\n\nDing called on primary and secondary schools from home and abroad to form partnerships in language education to soundly organize Chinese language competitions and facilitate Chinese learners' studies in China.\n\nHe also urged efforts to jointly implement the Global Civilization Initiative and strengthen the two-way exchanges between Chinese and the languages of countries around the world.\n\nAbout 2,000 guests, including government officials from China and abroad, experts and scholars, university leaders, and representatives of international organizations, attended the opening ceremony.",
  },
  {
    id: "art-economy-1-zh",
    domain: "economy",
    direction: "zh-to-en",
    title: "八月份经济总体平稳向新向优",
    source: "中国政府网",
    url: "https://www.gov.cn/lianbo/202609/content_7081268.htm",
    units: 254,
    excerpt: "8月份，国际地缘政治冲突态势持续，国内部分地方自然灾害多发。“复杂环境下，更加积极有为的宏观政策持续发力。我国经济顶住压力，保持总体平稳、向新向优发展态势。”9月15日举行的国新办发布会上，国家统计局新闻发言人、总经济师、国民经济综合统计司司长付凌晖介绍了8月份国民经济运行情况。\n\n经济运行呈现“生产稳、就业稳、物价稳”“新兴产业增长快、进出口增长快”等特点\n\n“从8月份主要指标来看，经济运行主要呈现‘三稳两快’的特点。”会上，付凌晖作了详细解读。\n\n生产稳。我国积极加大国内能源保供力度，支撑了生产稳定。8月份，全国规模以上工业增加值同比增长5.2%，比上月加快0.7个百分点；服务业生产指数同比增长4.1%，保持总体平稳。",
  },
  {
    id: "art-economy-2-zh",
    domain: "economy",
    direction: "zh-to-en",
    title: "一季度民企担当外贸主力 中式生活用品热销全球",
    source: "新华网",
    url: "http://www.news.cn/fortune/20260414/bfed2bf0a26d41af9d0ff6160b179b1e/c.html",
    units: 229,
    excerpt: "新华网北京4月14日电（记者 李童）海关总署14日发布数据显示，2026年一季度我国货物贸易进出口总值11.84万亿元，同比增长15%，季度规模首超11万亿元的同时，季度增速创近5年最高。其中，民营企业进出口占我国进出口总值的比重进一步提升至57.3%。\n\n2026年4月14日，在山东港口青岛港，装载外贸集装箱的货轮驶离港口。新华社发\n\n海关总署数据显示，一季度，我国民营企业进出口6.78万亿元，增长16.2%，其中出口、进口分别增长12.7%和23.5%，增速均高于全国整体，我国第一大外贸主体的地位得到了进一步巩固。\n\n海关总署副署长王军在14日国新办举行新闻发布会上表示，今年以来，民营企业进出口呈现出三方面特点：",
  },
  {
    id: "art-economy-3-zh",
    domain: "economy",
    direction: "zh-to-en",
    title: "权威解读｜从前8个月数据看中国经济向新向优",
    source: "新华社",
    url: "http://www.hubei.xinhua.org/20260916/b25057bd3500469f8ac6e2c9b1044dc5/c.html",
    units: 293,
    excerpt: "2026年是“十五五”开局之年，中国经济在1至8月交出一份总体平稳、向新向优的成绩单。国家统计局15日发布数据显示，8月份生产供给平稳增长，就业物价总体稳定，对外贸易快速增长，新动能支撑作用增强。前8个月经济数据成色如何？支撑向新向优的力量来自哪里？数据背后，三大结构性特征值得关注。特征一：经济运行总体平稳 向好基础继续巩固生产供给是观察经济大盘的“压舱石”。1至8月份，全国规模以上工业增加值同比增长5.3%。1至8月份，全国服务业生产指数同比增长4.7%。“稳”的态势之下，“进”的力量也在积蓄。1—8月份，知识产权产品投资同比增长9.2%，高技术产业投资同比增长5.2%。武汉大学经济与管理学院珞珈经管智库工作委员会副主任杨刚强分析表示，从已经公布的8月份数据看，我国经济运行延续总体平稳、稳中有进、向新向优的发展态势。",
  },
  {
    id: "art-politics-1-zh",
    domain: "politics",
    direction: "zh-to-en",
    title: "两会新华鲜报丨三部重要法律通过 “十五五”开局标注国家立法新刻度",
    source: "新华社",
    url: "http://www.xinhuanet.com.cn/politics/20260312/65af45969fc74859b9a3b8f9296bf633/c.html",
    units: 262,
    excerpt: "2026年3月12日下午，十四届全国人大四次会议表决通过生态环境法典、民族团结进步促进法、国家发展规划法。中国特色社会主义法律体系迎来三个标志性“新成员”，将分别自2026年8月15日、2026年7月1日和公布之日起施行。\n\n汇集共商共议之力，夯实良法善治之基。在“十五五”开局之年，中国式现代化夯实基础、全面发力的关键时期，这三部法律将党的主张、国家意志和人民意愿紧密结合，回应重大时代课题。一次全国人大会议表决通过三部重要法律，为近些年来少见。\n\n夯基固本，良法善治“四梁八柱”更加坚实——\n\n生态环境法典是我国第二部以“法典”命名的法律，将党的十八大以来生态文明建设理论、制度、实践成果以法典化的方式确定下来，完善生态环境法律制度体系……",
  },
  {
    id: "art-politics-2-zh",
    domain: "politics",
    direction: "zh-to-en",
    title: "李强主持召开国务院常务会议 听取老龄工作情况汇报等",
    source: "中国政府网",
    url: "https://www.gov.cn/yaowen/liebiao/202609/content_7081464.htm",
    units: 211,
    excerpt: "李强主持召开国务院常务会议听取老龄工作情况汇报研究推动体育赛事健康发展有关工作部署实施医疗康复护理扩容提升工程审议通过《中医药传统知识保护条例（草案）》讨论《〈中华人民共和国突发事件应对法〉等15部法律的修正案（草案）》\n\n新华社北京9月18日电 国务院总理李强9月18日主持召开国务院常务会议，听取老龄工作情况汇报，研究推动体育赛事健康发展有关工作，部署实施医疗康复护理扩容提升工程，审议通过《中医药传统知识保护条例（草案）》，讨论《〈中华人民共和国突发事件应对法〉等15部法律的修正案（草案）》。",
  },
  {
    id: "art-politics-3-zh",
    domain: "politics",
    direction: "zh-to-en",
    title: "新华全媒头条·两会特别报道｜凝聚起推进中国式现代化的磅礴力量——从全国两会看全过程人民民主新实践",
    source: "新华社",
    url: "http://www.news.cn/politics/20260310/b24bd46099eb457e88133d2cb10fc638/c.html",
    units: 203,
    excerpt: "新华社北京3月9日电 题：凝聚起推进中国式现代化的磅礴力量——从全国两会看全过程人民民主新实践正在进行的全国两会上，约5000名代表委员带着田间地头的调研心得、街巷社区的民意民声、基层一线的所思所想，共商推进中国式现代化大计，铺展出践行全过程人民民主的生动画卷。习近平总书记深刻指出：“人民民主是社会主义的生命。没有民主就没有社会主义，就没有社会主义的现代化，就没有中华民族伟大复兴。”今年，是“十五五”开局之年；此刻，距离基本实现社会主义现代化还有不到十年时间。",
  },
  {
    id: "art-culture-1-zh",
    domain: "culture",
    direction: "zh-to-en",
    title: "楚风汉韵融入城市日常（解码·文化遗产系统性保护）",
    source: "人民网",
    url: "http://ent.people.com.cn/n1/2026/0917/c1012-40800140.html",
    units: 287,
    excerpt: "江苏徐州探索历史文化资源保护传承、活化发展路径\n\n江苏徐州彭城广场站，一辆红色公交车吸引不少市民游客的目光。车身上绘着历史人物形象，车内的手拉环是编钟造型，讲解员一身汉服，边报站边讲解历史。\n\n徐州市民李泽政常带着孩子坐这趟公交车去上绘画课，“一出门就能遇上汉文化。”如今徐州全市有多条这样的汉文化主题公交线路。\n\n徐州有3000多座汉代墓葬、数万件汉代文物。“徐州市致力打造‘两汉文化看徐州’IP（知识产权），让千年楚风汉韵‘看得见’‘传得开’‘吃得着’‘穿得出’‘带得走’，化作城市生活的日常。”徐州市文广旅局推广科科长王莹说。\n\n徐州云龙区翠屏山街道居民崔红艳最近学会一项新本领：做汉服。“前段时间，我参加了社区的公益课堂，被非遗代表性传承人李欣的汉服制作课程吸引了。”崔红艳说。",
  },
  {
    id: "art-culture-2-zh",
    domain: "culture",
    direction: "zh-to-en",
    title: "在AI“舞台”，遇见更“潮”非遗",
    source: "光明网",
    url: "https://news.gmw.cn/2026-09/18/content_39006578.htm",
    units: 244,
    excerpt: "点击浏览器下方“”分享微信好友Safari浏览器请点击“”按钮\n\n——从2026年服贸会看我国非遗保护传承新貌\n\n9月的北京首钢园，工业遗存的钢铁梁柱间，阵阵茶香与墨韵飘来。古法合香、品味茶韵、捏面人……2026年中国国际服务贸易交易会上，各具特色的非遗展台成为人气十足的“打卡地”。\n\n服贸会上非遗的魅力和火热，也是我国非遗保护传承及相关文旅产业持续发展的缩影。当下，非遗正以可触可感可体验的方式走进大众生活。乘着AI等数智技术的东风，非遗也在走向更广阔的舞台。\n\n游客在福建厦门金沙书院体验非遗手工制作。新华社发\n\n2026年服贸会上展出电脑刺绣机。郭俊锋摄/光明图片\n\n从“看非遗”到“玩非遗”，“独角戏”变“大合唱”",
  },
  {
    id: "art-culture-3-zh",
    domain: "culture",
    direction: "zh-to-en",
    title: "习近平文化思想引领文化传承发展开创新局面",
    source: "新华社",
    url: "http://www.news.cn/politics/leaders/20260601/2e77b6338c3b4880b8d7dde081c71615/c.html",
    units: 278,
    excerpt: "2023年6月2日，习近平总书记在文化传承发展座谈会上发表重要讲话，深刻阐释中华文化传承发展的重大理论和现实问题，发出“赓续历史文脉、谱写当代华章”的时代号召。\n\n党的十八大以来，在习近平文化思想科学指引下，新时代文化建设守正创新、步履铿锵，文脉赓续绵延、文化活力迸发，一幅古老文明与现代文明交相辉映的绚丽图景在神州大地徐徐铺展。\n\n中华文明具有突出的连续性、创新性、统一性、包容性、和平性。习近平总书记对中华文明突出特性的精准概括，揭示了中华民族生生不息的“基因密码”。\n\n一个多月前，2025年度全国十大考古新发现公布，河北宣化郑家沟遗址、山西昔阳钟村遗址、山东青岛琅琊台遗址等重大成果，不断破解历史谜题、补全文明脉络，持续实证中华五千年文明史。",
  },
  {
    id: "art-society-1-zh",
    domain: "society",
    direction: "zh-to-en",
    title: "我国拟出台规定保障未成年人健康安全使用网络",
    source: "人民网",
    url: "http://society.people.com.cn/n1/2026/0919/c1008-40801512.html",
    units: 243,
    excerpt: "新华社北京9月18日电 为了加强未成年人网络保护，营造有利于未成年人身心健康的网络环境，保障未成年人合法权益，国家互联网信息办公室组织起草了《国务院关于保障未成年人健康安全使用网络的规定（征求意见稿）》，于18日向社会公开征求意见。意见反馈截止日期为2026年10月17日。\n\n征求意见稿的制定立足我国未成年人网络保护治理实践，针对未成年人使用网络过程中出现的新情况新问题，创新制度设计，衔接有关法律法规；明确有关部门、网络服务提供者、智能终端产品制造者、应用程序分发平台服务提供者、群团组织、学校、监护人等各方主体在未成年人健康安全使用网络中的协同治理要求。",
  },
  {
    id: "art-society-2-zh",
    domain: "society",
    direction: "zh-to-en",
    title: "两会特别报道丨为梦想奋斗 为幸福打拼——从全国两会看民生福祉新画卷",
    source: "新华社",
    url: "http://www.news.cn/politics/20260307/1533a7cddd21419f9bca2c1ce50f4f60/c.html",
    units: 238,
    excerpt: "新华社北京3月7日电 题：为梦想奋斗 为幸福打拼——从全国两会看民生福祉新画卷3月5日，习近平总书记参加他所在的十四届全国人大四次会议江苏代表团审议时，谈及准确把握新形势下人民群众对美好生活新期待和民生工作新特点，强调要“积极主动解答如何实现高质量充分就业、如何增加城乡居民收入、如何进一步提升基本公共服务和社会保障水平等课题”。“坚持在高质量发展中保障和改善民生”“加强普惠性、基础性、兜底性民生建设”“建设生育友好型社会”……“十五五”开局之年的全国两会上，翻开政府工作报告、计划报告、预算报告、“十五五”规划纲要草案，人们感受到浓浓的民生暖意。",
  },
  {
    id: "art-society-3-zh",
    domain: "society",
    direction: "zh-to-en",
    title: "习近平总书记关切事丨“长护险”守护夕阳红",
    source: "新华社",
    url: "http://www2.xinhuanet.com/politics/leaders/20260331/53b5fe3e2bcd4a7bbf506f87fd1a3bfc/c.html",
    units: 254,
    excerpt: "莫道桑榆晚，人间重晚晴。让老年人安享幸福晚年，是习近平总书记心中的牵挂。\n\n2016年5月，习近平总书记为推动老龄事业全面协调可持续发展定向指引，指出要建立“相关保险和福利及救助相衔接的长期照护保障制度”，指明了破解失能群体照护难题的制度路径。\n\n“十五五”规划纲要明确：“推行长期护理保险，健全统一的老年人能力评估制度。”2026年3月，《中共中央办公厅 国务院办公厅关于加快建立长期护理保险制度的意见》正式发布，提出建立覆盖全民、统筹城乡、公平统一、安全规范、可持续的长期护理保险制度，标志着长期护理保险制度从局部试点阶段走向全国推行阶段。殷殷嘱托化作生动实践，社会保障安全网进一步织密织牢。",
  },
  {
    id: "art-ecology-1-zh",
    domain: "ecology",
    direction: "zh-to-en",
    title: "中国华电清洁能源装机占比超62%",
    source: "人民网",
    url: "http://finance.people.com.cn/n1/2026/0919/c1004-40801562.html",
    units: 236,
    excerpt: "本报北京9月18日电（记者邱海峰）记者18日从中国华电集团有限公司获悉，近日，中国华电发布“十四五”碳排放白皮书，系统披露“十四五”时期碳排放管理的新思路、新举措、新成效，全面展现公司绿色低碳转型的实践成果。这是中国华电第三次发布碳排放白皮书。\n\n数据显示，“十四五”时期，中国华电降碳成效持续显现。2025年，中国华电全口径供电碳排放强度较2020年下降60.93克/千瓦时，万元产值二氧化碳排放（现价）较“十三五”末下降23%，创历史新低。五年间，通过能源结构优化与节能降耗协同发力，累计减排二氧化碳8.71亿吨。碳市场建设同步推进，累计交易量达6297万吨，碳排放管理的精细化、专业化水平持续提升。",
  },
  {
    id: "art-ecology-2-zh",
    domain: "ecology",
    direction: "zh-to-en",
    title: "两会现场速递丨生态环境部部长黄润秋带芯片上通道展示环保成就",
    source: "新华社",
    url: "http://www.news.cn/politics/20260312/f2e0ef4a46dc4184bb0076460eec9b33/c.html",
    units: 289,
    excerpt: "新华社北京3月12日电（记者高敬、张晓洁）一块小小的环境DNA测序芯片，记录了长江江苏段19个国控断面的水生生物信息，显示这个江段近5年来水生生物增加20多种，充分体现了长江十年禁渔的成效。3月12日，第十四届全国人民代表大会第四次会议第三场“部长通道”集中采访活动在北京人民大会堂举行。这是生态环境部部长黄润秋接受媒体采访。12日，在十四届全国人大四次会议第三场“部长通道”上，生态环境部部长黄润秋展示了这样一块芯片，并介绍我国生态环保成就。黄润秋介绍，去年全国PM2.5浓度降到28微克/立方米，优良天数比例达到89.3%，创有监测以来最好水平。“十四五”期间，全国PM2.5浓度累计下降20%，重污染天数减少25%。全国地表水优良水体比例达到91.4%，远超“十四五”规划目标。长江干流连续6年、黄河干流连续4年全线水质稳定达到Ⅱ类。",
  },
  {
    id: "art-ecology-3-zh",
    domain: "ecology",
    direction: "zh-to-en",
    title: "厚植中国式现代化的绿色底色——来自2026年全国生态日主场活动的观察",
    source: "新华社",
    url: "http://www.news.cn/20260815/77f54a4a58684aff8bef83c8fec74d7f/c.html",
    units: 273,
    excerpt: "新华社呼和浩特8月15日电 题：厚植中国式现代化的绿色底色——来自2026年全国生态日主场活动的观察\n\n2026年全国生态日主场活动15日在内蒙古呼伦贝尔举办。在主场活动期间，有关部门和地方发布了一系列重要数据、最新成果，作出一系列重要部署，全面展示我国生态文明建设取得的巨大成就，深入谋划“十五五”时期推进生态文明建设的方向路径。\n\n党的十八大以来，我国能耗强度累计降低超过26%，以年均3.4%的能耗增速支撑了年均6.1%的经济增长；与10年前相比，全国重点城市PM2.5平均浓度累计下降56%；推动全球风电和光伏发电成本在过去10年间分别下降超过60%和80%……在主场活动上，国家发展改革委副主任周海兵列举了一组数据，全面展现美丽中国建设成就。\n\n8月15日，参观者参观生态产品推介展示区。",
  },
  {
    id: "art-tech-1-zh",
    domain: "tech",
    direction: "zh-to-en",
    title: "新华网发布“算电协同智能调度服务平台” 以算法调度推动算力与绿电高效协同",
    source: "新华网",
    url: "https://www.news.cn/digital/20260910/8e6f3138eba84ca1a9cea7115fb3a9f8/c.html",
    units: 278,
    excerpt: "新华网沈阳9月10日电 随着AI算力需求快速增长，数据中心用电成本持续攀升，电费在运营成本中占比突出。如何通过优化调度实现节能降本，成为行业关注的焦点。2026全球工业互联网大会期间，新华网正式发布“算电协同智能调度服务平台”。该平台旨在通过算法调度，引导计算任务在电价低谷时段执行、优先使用绿色电力，从而降低数据中心综合用能成本。新华网数字经济事业中心任燚发布“算电协同智能调度服务平台”。来源：大会供图新华网数字经济事业中心任燚发布时介绍，该平台以“新华数据要素联合平台”“智算统筹平台”“AIGC应用使能平台”为技术底座，打通多主体间的数据壁垒，实现“可用不可见”的联合建模；支持异构算力调度与任务级编排，使算力资源可随电价与绿电灵活迁移；",
  },
  {
    id: "art-tech-2-zh",
    domain: "tech",
    direction: "zh-to-en",
    title: "华为发布首个采用NPO的超节点——昇腾960超节点",
    source: "新华网",
    url: "https://www.news.cn/tech/20260918/42277cf892f84d4dade743dbf2f734e1/c.html",
    units: 276,
    excerpt: "9月17日，华为全联接大会2026在上海启幕，华为副董事长、轮值董事长汪涛发表题为“智启新未来，打造智能世界的硅基黑土地”的主题演讲，发布首个采用NPO技术的超节点——昇腾960超节点，加速十万亿规模的大模型训练和推理。华为副董事长、轮值董事长汪涛发表主题演讲华为AI战略的核心是算力，坚持硬件变现，聚焦做好AI基础设施，打造智能世界的硅基黑土地，华为坚持围绕“超节点+集群”，通过系统架构创新构建竞争力，打造中国坚实算力底座，构建开源开放的算力生态，为世界构建新的选择。随着大模型迈向十万亿级规模，超节点是超大规模AI基础设施建设的必然选择。华为超节点设计理念是以一套协议平等连接集群内所有组件、支持跨物理服务器的内存访问、并采用近铜远光的互连。",
  },
  {
    id: "art-tech-3-zh",
    domain: "tech",
    direction: "zh-to-en",
    title: "科创青年说丨从实验室到生产线：一支“90后”团队打破技术垄断的十年",
    source: "新华网",
    url: "http://www.news.cn/fortune/20260505/059596dc8a964b41b66f2cdb798fd0de/c.html",
    units: 272,
    excerpt: "在中国天辰工程有限公司的实验室内，几名年轻的科研人员正围着操作台屏幕凝神屏息，目光紧紧锁在那条缓慢起伏的数据曲线上。那是他们攻坚路上的“生命线”，每一丝波动都牵动着所有人的神经。\n\n有人弓着脊背，指尖攥紧钢笔，笔尖在实验记录本上飞速游走，记录每一个细微的参数；有人指尖轻叩鼠标，眼神锐利如鹰，反复拖拽、核对模型数据，生怕一丝疏忽，就错过那个藏在数据里的关键答案。\n\n这间几乎常年灯火通明的实验室里，键盘敲击声、笔尖划过纸张的沙沙声，交织成攻坚的乐章。他们日夜攻坚的，是双氧水法环氧丙烷（HPPO）生产技术——一项关乎化工产业绿色升级，却长期被“卡脖子”的核心技术。\n\n4月29日，研发人员在中国天辰工程有限公司技术研发中心电镜室工作。",
  },
  {
    id: "art-education-1-zh",
    domain: "education",
    direction: "zh-to-en",
    title: "教育强国建设三年行动计划综合改革试点一周年座谈会召开",
    source: "教育部",
    url: "http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/moe_1485/202603/t20260319_1431565.html",
    units: 222,
    excerpt: "3月19日，中央教育工作领导小组秘书组、教育部党组在京召开教育强国建设三年行动计划综合改革试点一周年座谈会，深入贯彻党的二十大和二十届历次全会精神，座谈交流试点一周年工作成效和经验做法，部署下一步深化教育综合改革和试点工作。中央教育工作领导小组秘书组组长，教育部党组书记、部长怀进鹏出席会议并讲话。会议指出，以习近平同志为核心的党中央系统擘画教育强国战略图景，全国教育大会发出建设教育强国的总动员令。教育系统深入贯彻落实党中央决策部署，启动“两批次6大类41项”三年行动计划综合改革试点。",
  },
  {
    id: "art-education-2-zh",
    domain: "education",
    direction: "zh-to-en",
    title: "教育强国建设开新局见实效（“十五五”开好局起好步）",
    source: "人民网",
    url: "http://gd.people.com.cn/n2/2026/0707/c123932-41631491.html",
    units: 263,
    excerpt: "2026年是“十五五”开局之年，也是教育强国建设三年行动计划承上启下的关键一年。站在新的历史起点，教育系统全面把握教育的政治属性、人民属性、战略属性，正以昂扬姿态开创新局面、展现新气象。\n\n“同学们看，这些集装箱从装卸到转运，全程用的是咱们国家自己的技术！”\n\n山东日照港，自动化码头的观景平台上，全国五一劳动奖章获得者田振东的话，穿透海风，直抵人心。围在他身边的，是来自青岛港湾职业技术学院的同学们。“机器再‘聪明’，也得靠人不服输的劲头撑着。”港口机械专业一名学生自豪地说。\n\n这不是一次普通参观，而是一堂聚焦“强国建设 奋斗有我”的大思政课。一路讲解，一起交流，“十五五”的蓝图成了同学们“看得见、摸得着、悟得深”的鲜活场景。",
  },
  {
    id: "art-education-3-zh",
    domain: "education",
    direction: "zh-to-en",
    title: "教育公共服务路径升级",
    source: "教育部",
    url: "https://www.moe.gov.cn/jyb_xwfb/s5147/202609/t20260916_1450979.html",
    units: 259,
    excerpt: "“要坚持以人民为中心，不断提升教育公共服务的普惠性、可及性、便捷性，让教育改革发展成果更多更公平惠及全体人民。”习近平总书记在全国教育大会上的重要讲话，为新时代全面提升教育公共服务质量和水平指明了方向。\n\n两年来，教育战线牢记习近平总书记殷殷嘱托，推动构建同人口变化相协调的教育资源调配机制，推动基础教育扩优提质，加速提升终身学习公共服务水平，不断满足人民群众对美好生活的向往。\n\n科学应对人口变化给教育资源配置带来的挑战，不仅是教育的必答题，也是民生的必答题，更是事关国家未来发展的必答题。《教育强国建设规划纲要（2024—2035年）》明确，“健全与人口变化相适应的基础教育资源统筹调配机制”。",
  },
  {
    id: "art-communication-1-zh",
    domain: "communication",
    direction: "zh-to-en",
    title: "通讯丨“中国文化日”活动走进澳大利亚校园",
    source: "新华社",
    url: "https://www2.xinhuanet.com/20260917/ab7d81ca4dad4f4196accb7cf92ee39e/c.html",
    units: 225,
    excerpt: "新华社墨尔本9月17日电 通讯｜“中国文化日”活动走进澳大利亚校园\n\n距离墨尔本一小时车程的吉朗学院是一所有着165年历史的老牌名校，也是与近代中国颇有渊源的澳大利亚人莫理循的母校。16日午休时分，几个身着汉服的女孩出现在古朴的校园里。学校的莫理循礼堂内，学生们有的在用毛笔写“福”字，有的在做纸灯笼，有的在专心致志地体验国风串珠。\n\n9月16日，在澳大利亚吉朗，“亲情中华·美丽四川”艺术团在“中国文化日”活动上表演变脸。\n\n时近下午2时，礼堂里逐渐坐满学生。随着汉服女孩们陆续走上舞台，由中国驻墨尔本总领馆带来的“中国文化日”表演开始了。",
  },
  {
    id: "art-communication-2-zh",
    domain: "communication",
    direction: "zh-to-en",
    title: "学习规划建议每日问答丨全面提升国际话语权需要把握哪些重点",
    source: "求是网",
    url: "http://qstheory.cn/20260114/db31d150cbb8428a9b25efbf10f5cdc4/c.html",
    units: 300,
    excerpt: "新华社北京1月13日电 《中共中央关于制定国民经济和社会发展第十五个五年规划的建议》提出“完善国际传播体制机制，创新传播载体和方式，加强重点基地建设，增强主流媒体国际传播能力，全面提升国际话语权，讲好中国故事，展现可信、可爱、可敬的中国形象”，并围绕“提升中华文明传播力影响力”作出一系列重要部署。传播力决定影响力，话语权决定主动权。党的十八大以来，我们大力推动国际传播守正创新，理顺内宣外宣体制，积极推动中华文化走出去，有效开展国际舆论引导和舆论斗争，中华民族凝聚力和中华文化影响力显著增强，国家软实力持续提高。但我国的对外文化传播还没有完全跟上综合国力的快速发展，中国在世界上的形象很大程度上仍是“他塑”而非“自塑”，争取国际话语权仍然是我们必须解决好的一个重大问题。",
  },
  {
    id: "art-communication-3-zh",
    domain: "communication",
    direction: "zh-to-en",
    title: "中亚“Z世代”走进中国夏都 开启高原人文生态交流之旅",
    source: "新华网",
    url: "http://www.qh.news.cn/20260917/284fbac8eded445296d16364a0f243d8/c.html",
    units: 278,
    excerpt: "新华网西宁9月17日电（鱼昊）17日，2026中亚“Z世代”走进中国夏都交流活动在青海省西宁市启动。来自中亚国家媒体代表、青年代表30人将在为期4天的活动中赴西宁市以及青海湖开展高原人文生态多元交流之约。\n\n9月17日，2026中亚“Z世代”走进中国夏都交流活动启动仪式现场。新华网 鱼昊 摄\n\n在本次活动中，中亚“Z世代”媒体及青年代表将参观西宁市城市展示中心，参访西宁野生动物园、青海藏文化博物院、西宁市非物质文化遗产馆及知名企业，通过体验掐丝工艺、剪纸技艺、香包制作等，感受“雪豹之都”生态之美、欣赏世界级唐卡绘制之奇、追寻河湟文化人文之韵，体验古老藏毯技艺与数字化智造深度融合。活动还将围绕“青年在丝绸之路经济带建设中的作用”等话题展开深入交流，凝聚中外青年合作共识。",
  },
]

/** 取某个「领域 × 方向」下的全部文章。没有就是空数组。 */
export function articlesOf(domain: ArticleDomain, direction: Direction): readonly ArticleExcerpt[] {
  return ARTICLE_EXCERPTS.filter((item) => item.domain === domain && item.direction === direction)
}

/** 按题号取一篇。 */
export function articleById(id: string): ArticleExcerpt | undefined {
  return ARTICLE_EXCERPTS.find((item) => item.id === id)
}

/**
 * 某个领域在某个方向下有没有文章。
 * 界面用它决定"方向切换"里哪一侧是可点的——没有文章的方向不该让人点进去看空白。
 */
export function hasArticles(domain: ArticleDomain, direction: Direction): boolean {
  return articlesOf(domain, direction).length > 0
}

/** 第一个有文章的「领域 × 方向」，用作界面首次打开时的落点。 */
export function firstAvailable(): { domain: ArticleDomain; direction: Direction } | null {
  const first = ARTICLE_EXCERPTS[0]
  if (!first) return null
  return { domain: first.domain, direction: first.direction }
}
