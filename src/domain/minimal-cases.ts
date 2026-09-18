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

import { minimizeChange, applyMinimal } from './minimal'

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
  // 只差一个标点：不应把整句划掉
  {
    name: '补一个句号',
    oldText: '关键一环',
    newText: '关键一环。',
    expectFrom: '关键一环',
    expectTo: '关键一环。',
  },
  // 名词单复数：不要把前面的空格也划掉
  {
    name: '单复数变化',
    oldText: 'recent year',
    newText: 'recent years',
    expectFrom: 'year',
    expectTo: 'years',
  },
  // 冠词：只划那个词
  {
    name: '冠词变化',
    oldText: 'became a important',
    newText: 'became an important',
    expectFrom: 'a',
    expectTo: 'an',
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
  // 'a' 与 'an' 都出现在片段里时，公共后缀要认得出来，只标真正变的那个
  {
    name: '片段内含重复字符',
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
    const result = minimizeChange(testCase.oldText, testCase.newText)

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
    // 把最小修改应用回原片段，必须能得到目标文字；这一步能挡住"缩错了"的情况
    const rebuilt = applyMinimal(testCase.oldText, result)
    const rebuildOk = rebuilt === testCase.newText
    // 锚点位置必须真的落在原文上
    const anchorOk =
      testCase.oldText.slice(result.startOffset, result.endOffset) === result.from

    return {
      name: testCase.name,
      ok: fromOk && toOk && rebuildOk && anchorOk,
      detail:
        `划出「${result.from}」→「${result.to}」` +
        (fromOk && toOk ? '' : `（期望「${testCase.expectFrom}」→「${testCase.expectTo ?? ''}」）`) +
        (rebuildOk ? '' : `（应用回原文得到「${rebuilt}」，应为「${testCase.newText}」）`) +
        (anchorOk ? '' : '（锚点与划出的文字不一致）'),
    }
  })
}
