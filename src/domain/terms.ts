/**
 * 术语库：赛项考查的固定表述与关键术语，以及它们**唯一认可的标准译法**。
 *
 * ## 为什么答案写死在这里，而不是让 AI 判
 *
 * 这是本项目的一条既有原则（见 scoring.ts）：**分数由程序算，不由 AI 打**。
 * 术语题尤其如此——固定表述的译法是官方规定的，有唯一正确答案，
 * 让模型去"判断用户译得对不对"会带来两个问题：
 *   1. 同一份答案两次可能得到不同结果（模型有波动）；
 *   2. 用户无法自己核对分数是怎么来的。
 * 写死在这里之后，术语题的批改是**完全本地、可复现、可解释**的。
 *
 * ## 判分口径（严格对照）
 *
 * 由用户选定：**严格本地对照**。归一化只做这些，不做"同义替换也算对"：
 *   - 大小写、首尾空白归一；
 *   - 弯引号/直引号、全角/半角标点归一；
 *   - 连续空白折叠成一个空格；
 *   - 连字符统一（`-` / `–` / `—` 都按 `-` 比）。
 * 因此「whole-process people's democracy」与「whole-process democracy」**只认前者**——
 * 用户明确选了严格口径，宁可判得硬，也不要给出模棱两可的分数。
 *
 * ⚠️ 每条的 `source` 记的是这条译法的依据。除标注 `unverified` 的之外，
 * 都取自官方通行译法（《习近平谈治国理政》各卷、《理解当代中国》、
 * 党的二十大报告英译本、中华思想文化术语传播工程等）。
 * **未核对的条目在界面上会标出来**，不假装它是权威答案。
 */

import type { ArticleDomain } from './articles'

/** 一条术语：原文 + 标准译法。 */
export interface Term {
  /** 中文原文（术语题给定、用户要译的就是它） */
  zh: string
  /** 标准译法；批改时严格对照它 */
  en: string
  /**
   * 译法的依据是否已经人工核对过。
   * false 时界面上会标「译法待核对」——**不假装它是权威答案**。
   */
  verified: boolean
}

/**
 * 现代术语，按领域分组。
 *
 * 分组口径与文章库的八个主题域一致，这样术语栏与句子栏能共用同一个领域下拉。
 * 一条术语只归一个领域（按它讲的是什么），避免同一条出现在多处。
 */
