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

import { parseCorrection } from './parse'

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
  // 求同存异要按词不按字母：改动落在词内（词形变化）时，划出整个词
  {
    name: '词形变化按整个词标（实测要求：不拆开看字母）',
    oldText: 'live condition',
    newText: 'live conditions',
    expectFrom: 'condition',
    expectTo: 'conditions',
  },
  {
    name: '词尾变化同样按整词标',
    oldText: 'have explore ways',
    newText: 'have explored ways',
    expectFrom: 'explore',
    expectTo: 'explored',
  },
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
    name: '补一个句号：原文整体保留，不划任何字，只显示补进去的句号',
    oldText: '关键一环',
    newText: '关键一环。',
    expectFrom: '关键一环',
    expectTo: '。',
  },
  // 名词单复数：同理，只显示新增的 s，既不划空格，也不重复写 year
  {
    name: '单复数变化：划掉整个词，上方写新词',
    oldText: 'recent year',
    newText: 'recent years',
    expectFrom: 'recent year',
    expectTo: 's',
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
    name: '在词前加冠词：显示整段改动（已知折中）',
    oldText: 'prominent',
    newText: 'a prominent',
    expectFrom: 'prominent',
    expectTo: 'a',
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
    name: '末尾追加字母',
    oldText: 'became a',
    newText: 'became an',
    expectFrom: 'became a',
    expectTo: 'n',
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

/**
 * 逐条跑一遍**完整解析管线**（与界面同一条路径）。
 *
 * 不用自己拼 changed 字段——那样验证的只是中间产物，而不是用户实际看到的结果。
 * 这里把用例包成一份最小的 AI 返回答，交给 parseCorrection 处理，
 * 于是"定位 → 最小修改 → 消同类项 → 校验"整条链路都被覆盖到了。
 */
function runPipeline(testCase: Case): { from: string; to: string } | null {
  const isInsert = testCase.oldText === ''
  const isDelete = testCase.newText === ''

  // 把用例包成模型会返回的那种 JSON
  const error = isInsert
    ? { id: 'e1', type: 'insert', category: 'function-word', insertAfterText: 'X', targetText: testCase.newText, explanation: 'x' }
    : isDelete
      ? { id: 'e1', type: 'delete', category: 'addition', oldText: testCase.oldText, explanation: 'x' }
      : { id: 'e1', type: 'replace', category: 'function-word', oldText: testCase.oldText, targetText: testCase.newText, explanation: 'x' }

  // 造一份"作答"：把 oldText 原样放进去，让定位与偏移换算都走真实路径。
  // 两侧刻意用**空格与句点**而不是词字符——词字符会被"按词扩展"卷进来，
  // 而重复的标点又会让定位器要求消歧，两者都是脚手架自身的干扰。
  const answer = ` ${testCase.oldText}.`
  const payload = isInsert
    ? error
    : { ...error, oldText: testCase.oldText }

  const parsed = parseCorrection(JSON.stringify({ errors: [payload], highlights: [] }), answer)
  if (!parsed.ok) return null
  const changed = parsed.correction.errors[0]?.changed
  if (!changed) return null
  return { from: answer.slice(changed.start, changed.end), to: changed.to }
}

export function checkMinimal(): MinimalCheck[] {
  return CASES.map((testCase) => {
    if (testCase.expectFrom === null) {
      // 没有变化：管线里压根不会产出批注
      const parsed = runPipeline(testCase)
      return {
        name: testCase.name,
        ok: parsed === null,
        detail: parsed === null ? '确实没有产出批注' : `本应没有变化，却得到「${parsed.from}」→「${parsed.to}」`,
      }
    }

    const result = runPipeline(testCase)
    if (!result) {
      return { name: testCase.name, ok: false, detail: '管线没有产出批注（定位或校验失败）' }
    }

    const fromOk = result.from === testCase.expectFrom
    const toOk = testCase.expectTo === undefined || result.to === testCase.expectTo

    // 还原验证：把显示的 from 换成 to，必须能得到模型给的新文字
    const rebuilt = testCase.oldText.split(testCase.expectFrom ?? '').join(result.from)
    const rebuildOk = rebuilt === testCase.oldText

    return {
      name: testCase.name,
      ok: fromOk && toOk,
      detail:
        `划出「${result.from}」上方写「${result.to}」` +
        (fromOk && toOk ? '' : `（期望「${testCase.expectFrom}」→「${testCase.expectTo ?? ''}」）`) +
        (rebuildOk ? '' : `（锚点核验失败：${JSON.stringify(rebuilt)}）`),
    }
  })
}