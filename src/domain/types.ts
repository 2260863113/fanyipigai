/**
 * 领域类型定义。
 * 词汇含义以 CONTEXT.md 为准，这里只做类型层面的表达。
 */

/** 翻译走向。决定字数口径：英按词数、中按字符数。 */
export type Direction = 'zh-to-en' | 'en-to-zh'

/** 官方考查的四种文体。 */
export type Genre = 'political' | 'news' | 'literature' | 'expository'

/** 改法类型：说明一处错误"该怎么改"，决定页面上如何呈现。 */
export type ErrorType =
  | 'replace' // 替换：原词勾上荧光笔底色，上方小字写正确写法
  | 'insert' // 插入：漏掉的内容，在正确位置补入
  | 'delete' // 删除：多余的内容直接勾上底色
  | 'rewrite' // 整句重写：整句勾上底色，上方给出正确整句
  | 'reorder' // 语序调换：用配对弧线表示

/**
 * 错误分类的**类型层**表达：说明一处错误"错在哪里"。
 *
 * 运行时的那份唯一名单是下面的 ERROR_CATEGORY_SPECS —— 标签、颜色档位、
 * 判定优先级、给 AI 的说明全在那里，并由它派生出 CATEGORY_PRIORITY / CATEGORY_LABEL /
 * HARD_CATEGORIES。这个联合类型是编译期的镜像，供各处标注类型用；
 * **两者必须同时改**（漏改这里，parse.ts 会拒掉整个新分类，见 SPECS 的注释）。
 *
 * 分类同时决定颜色：硬性错误归红，表达问题归橙。
 */
export type ErrorCategory =
  | 'terminology' // 术语不准（硬性：固定译法写错）
  | 'omission' // 漏译（硬性：信息缺失）
  | 'addition' // 增译（硬性：多出原文没有的信息）
  | 'grammar' // 语法（硬性：时态、语态、主谓一致、词形、句子结构）
  | 'function-word' // 冠词、介词、单复数（硬性：形态细节）
  | 'punctuation' // 标点（硬性）
  | 'verbosity' // 啰嗦（表达问题：绕圈子、重复、堆砌——第 14 条新增）
  | 'word-order' // 语序错（表达问题）
  | 'collocation' // 搭配不当（表达问题）
  | 'word-choice' // 用词不当（表达问题）
  | 'register' // 语体不符（表达问题）

/**
 * 错误分类表的**唯一定义**：说明一处错误"错在哪里"。
 *
 * 为什么收成一张表：这份信息原先**手工维护了五份**——ErrorCategory 联合类型、
 * CATEGORY_PRIORITY、CATEGORY_LABEL、HARD_CATEGORIES，以及 prompt.ts 里又一份
 * CATEGORIES。加一个分类要改五个地方，而其中**两份有序列表必须人工对齐**。
 * 失败模式是不对称且致命的：只加进提示词而漏了联合类型，parse.ts 会把该类错误
 * 全部拒掉 → 解析失败 → 重试三次 → 整批 bad-out，而当时没有任何测试守着这件事。
 *
 * 现在下面那些导出**全部由这张表派生**，顺序就是判定优先级（从高到低）：
 * 一个错误同时像多个分类时取靠前的那个，保证统计不重复。
 * 硬性错误（红）排在前面：同样的位置既有语法问题又有表达问题，按硬性错误计。
 */
export interface ErrorCategorySpec {
  key: ErrorCategory
  /** 界面上显示的名字 */
  label: string
  /** 是否硬性错误（红）。false 表示表达问题（橙）。 */
  hard: boolean
  /**
   * 给 AI 看的判定说明。
   * 只用在提示词里，因此措辞是写给模型看的（含举例），不是给用户看的。
   */
  hint: string
}