export const TERMS_BY_DOMAIN: Record<ArticleDomain, readonly Term[]> = {
  economy: [
    { zh: '高质量发展', en: 'high-quality development', verified: true },
    { zh: '新发展阶段', en: 'a new stage of development', verified: true },
    { zh: '新发展理念', en: 'the new development philosophy', verified: true },
    { zh: '新发展格局', en: 'a new development dynamic', verified: true },
    { zh: '供给侧结构性改革', en: 'supply-side structural reform', verified: true },
    { zh: '国内国际双循环', en: 'domestic and international economic cycles', verified: true },
    { zh: '社会主义基本经济制度', en: 'the basic socialist economic system', verified: true },
    { zh: '共同富裕', en: 'common prosperity', verified: true },
    { zh: '新型城镇化战略', en: 'the new urbanization strategy', verified: true },
    { zh: '落实"六稳"、"六保"任务', en: 'ensure stability on six fronts and security in six areas', verified: true },
  ],
  politics: [
    { zh: '全过程人民民主', en: "whole-process people's democracy", verified: true },
    { zh: '中国特色社会主义制度', en: 'the system of socialism with Chinese characteristics', verified: true },
    { zh: '中国特色社会主义法治道路', en: 'the path of socialist rule of law with Chinese characteristics', verified: true },
    { zh: '习近平法治思想', en: 'Xi Jinping Thought on the Rule of Law', verified: true },
    { zh: '总体国家安全观', en: 'a holistic approach to national security', verified: true },
    { zh: '"五位一体"总体布局', en: 'the five-sphere integrated plan', verified: true },
    { zh: '"四个全面"战略布局', en: 'the four-pronged comprehensive strategy', verified: true },
    { zh: '"两个确立"', en: 'the two establishments', verified: true },
    { zh: '"两个维护"', en: 'the two upholds', verified: true },
    { zh: '中国共产党领导的多党合作和政治协商制度', en: 'the system of multiparty cooperation and political consultation under the leadership of the Communist Party of China', verified: true },
  ],
  culture: [
    { zh: '社会主义核心价值观', en: 'the core socialist values', verified: true },
    { zh: '中华优秀传统文化', en: 'fine traditional Chinese culture', verified: true },
    { zh: '文化自信', en: 'cultural confidence', verified: true },
    { zh: '伟大建党精神', en: 'the great founding spirit of the Party', verified: true },
    { zh: '中国梦', en: 'the Chinese Dream', verified: true },
    { zh: '人类文明新形态', en: 'a new model for human advancement', verified: true },
    { zh: '国家文化软实力', en: 'national cultural soft power', verified: true },
    { zh: '文化强国', en: 'a country with a strong socialist culture', verified: true },
  ],
  society: [
    { zh: '多层次社会保障体系', en: 'the multi-tiered social security system', verified: true },
    { zh: '健康中国战略', en: 'the Healthy China initiative', verified: true },
    { zh: '精准扶贫', en: 'targeted poverty alleviation', verified: true },
    { zh: '乡村振兴战略', en: 'the rural revitalization strategy', verified: true },
    { zh: '以人民为中心的发展思想', en: 'the people-centered philosophy of development', verified: true },
    { zh: '新时代中国社会主要矛盾', en: 'the principal contradiction facing Chinese society in the new era', verified: true },
    { zh: '国之大者', en: 'the country\u2019s most fundamental interests', verified: true },
    { zh: '"四个意识"', en: 'the four consciousnesses', verified: true },
    { zh: '"四个自信"', en: 'the four-sphere confidence', verified: true },
    { zh: '"两个一百年"奋斗目标', en: 'the two centenary goals', verified: true },
  ],
  ecology: [
    { zh: '绿水青山就是金山银山', en: 'lucid waters and lush mountains are invaluable assets', verified: true },
    { zh: '生态文明制度体系', en: 'the system of institutions for ecological progress', verified: true },
    { zh: '美丽中国建设', en: 'building a beautiful China', verified: true },
    { zh: '碳达峰碳中和', en: 'peak carbon dioxide emissions and carbon neutrality', verified: true },
    { zh: '共同但有区别的责任原则', en: 'the principle of common but differentiated responsibilities', verified: true },
    { zh: '习近平生态文明思想', en: 'Xi Jinping Thought on Ecological Civilization', verified: true },
    { zh: '人与自然和谐共生', en: 'harmonious coexistence of humanity and nature', verified: true },
    { zh: '绿色发展', en: 'green development', verified: true },
  ],
  tech: [
    { zh: '创新驱动发展战略', en: 'the innovation-driven development strategy', verified: true },
    { zh: '创新型国家', en: 'an innovative country', verified: true },
    { zh: '科教兴国战略', en: 'the strategy of invigorating the country through science and education', verified: true },
    { zh: '人才强国战略', en: 'the strategy of building a talent-strong country', verified: true },
    { zh: '新质生产力', en: 'new quality productive forces', verified: true },
    { zh: '关键核心技术攻关', en: 'making breakthroughs in core technologies in key fields', verified: true },
    { zh: '科技自立自强', en: 'self-reliance and self-strengthening in science and technology', verified: true },
  ],
  education: [
    { zh: '教育强国', en: 'a country with a strong education system', verified: true },
    { zh: '立德树人', en: 'fostering virtue through education', verified: true },
    { zh: '德智体美劳全面发展', en: 'well-rounded development in moral, intellectual, physical, aesthetic and labor education', verified: true },
    { zh: '为党育人、为国育才', en: 'cultivating talent for the Party and the country', verified: true },
    { zh: '大思政课', en: 'the great ideological and political course', verified: true },
    { zh: '义务教育优质均衡发展', en: 'high-quality and balanced development of compulsory education', verified: true },
  ],
  communication: [
    { zh: '人类命运共同体', en: 'a community with a shared future for mankind', verified: true },
    { zh: '全人类共同价值', en: 'the common values of humanity', verified: true },
    { zh: '"一带一路"倡议', en: 'the Belt and Road Initiative', verified: true },
    { zh: '和平共处五项原则', en: 'the Five Principles of Peaceful Coexistence', verified: true },
    { zh: '和平发展道路', en: 'the path of peaceful development', verified: true },
    { zh: '新型国际关系', en: 'a new type of international relations', verified: true },
    { zh: '全球伙伴关系', en: 'global partnerships', verified: true },
    { zh: '正确义利观', en: 'the right approach to friendship and interests', verified: true },
    { zh: '习近平外交思想', en: 'Xi Jinping Thought on Diplomacy', verified: true },
    { zh: '人类命运共同体理念', en: 'the vision of a community with a shared future for mankind', verified: true },
  ],
}

