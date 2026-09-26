/**
 * 术语库 · 必背用典（**自动生成，不要手改**）
 *
 * 来源：`handbook-src/` 里整理好的《理解当代中国 核心术语学习手册》条目
 * （第三部分「用典阐释」，7 个块，PDF 第 111–166 页），
 * 而手册是**扫描件**（没有文字层），最上游是 Windows OCR——
 * 英文里必然残留识别错误，整理者在各块的 `notes` 里逐处登记了订正，这里不再改动。
 * 生成命令：node scripts/build-handbook-terms.mjs --write
 *
 * 80 条，每 20 条一组，共 4 组（末组 20 条）：
 *   必背用典|第1组（1-20） … 必背用典|第4组（61-80）；每组都是 20 条
 *
 * 每条：`zh` 中文（照手册原样，含句末标点）、`en` 手册给的英文译法（一条术语多条时取第一条）、
 * `enAlt` 一并算对的其它写法（该条的其它译法 + 去掉末尾句号的写法）、
 * `zhAlt` 英译中方向同样算对的其它中文写法（去掉末尾句号的写法）。
 * ⚠️ **末尾句号写不写都算对**是照 `terms.ts` 的放宽口径给的（见那个文件头），
 * 不是同义替换放宽；屏幕上的标准答案仍是带标点的原样。
 */

import type { Term } from '../terms'

