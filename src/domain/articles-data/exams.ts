/**
 * 文章库 · 真题与样题（**自动生成，不要手改**）。
 *
 * 生成命令：node scripts/build-exams.mjs --write
 * 材料：仓库里的 `exams-src/*.json`——从「国才杯」笔译历年真题与官方样题里**人工整理**出来的
 *      原文与官方参考译文（卷头、题号、答题框、评分标准都剔除了；这一步没法机械化，
 *      因此材料以 json 的形式进仓库，可复核、可重算）。
 *      原始文件来自：桌面\下载\【2026】外研社（国才杯）笔译赛项\【2023-2026】笔译历年真题（校赛、初赛、省赛）
 *      与同级的\【2023-2026】笔译（官方）样题，每篇的 `title` 末尾都写着它的来源文件。
 *
 * 每篇的字段见 domain/articles.ts 的 Article。四条约定与文章库一致：
 *   1. 正文与参考译文都是**全文**，段落之间留一个空行；两边段数**完全一致**（脚本强校验）。
 *   2. **原文逐字照录**，不改写不润色；抽取造成的错字订正记在 exams-src 的 notes 里。
 *   3. **参考译文只来自官方答案**，没有答案的篇目 reference 是空串——绝不自己翻译。
 *   4. `units` 与文章库同一套口径：英译中数词，中译英数非空白字符。
 */

import type { Article } from '../articles'

export const EXAM_ARTICLES: readonly Article[] = [
  {
    id: "art-past-paper-zh-to-en-1",
    domain: "past-paper",
    direction: "zh-to-en",
    batch: 1,
    title: "2023 国才杯笔译真题：汉译英（语篇一，关于端午节习俗与传统节日文化的传承）｜来源：【2023】国才杯笔译真题/2023外研社国才杯笔译真题.docx",
    units: 228,
    text: "又是一年端阳至，人们吃粽子、饮雄黄、插艾草、戴香囊、划龙舟、荡秋千，在丰富多彩的活动中品读传统文化、过好传统佳节。作为率先入选联合国教科文组织非物质文化遗产名录的中国传统节日，端午节承载着多样且厚重的传统文化，需要进一步挖掘。除了参与体验端午节日的仪式感，更重要的是，要讲好传统节日故事。一些地方通过开展端午诗会、专题展览、读书分享会等活动，借助动漫、情景剧、纪录片等形式，培育天人合一的自然观、除秽驱病的健康观，已成为传承发扬传统节日文化精髓的创新途径。",
    reference: "The Dragon Boat Festival has arrived. Eating zongzi, drinking xionghuang wine, hanging mugwort leaves, wearing perfume pouches, enjoying dragon boat races and swings—the Chinese people are celebrating this traditional festival by immersing themselves in various traditional cultural activities. As the first traditional Chinese festival to be inscribed on the List of Intangible Cultural Heritage by UNESCO, the Dragon Boat Festival is representative of China's diverse and profound traditional culture that calls for further promotion. In addition to experiencing the ceremonial aspects of the Dragon Boat Festival, it is also important for us to tell the stories of the traditional festival well. To this end, some cities are holding events such as poetry recitals, theme exhibitions, and book readings; artists are also telling stories by means of animation, sitcoms and documentaries. These efforts advocate harmony between humans and nature and raise awareness for preventing disease and maintaining health. They are creative means to pass on and promote the cultural essence of traditional festivals.",
  },
  {
    id: "art-past-paper-zh-to-en-2",
    domain: "past-paper",
    direction: "zh-to-en",
    batch: 2,
    title: "2023 国才杯笔译真题：汉译英（语篇二，关于 2023 年前 4 个月我国外贸进出口形势）｜来源：【2023】国才杯笔译真题/2023外研社国才杯笔译真题.docx",
    units: 293,
    text: "海关总署发布的数据显示，2023年前4个月，我国进出口总值13.32万亿元，同比增长5.8%，进出口延续了向好态势。外贸进出口展现出较强韧性，为全年实现外贸促稳提质打下了基础。值得一提的是，今年前4个月，有进出口实绩的民营企业数量同比增加了8.9%，为拓宽就业渠道、稳定就业大盘发挥了积极作用。\n\n外贸平稳向好，得益于我国产业链水平不断提升。高技术、高附加值、引领绿色转型的产品领跑出口，表明我国外贸新动能不断培育壮大，更折射出供给侧结构性改革下，中国制造业迈向高端化、智能化、绿色化的坚实足迹。依靠科技创新与低碳转型，“中国制造”不断塑造和积累国际竞争新优势，中国经济高质量发展活力强劲。",
    reference: "According to data released by the General Administration of Customs, China’s import and export value reached 13.32 trillion yuan in the first four months of 2023, showing a year-on-year increase of 5.8%. This steady growth in imports and exports reflects the resilience of China’s foreign trade and lays a solid foundation for stabilizing and improving its quality throughout the year. Notably, the number of private enterprises with tangible import and export results increased by 8.9% compared to the same period last year, contributing to the expansion of employment opportunities and the stability of the job market.\n\nThe steady improvement in foreign trade can be attributed to the continuous development of China’s industrial chain. Leading the export market with high-tech, high-added-value, and green transformation-driven products signifies the ongoing cultivation and growth of China’s foreign trade. It also reflects the firm steps taken by China’s manufacturing industry towards high-end, smarter, and greener production under the supply-side structural reform. Through scientific and technological innovation and low-carbon transition, “Made in China” is constantly shaping and accumulating new advantages in international competition, thereby providing strong impetus for the high-quality development of China’s economy.",
  },
]
