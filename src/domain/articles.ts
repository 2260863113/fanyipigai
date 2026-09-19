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
    units: 280,
    excerpt: "By continuing to browse our site you agree to our use of cookies, revised Privacy Policy and Terms of Use. You can change your cookie settings through your browser.\n\nChenxiong Village, Yongzhou, central China's Hunan Province, August 26, 2026. /VCG\n\nSenior officials from the Chinese government have pledged continued efforts to consolidate and expand the achievements of poverty alleviation and promote rural revitalization.\n\nThese officials, including Vice Premier Liu Guozhong and representatives from several ministries and relevant authorities, made the remarks on Wednesday at a meeting held during an ongoing session of the National People's Congress (NPC) Standing Committee.\n\nLawmakers deliberated a report on efforts to consolidate and expand achievements in poverty alleviation and advance all-around rural revitalization. They also launched a joint inquiry at the meeting, which was attended by Zhao Leji, chairman of the NPC Standing Committee.\n\nAt the meeting, lawmakers raised questions about improving basic pension insurance for urban and rural residents, sustaining poverty-relief industries and increasing incomes for people lifted out of poverty, as well as addressing the aging of the rural population, among other issues.\n\nLiu and the officials listened to the lawmakers' comments and addressed their questions.\n\nLiu said regular support should be incorporated into the rural revitalization strategy, with targeted monitoring and assistance to prevent a large-scale return to or emergence of poverty.\n\nHe also called for further development of rural industries, infrastructure and governance.\n\nPresiding over the meeting, Wu Weihua, vice chairman of the NPC Standing Committee, called on the State Council and relevant departments to study and address the suggestions raised by lawmakers, and submit a report on their follow-up actions to the NPC Standing Committee in accordance with the law.",
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
  },]

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
