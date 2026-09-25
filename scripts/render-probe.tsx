/**
 * 渲染冒烟测试：在 jsdom 里真正把界面挂起来，走一遍「提交 → 批改 → 点批注」的流程。
 *
 * 为什么需要它：类型检查和 HTTP 探测都证明不了页面能不能真的渲染出来——
 * 组件里一个运行期错误就会白屏，而白屏是用户唯一无法自行修复的故障。
 *
 * 运行：npm run smoke
 */

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { fixtureCorrectionFor, MOCK_CASES } from '../src/domain/mock'
import { splitSections } from '../src/domain/sections'
import { validateCorrection } from '../src/domain/validate'
import { toAiShape } from '../src/domain/parse'
import { LENGTH_RULE, measureLength, toGeneratedExercise, type GeneratedArticle } from '../src/domain/generate'
import type { Direction, Genre, Mode } from '../src/domain/types'
// 造"能过提交门"的假作答（第 3 条之后必须有它，见该文件的说明）
import { answerForPage, appendNote } from './lib/probe-answer.mjs'

/** 顶层导航的标签文案，用于按题型切换（与 types.ts 的 MODE_TABS 保持一致）。 */
const MODE_TAB_LABEL: Record<string, string> = {
  article: '文章',
  paragraph: '段落',
  sentence: '句子',
  term: '术语',
}

export interface RenderProbe {
  html: string
  /** 逐页填入作答时，每一次「下一页」前后观察到的翻页导航状态（诊断用） */
  sectionNavTrace: Array<{ step: number; before: string; after: string; typedInto: string }>
  /** 批改结果区域的文字 */
  text: string
  /** 提交前右屏是否有输入框 */
  composeStageHadInput: boolean
  /** 提交后输入框是否从右屏消失（结果在同一位置替换它） */
  inputReplacedByResult: boolean
  /** 右上角「我的译文」栏在提交后显示的文字——用来抓"这一栏是空的"这类 bug */
  answerPaneText: string
  /** 右上栏的 HTML 片段，仅在该栏异常时用于诊断 */
  answerPaneHtml: string
  /** 右下栏的 HTML 片段，用来确认它只显示选中的那一处 */
  notesPaneHtml: string
  /**
   * 「点一处勾画 → 看那一处」的实测数据：气泡文字与右下栏文字。
   * 用来验证"点哪处显示哪处、不全量列出"这条交互。
   */
  interaction?: {
    markCount: number
    idleNotes: string
    firstMark: string
    firstNotes: string
    firstBubble: string
    /** 卡片的 HTML：说明里的「；」应当断成 <br>（分号换行） */
    firstBubbleHtml: string
    /** 点了某一处之后，原文栏里"对应那一段"的文字（用户要求：原文也标同色） */
    sourceMarkText: string
    /** 收起卡片之后，原文里那处标记应当消失 */
    sourceMarkAfterOutsideClick: string
    /** 卡片下方那颗按钮点击前 / 点击后的文案（收藏 → 已收藏） */
    firstFavoriteButton: string
    favoriteButtonAfterClick: string
    /** 点「收藏」之后浏览器里存下来的那几条 */
    favoriteStored: Array<{
      from?: string
      to?: string
      why?: string
      sentenceBefore?: string
      sentenceAfter?: string
      beforeStart?: number
      beforeEnd?: number
      afterStart?: number
      afterEnd?: number
    }>
    secondMark: string
    secondNotes: string
    secondBubble: string
    /** 小卡片是不是**挂在 document.body 上**（而不是在译文栏那棵子树里） */
    bubbleOutsideRoot: boolean
    /** 小卡片的内联 top（像素）与当时的视口高度——用来验"它没有被画到视口外面" */
    bubbleTop: number
    bubbleViewportHeight: number
    /** 卡片有没有翻到那一行上面（下面放不下时的退路，箭头跟着移到下沿） */
    bubbleFlipped: boolean
    /** 点**小卡片正文**之后：卡片还在不在（用户要求：点卡片不关） */
    bubbleAfterInsideBubble: string
    notesAfterInsideBubble: string
    /** 点**右下角那张卡片的正文**之后：两张卡都还在不在 */
    bubbleAfterInsideDetail: string
    notesAfterInsideDetail: string
    /** 右下栏里有几张详情卡片（应当恒为 1，而不是全量清单） */
    selectedDetailCount: number
    /** 点勾画之外的地方之后，右下栏的文字（应当回到提示） */
    notesAfterOutsideClick: string
    /** 点勾画之外的地方之后，气泡里的文字（应当为空） */
    bubbleAfterOutsideClick: string
    /** 点**上方补写的字**之后，气泡里的文字（应当等于那一处的说明） */
    bubbleAfterFixClick: string
    /** 点上方补写的字之后，右下栏的文字 */
    notesAfterFixClick: string
    /** 右下角有没有「点击查看 AI 完整返回内容」 */
    hasRawLink: boolean
    /** 点开之后，弹窗里的完整文本 */
    rawModalText: string
  }
  /** 大改档：整篇逐句重写 + 每句对应的原文 + 逐句解释，而且只给对照（见 domain/refine.ts） */
  refine?: {
    /** 按「返回编辑」把批过的那一页放开（作答还在） */
    reUnlock: boolean
    editorBack: boolean
    /** 档位切到「大改」 */
    levelPicked: boolean
    activeLevel: string
    /** 大改那一次提交打到了 /api/refine 几次 */
    refineCalls: number
    refineRequestBody: string
    /** 只给对照：对照列表在、勾画不在 */
    hasCompareList: boolean
    hasAnnotatedLines: boolean
    /** 一组里几行（第 4 条之后一组是"原文 / 我的译文 / 修改译文 / 说明"） */
    lineCount: number
    /** 第 4 条：每组最上面那行"原文"的数量与行首标签 */
    sourceLineCount: number
    sourceLabel: string
    originalLabel: string
    correctedLabel: string
    sourceText: string
    noteText: string
    /** 解释里带圈号的行数与圈号本身（用户要求：大改的解释按分号断行 + 圈号） */
    noteLineCount: number
    noteCircled: string[]
    noteBreaks: number
    correctedText: string
    /** 视图开关保留但禁用，并注明为什么 */
    viewButtonsDisabled: boolean
    lockedNote: string
    /** 大改**不打分**（用户拍板）：那一栏只写一句说明，且一个数字都没有 */
    scorePaneText: string
    scoreChip: string[]
    /** 右下角说清"不逐处批改" */
    notesPaneText: string
    paneHtml: string
  }
  /** 四栏边界可拖动；「返回编辑」之后输入框回来 */
  panels?: {
    hasSplitter: boolean
    manualApplied: boolean
    editorShown: boolean
    canReturnToResult: boolean
    /** 第 4 条：批改后的视图下**没有**「提交批改」这颗按钮 */
    submitVisibleInGraded: boolean
    resultBack: boolean
    judgeCallsAfterReturn: number
    /** 刚按「返回编辑」时的提交按钮文案（还没动字，应当是普通的「提交批改」） */
    submitLabelAfterUnlock: string
    /** 刚按「返回编辑」时有没有「批改记录」下拉（应当有：历史是落盘的，放开重写不影响它） */
    historyItemCount: number
    /** 下拉里至少有东西、而且点第一条真的把右栏切成了当时那份批改 */
    pickedFromHistory: boolean
    /** 改过字之后「批改记录」下拉还在吗（应当还在——这正是它比旧的「查看上次批改」强的地方） */
    historyKeptAfterEdit: boolean
    /** 改过之后**手动提交**：这一页重新变回只读、把刚批出来的结果显示出来（回归：曾经一直停在作答框上） */
    manualSubmitShowsResult: boolean
    manualSubmitReadOnly: boolean
    /** 从下拉里点一条回看的结果：回到带批注的批改、重新只读、而且不发请求 */
    backToResult: { 有批注译文: boolean; 又是只读: boolean; 新增调用: number }
  }
  /**
   * 逐页批改走一遍的观察：每翻一页记下这一页的状态、按钮文案、有没有输入框。
   * 见 renderApp 里那一段的说明——"哪一页批过、翻页会不会重复提交"就靠它钉住。
   */
  perPage: Array<{ page: number; state: string; hasInput: boolean; submitLabel: string; stateAfterLeave: string }>
  /**
   * 逐页批改**改版后**那一套规矩的观测点：翻页不提交、草稿留着、
   * 提交后的等待弹窗、批改中翻页、批改中别处不能提交、批完的右下角通知。
   */
  submits: Array<{
    page: number
    /** 点「下一页」引起的批改调用数（新规矩：0） */
    viaNav: number
    /** 翻走再翻回来，草稿还在不在（用户要求"保留当前页面输入缓存"） */
    draftKeptAfterRoundTrip: boolean
    /** 提交之后等待弹窗里的按钮文案（空数组 = 没弹；末页本就不该弹） */
    modal: string[]
    /** 批改还没回来时看到的样子（末页提交后不翻页，因此 duringJudge 是 null） */
    duringJudge: {
      /** 交出去之后，**正在批的那一页**上按钮写着什么（应当是"批改中…"） */
      judgingLabel: string
      /** 正在批的那一页，按钮按不按得动 */
      judgingDisabled: boolean
      /** 正在批的那一页，作答框是不是已经只读 */
      answerReadOnly: boolean
      /** 落到新的一页、写了字之后，提交按钮还按不按得动（一次只批一页） */
      submitDisabled: boolean
      elsewhereTitle: string
      /** 点「进入下一页」之后落在第几页（0 起） */
      pageAfterNext: number
      wentNext: boolean
    } | null
    /** 右下角那条通知的文案（没能弹出来就是空串） */
    toastText: string
    toastRouted: boolean
    /** 点通知之后落在第几页（0 起） */
    routedPage: number
    /** 跳过去之后通知自己消失了没有 */
    toastGoneAfterRoute: boolean
  }>
  /** 逐页批改：翻回第 1 页（已批过）时，批改结果是直接显示出来的，还是被重新提交了 */
  revisit: { showsResult: boolean; hasInput: boolean; judgeCalls: number }
  /**
   * 「返回编辑」没改字就翻页：回来时是批改界面还是作答框（用户要求必须是批改界面）。
   * 另一头：改过字再翻页，回来该是作答框（结果那时已经作废了）。
   */
  unlockRoundTrip?: { unlockedShown: boolean; gradingBack: boolean; stateAfterBack: string }
  editedRoundTrip?: { hasInput: boolean; hasResult: boolean }
  /** 「自定义」那一栏：自己贴一篇原文来练（原文本身就是一个输入框，见下面那段） */
  custom?: {
    /** 导航栏里的标签 */
    tabs: string[]
    navHasCustom: boolean
    /** 切过去之后，左上「原文」栏显示的文字 */
    shownSource: string
    /** 有没有参考译文那一栏（自己贴的题没有） */
    hasReference: boolean
    /** 有没有「换一换」与「AI 出题」（自己贴的题不该有） */
    hasAiButton: boolean
    hasRotateButton: boolean
    /** 原文栏里是不是一个**可写的原文输入框**（第 13 轮：不再弹窗问） */
    hasSourceInput: boolean
    /** 有没有贴题弹窗打开（第 13 轮之后**不该有**） */
    hasPasteModal: boolean
    /** 原文输入框里预填的内容（= 上次写的那一篇） */
    prefill: string
    /** 往输入框里写完新的一篇之后，「原文」栏显示的文字 */
    afterType: string
    /** 浏览器里存下来的那一篇（读回来的原文） */
    storedSource: string
    /** 按题号留的档里有几条（练习记录翻旧题要用） */
    historyCount: number
  }
  /** 对照视图与设置走一遍的结果 */
  views?: {
    compareLines: number
    compareText: string
    compareHtml: string
    /** 对照视图里每一行是不是"独占一行"（长句要在内部折行，不能挤成两列） */
    compareRowsFullWidth: boolean
    marksInCompareView: number
    coloredSpans: number
    boxesBefore: boolean
    settingsOpened: boolean
    toggledBoxes: boolean
    boxesAfter: boolean
    lineHeightStyle: string
  }
  /** AI 出题走一遍的结果 */
  generated?: {
    dialogOpened: boolean
    dialogClosed: boolean
    sourceChanged: boolean
    rotateEnabled: boolean
    notice: string
  }
  /** 练习记录页里打开一条记录后的样子（用来验证存档也带着勾画） */
  record?: {
    hasAnnotatedLines: boolean
    marks: number
    text: string
    /** 记录页左右两屏之间有没有可拖动的分隔条，拖过之后是不是切到了手动比例 */
    hasSplitter?: boolean
    manualAfterDrag?: boolean
    autoAfterDoubleClick?: boolean
    /** 收藏页里有几条、上面写了什么（交互那一段点过一次「收藏」） */
    favoritesCount?: number
    favoritesText?: string
  }
  /**
   * 译文文字流（不含绝对定位的标记）与提交的作答是否**逐字相同**。
   * 这是"批注不改变换行位置"的硬不变量：正确写法都画在方框层里，不占行内宽度。
   */
  flow?: { text: string; answer: string; matches: boolean }
  /** 左上角原文栏里有没有「换一换」按钮 */
  hasRotateButton: boolean
  /** 「换一换」是不是可用（只有一篇原文时应当禁用） */
  rotateDisabled: boolean
  /**
   * 切走再切回来之后，刚写的内容还在不在。
   * 只测"作答内容是否保留"（textarea 的 value），因为它是用户最在意的东西。
   */
  survivedTabRoundTrip?: { typed: string; afterReturn: string }
  /**
   * 切到别的题型再切回来之后，**批改结果**还在不在（不看作答文字，看那份批改本身）。
   * 用户的报告是"切走再切回来，之前的批改内容被清除了"，因此单独量这一件事。
   */
  tabRoundTripResult?: {
    before: { score: string; annotatedChars: number; notesChars: number; pageState: string }
    after: { score: string; annotatedChars: number; notesChars: number; pageState: string }
  }
  /**
   * 同一条要求的另一半：「我正在看这一页的第几次批改」也要扛住切栏。
   *
   * 用户原话是"切换之后切换回来，看到的东西不变"——切走时他看的是**那一次存档**，
   * 切回来要是变成作答框（或变成本页最新那次结果），就叫"东西变了"。
   * 判据取下拉上那行字（"第 N 次 · 时间" vs "共 N 次"），它比批注字形更能区分"这是哪一次"。
   */
  historyView?: {
    /** 有没有从下拉里选中一条 */
    picked: boolean
    /** 选中之前下拉上写的是什么（应当是"共 N 次"） */
    before: string
    /** 选中之后（切栏之前）写的是什么 */
    viewingBefore: string
    /** 切栏又切回来之后写的是什么（必须与 viewingBefore 一致） */
    viewingAfter: string
    /** 切回来之后右栏还是带批注的译文 */
    resultShown: boolean
    /** 切回来之后那颗按钮写「返回编辑」（看历史时的唯一出口），而且「回到作答」已经不在了 */
    returnToEditAfter: boolean
    backToWritingGone: boolean
  }
  /** 顶部导航里的模式标签 */
  modeTabLabels: string[]
  /** 切换到的第一个示例（用来核对四类题型都有题） */
  sampleIds: string[]
  judgeCalls: number
  /** 发给批改接口的请求体原文：用来断言参考译文没有被发出去 */
  judgeRequestBody: string
  /** 还原被这个探针改写过的全局对象，避免污染后续检查 */
  restore: () => void
}

