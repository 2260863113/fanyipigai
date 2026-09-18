/**
 * 最小修改算法的用例。
 *
 * 这些用例全部来自真实场景：模型给出的范围往往比实际改动大，
 * 例如它会把 "have explore ways" 整块报成一处修改，而真正变的只有 explore 一个词。
 * 因此这里逐条固定住"应当划出什么"，防止以后改动把它弄坏。
 *
 * 这些用例由 scripts/smoke.ts 调用，也可以单独运行：
 *   node scripts/run-minimal.mjs
 */

import { minimizeChange, applyMinimal, stripRepeats } from './minimal'

interface Case {
  name: string
  oldText: string
  newText: string
  /** 期望划出来的原文；null 表示这段文字没有实际变化 */
  expectFrom: string | null
  /** 期望改成的内容 */
  expectTo?: string
}

const CASES: Case[] = [
  // 本次实测遇到的例子：模型圈了三个词，实际只是一个词的词形变化
  {
    name: '词形变化只划那一个词（实测例子）',
    oldText: 'have explore ways',
    newText: 'have explored ways',
    expectFrom: 'explore',
    expectTo: 'explored',
  },
  // 只差一个标点：消同类项后只剩新增的那个句号（不再把整个词划掉又写一遍）
  {
    name: '补一个句号（消同类项后只显示新增的句号）',
    oldText: '关键一环',
    newText: '关键一环。',
    expectFrom: '',
    expectTo: '。',
  },
  // 名词单复数：同理，只显示新增的 s，既不划空格，也不重复写 year
  {
    name: '单复数变化（是词形变化，显示整个词而不是单个 s）',
    oldText: 'recent year',
    newText: 'recent years',
    expectFrom: 'year',
    expectTo: 'years',
  },
  // 冠词：这里 a 没有原样保留（变成了 an），因此照最小块显示
  {
    name: '冠词变化',
    oldText: 'became a important',
    newText: 'became an important',
    expectFrom: 'a',
    expectTo: 'an',
  },
  // 在词前面加冠词：整段原文被完整保留，因此只显示新增的 "a "，不重复写原词
  {
    name: '在词前加冠词（已知折中：显示整个词，因为新增的 a 含字母）',
    oldText: 'prominent',
    newText: 'a prominent',
    expectFrom: 'prominent',
    expectTo: 'a prominent',
  },
  // 首字母大小写：i → I 与 is → am，两处都变了，因此整块标出
  {
    name: '首个词大小写与词形同时变',
    oldText: 'i is',
    newText: 'I am',
    expectFrom: 'i is',
    expectTo: 'I am',
  },
  // 中间插词：只标真正插进去的部分，不把相邻的词一起圈
  {
    name: '插入一个词',
    oldText: 'in prominent position',
    newText: 'in a prominent position',
    expectFrom: 'prominent',
    expectTo: 'a prominent',
  },
  // 整句替换
  {
    name: '整句重写',
    oldText: 'In wake of reform',
    newText: 'Since the beginning of reform and opening up',
    expectFrom: 'In wake of reform',
    expectTo: 'Since the beginning of reform and opening up',
  },
  // 改成不同表达。这里整体换掉，因此整段划掉、整段写在上方
  {
    name: '换一种说法',
    oldText: '候鸟喜欢的到达地',
    newText: '候鸟青睐的栖息地',
    expectFrom: '候鸟喜欢的到达地',
    expectTo: '候鸟青睐的栖息地',
  },
  // 实测中最夸张的一次：模型圈的原文只有 ", "（半角逗号加空格），却说要改成「到达地，吸引了」
  // （把两侧的词也抄了进来）。这种情况没法再缩——新旧文字除逗号外没有公共部分——因此按模型给的范围标。
  // 保留这条用例是为了**记住这个真实缺陷**：能否自动校正取决于新旧两侧有没有公共文字，
  // 没有公共文字时只能照它给的标（这条能正确重建，不会把页面弄坏）。
  {
    name: '模型把目标文字圈得过宽（无公共文字，无法再缩）',
    oldText: ', ',
    newText: '到达地，吸引了',
    expectFrom: ', ',
    expectTo: '到达地，吸引了',
  },
  // 末尾追加一个字母：整段原文被完整保留，因此只显示新增的 n
  {
    name: '末尾追加字母（同样按词形变化显示）',
    oldText: 'became a',
    newText: 'became an',
    expectFrom: 'a',
    expectTo: 'an',
  },
  // 完全没有变化
  {
    name: '没有变化',
    oldText: 'ecological',
    newText: 'ecological',
    expectFrom: null,
  },
  // 一整块删除
  {
    name: '整块删除',
    oldText: '，这是中国式发展策略的关键一环',
    newText: '',
    expectFrom: '，这是中国式发展策略的关键一环',
    expectTo: '',
  },
  // 一整块新增
  {
    name: '整块新增',
    oldText: '',
    newText: '人与自然和谐共生的',
    expectFrom: '',
    expectTo: '人与自然和谐共生的',
  },
]

export interface MinimalCheck {
  name: string
  ok: boolean
  detail: string
}

export function checkMinimal(): MinimalCheck[] {
  return CASES.map((testCase) => {
    const minimal = minimizeChange(testCase.oldText, testCase.newText)
    const result = minimal ? { ...minimal, ...stripRepeats(minimal.from, minimal.to) } : null

    if (testCase.expectFrom === null) {
      return {
        name: testCase.name,
        ok: result === null,
        detail: result === null ? 'correctly found no change' : `expected no change, got 「${result.from}」→「${result.to}」`,
      }
    }

    if (!result) {
      return { name: testCase.name, ok: false, detail: 'expected a change, got none' }
    }

    const fromOk = result.from === testCase.expectFrom
    const toOk = testCase.expectTo === undefined || result.to === testCase.expectTo

    // 还原验证要用**最小块**（剥离之前），不能用剥离后的展示值：
    // 消同类项之后 from 为空、to 是新增内容，"划掉 from" 的语义已经不再成立。
    const rebuilt = minimal ? applyMinimal(testCase.oldText, minimal) : testCase.oldText
    const rebuildOk = rebuilt === testCase.newText

    // 剥离只应去掉重复，不应把变化本身抹掉：原本有变化，剥离后仍须有变化
    const changedOk = (minimal !== null) === (result.from !== result.to)

    return {
      name: testCase.name,
      ok: fromOk && toOk && rebuildOk && changedOk,
      detail:
        `划出「${result.from}」→「${result.to}」` +
        (fromOk && toOk ? '' : `（期望「${testCase.expectFrom}」→「${testCase.expectTo ?? ''}」）`) +
        (rebuildOk ? '' : `（应用回原文得到「${rebuilt}」，应为「${testCase.newText}」）`) +
        (changedOk ? '' : '（消同类项把变化本身抹掉了）'),
    }
  })
}
