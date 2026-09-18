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
    kind: 'sentence',
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
    kind: 'sentence',
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
    kind: 'sentence',
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
    kind: 'sentence',
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
    kind: 'sentence',
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

/** 演示时自动填入的作答：在示例作答后面接一句中文，用来验证作答尾部能正常显示。 */
export const DEMO_ANSWER_TAIL = '，这一点在各地实践中反复得到验证。'

export const MOCK_CASES: MockCase[] = [replaceCase, insertCase, deleteCase, reorderCase, rewriteCase]

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

/** 建立某道题的完整假批改。 */
export function mockCorrectionFor(exerciseId: string, answer: string): MockCorrection {
  const testCase = MOCK_CASES.find((item) => item.exercise.id === exerciseId)
  if (!testCase) throw new Error(`未知的题目：${exerciseId}`)
  return {
    ...testCase.correction,
    errors: buildErrors(exerciseId, answer),
    highlights: [testCase.highlight(answer)],
  }
}