export const ERROR_CATEGORY_SPECS: readonly ErrorCategorySpec[] = [
  {
    key: 'terminology',
    label: '术语不准',
    hard: true,
    hint: '固定术语、关键表述、专有名词译错或改写（如"改革开放"漏译成 reform）',
  },
  {
    key: 'omission',
    label: '漏译',
    hard: true,
    hint: '原文有而译文没有的信息，含漏掉的逻辑关系（转折、因果、递进）',
  },
  { key: 'addition', label: '增译', hard: true, hint: '译文里多出了原文没有的信息' },
  {
    key: 'grammar',
    label: '语法',
    hard: true,
    hint: '时态、语态、主谓一致、词形、句子结构等语法错误——只要语法不成立就归这里',
  },
  { key: 'function-word', label: '冠词/介词/单复数', hard: true, hint: '冠词、介词、单复数等形态细节' },
  { key: 'punctuation', label: '标点', hard: true, hint: '标点使用不当' },
  /**
   * 「啰嗦」（第 14 条新增，用户点名的一类）。
   *
   * 为什么单列一类、而不是并进"用词不当"：用户要的是**能单独看见"我写得太啰嗦"**这件事
   * （他把它排在"术语错误"之后、"更好的表达"之前单独检查一遍）。并进用词不当的话，
   * 弱项统计里就只剩一堆"用词不讲究"，看不出真正的问题。
   * 它是**表达问题（橙）**：啰嗦读得懂、意思也不错，只是不够利落。
   */
  {
    key: 'verbosity',
    label: '啰嗦',
    hard: false,
    hint: '绕圈子、重复、堆砌可有可无的成分，删掉更利落（同一件事说了两遍、一串修饰语只说一个意思）',
  },
  { key: 'word-order', label: '语序错', hard: false, hint: '词序、修饰语位置、从句位置需要调整' },
  { key: 'collocation', label: '搭配不当', hard: false, hint: '词与词的搭配不成立，如 insist her dream' },
  { key: 'word-choice', label: '用词不当', hard: false, hint: '词义选错、词形用错（如把名词 success 当动词用）' },
  { key: 'register', label: '语体不符', hard: false, hint: '过于口语或过于生硬，与文体要求不匹配' },
]

/** 错误分类的判定优先级，从高到低（由 ERROR_CATEGORY_SPECS 的顺序派生）。 */
export const CATEGORY_PRIORITY: readonly ErrorCategory[] = ERROR_CATEGORY_SPECS.map((spec) => spec.key)

/** 各分类的中文名（派生）。 */
export const CATEGORY_LABEL = Object.fromEntries(
  ERROR_CATEGORY_SPECS.map((spec) => [spec.key, spec.label]),
) as Record<ErrorCategory, string>

/**
 * 哪些分类算硬性错误（红色），从高到低（派生）。
 *
 * 为什么由代码定而不是让 AI 选颜色：颜色是给用户看的稳定信号，
 * 同一类错误在每一次批改里都必须是同一个颜色。让模型自由选颜色，
 * 会出现"这次冠词用红、下次用橙"，用户就没法形成阅读习惯了。
 */
export const HARD_CATEGORIES: readonly ErrorCategory[] = ERROR_CATEGORY_SPECS.filter((spec) => spec.hard).map(
  (spec) => spec.key,
)

/** 颜色分级。红＝硬性错误，橙＝表达问题，绿＝表达优秀。 */
export type MarkColor = 'red' | 'orange' | 'green'

export const COLOR_LABEL: Record<MarkColor, string> = {
  red: '硬性错误',
  orange: '表达问题',
  green: '表达优秀',
}

/** 修改风格：批改力度档位。**界面上叫「精修」的是 `polish`、叫「大改」的是 `refine`**（见下）。 */
export type PolishLevel = 'polish' | 'refine'

/**
 * 两档修改风格的**界面名**。
 *
 * ⚠️ **界面上叫「精修」的那一档，代码里的键是 `polish`；叫「大改」的那一档，键是 `refine`。**
 *
 * 用户改过名（原话："将'润色'改成'精修'，'精修'改成'大改'"）：
 * 原来的「润色」现在叫**精修**（只改硬性错误与严重表达不当），
 * 原来的「精修」现在叫**大改**（整篇逐句重写 + 逐句解释 + AI 给分）。
 * 只改界面名与文档，**不动内部键**：`polish` / `refine` 已经写进了解析、提示词与落盘的
 * 练习记录（`records.v2` 里的 `level` 字段），改键等于让旧存档读不出来。
 * 于是"精修"这个词在本项目里有两种含义：**界面上它指 `polish`**，
 * 而代码里 `refine*` 一律指**大改**——读代码时以键为准。
 */
export const LEVEL_LABEL: Record<PolishLevel, string> = {
  polish: '精修（只改硬性错误与严重表达不当）',
  refine: '大改（额外指出表达生硬之处，并给出更地道写法）',
}

/**
 * 锚点：一处批注在作答文本中的绝对区间。
 *
 * 注意：AI **从来不输出这个字段**。它由程序按 AI 给出的文字片段找出来之后写入，
 * 这样界面、位置校验、排版这些下游逻辑完全不需要知道"定位方式变了"。
 */
export interface Anchor {
  /** 起始字符序号，含 */
  start: number
  /** 结束字符序号，不含 */
  end: number
  /** 该区间内的原文片段，用于校验与消歧 */
  snippet: string
}

/** 语序调换中的一个片段。sourceIndex / targetIndex 相同者互为"另一端"。 */
export interface ReorderSegment {
  /**
   * AI 给出的文字片段（与 errors 的其他字段保持一致叫 oldText；也兼容 text 这个别名）。
   * 位置由程序按文字找出来，见 anchor。
   */
  oldText?: string
  /** 解析后填入的绝对区间，AI 从不输出这个字段 */
  anchor: Anchor
  /** 该片段在原始语序中的序号 */
  sourceIndex: number
  /** 该片段调整后应处的次序 */
  targetIndex: number
}