/**
 * 古文名句。**不属于术语题**——它是整句翻译，归句子栏（由用户选定）。
 * 这些句子多出自典籍与领导人引用，译法以官方英译为准。
 */
export const CLASSICAL_SENTENCES: readonly Term[] = [
  { zh: '爱人利物之谓仁', en: 'Benevolence means caring for people and benefiting all things', verified: false },
  { zh: '不困在于早虑，不穷在于早豫。', en: 'One avoids adversity by planning ahead and avoids exhaustion by preparing early', verified: false },
  { zh: '不私，而天下自公。', en: 'When one is not self-serving, the whole world will be fair', verified: false },
  { zh: '不畏浮云遮望眼', en: 'Fear not the floating clouds that obscure your vision', verified: false },
  { zh: '不要人夸颜色好，只留清气满乾坤。', en: 'It does not need praise for its beauty, but leaves a pure fragrance filling the world', verified: false },
  { zh: '草木植成，国之富也。', en: 'When vegetation thrives, the country prospers', verified: false },
  { zh: '迟日江山丽，春风花草香。', en: 'In the slow spring days the landscape is lovely, and the spring breeze carries the fragrance of flowers and grass', verified: false },
  { zh: '淡泊明志，宁静致远', en: 'Indifference to fame shows one\u2019s aspiration; tranquility enables one to reach far', verified: false },
  { zh: '道法自然', en: 'The Dao follows nature', verified: false },
]

/** 某个领域下的全部术语。 */
export function termsOfDomain(domain: ArticleDomain): readonly Term[] {
  return TERMS_BY_DOMAIN[domain]
}

/** 全部现代术语（跨领域）。 */
export function allTerms(): readonly Term[] {
  return Object.values(TERMS_BY_DOMAIN).flat()
}

/**
 * 归一化，用于**严格对照**判分。
 *
 * 只做"同一个答案的不同写法"层面的归一，绝不做同义替换：
 *   - 大小写、首尾空白；
 *   - 连续空白折叠；
 *   - 弯引号/直引号、全角标点 → 直引号/半角标点；
 *   - 各类连字符统一成 `-`。
 * 非 ASCII 全角字符（如全角逗号）也一并归一，因为中文输入法下很容易打出来。
 */
export function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'") // ‘ ’ ʼ → '
    .replace(/[\u201c\u201d]/g, '"') // “ ” → "
    .replace(/[\u2013\u2014\u2212]/g, '-') // – — − → -
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)) // 全角 → 半角
    .replace(/\u3000/g, ' ') // 全角空格
    .replace(/\s+/g, ' ')
    .trim()
}

/** 这一条术语的作答是否正确（严格对照）。 */
export function isTermCorrect(term: Term, answer: string): boolean {
  return normalizeAnswer(answer) === normalizeAnswer(term.en)
}
