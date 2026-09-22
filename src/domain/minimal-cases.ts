/**
 * 最小修改算法的用例。
 *
 * 这些用例全部来自真实场景：模型给出的范围往往比实际改动大，
 * 例如它会把 "have explore ways" 整块报成一处修改，而真正变的只有 explore 一个词。
 * 因此这里逐条固定住"应当划出什么"，防止以后改动把它弄坏。
 *
 * 这些用例由 scripts/smoke.ts 调用（`npm run smoke`），不单独提供运行器。
 */

import { parseCorrection } from './parse'
import { applyChangesToText } from './minimal'

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
  // 只差一个标点：原文被完整保留、多出来的全是标点，因此不划任何字，只显示补进去的句号
  {
    name: '补一个句号：原文整体保留，不划任何字，只显示补进去的句号',
    oldText: '关键一环',
    newText: '关键一环。',
    expectFrom: '',
    expectTo: '。',
  },
  // 名词单复数：改动落在词尾，但求同存异要按词不按字母，因此划掉整个 year、上方写 years
  {
    name: '单复数变化：划掉整个词，上方写新词',
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
  // 在词前面加冠词：改动发生在词与词之间，因此一个字都不划，只在 prominent 前面补 a
  {
    name: '在词前加冠词：一个字都不划，只补入 a',
    oldText: 'prominent',
    newText: 'a prominent',
    expectFrom: '',
    expectTo: 'a ',
  },
  // 本轮实测要求：漏了一个词时只补不划
  {
    name: '漏了一个词：past 前面补 the（不划任何字）',
    oldText: 'past',
    newText: 'the past',
    expectFrom: '',
    expectTo: 'the ',
  },
  {
    name: '漏了一个词（原句）：over the past years → over past years',
    oldText: 'over the past years',
    newText: 'over past years',
    expectFrom: 'the ',
    expectTo: '',
  },
  // 实测：整句话里只有一个词写错，绝不能整句划掉。
  // 字符级差异会把 plant → afforested 切碎（a、t 恰好对得上号），必须靠"词内相邻块合并"收回来。
  {
    name: '只改一个词（实测）：plant → afforested，不许整句划掉',
    oldText: 'China has plant trees more than 70 million hectares.',
    newText: 'China has afforested trees more than 70 million hectares.',
    expectFrom: 'plant',
    expectTo: 'afforested',
  },
  // 首字母大小写 + 少了一个词：字符级差异会给出 "At m" → "M"，
  // 按单词求最小不同项应当是整段替换 At meanwhile → Meanwhile
  {
    name: '按词替换：At meanwhile → Meanwhile（不拆成 At m → M）',
    oldText: 'At meanwhile',
    newText: 'Meanwhile',
    expectFrom: 'At meanwhile',
    expectTo: 'Meanwhile',
  },
  // 一处错误跨两个词：两个词各改各的，中间没错的 and 不该被划掉
  {
    name: '一处错误跨两个词：farmer / herder 各改各的，and 不动',
    oldText: 'farmer and herder',
    newText: 'farmers and herders',
    expectFrom: 'farmer + herder',
    expectTo: 'farmers + herders',
  },
  // 首字母大小写：i → I 与 is → am，两处都变了，因此整块标出
  {
    name: '首个词大小写与词形同时变',
    oldText: 'i is',
    newText: 'I am',
    expectFrom: 'i is',
    expectTo: 'I am',
  },
  // 中间插词：改动同样发生在词与词之间，只补不划
  {
    name: '插入一个词',
    oldText: 'in prominent position',
    newText: 'in a prominent position',
    expectFrom: '',
    expectTo: 'a ',
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
  // 末尾追加一个字母：改动落在词内（a → an），按词不按字母，划掉整个 a、上方写 an
  {
    name: '末尾追加字母',
    oldText: 'became a',
    newText: 'became an',
    expectFrom: 'a',
    expectTo: 'an',
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
  /*
   * ── 用户口径：中间（或一端）有一截完全相同的文字，达到**三个单位**就不标色 ──
   *
   * 用户原话："对于中间内容相同的且相同部分大于两个字或者单词的雷同部分，也不标色"，
   * 并另外强调过"每个单词就是最小单位，绝不能把一个单词按字母拆开改"。
   * 单位是英文一个**词**、中文一个**字**；阈值与实现见 minimal.ts 的 MIN_SAME_UNITS 与 trimSameEnds。
   */
  {
    // 用户给的例子：中间三个词完全一样，够三个单位，那三个词不标
    name: '中间三个词完全相同：不标色（用户给的例子）',
    oldText: 'aaa bbb ccc dddd eee',
    newText: 'hh bbb ccc dddd dee',
    expectFrom: 'aaa + eee',
    expectTo: 'hh + dee',
  },
  {
    /*
     * 反例：中间只有一个词相同，只有 **1 个单位**，够不上三个 → 没有免标的资格。
     * 它本来就被字符级差异切在两块之间（aaa 与 ccc 各改各的），因此这条钉住的是
     * "阈值没有被悄悄调小"：只要它还是 1 个单位，就永远不该为它多切一刀。
     */
    name: '中间只有一个词相同（1 个单位，不够三个）：照旧不享受免标',
    oldText: 'aaa bbb ccc',
    newText: 'hh bbb dee',
    expectFrom: 'aaa + ccc',
    expectTo: 'hh + dee',
  },
  {
    /*
     * 中文：一个字就是一个单位。这里首尾各 4 个字、5 个字完全相同（都够 3 个字），
     * 因此只标中间真正变的那两个字。
     * 改之前这里会**整句标色**——`alignToWord` 把没有空格的一整句中文当成"一个词"，
     * 于是块里夹着的那一大截相同文字跟着一起标（对照视图当初就是因为这个毛病另写了一份差异算法）。
     */
    name: '中文：两端相同的汉字各自够三个字 → 只标真正变的字',
    oldText: '苹果香蕉橘子西瓜很好吃',
    newText: '苹果香蕉葡萄西瓜很好吃',
    expectFrom: '橘子',
    expectTo: '葡萄',
  },
  {
    // 同一条规则的另一面：相同的那截只有两个字，不够三个字 → 照旧整段标（阈值不许调小）
    name: '中文：只有两个字相同，不够三个字 → 照旧整段标',
    oldText: '中国农业发展很快',
    newText: '中国经济增长很快',
    expectFrom: '中国农业发展很快',
    expectTo: '中国经济增长很快',
  },
  {
    /*
     * 一个块里"该剪"与"不该剪"并存：块尾那 10 个字两边完全一样 → 剪掉不标；
     * 块首那两个字（他们）也相同，但只有 2 个字、不到三个 → 跟着这一块照旧标出来。
     */
    name: '中文：块尾那长长的一截相同就不标，开头两个字不够三个字仍照旧标',
    oldText: '他们讨论了中国农业发展的问题',
    newText: '他们介绍了中国农业发展的问题',
    expectFrom: '他们讨论',
    expectTo: '他们介绍',
  },
  {
    /*
     * **安全网上限的边界**（有意固定住，别当成缺陷顺手改掉）：
     * 两侧改动各自的块数超过 MAX_CHANGES（2）时，批注口径宁可整段替换，
     * 中间那三个完全相同的词于是跟着一起标出来——裁剪只剪块的两端，剪不到夹在两处改动之间的它。
     * 要让这种句子也只标真正变的词，得把上限调大（那是**对照视图**的口径）；
     * 真改了那个口径，这条用例就该跟着改，而不是让代码两边讨好。
     */
    name: '安全网上限的边界：改动块数超过 2 时，中间相同的词会连着整段标',
    oldText: 'the report shows bbb ccc dddd eee',
    newText: 'since the start bbb ccc dddd dee',
    expectFrom: 'the report shows bbb ccc dddd eee',
    expectTo: 'since the start bbb ccc dddd dee',
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
 * 于是"定位 → 最小不同项 → 校验"整条链路都被覆盖到了。
 *
 * 一处批注可能含**多个**最小不同项（farmer and herder 各改各的），
 * 因此 from / to 用「 + 」把各项连起来，并额外做一次**重建验证**：
 * 把产出的改动应用回构造的作答，必须正好得到模型说的新文字。
 */
function runPipeline(testCase: Case): { from: string; to: string; rebuiltOk: boolean } | null {
  const isInsert = testCase.oldText === ''
  const isDelete = testCase.newText === ''

  // 把用例包成模型会返回的那种 JSON。
  //
  // 插入类必须给一个**在构造的作答里真实存在**的锚点：插入的落点是「补在这个片段之后」，
  // 锚点不存在时定位器会（正确地）拒绝，用例也就测不到任何东西。
  // 这里统一用构造作答末尾那个句点当锚点，于是插入落在整段作答的最后。
  const ANCHOR = '.'
  const error = isInsert
    ? { id: 'e1', type: 'insert', category: 'function-word', insertAfterText: ANCHOR, targetText: testCase.newText, explanation: 'x' }
    : isDelete
      ? { id: 'e1', type: 'delete', category: 'addition', oldText: testCase.oldText, explanation: 'x' }
      : { id: 'e1', type: 'replace', category: 'function-word', oldText: testCase.oldText, targetText: testCase.newText, explanation: 'x' }

  // 造一份"作答"：把 oldText 原样放进去，让定位与偏移换算都走真实路径。
  // 两侧刻意用**空格与句点**而不是词字符——词字符会被"按词对齐"卷进来，
  // 而重复的标点又会让定位器要求消歧，两者都是脚手架自身的干扰。
  const answer = ` ${testCase.oldText}.`
  const payload = isInsert
    ? error
    : { ...error, oldText: testCase.oldText }

  // 这些用例都是英文译文，方向按「中译英」给（只影响漏译/多译的轻重判定，与本用例要验的最小改动无关）
  const parsed = parseCorrection(JSON.stringify({ errors: [payload], highlights: [] }), answer, 'zh-to-en')
  if (!parsed.ok) return null
  const changed = parsed.correction.errors[0]?.changed
  if (!changed || changed.length === 0) return null

  const rebuilt = applyChangesToText(
    answer,
    changed.map((change) => ({ start: change.start, end: change.end, replacement: change.to })),
  )
  const expected = isInsert ? answer + testCase.newText : ` ${testCase.newText}.`

  return {
    from: changed.map((change) => answer.slice(change.start, change.end)).join(' + '),
    to: changed.map((change) => change.to).join(' + '),
    rebuiltOk: rebuilt === expected,
  }
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

    return {
      name: testCase.name,
      ok: fromOk && toOk && result.rebuiltOk,
      detail:
        `划出「${result.from}」上方写「${result.to}」` +
        (fromOk && toOk ? '' : `（期望「${testCase.expectFrom}」→「${testCase.expectTo ?? ''}」）`) +
        (result.rebuiltOk ? '' : '（重建验证失败：把这些改动应用回作答得不到模型说的新文字）'),
    }
  })
}