/**
 * 错误对象：批改中描述"一处"问题的最小单位。
 *
 * 位置**不由 AI 给序号**，而是由 AI 给出「改哪段文字」，程序自己到译文里找位置。
 * 这样 AI 不需要数任何字符，也就没有"数错序号"这种失败——实测中它是最常见的失败来源。
 * 定位所需的三样东西：
 * - oldText / anchor.snippet：要改的原文片段，必须逐字复制
 * - contextBefore / contextAfter：可选的左右各若干字，用于同一片段出现多次时消歧
 * - insertAfter：插入类改用「补在这个片段之后」表达落点
 */
export interface ErrorObject {
  /** 在本次批改内唯一的编号 */
  id: string
  type: ErrorType
  category: ErrorCategory
  /** 要改的原文片段（replace / delete / rewrite 用它定位；reorder 用 segments 里的 anchor） */
  oldText?: string
  /**
   * 解析后填入的绝对区间（= 模型圈的那片文字被定位到的位置）。
   * AI 从来不给这个字段——它是程序按文字找出来之后自己写进来的，
   * 保留它是为了让界面、校验、排版这些下游逻辑完全不用改。
   *
   * 注意它**不装**按词缩窄后的改动项：那些在 `changed` 里。
   * 插入类（insert）的落点在 `insertAfter` 上，此时 anchor 的 snippet 是空串。
   */
  anchor?: Anchor
  /** 插入时使用的原文锚点（补在这个片段之后） */
  insertAfter?: Anchor
  /** 消歧用：片段左边紧邻的若干字 */
  contextBefore?: string
  /** 消歧用：片段右边紧邻的若干字 */
  contextAfter?: string
  /**
   * 最小修改后的若干区间：只覆盖真正变化的那些**词**。
   *
   * 为什么是数组：一"处"错误在 AI 眼里是一件事，落在文字上却可能横跨好几个互不相邻的词。
   * 例如 farmers and herders 被写成 farmer and herder：
   *   farmer → farmers、herder → herders —— 两处改动，逻辑上是同一处错误
   * （and 没错，不该被划掉）。渲染时按区间各画各的，但共用同一个 id：
   * 点哪一部分，选中的都是这一处错误。
   */
  changed?: Array<{ start: number; end: number; to: string }>
  /**
   * AI 当初圈出的那片文字，由程序定位后得到的位置与片段。
   *
   * 校验器用它核对"该区间里的文字是否与 oldText 一致"。
   * 对 replace / rewrite / delete / insert，它和 `anchor` 是**同一个**区间
   * （见 parse.ts），保留它是为了让校验只依赖"模型圈的范围"这一个来源；
   * 缩窄后的可渲染区间在 `changed` 里，不在 anchor 里。
   *
   * （旧注释说"anchor 装的是缩窄后的区间"，与代码不符，已改正。）
   */
  originalSpan?: { start: number; end: number; snippet: string }
  /** 正确的写法；只有「删除」类错误没有这一项 */
  targetText?: string
  /** 仅 type = 'reorder' 时存在 */
  segments?: ReorderSegment[]
  /**
   * **翻译前的那段原文**：这一处批注对应原文里的哪一小段（AI 逐字复制，可省略）。
   *
   * 用途是用户要求的那一条：点译文上的某一处批改时，**左边原文栏里对应的那一处也用同一个颜色标出来**；
   * 收起小卡片，标记就消失。语法/表达类问题常常指不出对应的原文片段，那就留空——
   * **给不出就不给，宁少勿错**（见 parse.ts：定位不上就安静地丢掉这个字段，不因此重试整份）。
   */
  sourceText?: string
  /**
   * `sourceText` 在**原文**里的位置（程序按文字找出来的，AI 从不输出这个字段）。
   *
   * ⚠️ 坐标属于**原文**（这一页的原文），与 `anchor`（属于译文）是两套坐标系，不要混用。
   */
  sourceAnchor?: Anchor
  /** 为什么错、正确写法是什么 */
  explanation: string
}

/** 亮点：作答中表达优秀的片段。它不是错误，不参与扣分与错误统计。 */
export interface Highlight {
  id: string
  /** AI 给的文字片段（与 errors 用同一个字段名，保持一致） */
  oldText?: string
  /** 解析后填入的绝对区间，AI 从不输出这个字段 */
  anchor: Anchor
  /** 值得肯定的原因 */
  comment: string
}