export const CLASSICS_TERMS: readonly Term[] = [
  {
    zh: "爱人利物之谓仁",
    en: "Compassion means loving and helping others.",
    enAlt: ["Compassion means loving and helping others"],
    zhAlt: [],
  },
  {
    zh: "不困在于早虑，不穷在于早豫。",
    en: "Prior planning prevents pitfalls and proper preparation preempts perils.",
    enAlt: ["Prior planning prevents pitfalls and proper preparation preempts perils"],
    zhAlt: ["不困在于早虑，不穷在于早豫"],
  },
  {
    zh: "不私，而天下自公。",
    en: "Selflessness in governance creates social equity.",
    enAlt: ["Selflessness in governance creates social equity"],
    zhAlt: ["不私，而天下自公"],
  },
  {
    zh: "不畏浮云遮望眼",
    en: "to be unperturbed by the cloud vision",
    enAlt: [],
    zhAlt: [],
  },
  {
    zh: "不要人夸颜色好，只留清气满乾坤。",
    en: "Not bent on praise for its bright colors, but on leaving its fragrance to all.",
    enAlt: ["Not bent on praise for its bright colors, but on leaving its fragrance to all"],
    zhAlt: ["不要人夸颜色好，只留清气满乾坤"],
  },
  {
    zh: "草木植成，国之富也。",
    en: "Vegetation is a valuable asset of a country.",
    enAlt: ["Vegetation is a valuable asset of a country"],
    zhAlt: ["草木植成，国之富也"],
  },
  {
    zh: "迟日江山丽，春风花草香。",
    en: "The land bathes in the spring sunshine, and the wind sends the aromas of grass and flowers.",
    enAlt: ["The land bathes in the spring sunshine, and the wind sends the aromas of grass and flowers"],
    zhAlt: ["迟日江山丽，春风花草香"],
  },
  {
    zh: "淡泊明志、宁静致远",
    en: "Indifference to fame and fortune characterizes a high aim in life, and leading a quiet life helps one reach afar.",
    enAlt: ["Indifference to fame and fortune characterizes a high aim in life, and leading a quiet life helps one reach afar"],
    zhAlt: [],
  },
  {
    zh: "道法自然",
    en: "Dao operates naturally.",
    enAlt: ["Dao operates naturally"],
    zhAlt: [],
  },
  {
    zh: "登高使人心旷，临流使人意远。",
    en: "From a mountain top you will enjoy a broader outlook; down by the riverside you will enjoy a pleasant prospect.",
    enAlt: ["From a mountain top you will enjoy a broader outlook; down by the riverside you will enjoy a pleasant prospect"],
    zhAlt: ["登高使人心旷，临流使人意远"],
  },
  {
    zh: "法不阿贵",
    en: "The law does not favor the rich and powerful.",
    enAlt: ["The law does not favor the rich and powerful"],
    zhAlt: [],
  },
  {
    zh: "法与时转则治",
    en: "The law must be adaptive to the changing times, so that social order and stability are maintained.",
    enAlt: ["The law must be adaptive to the changing times, so that social order and stability are maintained"],
    zhAlt: [],
  },
  {
    zh: "格物致知",
    en: "to study the nature of things to acquire knowledge",
    enAlt: [],
    zhAlt: [],
  },
  {
    zh: "公生明，廉生威。",
    en: "Justice breeds trust, and honesty fosters credibility.",
    enAlt: ["Fairness fosters discernment, and integrity creates authority.","Justice breeds trust, and honesty fosters credibility","Fairness fosters discernment, and integrity creates authority"],
    zhAlt: ["公生明，廉生威"],
  },
  {
    zh: "功以才成，业由才广。",
    en: "Feats are accomplished by capable people; work develops because of achievers.",
    enAlt: ["Feats are accomplished by capable people; work develops because of achievers"],
    zhAlt: ["功以才成，业由才广"],
  },
  {
    zh: "苟日新，日日新，又日新。",
    en: "If you can in one day renovate yourself, do so from day to day. Yea, let there be daily renovation.",
    enAlt: ["If you can in one day renovate yourself, do so from day to day. Yea, let there be daily renovation"],
    zhAlt: ["苟日新，日日新，又日新"],
  },
  {
    zh: "国虽大，好战必亡。",
    en: "A warlike state, however big it may be, will eventually perish.",
    enAlt: ["A warlike state, however big it may be, will eventually perish"],
    zhAlt: ["国虽大，好战必亡"],
  },
  {
    zh: "国泰民安",
    en: "The country enjoys prosperity, and the people live in peace.",
    enAlt: ["a stable country and peaceful people","The country enjoys prosperity, and the people live in peace"],
    zhAlt: [],
  },
  {
    zh: "国之称富者，在乎丰民。",
    en: "A country is truly prosperous only when its people are prosperous.",
    enAlt: ["A country is truly prosperous only when its people are prosperous"],
    zhAlt: ["国之称富者，在乎丰民"],
  },
  {
    zh: "合天下之众者财，理天下之财者法。",
    en: "It is wealth that binds the people of a country together, and it is the law that governs the wealth of a country.",
    enAlt: ["It is wealth that binds the people of a country together, and it is the law that governs the wealth of a country"],
    zhAlt: ["合天下之众者财，理天下之财者法"],
  },
  {
    zh: "和而不同",
    en: "harmony without uniformity",
    enAlt: ["to promote harmony and respect for differences"],
    zhAlt: [],
  },
  {
    zh: "厚德载物",
    en: "to embrace higher virtues and ethics",
    enAlt: ["to embrace the world with virtue","to have ample virtue and carry all things"],
    zhAlt: [],
  },
  {
    zh: "厚积薄发",
    en: "Only by learning extensively and accumulating profound knowledge can one be ready to achieve something.",
    enAlt: ["to build up fully and release sparingly","Only by learning extensively and accumulating profound knowledge can one be ready to achieve something"],
    zhAlt: [],
  },
  {
    zh: "化干戈为玉帛",
    en: "to turn hostility into amity",
    enAlt: ["to beat swords into plowshares","to turn war into peace"],
    zhAlt: [],
  },
  {
    zh: "祸几始作，当杜其萌；疾证方形，当绝其根。",
    en: "We must nip troubles in the bud and eliminate illnesses at their earliest stage.",
    enAlt: ["We must nip troubles in the bud and eliminate illnesses at their earliest stage"],
    zhAlt: ["祸几始作，当杜其萌；疾证方形，当绝其根"],
  },
  {
    zh: "机者如神，难遇易失。",
    en: "Opportunities are rare and hard to grasp, and easy to lose.",
    enAlt: ["Opportunities are rare and hard to grasp, and easy to lose"],
    zhAlt: ["机者如神，难遇易失"],
  },
  {
    zh: "集思广益",
    en: "to draw on collective wisdom",
    enAlt: ["to pool wisdom of the people"],
    zhAlt: [],
  },
  {
    zh: "己所不欲，勿施于人。",
    en: "Do not do to others what we would not have done to ourselves.",
    enAlt: ["Do not do to others what you do not want others to do to you.","Do not do to others what we would not have done to ourselves","Do not do to others what you do not want others to do to you"],
    zhAlt: ["己所不欲，勿施于人"],
  },
  {
    zh: "兼爱",
    en: "universal love",
    enAlt: [],
    zhAlt: [],
  },
  {
    zh: "见出以知入，观往以知来。",
    en: "One can tell the inside of a thing by observing its outside and see future developments by reviewing the past.",
    enAlt: ["One can tell the inside of a thing by observing its outside and see future developments by reviewing the past"],
    zhAlt: ["见出以知入，观往以知来"],
  },
  {
    zh: "见贤思齐",
    en: "a learning spirit featuring humility",
    enAlt: ["When seeing a person of high caliber, strive to be his equal.","When seeing a person of high caliber, strive to be his equal"],
    zhAlt: [],
  },
  {
    zh: "讲信修睦",
    en: "to build trust and good-neighborly ties",
    enAlt: ["to act in good faith and be friendly to others","to keep good faith and pursue harmony"],
    zhAlt: [],
  },
  {
    zh: "经世致用",
    en: "Study should be of substantive practical value.",
    enAlt: ["practical knowledge of managing state affairs","Study of ancient classics should meet present needs.","Study should be of substantive practical value","Study of ancient classics should meet present needs"],
    zhAlt: [],
  },
  {
    zh: "理辩则气直，气直则辞盛，辞盛则文工。",
    en: "A good and well-constructed argument makes one feel upright and righteous; only by feeling upright and righteous can one be eloquent and articulate; only with articulate eloquence can one create well-structured and meaningful writing.",
    enAlt: ["A good and well-constructed argument makes one feel upright and righteous; only by feeling upright and righteous can one be eloquent and articulate; only with articulate eloquence can one create well-structured and meaningful writing"],
    zhAlt: ["理辩则气直，气直则辞盛，辞盛则文工"],
  },
  {
    zh: "立善法于天下，则天下治；立善法于一国，则一国治。",
    en: "If good laws are established under heaven, then there will be order under heaven; if good laws are established in a state, then there will be order in that state.",
    enAlt: ["If good laws are established under heaven, then there will be order under heaven; if good laws are established in a state, then there will be order in that state"],
    zhAlt: ["立善法于天下，则天下治；立善法于一国，则一国治"],
  },
  {
    zh: "立文之道，惟字与义。",
    en: "Writing is about expressing ideas through the optimal use of words.",
    enAlt: ["Writing is about expressing ideas through the optimal use of words"],
    zhAlt: ["立文之道，惟字与义"],
  },
  {
    zh: "靡不有初，鲜克有终。",
    en: "After making a good start, we should ensure that the cause achieves fruition.",
    enAlt: ["All things have a beginning, but few can reach the end.","After making a good start, we should ensure that the cause achieves fruition","All things have a beginning, but few can reach the end"],
    zhAlt: ["靡不有初，鲜克有终"],
  },
  {
    zh: "民惟邦本",
    en: "The people are the foundation of a state.",
    enAlt: ["The people are the foundation of a state"],
    zhAlt: [],
  },
  {
    zh: "明者因时而变，知者随世而制。",
    en: "A smart man changes his approach as circumstances change; a wise person alters his means as times evolve.",
    enAlt: ["A smart man changes his approach as circumstances change; a wise person alters his means as times evolve"],
    zhAlt: ["明者因时而变，知者随世而制"],
  },
  {
    zh: "能用众力，则无敌于天下矣；能用众智，则无畏于圣人矣。",
    en: "If you can employ the strength of the people, you will be invincible under heaven; if you can employ the wisdom of the people, no sage will be cleverer than you.",
    enAlt: ["If you can employ the strength of the people, you will be invincible under heaven; if you can employ the wisdom of the people, no sage will be cleverer than you"],
    zhAlt: ["能用众力，则无敌于天下矣；能用众智，则无畏于圣人矣"],
  },
  {
    zh: "农，天下之本，务莫大焉。",
    en: "Agriculture is the foundation of a country and the top priority in governance.",
    enAlt: ["Agriculture is the foundation of a country and the top priority in governance"],
    zhAlt: ["农，天下之本，务莫大焉"],
  },
  {
    zh: "务农重本，国之大纲。",
    en: "Attaching importance to agricultural development is the fundamental plan of the country.",
    enAlt: ["Attaching importance to agricultural development is the fundamental plan of the country"],
    zhAlt: ["务农重本，国之大纲"],
  },
  {
    zh: "亲仁善邻",
    en: "to value amity and friendship with neighbors",
    enAlt: ["to be benevolent and friendly toward neighboring countries/states","to pursue amity and good neighborliness","to be benevolent and friendly toward neighboring countries","to be benevolent and friendly toward neighboring states"],
    zhAlt: [],
  },
  {
    zh: "穷理以致其知，反躬以践其实。",
    en: "One studies everything to obtain knowledge, and proves it in practice.",
    enAlt: ["One studies everything to obtain knowledge, and proves it in practice"],
    zhAlt: ["穷理以致其知，反躬以践其实"],
  },
  {
    zh: "穷则变，变则通，通则久。",
    en: "Limits lead to changes; changes lead to solutions; solutions lead to development.",
    enAlt: ["Extreme-Change-Continuity","When things reach their extreme, change occurs. After the change they evolve smoothly, and thus they continue for a long time.","Limits lead to changes; changes lead to solutions; solutions lead to development","When things reach their extreme, change occurs. After the change they evolve smoothly, and thus they continue for a long time"],
    zhAlt: ["穷则变，变则通，通则久"],
  },
  {
    zh: "求同存异",
    en: "to seek common ground while shelving differences",
    enAlt: ["to expand common ground while shelving differences"],
    zhAlt: [],
  },
  {
    zh: "取之有制、用之有节则裕，取之无制、用之不节则乏。",
    en: "Utilized with restraint, resources will be abundant; otherwise, they will be scarce.",
    enAlt: ["Utilized with restraint, resources will be abundant; otherwise, they will be scarce"],
    zhAlt: ["取之有制、用之有节则裕，取之无制、用之不节则乏"],
  },
  {
    zh: "三省吾身",
    en: "to reflect on oneself several times a day",
    enAlt: [],
    zhAlt: [],
  },
  {
    zh: "上善若水",
    en: "The great virtue is like water.",
    enAlt: ["The great virtue is like water"],
    zhAlt: [],
  },
  {
    zh: "上下同欲者胜",
    en: "Success comes to those who share in one purpose.",
    enAlt: ["Triumph comes when leaders and followers share the same goal.","Success comes to those who share in one purpose","Triumph comes when leaders and followers share the same goal"],
    zhAlt: [],
  },
  {
    zh: "慎易以避难，敬细以远大。",
    en: "We should manage the small and simple things with care so as to avoid difficulties and disasters.",
    enAlt: ["We should manage the small and simple things with care so as to avoid difficulties and disasters"],
    zhAlt: ["慎易以避难，敬细以远大"],
  },
  {
    zh: "胜非其难也，持之者其难也。",
    en: "The most difficult part of victory is not the winning, but the sustaining.",
    enAlt: ["The most difficult part of victory is not the winning, but the sustaining"],
    zhAlt: ["胜非其难也，持之者其难也"],
  },
  {
    zh: "四海之内皆兄弟",
    en: "All the people within the Four Seas are brothers.",
    enAlt: ["All the people within the Four Seas are brothers"],
    zhAlt: [],
  },
  {
    zh: "他山之石，可以攻玉。",
    en: "A stone taken from another mountain may serve as a tool to polish the local jade.",
    enAlt: ["to use stones from another mountain to polish one's jade","A stone taken from another mountain may serve as a tool to polish the local jade"],
    zhAlt: ["他山之石，可以攻玉"],
  },
  {
    zh: "天不言而四时行，地不语而百物生。",
    en: "Heaven and earth do not speak, yet the seasons change and all things grow.",
    enAlt: ["Heaven and earth do not speak, yet the seasons change and all things grow"],
    zhAlt: ["天不言而四时行，地不语而百物生"],
  },
  {
    zh: "天地之大，黎元为本。",
    en: "In a country, the people are the most important.",
    enAlt: ["In a country, the people are the most important"],
    zhAlt: ["天地之大，黎元为本"],
  },
  {
    zh: "天人合一",
    en: "to promote harmony between humanity and nature",
    enAlt: ["harmony between humanity and nature","Heaven and man are united as one.","Heaven and man are united as one"],
    zhAlt: [],
  },
  {
    zh: "天下为公",
    en: "to put one's interests aside for the common good",
    enAlt: ["to common good for all","The world belongs to all.","The world belongs to all"],
    zhAlt: [],
  },
  {
    zh: "天下兴亡、匹夫有责",
    en: "Survival of a nation is the responsibility of every individual.",
    enAlt: ["to fulfill one's duties to secure the future of the nation","Survival of a nation is the responsibility of every individual"],
    zhAlt: [],
  },
  {
    zh: "天行健，君子以自强不息。",
    en: "Just heaven maintains vigor through movement, a gentleman makes unremitting efforts to perfect himself.",
    enAlt: ["Just heaven maintains vigor through movement, a gentleman makes unremitting efforts to perfect himself"],
    zhAlt: ["天行健，君子以自强不息"],
  },
  {
    zh: "天行有常",
    en: "Nature's ways are constant.",
    enAlt: ["Nature's ways are constant"],
    zhAlt: [],
  },
  {
    zh: "为世用者，百篇无害；不为用者，一章无补。",
    en: "Writings, if useful to society, are never enough even if there are more than a hundred of them; while if useless, one single page is far too many.",
    enAlt: ["Writings, if useful to society, are never enough even if there are more than a hundred of them; while if useless, one single page is far too many"],
    zhAlt: ["为世用者，百篇无害；不为用者，一章无补"],
  },
  {
    zh: "为政以德",
    en: "governance by means of virtue",
    enAlt: ["governance based on virtue","to uphold integrity and clear governance"],
    zhAlt: [],
  },
  {
    zh: "为政之要，以顺民心为本。",
    en: "Conforming to the will of the people is the key to governance.",
    enAlt: ["Conforming to the will of the people is the key to governance"],
    zhAlt: ["为政之要，以顺民心为本"],
  },
  {
    zh: "行之力则知愈进，知之深则行愈达。",
    en: "Practice improves understanding and a deeper understanding guides further practice.",
    enAlt: ["Practice improves understanding and a deeper understanding guides further practice"],
    zhAlt: ["行之力则知愈进，知之深则行愈达"],
  },
  {
    zh: "休养生息",
    en: "to allow the natural ecosystems to recover and regenerate themselves",
    enAlt: ["to develop economy and increase population","to recover from a social upheaval and restore production"],
    zhAlt: [],
  },
  {
    zh: "学如弓弩，才如箭镞。",
    en: "Learning is the bow, while competence is the arrow.",
    enAlt: ["Learning is the bow, while competence is the arrow"],
    zhAlt: ["学如弓弩，才如箭镞"],
  },
  {
    zh: "言传身教",
    en: "to instruct someone through words and actions",
    enAlt: [],
    zhAlt: [],
  },
  {
    zh: "宜将剩勇追穷寇，不可沽名学霸王。",
    en: "One should chase down the last remnant of the enemy till the whole land was liberated, rather than giving up halfway.",
    enAlt: ["One should chase down the last remnant of the enemy till the whole land was liberated, rather than giving up halfway"],
    zhAlt: ["宜将剩勇追穷寇，不可沽名学霸王"],
  },
  {
    zh: "因材施教",
    en: "to take different approaches according to the audience",
    enAlt: ["audience-based education"],
    zhAlt: [],
  },
  {
    zh: "与天下同利者，天下持之；擅天下之利者，天下谋之。",
    en: "A sovereign who shares the interests of the people will have their support; a sovereign who denies the interests of the people will provoke their opposition.",
    enAlt: ["A sovereign who shares the interests of the people will have their support; a sovereign who denies the interests of the people will provoke their opposition"],
    zhAlt: ["与天下同利者，天下持之；擅天下之利者，天下谋之"],
  },
  {
    zh: "栽下梧桐树，引来金凤凰。",
    en: "A tall and luxuriant Chinese parasol tree attracts golden phoenixes.",
    enAlt: ["A tall and luxuriant Chinese parasol tree attracts golden phoenixes"],
    zhAlt: ["栽下梧桐树，引来金凤凰"],
  },
  {
    zh: "载舟覆舟",
    en: "The same water that keeps a ship afloat can also sink it.",
    enAlt: ["to carry or overturn the boat","The same water that keeps a ship afloat can also sink it"],
    zhAlt: [],
  },
  {
    zh: "知耻而后勇",
    en: "to have the courage to correct the shortcomings",
    enAlt: ["Having a feeling of shame gives to courage.","Having a feeling of shame gives to courage"],
    zhAlt: [],
  },
  {
    zh: "知行合一",
    en: "Knowledge and action should go hand in hand.",
    enAlt: ["unity of knowing and doing","unity of and action","Knowledge and action should go hand in hand"],
    zhAlt: [],
  },
  {
    zh: "志不强者智不达，言不信者行不果。",
    en: "The weak-minded cannot be wise; the dishonest cannot succeed.",
    enAlt: ["The weak-minded cannot be wise; the dishonest cannot succeed"],
    zhAlt: ["志不强者智不达，言不信者行不果"],
  },
  {
    zh: "志高则言洁，志大则辞弘，志远则旨永。",
    en: "A cultivated person of noble and lofty aspirations can produce succinct and vigorous expressions of profound thoughts.",
    enAlt: ["A cultivated person of noble and lofty aspirations can produce succinct and vigorous expressions of profound thoughts"],
    zhAlt: ["志高则言洁，志大则辞弘，志远则旨永"],
  },
  {
    zh: "志之难也，不在胜人，在自胜。",
    en: "The key to achieving your aspirations lies not in overcoming others but in overcoming your own weaknesses.",
    enAlt: ["The key to achieving your aspirations lies not in overcoming others but in overcoming your own weaknesses"],
    zhAlt: ["志之难也，不在胜人，在自胜"],
  },
  {
    zh: "治国之道，富民为始。",
    en: "The key to running a country is to first enrich the people.",
    enAlt: ["The key to running a country is to first enrich the people"],
    zhAlt: ["治国之道，富民为始"],
  },
  {
    zh: "治天下也，必先公，公则天下平矣。",
    en: "To govern the country, the priority is to realize equality, and then stability will follow.",
    enAlt: ["To govern the country, the priority is to realize equality, and then stability will follow"],
    zhAlt: ["治天下也，必先公，公则天下平矣"],
  },
]
