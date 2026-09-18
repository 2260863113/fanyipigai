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
  | 'replace' // 替换：原词划掉，上方小字写正确写法
  | 'insert' // 插入：漏掉的内容，在正确位置补入
  | 'delete' // 删除：多余的内容直接划掉
  | 'rewrite' // 整句重写：整句划掉，下方给出正确整句
  | 'reorder' // 语序调换：用配对弧线表示

/**
 * 错误分类：说明一处错误"错在哪里"。
 * 一条错误只归一类，判定优先级见 CATEGORY_PRIORITY。
 */
export type ErrorCategory =
  | 'terminology' // 术语不准
  | 'omission' // 漏译
  | 'addition' // 增译（译文中多出了原文没有的内容）
  | 'word-order' // 语序错
  | 'collocation' // 搭配不当
  | 'word-choice' // 用词不当
  | 'register' // 语体不符
  | 'function-word' // 冠词、介词、单复数
  | 'punctuation' // 标点

/**
 * 错误分类的判定优先级，从高到低。
 * 一个错误可能同时像多个分类，按此顺序取第一个匹配项，保证统计不重复。
 */
export const CATEGORY_PRIORITY: readonly ErrorCategory[] = [
  'terminology',
  'omission',
  'addition',
  'word-order',
  'collocation',
  'word-choice',
  'register',
  'function-word',
  'punctuation',
]

export const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  terminology: '术语不准',
  omission: '漏译',
  addition: '增译',
  'word-order': '语序错',
  collocation: '搭配不当',
  'word-choice': '用词不当',
  register: '语体不符',
  'function-word': '冠词/介词/单复数',
  punctuation: '标点',
}

/** 颜色分级由分类推导，不由 AI 自由选择，保证同一类错误颜色永远一致。 */
export type MarkColor = 'red' | 'orange' | 'green'

export const COLOR_LABEL: Record<MarkColor, string> = {
  red: '语法错误或严重表达不当',
  orange: '表达生硬别扭',
  green: '表达优秀',
}

/** 修改风格：批改力度档位。 */
export type PolishLevel = 'polish' | 'refine'

export const LEVEL_LABEL: Record<PolishLevel, string> = {
  polish: '润色（只改语法错误与严重表达不当）',
  refine: '精修（额外提供更好的表达）',
}

/**
 * 锚点：错误对象在作答文本中指向的位置。
 * 由字符序号区间 + 该区间应有的原文片段共同描述；
 * 片段的作用是让程序自证位置是否有误（见 validateAnnotation）。
 */
export interface Anchor {
  /** 起始字符序号，含 */
  start: number
  /** 结束字符序号，不含 */
  end: number
  /** 该区间内应有的原文片段，用于校验 */
  snippet: string
}

/** 语序调换中的一个片段。sourceIndex / targetIndex 相同者互为"另一端"。 */
export interface ReorderSegment {
  /** 该片段在用户译文中的锚点 */
  anchor: Anchor
  /** 该片段在原始语序中的序号 */
  sourceIndex: number
  /** 该片段调整后应处的次序 */
  targetIndex: number
}

/** 错误对象：批改中描述"一处"问题的最小单位。 */
export interface ErrorObject {
  /** 在本次批改内唯一的编号 */
  id: string
  type: ErrorType
  category: ErrorCategory
  /** 替换、删除、整句重写、语序调换所指向的原文位置 */
  anchor?: Anchor
  /** 插入时使用的原文锚点，作用仅为校验，不在页面上划掉任何内容 */
  insertAfter?: Anchor
  /** 正确的写法；只有「删除」类错误没有这一项（多余内容划掉即可，没有替代写法） */
  targetText?: string
  /** 仅 type = 'reorder' 时存在 */
  segments?: ReorderSegment[]
  /** 为什么错、正确写法是什么 */
  explanation: string
}

/** 亮点：作答中表达优秀的片段。它不是错误，不参与扣分与错误统计。 */
export interface Highlight {
  id: string
  anchor: Anchor
  /** 值得肯定的原因 */
  comment: string
}

/** 维度分：四个打分角度。评价尺子固定为比赛评分标准。 */
export interface DimensionScores {
  /** 术语准确 */
  terminology: number
  /** 语法正确 */
  grammar: number
  /** 语篇连贯 */
  coherence: number
  /** 语体得体 */
  register: number
}

export const DIMENSION_LABEL: Record<keyof DimensionScores, string> = {
  terminology: '术语准确',
  grammar: '语法正确',
  coherence: '语篇连贯',
  register: '语体得体',
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

/** 批改：对一次作答的完整评价。 */
export interface Correction {
  /** 总分，0–100 */
  total: number
  dimensions: DimensionScores
  /** 总体评语 */
  summary: string
  /** 各维度评语 */
  dimensionComments: Record<keyof DimensionScores, string>
  errors: ErrorObject[]
  highlights: Highlight[]
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

export const KIND_LABEL: Record<Exercise['mode'], string> = {
  term: '术语翻译',
  sentence: '句子翻译',
  paragraph: '段落翻译',
  article: '文章翻译',
}

/** 顶部导航栏用的短标签与说明。顺序即导航栏从左到右的顺序。 */
export const MODE_TABS: ReadonlyArray<{ mode: Exercise['mode']; label: string; hint: string }> = [
  { mode: 'article', label: '文章', hint: '整篇语篇翻译，英译汉 250–350 词，汉译英 200–300 字' },
  { mode: 'paragraph', label: '段落', hint: '段落翻译，考查句间衔接与语篇连贯' },
  { mode: 'sentence', label: '句子', hint: '单句翻译，改错最直观，适合打磨细节' },
  { mode: 'term', label: '术语', hint: '关键术语与中华思想文化术语，按官方标准译法判定' },
]