/**
 * 批改：对一次作答的完整评价。
 *
 * 注意这里**没有分数字段**：AI 不再负责打分，分数由程序根据错误列表算出来
 * （见 scoring.ts）。这样分数与页面上实际标出的错误永远一致，
 * 也不会出现"模型给了 90 分却标出 8 处硬性错误"这种自相矛盾。
 */
export interface Correction {
  errors: ErrorObject[]
  highlights: Highlight[]
}

/** 系统计分的结果。 */
export interface Score {
  /** 0–100 */
  total: number
  /** 红色（硬性错误）数量——**含漏译**（漏译也会标色，图例少算它就不一致了） */
  hardCount: number
  /** 橙色（表达问题）数量——同样含漏译 */
  softCount: number
  /** 绿色（表达优秀）数量 */
  highlightCount: number
  /**
   * 一共漏了多少个单位（中译英数词、英译中数汉字）。
   * 漏译是**按字数扣分**的（用户第 13 条），因此这两个数要单独报出来，
   * 分数栏里会写一行"漏译扣 X 分（漏 N 个单位）"。
   */
  omissionUnits: number
  /** 漏译一共扣了多少分（= 单位数 × 每单位扣分） */
  omissionPenalty: number
}

/** 题目的四种形态。顶部导航栏就是按这个分类切换的。 */
export type Mode = 'article' | 'paragraph' | 'sentence' | 'term'

/** 一道题目。 */
export interface Exercise {
  id: string
  direction: Direction
  /** 题型 */
  mode: Mode
  genre: Genre
  /** 话题领域，用户可自行输入 */
  topic: string
  /** 待译原文 */
  source: string
  /** 参考译文，随题生成一次后固定 */
  referenceTranslation: string
  /** 官方建议用时（分钟），仅作参考，不做倒计时 */
  suggestedMinutes: number
}

/** 练习记录：一次作答与其批改共同构成的存档。 */
export interface PracticeRecord {
  id: string
  exerciseId: string
  /** 第几次作答这道题，从 1 开始 */
  attempt: number
  /** 作答时选择的修改风格 */
  level: PolishLevel
  answer: string
  correction: Correction
  createdAt: string
}

export const KIND_LABEL: Record<Mode, string> = {
  term: '术语翻译',
  sentence: '句子翻译',
  paragraph: '段落翻译',
  article: '文章翻译',
}

/** 文体标签。取值为官方考查的四类。 */
export const GENRE_LABEL: Record<Genre, string> = {
  political: '政治文献',
  news: '新闻编译',
  literature: '文学选篇',
  expository: '一般说明文',
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  'zh-to-en': '中译英',
  'en-to-zh': '英译中',
}

/**
 * 顶部导航栏的顺序与文案。
 * 「练习记录」不是题型，而是所有题型的记录汇总页，因此单独放在最后。
 * 「自定义」也不是题型：它是用户自己贴一篇原文进来练的入口（见 domain/custom.ts）。
 * 「收藏」同样不是题型：它是用户自己挑出来的那些句子（见 domain/favorites.ts）。
 *
 * `hidden` 表示**不在导航栏出现**。目前只有「段落」：
 * 文章题本来就把文章按自然段切、逐段作答，另开一个「段落」栏与它重复，
 * 因此从导航里撤掉。**类型、内置题目与相关代码都留着**（用户选的是"只从导航隐藏"），
 * 以后想恢复只需把这个标记去掉，不必重写。
 */
export const MODE_TABS: ReadonlyArray<{
  mode: Mode | 'records' | 'custom' | 'favorites'
  label: string
  hint: string
  hidden?: boolean
}> = [
  { mode: 'article', label: '文章', hint: '整篇语篇翻译，英译汉 250–350 词，汉译英 200–300 字' },
  {
    mode: 'paragraph',
    label: '段落',
    hint: '段落翻译，考查句间衔接与语篇连贯',
    hidden: true,
  },
  { mode: 'sentence', label: '句子', hint: '单句翻译，改错最直观，适合打磨细节' },
  { mode: 'term', label: '术语', hint: '关键术语与中华思想文化术语，按官方标准译法判定' },
  { mode: 'custom', label: '自定义', hint: '自己贴一篇原文来练，不用等我们出题（只贴原文即可）' },
  { mode: 'favorites', label: '收藏', hint: '做题时点「收藏」存下来的那些句子，回来复习用' },
  { mode: 'records', label: '练习记录', hint: '查看全部练习记录与当时的完整批改' },
]

/** 导航栏上真正显示的那几项（过滤掉 hidden 的）。 */
export const VISIBLE_MODE_TABS = MODE_TABS.filter((item) => !item.hidden)

/** 每类题型的评价单位。文章题按段调用 API，因此单位是"段落"。 */
export const UNIT_LABEL: Record<Mode, string> = {
  article: '段落',
  paragraph: '段落',
  sentence: '句子',
  term: '术语',
}
