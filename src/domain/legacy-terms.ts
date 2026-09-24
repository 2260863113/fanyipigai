/**
 * **归档的术语**：术语库换材料之前的那 43 条现代术语，加上 9 条古文名句。
 *
 * ## 为什么单独一个文件、而且**谁都不许 import 它**
 *
 * 用户拍板（第 13 轮）：「现存术语从术语栏整个撤下，数据文件留在仓库里当档案」。
 * 归档的意思是**两件事同时成立**：
 *   1. 数据**不丢**——想找回来（或以后恢复成第三个范围）就在这个文件里，不用翻 git 历史；
 *   2. 数据**不再进应用**——因此这个文件**不被任何代码引用**。
 * 一个没有 import 的模块不会进打包体积，这正是"归档"与"还在用"的区别。
 * ⚠️ 所以：**不要为了复用这些词而 import 本文件**。真要恢复，按 `term-scopes.ts` 头部
 * 那三步走（加范围 + 放材料 + 重跑脚本），把数据交给 `scripts/build-terms.mjs` 生成。
 *
 * ## 它们的来历
 *
 * 那 43 条是按**话题领域**（社会／经济／文化／生态／科技）分组的政论固定表述
 * （高质量发展、共同富裕、新质生产力……）。更早还有政治建设、教育强国、国际传播
 * 三组共 26 条，随领域表从八个收敛到五个一起删掉了（见 ADR 0010），
 * 那 26 条在 git 历史里。
 *
 * 9 条古文名句从来不属于术语题（它是整句翻译，本该归句子栏），而且句子栏并没有在用它，
 * 因此一并放在这里存档。`verified` 一栏保留的是**当时的校对状态**，
 * 现在它只是一个历史字段：新的术语库整批来自官方译名材料，不再有"待核对"这个状态。
 */

/**
 * 归档条目的形状（**故意与现在的 `Term` 不同**）。
 *
 * 现在的 `Term` 带 `enAlt` / `zhAlt`（官方缩写、一英多中），那两样是机关名称材料才有的概念；
 * 当时这批词是"唯一标准译法"，因此这里如实保留 `verified`，不做掩饰性的改写。
 */
export interface LegacyTerm {
  zh: string
  en: string
  verified: boolean
}

/** 归档的 43 条现代术语，按当时的话题领域分组。 */
export const LEGACY_TERMS_BY_DOMAIN: Record<string, readonly LegacyTerm[]> = {
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
}

/** 归档的 9 条古文名句（从来不属于术语题）。 */
export const LEGACY_CLASSICAL_SENTENCES: readonly LegacyTerm[] = [
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