/**
 * 造一篇"刚好达标"的文章，给 AI 出题的接口桩用。
 * 篇幅是**按官方口径算出来的**，不是抄一段固定文本——阈值改了这里也不会失效。
 */
function makeStubArticle(direction: Direction, topic: string, genre: Genre): GeneratedArticle {
  const rule = LENGTH_RULE[direction]
  const target = Math.round((rule.min + rule.max) / 2)
  const unit =
    direction === 'en-to-zh'
      ? 'Wetland restoration is slow and costly, and the benefits are shared far more widely than the costs. '
      : '湿地修复见效慢、花钱多，而收益却比成本分散得广得多。'
  const translation = direction === 'en-to-zh' ? '湿地修复见效慢、花钱多，而收益却比成本分散得广得多。' : 'Wetland restoration is slow and costly.'

  const source = buildUntil(direction, unit, target)
  return {
    topic,
    genre,
    paragraphs: splitInto(source, 4).map((text) => ({ source: text, translation })),
    terms: [
      {
        source: direction === 'en-to-zh' ? 'wetland restoration' : '湿地修复',
        translation: direction === 'en-to-zh' ? '湿地修复' : 'wetland restoration',
      },
    ],
  }
}

/** 反复拼同一句，直到长度刚好越过目标。 */
function buildUntil(direction: Direction, unit: string, target: number): string {
  let text = ''
  while (measureLength(direction, text) < target) text += unit
  return text.trim()
}

/** 均匀切成 n 段，模拟"按自然段组织"。 */
function splitInto(text: string, parts: number): string[] {
  const size = Math.ceil(text.length / parts)
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size))
  return chunks
}
/**
 * 批改接口的模拟响应。
 * 真实批改由 AI 完成，冒烟测试不该依赖网络与密钥；
 * 这里用内置假数据构造一个与真实接口**同结构**的响应，
 * 专门用来验证「提交 → 校验 → 渲染」这条链路本身。
 */
function makeJudgeFetch(options: { judgeDelayMs?: number } = {}): {
  fetch: typeof fetch
  calls: () => number
  lastBody: () => string
} {
  const judgeDelayMs = options.judgeDelayMs ?? 0
  let calls = 0
  let lastBody = ''

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const pathname = new URL(url, 'http://localhost/').pathname
    if (pathname === '/api/generate') {
      calls += 1
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        direction?: Direction
        genre?: Genre
        topic?: string
        mode?: Mode
      }
      const article = makeStubArticle(request.direction ?? 'en-to-zh', request.topic ?? '生态文明建设', request.genre ?? 'news')
      return new Response(
        JSON.stringify({
          ok: true,
          attempts: 1,
          exercise: toGeneratedExercise(article, request.mode ?? 'article'),
          raw: JSON.stringify(article, null, 2),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (pathname === '/api/refine') {
      /*
       * 大改档：回一份**与提交文字自洽**的重写结果。
       *
       * 重写只改一个字符（句首大写），这样 `minimizeChange` 能算出最小不同项、
       * 对照视图上只染那一个字——结构断言才验证得了"只染真正变了的字"这件事。
       *
       * ⚠️ 第 4 条之后这里有两处变了：
       *   - **不再有 score / comment**（大改档不打分，用户拍板；给了也会被丢掉）；
       *   - 每一句要带 **sourceText**（这一句对应的原文，界面靠它多排一行"原文"）。
       * 这些字段是**手搭的**（没走 parseRefine），因此必须与解析出来的形状一模一样，
       * 否则界面渲染时会在缺字段的地方炸掉——实测踩过（`sourceOf` 读 undefined 的 length）。
       */
      calls += 1
      lastBody = String(init?.body ?? '')
      const refineBody = JSON.parse(lastBody || '{}') as {
        answerSections?: Array<{ start: number; text: string }>
        source?: string
      }
      const refineSections = refineBody.answerSections ?? []
      const submittedText = refineSections.map((section) => section.text).join('\n\n').trim()
      const refined = submittedText.length > 0 ? submittedText[0]!.toUpperCase() + submittedText.slice(1) : submittedText
      const refineAnchorStart = refineSections[0]?.start ?? 0
      /* 原文那一句：取本页原文的第一句（真的从原文里切，因此定位得到、`sourceMatched` 为真） */
      const refineSource = (refineBody.source ?? '').split(/(?<=[.。!！?？])\s*/)[0]?.trim() ?? ''
      const refineSentence = {
        id: 'r1',
        sourceText: refineSource,
        sourceAnchor:
          refineSource.length > 0 && (refineBody.source ?? '').includes(refineSource)
            ? { start: 0, end: refineSource.length, snippet: refineSource }
            : null,
        sourceMatched: refineSource.length > 0 && (refineBody.source ?? '').includes(refineSource),
        oldText: submittedText,
        anchor: { start: refineAnchorStart, end: refineAnchorStart + submittedText.length, snippet: submittedText },
        rewritten: refined,
        explanation: '句首字母要大写；其余保持不变。',
        praise: '',
        changed: submittedText !== refined,
      }
      const refinePayload = {
        ok: true,
        attempts: 1,
        raw: JSON.stringify(
          {
            sentences: [
              {
                sourceText: refineSource,
                original: submittedText,
                rewritten: refined,
                explanation: '句首字母要大写；其余保持不变。',
              },
            ],
          },
          null,
          2,
        ),
        refine: { sentences: [refineSentence] },
      }
      return new Response(JSON.stringify(refinePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (pathname !== '/api/judge') throw new Error(`渲染测试未预期的请求：${pathname}`)
    calls += 1
    lastBody = String(init?.body ?? '')

    // 用请求里实际提交的作答来构造批注，与真实流程一致
    const body = JSON.parse(lastBody || '{}') as {
      answerSections?: Array<{ start: number; text: string }>
      source?: string
      direction?: Direction
    }
    /** 真实接口拿得到方向（它就在请求里），位置校验与算分都要它——这里如实照抄 */
    const judgedDirection: Direction = body.direction ?? 'en-to-zh'
    const submitted = (body.answerSections ?? []).map((section) => section.text).join('\n\n')
    /*
     * 找到"提交的作答属于哪一道内置示例"。
     *
     * 只有配上**示例作答本身**，内置批改里的锚点才校验得过——批注的位置是按那段文字算出来的，
     * 换一段文字去核对必然全部对不上（校验器如实拒掉，界面上一处标注都不显示）。
     *
     * 文章库 / 句子库那些题的作答是探针自动填的、不属于任何示例。这时**不编批注**，
     * 直接回一份"没有错误、也没有亮点"的合法结果：界面照样走完提交 → 渲染 → 计分 → 记录，
     * 结构断言（四栏、接口只调一次、记录页、设置）全部有效；
     * 只是没有勾画可点，因此**不该**拿"有几处标注"这类内容断言去要求它。
     */
    const matched =
      MOCK_CASES.find((item) => item.sampleAnswer.trim() === submitted.trim()) ??
      MOCK_CASES.find((item) => item.exercise.source === body.source)

    if (!matched) {
      /*
       * 作答不属于任何内置示例（文章库 / 句子库那些题，作答是探针自动填的）：
       * 回一份**与提交文字自洽**的批改——从提交的作答里取一个片段当亮点。
       *
       * 为什么不能凭空编一批批注：批注的位置是锚点（区间 + 原文片段），
       * 位置与提交文字对不上时校验器会如实拒掉，界面上一处都不显示，
       * 于是"译文上有带批注的勾画"这类结构断言就废了。
       * 取真实片段当亮点，位置与文字天然自洽，勾画与对照视图就有内容可渲染，
       * 结构断言（四栏、接口只调一次、记录页、设置）全部有效。
       */
      const excerpt = submitted.trim().split(/\s+/).slice(0, 4).join(' ')
      const anchorStart = excerpt ? submitted.indexOf(excerpt) : 0
      const highlight = {
        id: 'h1',
        anchor: { start: Math.max(0, anchorStart), end: Math.max(0, anchorStart) + excerpt.length, snippet: excerpt },
        comment: '渲染测试用的固定亮点（作答不属于任何内置示例时由此兜底）',
      }
      const checkedEmpty = validateCorrection([], [highlight], submitted, judgedDirection)
      const payload = {
        ok: true,
        attempts: 1,
        sectionCount: (body.answerSections ?? []).length,
        repaired: checkedEmpty.rejections.map((rejection) => `${rejection.id}：${rejection.message}`),
        correction: { errors: [], highlights: [highlight] },
        validated: {
          errors: [],
          highlights: checkedEmpty.highlights.map((entry) => ({ highlight: entry.highlight, span: entry.span })),
          rejections: checkedEmpty.rejections,
        },
        raw: JSON.stringify({ errors: [], highlights: [highlight] }, null, 2),
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const exercise = matched
    const answerForFixture = exercise.sampleAnswer

    const correction = fixtureCorrectionFor(exercise.exercise.id, answerForFixture)
    if (!correction) throw new Error('渲染测试：取不到内置示例的批改结果')
    /*
     * 给第一处批注补一个**"翻译前的那段原文"**（真实 AI 会返回 sourceText，程序据此定位）。
     * 这里按同样的形状补上，才能验"点这一处 → 左边原文栏对应那一段也标同色"这件事——
     * 那份字段是可选的，fixture 里本来没有。
     */
    {
      const sourceText = (body.source ?? '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
      const at = sourceText ? (body.source ?? '').indexOf(sourceText) : -1
      const firstError = correction.errors[0]
      if (firstError && at >= 0) {
        firstError.sourceText = sourceText
        firstError.sourceAnchor = { start: at, end: at + sourceText.length, snippet: sourceText }
      }
    }
    // 与真实接口保持严格同构：真实接口也会把位置校验的结果与 AI 原始返回一起带回来
    const checked = validateCorrection(correction.errors, correction.highlights, answerForFixture, exercise.exercise.direction)
    const payload = {
      ok: true,
      attempts: 1,
      sectionCount: (body.answerSections ?? []).length,
      repaired: checked.rejections.map((rejection) => `${rejection.id}：${rejection.message}`),
      correction: { errors: correction.errors, highlights: correction.highlights },
      validated: {
        errors: checked.errors.map((entry) => ({
          error: entry.error,
          changes: entry.changes,
          span: entry.span,
          insertPoint: entry.insertPoint,
          reorderSpans: entry.reorderSpans,
          reordered: entry.reordered,
        })),
        highlights: checked.highlights.map((entry) => ({ highlight: entry.highlight, span: entry.span })),
        rejections: checked.rejections,
      },
      // AI 原样返回的文本：界面上「查看 AI 完整返回内容」看到的就是它
      raw: JSON.stringify(toAiShape(correction), null, 2),
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /*
   * 只在探针要求时把**批改**那一趟拖慢。
   *
   * 为什么需要它：真实批改要十几秒到一分钟，而这一轮新增的几条规矩全都发生在
   * "请求已经发出去、结果还没回来"这段时间里——等待弹窗、翻页不拦、
   * 一次只批一页（别处不许再提交）、批完的右下角通知。
   * 桩默认是**立刻**返回的，那段时间宽度为零，这些都测不到。
   * 拖慢的是"返回"这一侧：调用次数、请求体照旧当场记下，因此计数类断言不受影响。
   */
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await handle(input, init)
    if (judgeDelayMs > 0) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, 'http://localhost/').pathname === '/api/judge') {
        await new Promise((resolve) => setTimeout(resolve, judgeDelayMs))
      }
    }
    return response
  }

  return { fetch: impl as unknown as typeof fetch, calls: () => calls, lastBody: () => lastBody }
}

/** 在 jsdom 环境里挂载界面并与之交互，返回渲染出的 HTML 与纯文本。 */
export async function renderApp(
  options: {
    exerciseId?: string
    checkTabRoundTrip?: boolean
    checkRecords?: boolean
    checkGenerate?: boolean
    checkPanels?: boolean
    /** 走一遍大改档：整篇逐句重写 + AI 总评 + 只给对照（见 domain/refine.ts） */
    checkRefine?: boolean
    checkViews?: boolean
    /** 先在浏览器里存一篇自定义题（模拟"上次贴过"），贴题流程用它做起点 */
    seedCustom?: string
    /** 走一遍「自定义」贴题流程，并把这一段期间贴进去的原文填成这个 */
    checkCustom?: string
    /**
     * 目标题**不在内置题库里**时的题型（文章库 / 句子库 / 术语库供题的栏）。
     * 指定了 exerciseId 又查不到内置示例时，用它决定切到哪一栏；不指定就按文章栏。
     */
    mode?: Mode
    /**
     * 让 `/api/judge` 晚这么多毫秒才返回（默认 0 = 立刻）。
     *
     * 逐页那一段要靠它才测得到"批改正在跑"这段时间里的界面：
     * 等待弹窗、批改中照样翻页、一次只批一页、批完的右下角通知。
     */
    judgeDelayMs?: number
    /**
     * 以**没登录**的身份渲染（默认是已登录）。
     *
     * 第 15 轮起「提交批改」要求登录（用户要求：没登录就提交失败、弹出登录/注册窗口），
     * 而探针绝大多数流程测的是批改本身，因此默认塞一个已登录会话进去；
     * 想验"没登录会被拦下"那条时传 `guest: true`。
     */
    guest?: boolean
  } = {},
): Promise<RenderProbe> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })

  const globalAny = globalThis as unknown as Record<string, unknown>
  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>()
  const install = (key: string, value: unknown): void => {
    // 用 defineProperty 而不是直接赋值：Node 内建的 navigator 等属性只有 getter，
    // 直接赋值会抛 TypeError。
    savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalAny, key))
    Object.defineProperty(globalAny, key, { value, writable: true, configurable: true })
  }

  install('window', dom.window)
  install('document', dom.window.document)
  install('navigator', dom.window.navigator)
  install('HTMLElement', dom.window.HTMLElement)
  install('Element', dom.window.Element)
  install('Node', dom.window.Node)
  install('Event', dom.window.Event)
  install('MouseEvent', dom.window.MouseEvent)
  install('KeyboardEvent', dom.window.KeyboardEvent)
  install('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  install('requestAnimationFrame', (cb: FrameRequestCallback): number => setTimeout(() => cb(Date.now()), 0) as unknown as number)
  install('cancelAnimationFrame', (id: number): void => clearTimeout(id))
  /*
   * localStorage 也要装上：自定义题存在浏览器里（domain/custom.ts），
   * 不装的话那边只能走"读不到"的分支——测试会以为功能坏了，其实是环境没给它。
   */
  install('localStorage', dom.window.localStorage)
  install('sessionStorage', dom.window.sessionStorage)
  install('IS_REACT_ACT_ENVIRONMENT', true)

  const judgeFetch = makeJudgeFetch({ judgeDelayMs: options.judgeDelayMs ?? 0 })
  install('fetch', judgeFetch.fetch)

  /*
   * 「自定义」那一栏：模拟"上一次贴过的一篇还留在浏览器里"。
   */
  if (options.seedCustom) {
    const seeded = { id: 'custom-seed', source: options.seedCustom, createdAt: new Date().toISOString() }
    dom.window.localStorage.setItem('translation-practice.custom', JSON.stringify(seeded))
  }

  /*
   * 登录态：默认"已登录"（见 options.guest 的说明）。
   *
   * 这里只塞 localStorage 那一条记录，不去打 /api/auth/me——接口桩对其他路径是**抛错**的
   * （见下面的 makeJudgeFetch），而 store 的 restore 对网络错误是"保留本地缓存"，
   * 因此这个会话会稳稳留着，正好也是真实情况里"断网时也认得你是谁"的那条分支。
   */
  if (!options.guest) {
    dom.window.localStorage.setItem(
      'translation-practice.session.v1',
      JSON.stringify({
        token: 'probe-session-token',
        user: { username: '探针用户', avatar: null, isAdmin: false, createdAt: 0, updatedAt: 0 },
      }),
    )
  } else {
    /*
     * ⚠️ 只清 localStorage 是不够的：`authStore` 是**模块级单例**，而 App 是动态 import 的
     * （见下面那段），模块只在第一次渲染时加载一次——构造函数读过种子之后就不会再读。
     * 因此"以游客身份渲染"必须走它自己的 `logout()`：那才是真的"现在没人登录"。
     *
     * 由此带来一条使用上的约束：**游客渲染会把单例里的会话清掉**，
     * 之后再跑的"已登录"探针不会自动恢复（模块不会重跑构造函数）。
     * smoke 里因此把游客那一段放在最后。
     */
    const { authStore } = await import('../src/components/auth/store')
    authStore.logout()
  }

  // jsdom 不实现 ResizeObserver；调序弧线依赖它做尺寸观测
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  install('ResizeObserver', StubResizeObserver)
  Object.defineProperty(dom.window, 'ResizeObserver', { value: StubResizeObserver, configurable: true })

  /*
   * jsdom 不做排版：所有元素的 getBoundingClientRect 都是 0×0。
   * 调序弧线直接依赖它，于是"弧线"这条链路在测试里永远算不出坐标，
   * 断言就退化成"只要渲染出 <svg> 就算过"——真坏掉时照样是绿的（实际踩过）。
   * 这里给一个固定但非零的 rect，让弧线真的被配对、真的被画出来；
   * 气泡定位读的是同一个方法，顺带也覆盖到了。
   */
  const stubRect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 120,
    height: 20,
    right: 120,
    bottom: 20,
    toJSON: () => ({}),
  } as DOMRect
  dom.window.Element.prototype.getBoundingClientRect = () => stubRect

  const { createRoot } = await import('react-dom/client')
  const { App } = await import('../src/components/App')
  const { createElement } = await import('react')

  const container = dom.window.document.getElementById('root')
  if (!container) throw new Error('没有挂载点')

  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(App))
  })

  const textOf = (selector: string): string => container.querySelector(selector)?.textContent ?? ''

  const composeStageHadInput = container.querySelector('.answer-input') !== null
  const modeTabLabels = [...container.querySelectorAll('.mode-tab')].map((node) => node.textContent?.trim() ?? '')
  const sampleIds = MOCK_CASES.map((item) => item.exercise.id)

  // 先把内置示例的作答填进输入框（模拟用户真的打字），再点提交。
  // 必须用原生 setter + input 事件，React 才会收到这次受控更新。
  //
  // 注意：默认题目是一篇分段文章，而文章模式要求每段都写完才允许提交，
  // 因此这里按段落逐段填入，而不是只填一段。
  /*
   * 目标题目与"要打进去的作答"。
   *
   * 题库里有示例作答的（MOCK_CASES）优先用示例——那样批改的是真实的错误样本，
   * 勾画、对照视图这些断言才有内容可测。
   *
   * 但**「句子」栏现在由文章库供题**（从该领域文章里切的单句），内置句子题不再从界面可达；
   * 「文章」栏同理。这类题没有示例作答，探针就把**屏幕上的原文本身**当作答打进去——
   * 结构断言（提交后是否换成带批注的译文、四栏是否就位、接口是否只调一次）照样成立，
   * 只是批改内容来自接口桩的固定响应，不代表真实错误样本。
   */
  const builtIn = MOCK_CASES.find((item) => item.exercise.id === options.exerciseId)
  const targetMode = builtIn ? builtIn.exercise.mode : (options.mode ?? 'article')
  const answerSections = builtIn ? splitSections(builtIn.sampleAnswer) : []

  /*
   * 切到目标题型（必要时再切题目）。
   *
   * 为什么**无条件**切，而不是只在指定了 exerciseId 时切：
   * 界面打开时落在哪一栏是**会变的**——「文章」栏现在由文章库供题（真实新闻选段），
   * 而文章库的选段没有示例作答，探针没法自动填答。若探针假定"打开就是目标题"，
   * 它会往一个不存在示例的界面上打字，于是提交按钮一直是禁用的
   * （表现为"提交后调用了批改接口 0 次"）。本探针用的是题库示例作答，
   * 因此必须显式把自己切到那道题所在的题型。
   */
  const activeTabLabel = container.querySelector('.mode-tab.mode-tab-active')?.textContent?.trim()
  if (process.env.DSH_PROBE_DEBUG) {
    console.log(
      `[probe] 目标题型=${targetMode}(${MODE_TAB_LABEL[targetMode]}) 当前高亮=${activeTabLabel ?? '(无)'} ` +
        `共 ${container.querySelectorAll('.mode-tab').length} 个题型标签 内置题=${builtIn?.exercise.id ?? '(无)'}`,
    )
  }
  /*
   * 切到目标题型。
   *
   * 为什么**无条件**切（而不是"内置题就不切"）：界面的默认落点是文章栏，
   * 若目标题属于别的栏，不切就会把作答打到文章栏那道题上——提交按钮一直是禁用的，
   * 表现为"提交后调用了批改接口 0 次"（踩过两次）。
   * 探针因此显式把自己切到目标题型，再（若目标是内置示例）靠题号切到那道题。
   */
  const alreadyThere = activeTabLabel === MODE_TAB_LABEL[targetMode]
  if (!alreadyThere) {
    const modeTab = [...container.querySelectorAll<HTMLButtonElement>('.mode-tab')].find(
      (node) => node.textContent?.trim() === MODE_TAB_LABEL[targetMode],
    )
    if (modeTab) {
      await act(async () => {
        modeTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
  }
  if (options.exerciseId && builtIn) {
    // 该题型下有多道题时靠题号切；文章库/句子库那类没有按钮的题干不在此列
    const caseTab = [...container.querySelectorAll<HTMLButtonElement>('.case-tab')].find((node) =>
      node.textContent?.includes(builtIn.exercise.topic),
    )
    if (caseTab) {
      await act(async () => {
        caseTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
  }

  /**
   * 逐段填入作答时记录分段导航的状态。
   *
   * 为什么要有这个：这一段的失败现象（"提交按钮一直禁用"）离根因很远，
   * 光看断言只知道"没提交成功"。把每一步的导航文案记下来，
   * 就能一眼看出"第几段没切过去"。
   */
  const sectionNavTrace: Array<{ step: number; before: string; after: string; typedInto: string }> = []
  const navText = (): string => container.querySelector('.section-nav .hint')?.textContent?.trim() ?? '(无分段导航)'
  /** 这一页现在是"待批改 / 已批改 / 已修改待提交"——翻页导航中间那句话里带着它 */
  const pageStateNow = (): string => navText()

  const typeInto = async (text: string): Promise<void> => {
    const target = container.querySelector<HTMLTextAreaElement>('.answer-input')
    if (!target) return
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(target, text)
      target.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  /** 让出一轮事件循环（React 的异步动作靠它推进） */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  const clickNav = async (which: 'prev' | 'next'): Promise<void> => {
    const button = container.querySelector<HTMLButtonElement>(`.section-nav [data-nav="${which}"]`)
    if (!button || button.disabled) return
    const pageBefore = sectionIndexNow()
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    /*
     * ⚠️ 必须等到**界面上真的翻过去了**再返回，光等 `act` 是不够的。
     *
     * 「下一页」不只是翻页：它还**先把这一页交去批改**（一个 await 的异步过程，
     * 里面还有一次 useEffect/DOM 提交）。`act` 只保证这次事件处理跑完，
     * 而它第一个 await 之后发生的事情（批改返回、写入结果、切页）都还在飞行中。
     * 早先没等就直接往下读界面，读到的是**翻页之前**的状态与正文：
     * 表现为"每一页都写到第 1 页上""翻走时那一页还是待批改"（踩过，很难定位）。
     */
    const expected = which === 'next' ? pageBefore + 1 : pageBefore - 1
    for (let round = 0; round < 60; round += 1) {
      /*
       * 等到**页码真的变了**再返回，光等 `act` 是不够的（见上面的说明）。
       *
       * 这里只等页码，不指望"离开的那一页已经在界面上显示成已批改"——
       * 那个状态还会再晚一步才画出来，拿它当条件就会一直空等。
       * "这一页到底交出去没有"改由**练习记录**来验（见 smoke.ts），
       * 那是落盘的事实，不依赖渲染时机。
       */
      if (sectionIndexNow() === expected) return
      await tick()
    }
  }

  /**
   * 现在在第几页（从 0 开始）。
   *
   * 只从界面上读：导航中间那句"第 N / M 页 · …"是页号的**唯一**来源，
   * 探针不去偷看 App 的状态——它要验的正是"界面上说的是不是真的"。
   */
  const sectionIndexNow = (): number => {
    const matched = /第\s*(\d+)\s*\//.exec(navText())
    return matched?.[1] ? Number(matched[1]) - 1 : 0
  }

  /**
   * 翻到指定的页（在当前页与目标页之间一步一步走）。
   *
   * 为什么不让循环"记住上一轮停在哪一页"：那样每一轮的正确性都依赖上一轮的收尾动作，
   * 而这一轮新增的动作（提交后的等待窗、点右下角通知跳回来）恰恰会打乱收尾位置——
   * 一处出错就变成"每一页都写在别的页上"，症状离原因很远（踩过）。
   * 现在每一轮开头都先站到自己该在的那一页上，循环内部就自洽了。
   */
  const goToPage = async (target: number): Promise<void> => {
    for (let round = 0; round < 12; round += 1) {
      const now = sectionIndexNow()
      if (now === target) return
      await clickNav(now < target ? 'next' : 'prev')
      // 翻不动了（到了头）就别空转
      if (sectionIndexNow() === now) return
    }
  }

  /**
   * 让当前这一页变成可写的。
   *
   * 逐页批改下批过的页是**只读**的（要在它上面打字得先按「返回编辑」），
   * 因此每一次要填字之前都得问一下"现在还写不写得进去"。
   */
  const ensureEditable = async (): Promise<void> => {
    if (container.querySelector('.answer-input') !== null) return
    const unlock = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].find(
      (node) => node.textContent?.trim() === '返回编辑',
    )
    if (!unlock) return
    await act(async () => {
      unlock.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  /** 手动按「提交批改」，**不等结果**就返回（批改中要验的界面状态全靠它） */
  const clickSubmit = async (): Promise<HTMLButtonElement | null> => {
    const button = container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')
    if (!button || button.disabled) return null
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    return button
  }

  /** 等某件事成真（批改是异步的，界面总要过几拍才跟上） */
  const waitFor = async (ready: () => boolean, rounds = 300): Promise<boolean> => {
    for (let round = 0; round < rounds; round += 1) {
      if (ready()) return true
      await tick()
    }
    return false
  }

  /** 弹窗底部的按钮文案（等待弹窗与 AI 出题弹窗共用同一个壳，因此这里按文案认） */
  const modalButtonTexts = (): string[] =>
    [...container.querySelectorAll<HTMLButtonElement>('.raw-modal-backdrop .gen-foot .btn')].map(
      (node) => node.textContent?.trim() ?? '',
    )

  const clickModalButton = async (text: string): Promise<boolean> => {
    const node = [...container.querySelectorAll<HTMLButtonElement>('.raw-modal-backdrop .gen-foot .btn')].find(
      (item) => item.textContent?.trim() === text,
    )
    if (!node) return false
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    return true
  }

  /** 右下角那条批改完成通知的文案（没有就是空串） */
  const toastText = (): string => container.querySelector('.judge-toast')?.textContent?.trim() ?? ''

  const clickToast = async (): Promise<boolean> => {
    const node = container.querySelector<HTMLButtonElement>('.judge-toast-main')
    if (!node) return false
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    return true
  }

  /** 手动按「提交批改」并等它批完（只在最后一页用：那一页提交完就不动了） */
  const submitCurrentPage = async (): Promise<void> => {
    const button = container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')
    if (!button || button.disabled) return
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    /*
     * 等结果真的落到界面上：提交按钮消失（批过的那一页是只读的）就是落定的标志。
     * 同样不能只等 `act`——批改是异步的。
     */
    await waitFor(() => container.querySelector('.pane-answer .btn-primary') === null, 60)
  }

  /*
   * 「自定义」那一栏：自己贴一篇原文来练。
   *
   * 顺序是刻意的：这一段要跑在**读页面之前**（下面是 sectionsToFill）。
   * 贴题会把当前题目整个换掉，而逐页流程读的是"屏幕上这一篇"——
   * 先读、后贴，读到的就是上一个题目的页数与正文（踩过：拿 8 页的文章去套 3 页的自定义题）。
   */
  let custom: RenderProbe['custom']
  if (options.checkCustom) {
    const clickText = async (selector: string, text: string): Promise<boolean> => {
      const node = [...container.querySelectorAll<HTMLButtonElement>(selector)].find(
        (item) => item.textContent?.trim() === text,
      )
      if (!node) return false
      await act(async () => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      return true
    }
    const hasButton = (text: string): boolean =>
      [...container.querySelectorAll('.pane-source .btn')].some((node) => node.textContent?.trim() === text)

    const tabs = [...container.querySelectorAll('.mode-tab')].map((node) => node.textContent?.trim() ?? '')
    await clickText('.mode-tab', '自定义')
    const shownSource = textOf('.pane-source')
    const hasReference = container.querySelector('.pane-source .reference') !== null

    /*
     * 第 13 轮起**没有贴题弹窗**了：原文栏自己就是一个输入框（`.source-input`），
     * 进来直接往里写——因此这里不再点「重新贴一篇」、也不再点「开始练习」，
     * 而是把字直接打进那个框里（模拟用户真的粘一段进去）。
     */
    const sourceInput = container.querySelector<HTMLTextAreaElement>('.pane-source .source-input')
    const prefill = sourceInput?.value ?? ''
    if (sourceInput) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(sourceInput, options.checkCustom)
        sourceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    }

    // 存进浏览器了没有：直接问 localStorage（刷新后还在，靠的就是它）
    const storedRaw = dom.window.localStorage.getItem('translation-practice.custom') ?? ''
    const historyRaw = dom.window.localStorage.getItem('translation-practice.custom-sources') ?? ''
    let storedSource = ''
    try {
      storedSource = (JSON.parse(storedRaw) as { source?: string }).source ?? ''
    } catch {
      storedSource = ''
    }
    let historyCount = 0
    try {
      historyCount = Object.keys(JSON.parse(historyRaw) as Record<string, string>).length
    } catch {
      historyCount = 0
    }

    custom = {
      tabs,
      navHasCustom: tabs.includes('自定义'),
      shownSource,
      hasReference,
      hasAiButton: hasButton('AI 出题'),
      hasRotateButton: hasButton('换一换'),
      hasSourceInput: sourceInput !== null,
      hasPasteModal: container.querySelector('.gen-modal') !== null,
      prefill,
      afterType: textOf('.pane-source'),
      storedSource,
      historyCount,
    }
  }

  /*
   * 没有内置示例作答（文章库/句子库/自定义题）时，**造一段合规的假译文**打进去
   * （见 scripts/lib/probe-answer.mjs）。
   *
   * ⚠️ 以前这里是把**屏幕上的原文**当作答打进去的。第 3 条之后那样行不通了：
   * 提交前要数篇幅（文章题/段落题必须多于 30 个单位，英译中数汉字、中译英数单词），
   * 而把中文原文当"英文译文"交上去只有 1 个词——门一拦，一次批改都不会发出去
   * （表现为"批改调用 0 次"，很容易被误读成功能坏了）。
   *
   * 造出来的假译文够长、且与页号相关（各页互不相同），因此两道门都过，
   * 而批改内容仍然来自接口桩的固定响应，不代表真实错误样本。
   *
   * 多段原文要**一段一段读**：原文栏一次只显示当前那一页，因此这里翻到最后再翻回来，
   * 把每一页的**原文**收集起来（用来判断该页该填中文还是英文），再据此造作答。
   * 这一步只翻页、不写不打字，因此不会触发任何提交。
   */
  /**
   * 屏幕上"原文"那一块的文字。
   *
   * ⚠️ 两处都要读：自己贴的题（第 13 轮起）原文栏是一个**输入框**（`.source-input`），
   * 其它题型是只读的 `.source-text`。只读前者会让自定义题的作答按**空原文**去造，
   * 方向随之判反（中文原文被当成英文原文），造出来的"译文"过不了提交门，
   * 现象是"点了提交却一次请求都没发出去"（实测踩到）。
   */
  const fallbackSource = (): string =>
    (
      container.querySelector('.pane-source .source-text')?.textContent ??
      container.querySelector<HTMLTextAreaElement>('.pane-source .source-input')?.value ??
      ''
    ).trim()

  /**
   * 把"现在这一篇"的每一页原文读下来，并据此造出每一页的合格作答。
   *
   * 读完之后会翻回第 1 页——**用实际读到的页号决定翻几次**，不要用读到的段数：
   * 中途点不动时"读了几段"和"走了几页"会对不上，用段数回退就会回退过头，
   * 现象是整个逐页流程在错误的页码上跑（踩过：探针在第 1 页上重复写了 8 遍）。
   */
  const readPagesFromScreen = async (): Promise<string[]> => {
    if (!container.querySelector('.section-nav')) return [answerForPage(fallbackSource(), 0)]
    const collected: string[] = []
    for (;;) {
      collected.push(answerForPage(fallbackSource(), collected.length))
      const next = container.querySelector<HTMLButtonElement>('.section-nav [data-nav="next"]')
      if (!next || next.disabled) break
      await clickNav('next')
    }
    const atPage = sectionIndexNow()
    for (let index = 0; index < atPage; index += 1) await clickNav('prev')
    return collected
  }

  const sectionsToFill: string[] =
    answerSections.length > 0 ? answerSections.map((s) => s.text) : []
  if (sectionsToFill.length === 0) {
    /*
     * ⚠️ 必须在**贴题流程跑完之后**才读页面：
     * 上面那一段会把当前题目整个换掉（换成刚贴的那一篇），
     * 换题之前读到的页数与正文都属于**上一个题目**。
     * 先读、后贴，就会出现"拿 8 页的文章去套 3 页的自定义题"这种错位
     * （表现为每一页都写到同一页上、页号全是 1）。
     */
    sectionsToFill.push(...(await readPagesFromScreen()))
  }
  if (process.env.DSH_PROBE_DEBUG) {
    console.log(
      `[probe] 内置题=${builtIn ? builtIn.exercise.id : '(无，用屏幕原文当作答)'} 页数=${sectionsToFill.length} ` +
        `首页=${JSON.stringify(sectionsToFill[0]?.slice(0, 40))} 输入框=${!!container.querySelector('.answer-input')}`,
    )
    if (custom) {
      console.log(
        `[probe] 自定义：checkCustom=${options.checkCustom?.length ?? 0} 输入框=${custom.hasSourceInput} 预填=${custom.prefill.length} 键入后原文栏=${JSON.stringify(
          custom.afterType.slice(0, 40),
        )} 存档=${custom.storedSource.length} 导航=${!!container.querySelector('.section-nav')}`,
      )
    }
  }

  /*
   * 逐页走一遍：填一页 → 自己按「提交批改」 → 翻到下一页接着译。
   *
   * ⚠️ 这一轮（第三版）把这条主循环重写了。早先它是"填一页 → 点「下一页」，
   * 翻页时自动把这一页交出去"，而用户已经把自动提交取消：
   * 「点击下一页或者上一页，不触发提交批改，而是保留当前页面输入缓存，后面返回时可以继续作答」。
   *
   * 因此每一轮除了"填、交、翻"，还顺手验了这一轮改动要守住的四件事
   * （它们全发生在"请求发出去、结果还没回来"那段时间里，因此这一段把桩拖慢：
   * 见 renderApp 的 judgeDelayMs）：
   *   1. 点「下一页」**不引起批改调用**，而且翻回来草稿还在；
   *   2. 提交之后弹出等待窗，两个按钮都在；点「进入下一页」能走，且**批改还在跑**；
   *   3. 批改期间**别处也不能提交**（一次只批一页）；
   *   4. 批完右下角弹出通知，点它跳回那一页，通知随之消失。
   */
  const perPage: Array<{ page: number; state: string; hasInput: boolean; submitLabel: string; stateAfterLeave: string }> = []
  const submits: RenderProbe['submits'] = []

  for (const [index, section] of sectionsToFill.entries()) {
    // 每一轮开头先站到自己该在的那一页上（上一轮的收尾未必落在这里，见 goToPage）
    await goToPage(index)
    const before = navText()
    await ensureEditable()
    await typeInto(section)
    // 注意：typedInto 要在**填完之后**读，否则记下的是上一次的残留
    const typedInto = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    sectionNavTrace.push({ step: index, before, after: navText(), typedInto })
    // 离开这一页**之前**的样子：应该是在写（有输入框）、状态是"待批改"
    const pendingState = pageStateNow()
    const hadInput = container.querySelector('.answer-input') !== null

    const isLast = index === sectionsToFill.length - 1
    /** 点「下一页」引起的批改调用数（新规矩：必须是 0） */
    let viaNav = 0
    let draftKeptAfterRoundTrip = false
    /** 翻走再回来之后，这一页自己说它是什么状态（新规矩下应当是"待批改"） */
    let stateAfterLeave = '(末页，翻不过去)'

    if (!isLast) {
      /*
       * 规矩 1：**翻页只是翻页**。
       * 翻过去、再翻回来，两头各问一句：有没有偷偷提交？草稿还在不在？
       * `stateAfterLeave` 就在翻回来的那一刻读——那时界面说的才是"这一页现在是什么状况"。
       */
      const callsBeforeNav = judgeFetch.calls()
      await clickNav('next')
      viaNav = judgeFetch.calls() - callsBeforeNav
      await clickNav('prev')
      draftKeptAfterRoundTrip =
        (container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? '') === section
      stateAfterLeave = pageStateNow()
    }

    /*
     * 提交：
     *   - 非末页：按「提交批改」，这时应当弹出等待窗，然后**点「进入下一页」**
     *     在批改还没回来的情况下翻走（这正是用户要的"等待过程中可进入下一页"）；
     *   - 末页：后面没有下一页，因此不该弹窗（`modal` 空即证据），直接等结果。
     */
    let modal: string[] = []
    let duringJudge: RenderProbe['submits'][number]['duringJudge'] = null
    let pageText = ''
    let toastRouted = false
    let routedPage = -1
    let toastGoneAfterRoute = false

    if (isLast) {
      await submitCurrentPage()
      modal = modalButtonTexts()
    } else {
      await clickSubmit()
      modal = modalButtonTexts()
      /*
       * 交出去之后**立刻**看这一页（还没翻走）：按钮应当变成按不动的"批改中…"，
       * 作答框应当只读——"批改中不能提交"这条要求最直接的两条证据。
       */
      const judgingButton = container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')
      const answerBox = container.querySelector<HTMLTextAreaElement>('.answer-input')
      const judgingLabel = judgingButton?.textContent?.trim() ?? ''
      const judgingDisabled = judgingButton?.disabled ?? false
      const answerReadOnly = answerBox?.readOnly ?? false
      const wentNext = await clickModalButton('进入下一页')
      const pageAfterNext = sectionIndexNow()
      /*
       * 规矩 3：**批改中别处也不能提交**。
       * 落到新的一页上先写两个字，把"按钮禁用是不是因为没写东西"这条歧义排除掉——
       * 写了字还按不动，才说明挡住它的是"另一页正在批"。
       */
      await typeInto(`${section}\n（下一页的草稿）`)
      const button = container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')
      duringJudge = {
        judgingLabel,
        judgingDisabled,
        answerReadOnly,
        submitDisabled: button === null || button.disabled,
        elsewhereTitle: button?.title ?? '',
        pageAfterNext,
        wentNext,
      }
    }

    /*
     * 规矩 4：批完右下角弹通知，点它跳回来。
     * 这里必须**等到通知出现**：它在批改返回之后才画出来，而这一段故意把桩拖慢，
     * 所以"点了按钮马上读"一定读不到（那会变成一条假红）。
     */
    const appeared = await waitFor(() => toastText().includes('已经批改完成'))
    pageText = appeared ? toastText() : ''
    toastRouted = await clickToast()
    routedPage = sectionIndexNow()
    toastGoneAfterRoute = toastText() === ''

    perPage.push({
      page: index,
      state: pendingState,
      hasInput: hadInput,
      submitLabel: container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')?.textContent?.trim() ?? '',
      stateAfterLeave,
    })
    submits.push({
      page: index,
      viaNav,
      draftKeptAfterRoundTrip,
      modal,
      duringJudge,
      toastText: pageText,
      toastRouted,
      routedPage,
      toastGoneAfterRoute,
    })
  }

  /*
   * 翻回第 1 页：那一页**已经批过**，必须直接显示当时那份结果、
   * 并且**不产生新的批改调用**——这就是"返回上一页查看结果"那条要求。
   */
  const callsBeforeRevisit = judgeFetch.calls()
  await clickNav('prev')
  const revisit = {
    showsResult: container.querySelector('.pane-answer .annotated-lines') !== null,
    hasInput: container.querySelector('.answer-input') !== null,
    judgeCalls: judgeFetch.calls() - callsBeforeRevisit,
  }

  /*
   * 用户要求："假如当前页面处于批改后的状态，那么切换其他页，再切换回来时，
   * 也需要在批改界面，不能回到编辑界面。"
   *
   * 两种情形各量一次，因为正确答案是相反的：
   *   ① **按了「返回编辑」但一个字没改**就翻走 → 回来该看到批改结果（结果还在，没理由退回作答框）；
   *   ② 放开之后**真的改了一个字**再翻走 → 回来该是作答框（结果那时已经作废了）。
   *
   * ⚠️ 必须**只在多页题上跑**：单页题没有"另一页"可翻，这一段里的 `typeInto` 会直接写进
   * 这一页的作答框，把主流程刚提交出来的结果顶成"正在编辑"（加这段时实际踩过，
   * 表现是主流程那几条"右上角有批注"的断言一起变红）。
   */
  let unlockRoundTrip: RenderProbe['unlockRoundTrip']
  let editedRoundTrip: RenderProbe['editedRoundTrip']
  if (sectionsToFill.length > 1) {
    await ensureEditable()
    const unlockedShown = container.querySelector('.answer-input') !== null
    await clickNav('next')
    await clickNav('prev')
    unlockRoundTrip = {
      unlockedShown,
      gradingBack:
        container.querySelector('.answer-input') === null &&
        container.querySelector('.pane-answer .annotated-lines') !== null,
      stateAfterBack: pageStateNow(),
    }

    // 这一页现在仍是"已批改"（那个标记被收回了），先放开、改一个字，再翻走又翻回来
    await ensureEditable()
    await typeInto('（改一个字再翻走）')
    await clickNav('next')
    await clickNav('prev')
    editedRoundTrip = {
      hasInput: container.querySelector('.answer-input') !== null,
      hasResult: container.querySelector('.pane-answer .annotated-lines') !== null,
    }
  }
  // 停在最后一页收场：后面那些断言看的是"刚提交完"的样子
  await clickNav('next')

  /*
   * AI 出题：打开弹窗 → 点生成 → 应当切到刚出的那一篇（并留存下来）。
   * 走的是与真实接口同形的桩，因此"提交 → 校验 → 落库（内存）→ 切过去"整条链路都被覆盖。
   */
  let generated: RenderProbe['generated']
  if (options.checkGenerate) {
    const openButton = [...container.querySelectorAll<HTMLButtonElement>('.pane-source .btn')].find(
      (node) => node.textContent?.trim() === 'AI 出题',
    )
    if (openButton) {
      await act(async () => {
        openButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      const dialogOpened = container.querySelector('.gen-modal') !== null
      const beforeText = textOf('.pane-source')
      const submitGen = [...container.querySelectorAll<HTMLButtonElement>('.gen-foot .btn')].find((node) =>
        node.textContent?.includes('生成题目'),
      )
      if (submitGen) {
        await act(async () => {
          submitGen.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
      }
      const afterText = textOf('.pane-source')
      const rotate = [...container.querySelectorAll<HTMLButtonElement>('.pane-source .btn')].find(
        (node) => node.textContent?.trim() === '换一换',
      )
      generated = {
        dialogOpened,
        dialogClosed: container.querySelector('.gen-modal') === null,
        sourceChanged: afterText !== beforeText && afterText.length > beforeText.length,
        rotateEnabled: rotate ? !rotate.disabled : false,
        notice: textOf('.pane-source'),
      }
    }
  }

  /*
   * 末页已经在上面的逐页循环里交出去了（那一页是"待批改"，按钮就在），
   * 因此这里只做校验：**提交之后按钮应当消失**——批过的页是只读的，
   * 想再改要先按「返回编辑」。这条比"点一下按钮"更能说明这一栏现在的形态。
   */
  const submitGoneAfterSubmit = container.querySelector('.pane-answer .btn-primary') === null

  // 关键：末页提交后，答题位置换成带批注的译文，左下与右下换成计分与批注
  const inputReplacedByResult =
    submitGoneAfterSubmit &&
    container.querySelector('.answer-input') === null &&
    container.querySelector('.pane-score') !== null &&
    container.querySelector('.pane-notes') !== null

  /*
   * 交互验证：点译文上的一处勾画 →
   *   1) 那一行下面浮出气泡（简要说明）
   *   2) 右下角换成**这一处**的完整说明（不是全量清单）
   * 再点另一处，右下角必须跟着换。
   */
  const notesText = (): string => textOf('.pane-notes')
  /*
   * ⚠️ 小卡片现在挂在 `document.body` 上（`position: fixed`，见 AnnotationText 的 createPortal），
   * 因此**不能**再在 `#root` 里面找它——它已经从那一棵子树里搬出去了。
   * 这正是"不被下面的栏目挡住"那条要求的实现方式：译文栏的正文盒子是滚动容器，
   * 滚动容器会把超出它的内容剪掉，卡片留在里面就一定会被剪。
   */
  const bubbleNode = (): HTMLElement | null => dom.window.document.querySelector<HTMLElement>('.ann-bubble')
  const bubbleText = (): string => (bubbleNode()?.textContent ?? '').trim()
  const markNodes = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.pane-answer [data-mark-id]')]
  const clickMark = async (index: number): Promise<void> => {
    const node = markNodes()[index]
    if (!node) return
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  const idleNotes = notesText()
  const initialMarks = markNodes()
  const markCount = initialMarks.length
  const firstMark = initialMarks[0]?.textContent?.trim() ?? ''
  const secondMark = initialMarks[1]?.textContent?.trim() ?? ''

  await clickMark(0)
  const firstNotes = notesText()
  const firstBubble = bubbleText()
  const firstBubbleHtml = bubbleNode()?.innerHTML ?? ''
  /** 小卡片是不是**挂到 body 上**了（它必须在译文栏那棵子树之外，否则会被滚动容器剪掉） */
  const bubbleOutsideRoot = bubbleNode() !== null && container.querySelector('.ann-bubble') === null
  const bubbleTop = Number.parseFloat(bubbleNode()?.style.top ?? '') || 0
  const bubbleViewportHeight = dom.window.innerHeight || 768
  const bubbleFlipped = bubbleNode()?.className.includes('ann-bubble-above') === true
  /*
   * 原文栏里"这一处对应的地方"（用户要求）：点了译文上的某一处之后，
   * 左边原文栏里对应的那一小段也要用同一个颜色标出来；收起卡片就消失。
   * 区间来自 AI 给的 sourceText（见下面 stub 里补的那一段）。
   */
  const sourceMarkText = container.querySelector('.pane-source .source-mark')?.textContent?.trim() ?? ''
  const selectedDetailCount = container.querySelectorAll('.pane-notes .detail-list').length
  // 卡片下方那颗「收藏」：点了之后文案要变成「已收藏」，并且真的进了收藏页
  const favoriteButton = (): HTMLButtonElement | undefined =>
    [...container.querySelectorAll<HTMLButtonElement>('.pane-notes .detail-foot .btn')].find(
      (node) => node.textContent?.trim() === '收藏' || node.textContent?.trim() === '已收藏',
    )
  const favoriteBefore = favoriteButton()?.textContent?.trim() ?? ''
  const favoriteBtn = favoriteButton()
  if (favoriteBtn) {
    await act(async () => {
      favoriteBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  const favoriteAfter = favoriteButton()?.textContent?.trim() ?? ''
  const favoriteStored = (() => {
    try {
      return JSON.parse(dom.window.localStorage.getItem('translation-practice.favorites') ?? '[]') as Array<{
        from?: string
        to?: string
        why?: string
        sentence?: string
      }>
    } catch {
      return []
    }
  })()

  await clickMark(1)
  const secondNotes = notesText()
  const secondBubble = bubbleText()

  /*
   * 用户要求："点击任意卡片都不会关掉这两个卡片，当且仅当点击这两个卡片之外的地方才消失。"
   *
   * 两张卡片各点一次**卡片正文**（不是按钮）：都必须还在。
   * 早先的判据是一张类名清单，只放行了卡片里的标题与按钮，点到正文就等于点了外面——
   * 用户看到的就是"点卡片它也会消失"。现在两张卡各带一个 `data-card` 标记，
   * 判定按整张卡走。两个标记都在点外面那一段（下面）之前量，顺序不能倒。
   */
  const clickInside = async (node: Element | null | undefined): Promise<void> => {
    if (!node) return
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  await clickInside(bubbleNode()?.querySelector('.ann-bubble-why'))
  const bubbleAfterInsideBubble = bubbleText()
  const notesAfterInsideBubble = notesText()
  await clickInside(container.querySelector('.pane-notes .detail-body'))
  const bubbleAfterInsideDetail = bubbleText()
  const notesAfterInsideDetail = notesText()

  // 点勾画之外的地方：气泡应当消失、右下角回到提示。
  // 坐标特意给一个大值——探针把所有元素的 rect 都桩成固定方块，
  // 用 (0,0) 会被"点在气泡上"这条判断拦下来。
  const outside = container.querySelector<HTMLElement>('.pane-source') ?? container
  await act(async () => {
    outside.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 900, clientY: 700 }))
  })
  const notesAfterOutsideClick = notesText()
  const bubbleAfterOutsideClick = bubbleText()
  /** 收起小卡片之后，原文里那处标记也该跟着消失（用户要求） */
  const sourceMarkAfterOutsideClick = container.querySelector('.pane-source .source-mark')?.textContent?.trim() ?? ''

  /*
   * 点**上方补写的字**（`.fix-text`）：它代表的是同一处，也该把小卡片打开。
   * 之前文档级的"点外面就收起来"把它当成外面，于是点上去等于没反应（实际踩过）。
   */
  const fixBox = container.querySelector<HTMLElement>('.pane-answer .fix-text')
  if (fixBox) {
    await act(async () => {
      fixBox.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  const bubbleAfterFixClick = bubbleText()
  const notesAfterFixClick = notesText()
  // 收起来，别把选中状态带进后面那些"看结果"的检查里
  await act(async () => {
    outside.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 900, clientY: 700 }))
  })

  // 「点击查看 AI 完整返回内容」→ 屏幕中央的弹窗
  const rawLink = container.querySelector<HTMLElement>('.pane-notes .raw-link')
  if (rawLink) {
    await act(async () => {
      rawLink.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  const rawModalText = (container.querySelector('.raw-modal-body')?.textContent ?? '').trim()
  const closeModal = container.querySelector<HTMLElement>('.raw-modal-close')
  if (closeModal) {
    await act(async () => {
      closeModal.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  const interaction: RenderProbe['interaction'] =
    markCount > 0
      ? {
          markCount,
          idleNotes,
          firstMark,
          firstNotes,
          firstBubble,
          firstBubbleHtml,
          sourceMarkText,
          sourceMarkAfterOutsideClick,
          firstFavoriteButton: favoriteBefore,
          favoriteButtonAfterClick: favoriteAfter,
          favoriteStored,
          secondMark,
          secondNotes,
          secondBubble,
          bubbleOutsideRoot,
          bubbleTop,
          bubbleViewportHeight,
          bubbleFlipped,
          bubbleAfterInsideBubble,
          notesAfterInsideBubble,
          bubbleAfterInsideDetail,
          notesAfterInsideDetail,
          selectedDetailCount,
          notesAfterOutsideClick,
          bubbleAfterOutsideClick,
          bubbleAfterFixClick,
          notesAfterFixClick,
          hasRawLink: Boolean(rawLink),
          rawModalText,
        }
      : undefined

  // 切走再切回来，检查会不会丢东西
  let survivedTabRoundTrip: RenderProbe['survivedTabRoundTrip']
  let tabRoundTripResult: RenderProbe['tabRoundTripResult']
  /** 切走再切回来时，"我正在看第几次批改"这件事有没有被记住 */
  let historyView: RenderProbe['historyView']
  if (options.checkTabRoundTrip) {
    const clickTab = async (label: string): Promise<void> => {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('.mode-tab')].find(
        (node) => node.textContent?.trim() === label,
      )
      if (!tab) throw new Error(`找不到题型标签：${label}`)
      await act(async () => {
        tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const backTabLabel = MODE_TAB_LABEL[targetMode] ?? '文章'
    const readGraded = (): { score: string; annotatedChars: number; notesChars: number; pageState: string } => ({
      score: textOf('.pane-score .score-number').trim(),
      annotatedChars: (container.querySelector('.pane-answer .annotated-lines')?.textContent ?? '').length,
      notesChars: textOf('.pane-notes').trim().length,
      pageState: navText(),
    })

    /*
     * ① 先量"**已批改**的那一页切走再切回来，那份批改还在不在"。
     *
     * 这正是用户报告的那一条（"切换导航栏，切换回来发现之前的批改内容清除了"）。
     * 必须**趁这一页还是只读的**去量：一旦按下「返回编辑」，画面上本来就没有批注了
     * （那是另一个状态），量出来的"0 字"会让人以为功能坏了——第一版就写错在这里。
     */
    const gradedBefore = readGraded()
    await clickTab('术语')
    await clickTab(backTabLabel)
    await tick()
    tabRoundTripResult = { before: gradedBefore, after: readGraded() }

    /*
     * ② 再量"正在写的那一页切走再切回来，写进去的字还在不在"。
     * 这一页已经批过，得先按「返回编辑」——它同时也是"改过的页不再自动提交"的起点。
     */
    for (let index = sectionIndexNow(); index > 0; index -= 1) await clickNav('prev')
    await ensureEditable()
    const typed = '这是一段用来检查切换页面是否会丢失的文字'
    await typeInto(typed)
    const afterTyping = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''

    await clickTab('术语')
    await clickTab(backTabLabel)
    await tick()

    const afterReturn = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    survivedTabRoundTrip = { typed: afterTyping, afterReturn }

    /*
     * 收场：留在**末页已批改**上，后面那些"看结果"的断言才有结果可看。
     * 末页也已经被批过，所以同样是先「返回编辑」、写、再手动交出去。
     */
    for (let index = sectionIndexNow(); index < sectionsToFill.length - 1; index += 1) await clickNav('next')
    const lastSection = sectionsToFill[sectionsToFill.length - 1] ?? ''
    await ensureEditable()
    /*
     * ⚠️ 必须**改一句再交**：这一页在逐页流程里已经用同样的文字交过一次，
     * 而第 3 条之后"与之前任何一次提交一字不差"会被拦下（那是"防重复提交"的正经作用）。
     * 追加一句既保证过篇幅那道门（只会更长），又让它与上一次不同。
     */
    await typeInto(appendNote(lastSection, '（收场：探针在这里加了一句，好让这次提交不被"重复提交"拦住）'))
    await submitCurrentPage()

    /*
     * ③ 第三件事：**"我正在看这一页的第几次批改"也要扛住切栏**。
     *
     * 这是用户报的第二条原话："批改界面下，切换导航栏后，回到文章模式时，
     * 不要恢复到批改前的空白状态，而是保留记忆，相当于切换之后切换回来，看到的东西不变。"
     * 当时的那条路线上写着 `selectTab` 里一句 `setViewingGradeId(null)`——
     * 于是切走时屏幕上是那一次存档，切回来变成作答框，看着就像批改结果被清空了。
     *
     * 判据取「批改记录」下拉上那行小字：正在看某一次时写的是"第 N 次 · 时间"，
     * 没在看时写的是"共 N 次"——两者一眼可分，不必去猜右栏那些批注是谁的。
     */
    const pickerTriggerText = (): string => {
      const node = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .domain-trigger')].find((item) =>
        item.textContent?.includes('批改记录'),
      )
      return node?.textContent?.trim() ?? ''
    }
    const pickerBefore = pickerTriggerText()
    const pickerTrigger = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .domain-trigger')].find(
      (item) => item.textContent?.includes('批改记录'),
    )
    let pickedFromPicker = false
    if (pickerTrigger) {
      await act(async () => {
        pickerTrigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      const firstItem = container.querySelector<HTMLButtonElement>('.pane-answer .domain-item')
      if (firstItem) {
        await act(async () => {
          firstItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        pickedFromPicker = true
      }
    }
    const viewingLabelBefore = pickerTriggerText()
    await clickTab('术语')
    await clickTab(backTabLabel)
    await tick()
    /*
     * 第 6 条之后**没有「回到作答」那颗按钮了**：正在看历史时，标题栏那颗按钮写「返回编辑」，
     * 点它就离开历史视图、回到这一页的作答框（看下面的收场）。
     */
    const returnToEditButtons = () =>
      [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].filter(
        (node) => node.textContent?.trim() === '返回编辑',
      )
    historyView = {
      picked: pickedFromPicker,
      before: pickerBefore,
      viewingBefore: viewingLabelBefore,
      viewingAfter: pickerTriggerText(),
      resultShown: container.querySelector('.pane-answer .annotated-lines') !== null,
      returnToEditAfter: returnToEditButtons().length > 0,
      backToWritingGone: ![...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].some(
        (node) => node.textContent?.trim() === '回到作答',
      ),
    }
    // 收场：点「返回编辑」，离开历史视图、把这一页还回可写
    const toEdit = returnToEditButtons()[0]
    if (toEdit) {
      await act(async () => {
        toEdit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
  }

  /*
   * 练习记录页：存档里必须也带着勾画——"回看时知道当时哪里错了"正是记录的意义。
   * 单独跑一趟，因为切到记录页之后返回的 HTML 就不是练习页了。
   */
  let record: RenderProbe['record']
  if (options.checkRecords) {
    const clickTabByLabel = async (label: string): Promise<void> => {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('.mode-tab')].find(
        (node) => node.textContent?.trim() === label,
      )
      if (!tab) throw new Error(`找不到导航标签：${label}`)
      await act(async () => {
        tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    await clickTabByLabel('练习记录')
    const firstRecord = container.querySelector<HTMLElement>('.record-item')
    if (firstRecord) {
      await act(async () => {
        firstRecord.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const pane = container.querySelector('.split-nested .pane-answer')
    const paneHtml = pane?.innerHTML ?? ''

    /*
     * 记录页左右两屏之间的分隔条也要能拖：拖一下应当切到手动比例（split-manual），
     * 双击恢复自动。这是这一轮新加的能力，量一次钉住。
     */
    const recordsSplitter = container.querySelector<HTMLElement>('.split-records > .splitter-v')
    if (recordsSplitter) {
      await act(async () => {
        recordsSplitter.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }))
      })
      await act(async () => {
        recordsSplitter.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 200 }))
      })
      await act(async () => {
        recordsSplitter.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }))
      })
    }
    const recordsManual = container.querySelector('.split-records.split-manual') !== null
    if (recordsSplitter) {
      await act(async () => {
        recordsSplitter.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
      })
    }
    const recordsBackToAuto = container.querySelector('.split-records.split-manual') === null

    record = {
      hasAnnotatedLines: Boolean(pane?.querySelector('.annotated-lines')),
      marks: (paneHtml.match(/class="mk /g) ?? []).length,
      text: pane?.textContent ?? '',
      hasSplitter: Boolean(recordsSplitter),
      manualAfterDrag: recordsManual,
      autoAfterDoubleClick: recordsBackToAuto,
    }

    // 收藏页：交互那一段点过一次「收藏」，这里应当看得到那一条
    await clickTabByLabel('收藏')
    record.favoritesCount = container.querySelectorAll('.fav-item').length
    record.favoritesText = textOf('.favorites')
  }

  let views: RenderProbe['views']
  if (options.checkViews) {
    const clickByText = async (selector: string, text: string): Promise<void> => {
      const node = [...container.querySelectorAll<HTMLElement>(selector)].find((item) =>
        item.textContent?.trim().includes(text),
      )
      if (!node) return
      await act(async () => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }

    await clickByText('.view-btn', '对照视图')
    const compareHtml = container.querySelector('.compare-list')?.innerHTML ?? ''
    const compareText = textOf('.compare-list')
    const compareLines = container.querySelectorAll('.compare-line').length
    const marksInCompareView = (compareHtml.match(/class="mk /g) ?? []).length
    const coloredSpans = (compareHtml.match(/class="compare-mark"/g) ?? []).length
    /*
     * 「一句话占一行」：每一行（原译 / 改后）都应当占满整栏宽度，
     * 而不是被排成左右两列。判据取"两行的左边界相同、宽度也相同"——
     * 排成两列时它们的 left 必然不一样（jsdom 不排版，这里量的是桩出来的固定矩形，
     * 因此改看结构：两个 <p> 各自独占父级的一行，父级是纵向 flex 列表）。
     */
    const rowBoxes = [...container.querySelectorAll<HTMLElement>('.compare-line > p')]
    const rowParents = new Set(rowBoxes.map((node) => node.parentElement?.className ?? ''))
    const compareRowsFullWidth =
      rowBoxes.length >= 2 && rowParents.size === 1 && [...rowParents][0] === 'compare-line'

    await clickByText('.view-btn', '批改视图')
    const boxesBefore = container.querySelector('.fix-text') !== null

    await clickByText('.topbar .btn', '设置')
    const settingsOpened = container.querySelector('.gen-check') !== null
    const checkbox = container.querySelector<HTMLInputElement>('.gen-check input')
    if (checkbox) {
      await act(async () => {
        checkbox.click()
      })
    }
    const boxesAfter = container.querySelector('.fix-text') !== null
    const lineHeightStyle = container.querySelector<HTMLElement>('.annotated-lines')?.getAttribute('style') ?? ''

    views = {
      compareLines,
      compareText,
      compareHtml,
      compareRowsFullWidth,
      marksInCompareView,
      coloredSpans,
      boxesBefore,
      settingsOpened,
      toggledBoxes: Boolean(checkbox),
      boxesAfter,
      lineHeightStyle,
    }
  }

  let panels: RenderProbe['panels']
  if (options.checkPanels) {
    /*
     * 1) 批阅态是**只读**的；按「返回编辑」才放开，而且放开之后
     *    **不能**再悄悄交一次（`judgeCallsAfterReturn` 与放开前相等）。
     *
     *    这一条正是逐页批改的核心取舍：批过的页想改就得明确说一句，
     *    说了之后也不再自动提交——否则用户每改一个字都在花钱调模型。
     */
    const callsBeforeUnlock = judgeFetch.calls()
    const unlock = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].find(
      (node) => node.textContent?.trim() === '返回编辑',
    )
    /*
     * 批过的那一页现在是结果视图：**没有输入框**，而标题栏那颗按钮写的是「返回编辑」。
     *
     * ⚠️ 第 2 条之后这里不能再要求"没有提交按钮"了：那颗按钮**一直在同一个位置**，
     * 只是名字在两种状态之间换（批改后叫「返回编辑」，点是回到可写；回到可写又叫「提交批改」）。
     * 因此判据改成"它在、而且写着「返回编辑」"——那正是"同一颗按钮，两个名字"的证据。
     */
    const gradedButton = container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')
    const readonlyBeforeUnlock =
      container.querySelector('.answer-input') === null &&
      gradedButton?.textContent?.trim() === '返回编辑'
    /*
     * 第 4 条：**批改后的视图下不该能点「提交批改」**。
     * 判据就是"标题栏那颗主按钮上写的是不是提交批改"——那一档根本不画提交按钮。
     */
    const submitVisibleInGraded = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn-primary')].some(
      (node) => node.textContent?.trim() === '提交批改',
    )
    if (unlock) {
      await act(async () => {
        unlock.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const editorShown = container.querySelector('.answer-input') !== null
    /*
     * 放开之后**还没改字**：按钮仍是普通的「提交批改」，
     * 而回看那一次批改靠的是**「批改记录」下拉**（用户要求把「查看上次批改」按钮删掉）。
     * 这里量三件事：
     *   1. 放开之后下拉还在（历史是落盘的，不随"放开重写"消失）；
     *   2. 打开下拉能看到那一次（至少一条），点它能把右栏切成当时那份批改；
     *   3. 整个过程**不发请求**（回看不是重新批改）。
     */
    const submitLabelAfterUnlock =
      container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')?.textContent?.trim() ?? ''
    const historyTrigger = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .domain-trigger')].find(
      (node) => node.textContent?.includes('批改记录'),
    )
    const callsBeforeGoBack = judgeFetch.calls()
    let historyItemCount = 0
    let pickedFromHistory = false
    if (historyTrigger) {
      await act(async () => {
        historyTrigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      const items = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .domain-item')]
      historyItemCount = items.length
      const first = items[0]
      if (first) {
        await act(async () => {
          first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        pickedFromHistory = true
      }
    }
    const backToResult = {
      有批注译文: container.querySelector('.pane-answer .annotated-lines') !== null,
      又是只读: container.querySelector('.answer-input') === null,
      新增调用: judgeFetch.calls() - callsBeforeGoBack,
    }
    /*
     * 点「返回编辑」离开历史视图（第 6 条之后这是唯一出口），再走后面那些断言。
     * 它同时把这一页放开成可写——下面的"改一个字再提交"就是从这个状态开始的。
     */
    const backToWriting = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].find(
      (node) => node.textContent?.trim() === '返回编辑',
    )
    if (backToWriting) {
      await act(async () => {
        backToWriting.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    /*
     * 改一个字、翻走再翻回来：**一个批改调用都不该多**。
     *
     * ⚠️ 这条比早先更强：那时翻页仍会自动提交（只有"改过的页"例外），
     * 因此这里量的是"改过的页不自动提交"；现在自动提交整个取消了，
     * 翻页无论改没改过都只是翻页——`judgeCallsAfterReturn` 必须是 0。
     *
     * 改的方式是**在原文后面追加一句**（而不是整段换成一句短话）：
     * 下面要拿这段文字去"手动提交"，而第 3 条之后重复提交会被拦下、
     * 太短也会被拦下（篇幅那道门）——整段换成一句短话两条都过不了。
     */
    const textBeforeEdit = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    await typeInto(appendNote(textBeforeEdit, '（改了一下：探针追加一句，好让重新提交不被拦住）'))
    const submitLabelAfterEdit =
      container.querySelector<HTMLButtonElement>('.pane-answer .btn-primary')?.textContent?.trim() ?? ''
    /** 改过字之后下拉**仍然在**（这正是它比旧的「查看上次批改」强的地方） */
    const historyKeptAfterEdit = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .domain-trigger')].some(
      (node) => node.textContent?.includes('批改记录'),
    )
    await clickNav('prev')
    await clickNav('next')
    const judgeCallsAfterReturn = judgeFetch.calls()

    /*
     * 改过之后**手动提交**：这一页必须重新变回只读、把刚批出来的结果显示出来。
     *
     * 这是一个真实存在过的窟窿：「返回编辑」把这一页记进 `unlocked` 之后，
     * 它再也回不到"已批改"那一档——用户改完按了提交，界面却仍旧停在作答框上、
     * 左边还写着"已修改 · 待提交"，而新结果明明已经存下来了。
     * 现在提交成功会把这一页收回只读（见 session.ts 的 `pageLocked`）。
     */
    await submitCurrentPage()
    const manualSubmitShowsResult = container.querySelector('.pane-answer .annotated-lines') !== null
    const manualSubmitReadOnly = container.querySelector('.answer-input') === null

    // 2) 拖动左右边界：应当切到手动比例，并记住
    const splitter = container.querySelector<HTMLElement>('.splitter-v')
    if (splitter) {
      await act(async () => {
        splitter.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120 }))
      })
      await act(async () => {
        splitter.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 320, clientY: 120 }))
      })
      await act(async () => {
        splitter.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }))
      })
    }

    panels = {
      hasSplitter: Boolean(splitter),
      manualApplied: container.querySelector('.split-manual') !== null,
      editorShown,
      canReturnToResult: readonlyBeforeUnlock && Boolean(unlock),
      /** 第 4 条：批改后的那一档**看不到提交按钮** */
      submitVisibleInGraded,
      resultBack: submitLabelAfterEdit.includes('提交批改'),
      judgeCallsAfterReturn: judgeCallsAfterReturn - callsBeforeUnlock,
      submitLabelAfterUnlock,
      historyItemCount,
      pickedFromHistory,
      historyKeptAfterEdit,
      manualSubmitShowsResult,
      manualSubmitReadOnly,
      backToResult,
    }
  }

  /*
   * 「自定义」那一栏的检查已经搬到上面（必须在收集页面文字之前跑完），
   * 这里只留一个位置说明，免得后来人以为漏了一段。
   */

  // 译文文字流：把调序圈号（绝对定位的标记）去掉后，必须与作答逐字相同
  const flowLines = container.querySelector('.pane-answer .annotated-lines')
  const flowText = (flowLines?.textContent ?? '').replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
  const submittedAnswer = answerSections.map((section) => section.text).join('\n\n')

  /*
   * 大改档：**整篇逐句重写 + 逐句解释 + AI 总评**，而且只给对照（用户要求）。
   *
   * 跑在主流程之后：那时这一页刚批过、是只读的，于是这一段先按「返回编辑」放开它
   * （作答还在），再把档位切到「大改」，重新提交一次——正好是把真实用法的顺序走了一遍。
   */
  let refine: RenderProbe['refine']
  if (options.checkRefine) {
    const clickByTextIn = async (selector: string, label: string): Promise<boolean> => {
      const node = [...container.querySelectorAll<HTMLButtonElement>(selector)].find(
        (item) => item.textContent?.trim() === label,
      )
      if (!node) return false
      await act(async () => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      return true
    }

    // 1) 放开这一页，再把档位切到大改
    const reUnlock = await clickByTextIn('.pane-answer .btn', '返回编辑')
    const editorBack = container.querySelector('.answer-input') !== null
    const levelPicked = await clickByTextIn('.level-btn', '大改')
    const activeLevel = container.querySelector('.level-btn-active')?.textContent?.trim() ?? ''

    // 2) 重新提交：这一次走的是 /api/refine
    /*
     * ⚠️ 交之前先**改一句**：这一页刚刚用同样的文字交过一次，
     * 而第 3 条之后"与之前任何一次提交一字不差"会被拦下（不发出任何请求）。
     * 追加一句既过篇幅那道门，也过"防重复提交"那道门。
     */
    const beforeRefineText = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    await typeInto(appendNote(beforeRefineText, '（大改：探针追加一句，好让这次提交不被"重复提交"拦住）'))
    const callsBeforeRefine = judgeFetch.calls()
    await submitCurrentPage()
    const refineCalls = judgeFetch.calls() - callsBeforeRefine

    const paneHtml = container.querySelector('.pane-answer')?.innerHTML ?? ''
    const switchButtons = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .view-btn')]
    refine = {
      reUnlock,
      editorBack,
      levelPicked,
      activeLevel,
      /** 大改的那一次提交打到了 /api/refine（而不是 /api/judge）+ 那一次的请求体 */
      refineCalls,
      refineRequestBody: judgeFetch.lastBody(),
      /** 只给对照：对照列表在、勾画不在 */
      hasCompareList: container.querySelector('.pane-answer .compare-list') !== null,
      hasAnnotatedLines: container.querySelector('.pane-answer .annotated-lines') !== null,
      /** 第 4 条：一组里"原文 / 我的译文 / 修改译文"三行 + 说明 */
      lineCount: container.querySelectorAll('.pane-answer .compare-line').length,
      sourceLineCount: container.querySelectorAll('.pane-answer .compare-source').length,
      sourceLabel: textOf('.pane-answer .compare-label-source'),
      originalLabel: textOf('.pane-answer .compare-original .compare-label'),
      correctedLabel: textOf('.pane-answer .compare-corrected .compare-label'),
      sourceText: textOf('.pane-answer .compare-source'),
      noteText: container.querySelector('.pane-answer .compare-note')?.textContent?.trim() ?? '',
      /*
       * 大改的解释也要**按分号断行、每行带圈号**（用户要求："大改模式下，解释部分也要
       * 按照分号进行圈一圈二的序号标注分行"）。判据与小卡片那份是同一个
       * （explain-lines.tsx），因此这里直接数带圈号的行，并比对纯文本（圈号去掉后拼回来）。
       */
      noteLineCount: container.querySelectorAll('.pane-answer .compare-note .explain-line').length,
      noteCircled: [...container.querySelectorAll('.pane-answer .compare-note .explain-num')].map(
        (node) => node.textContent?.trim() ?? '',
      ),
      noteBreaks: container.querySelectorAll('.pane-answer .compare-note br').length,
      correctedText: textOf('.pane-answer .compare-corrected'),
      /** 视图开关保留但禁用，并注明为什么 */
      viewButtonsDisabled: switchButtons.length > 0 && switchButtons.every((button) => button.disabled),
      lockedNote: textOf('.pane-answer .view-switch'),
      /** 大改**不打分**（用户拍板）：那一栏只写一句说明 */
      scorePaneText: textOf('.pane-score'),
      scoreChip: [...container.querySelectorAll('.pane-score .chip')].map((node) => node.textContent?.trim() ?? ''),
      /** 右下角说清"不逐处批改" */
      notesPaneText: textOf('.pane-notes'),
      paneHtml,
    }
  }

  /*
   * 拍快照之前先冲一次：最后一次交互可能只是**设了状态**（例如被登录门拦下之后
   * `setAuthOpen(true)`），React 会把它批到下一个微任务里再落到 DOM 上。
   * 不冲这一下，`html` 拍到的是"上一帧"——弹窗明明开了，快照里却没有。
   */
  await act(async () => {})

  return {
    sectionNavTrace,
    perPage,
    submits,
    revisit,
    unlockRoundTrip,
    editedRoundTrip,
    flow: { text: flowText, answer: submittedAnswer, matches: flowText === submittedAnswer },
    panels,
    refine,
    custom,
    views,
    record,
    generated,
    html: container.innerHTML,
    text: `${textOf('.pane-score')} ${textOf('.pane-notes')}`,
    composeStageHadInput,
    inputReplacedByResult,
    answerPaneText: textOf('.pane-answer'),
    answerPaneHtml: container.querySelector('.pane-answer')?.innerHTML ?? '（找不到该栏）',
    notesPaneHtml: container.querySelector('.pane-notes')?.innerHTML ?? '（找不到该栏）',
    hasRotateButton: textOf('.pane-source').includes('换一换'),
    rotateDisabled:
      [...container.querySelectorAll<HTMLButtonElement>('.pane-source .btn')].find((node) => node.textContent?.trim() === '换一换')
        ?.disabled ?? false,
    modeTabLabels,
    sampleIds,
    judgeCalls: judgeFetch.calls(),
    judgeRequestBody: judgeFetch.lastBody(),
    survivedTabRoundTrip,
    tabRoundTripResult,
    historyView,
    interaction,
    restore: () => {
      // 把改过的全局对象放回去。不做这一步，后面依赖 fetch 的检查（例如截屏的就绪探测）
      // 会被这个探针的桩拦住，报出与真实原因无关的错误。
      for (const [key, descriptor] of savedDescriptors) {
        if (descriptor) Object.defineProperty(globalAny, key, descriptor)
        else delete globalAny[key]
      }
    },
  }
}
