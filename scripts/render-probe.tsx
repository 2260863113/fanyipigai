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

/** 顶层导航的标签文案，用于按题型切换（与 types.ts 的 MODE_TABS 保持一致）。 */
const MODE_TAB_LABEL: Record<string, string> = {
  article: '文章',
  paragraph: '段落',
  sentence: '句子',
  term: '术语',
}

export interface RenderProbe {
  html: string
  /** 逐段填入作答时，每一次「下一段」前后观察到的分段导航状态（诊断用） */
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
  /** 四栏边界可拖动 / 返回修改后能回到上次结果 */
  panels?: {
    hasSplitter: boolean
    manualApplied: boolean
    editorShown: boolean
    canReturnToResult: boolean
    resultBack: boolean
    judgeCallsAfterReturn: number
  }
  /** 「自定义」那一栏：自己贴一篇原文来练 */
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
    hasRepasteButton: boolean
    /** 贴题弹窗打开后，框里预填的内容 */
    prefill: string
    /** 贴进新的一篇之后，「原文」栏显示的文字 */
    afterPaste: string
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
function makeJudgeFetch(): { fetch: typeof fetch; calls: () => number; lastBody: () => string } {
  let calls = 0
  let lastBody = ''

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
    if (pathname !== '/api/judge') throw new Error(`渲染测试未预期的请求：${pathname}`)
    calls += 1
    lastBody = String(init?.body ?? '')

    // 用请求里实际提交的作答来构造批注，与真实流程一致
    const body = JSON.parse(lastBody || '{}') as {
      answerSections?: Array<{ start: number; text: string }>
      source?: string
    }
    const submitted = (body.answerSections ?? []).map((section) => section.text).join('\n\n')
    const exercise =
      MOCK_CASES.find((item) => item.sampleAnswer.trim() === submitted.trim()) ??
      MOCK_CASES.find((item) => item.exercise.source === body.source) ??
      MOCK_CASES[0]
    if (!exercise) throw new Error('题库为空')

    const correction = fixtureCorrectionFor(exercise.exercise.id, submitted)
    if (!correction) throw new Error('渲染测试：提交的作答对不上任何内置示例')
    // 与真实接口保持严格同构：真实接口也会把位置校验的结果与 AI 原始返回一起带回来
    const checked = validateCorrection(correction.errors, correction.highlights, submitted)
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
    checkViews?: boolean
    /** 先在浏览器里存一篇自定义题（模拟"上次贴过"），贴题流程用它做起点 */
    seedCustom?: string
    /** 走一遍「自定义」贴题流程，并把这一段期间贴进去的原文填成这个 */
    checkCustom?: string
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

  const judgeFetch = makeJudgeFetch()
  install('fetch', judgeFetch.fetch)

  // 「自定义」那一栏：模拟"上一次贴过的一篇还留在浏览器里"
  if (options.seedCustom) {
    dom.window.localStorage.setItem(
      'translation-practice.custom',
      JSON.stringify({ id: 'custom-seed', source: options.seedCustom, createdAt: new Date().toISOString() }),
    )
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
  const sample = options.exerciseId
    ? (MOCK_CASES.find((item) => item.exercise.id === options.exerciseId) ?? MOCK_CASES[0])
    : MOCK_CASES[0]
  if (!sample) throw new Error('题库为空')
  const answerSections = splitSections(sample.sampleAnswer)

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
  const targetMode = sample.exercise.mode
  const activeTabLabel = container.querySelector('.mode-tab.mode-tab-active')?.textContent?.trim()
  if (process.env.DSH_PROBE_DEBUG) {
    console.log(
      `[probe] 目标题型=${targetMode}(${MODE_TAB_LABEL[targetMode]}) 当前高亮=${activeTabLabel ?? '(无)'} ` +
        `共 ${container.querySelectorAll('.mode-tab').length} 个题型标签`,
    )
  }
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
  if (options.exerciseId) {
    // 该题型下有多道题时靠题号切；文章库那类没有按钮的题干不在此列
    const caseTab = [...container.querySelectorAll<HTMLButtonElement>('.case-tab')].find((node) =>
      node.textContent?.includes(sample.exercise.topic),
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

  const typeInto = async (text: string): Promise<void> => {
    const target = container.querySelector<HTMLTextAreaElement>('.answer-input')
    if (!target) return
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(target, text)
      target.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  for (const [index, section] of answerSections.entries()) {
    const before = navText()
    if (index > 0) {
      const next = [...container.querySelectorAll<HTMLButtonElement>('.section-nav .btn')].find((button) =>
        button.textContent?.includes('下一段'),
      )
      if (!next) throw new Error('分段导航里找不到「下一段」按钮')
      await act(async () => {
        next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const afterNav = navText()
    await typeInto(section.text)
    // 注意：typedInto 要在**填完之后**读，否则记下的是上一次的残留
    const typedInto = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    sectionNavTrace.push({ step: index, before, after: afterNav, typedInto })
  }

  // 回到第一段，便于断言与截图
  const prev = [...container.querySelectorAll<HTMLButtonElement>('.section-nav .btn')].find((button) =>
    button.textContent?.includes('上一段'),
  )
  if (prev) {
    await act(async () => {
      prev.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

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

  const submit = container.querySelector<HTMLButtonElement>('.btn-primary')
  if (!submit) throw new Error('找不到「提交批改」按钮')
  await act(async () => {
    submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  // 关键：提交后输入框应当从右上角消失，左下与右下换成计分与批注
  const inputReplacedByResult =
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
  const bubbleText = (): string => textOf('.pane-answer .ann-bubble').trim()
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
  const firstBubbleHtml = container.querySelector('.pane-answer .ann-bubble')?.innerHTML ?? ''
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

  // 点勾画之外的地方：气泡应当消失、右下角回到提示。
  // 坐标特意给一个大值——探针把所有元素的 rect 都桩成固定方块，
  // 用 (0,0) 会被"点在气泡上"这条判断拦下来。
  const outside = container.querySelector<HTMLElement>('.pane-source') ?? container
  await act(async () => {
    outside.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 900, clientY: 700 }))
  })
  const notesAfterOutsideClick = notesText()
  const bubbleAfterOutsideClick = bubbleText()

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
          firstFavoriteButton: favoriteBefore,
          favoriteButtonAfterClick: favoriteAfter,
          favoriteStored,
          secondMark,
          secondNotes,
          secondBubble,
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

    // 先回到可编辑状态，写一段独有内容
    const back = [...container.querySelectorAll<HTMLButtonElement>('.btn-ghost')].find((node) =>
      node.textContent?.includes('返回修改'),
    )
    if (back) {
      await act(async () => {
        back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const typed = '这是一段用来检查切换页面是否会丢失的文字'
    await typeInto(typed)
    const afterTyping = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''

    // 切到别的题型，再切回来
    await clickTab('术语')
    await clickTab(MODE_TAB_LABEL[sample.exercise.mode] ?? '文章')

    const afterReturn = container.querySelector<HTMLTextAreaElement>('.answer-input')?.value ?? ''
    survivedTabRoundTrip = { typed: afterTyping, afterReturn }

    // 再提交一次并把界面留在结果态，方便后面的断言（此时第一步已被切走，需要重新填满分段）
    for (const [index, section] of answerSections.entries()) {
      if (index > 0) {
        const next = [...container.querySelectorAll<HTMLButtonElement>('.section-nav .btn')].find((button) =>
          button.textContent?.includes('下一段'),
        )
        if (next) {
          await act(async () => {
            next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
          })
        }
      }
      await typeInto(section.text)
    }
    const submitAgain = container.querySelector<HTMLButtonElement>('.btn-primary')
    if (submitAgain && !submitAgain.disabled) {
      await act(async () => {
        submitAgain.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
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
    // 1) 点「返回修改」回到作答框，再点「查看上次批改」回到同一份结果（不重新提交）
    const answerText = textOf('.pane-answer')
    const back = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].find(
      (node) => node.textContent?.trim() === '返回修改',
    )
    if (back) {
      await act(async () => {
        back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const editorShown = container.querySelector('.answer-input') !== null
    const returnButton = [...container.querySelectorAll<HTMLButtonElement>('.pane-answer .btn')].find(
      (node) => node.textContent?.trim() === '查看上次批改',
    )
    if (returnButton) {
      await act(async () => {
        returnButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const resultBack = container.querySelector('.answer-input') === null && textOf('.pane-answer') === answerText

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
      canReturnToResult: Boolean(returnButton),
      resultBack,
      judgeCallsAfterReturn: judgeFetch.calls(),
    }
  }

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

    // 贴新的一篇：点「重新贴一篇」，把划来的原文填进去，再点「开始练习」
    await clickText('.pane-source .btn', '重新贴一篇')
    const area = container.querySelector<HTMLTextAreaElement>('.gen-textarea')
    const prefill = area?.value ?? ''
    if (area) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(area, options.checkCustom)
        area.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    }
    await clickText('.gen-modal .btn-primary', '开始练习')

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
      hasRepasteButton: hasButton('重新贴一篇'),
      prefill,
      afterPaste: textOf('.pane-source'),
      storedSource,
      historyCount,
    }
  }

  // 译文文字流：把调序圈号（绝对定位的标记）去掉后，必须与作答逐字相同
  const flowLines = container.querySelector('.pane-answer .annotated-lines')
  const flowText = (flowLines?.textContent ?? '').replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
  const submittedAnswer = answerSections.map((section) => section.text).join('\n\n')

  return {
    sectionNavTrace,
    flow: { text: flowText, answer: submittedAnswer, matches: flowText === submittedAnswer },
    panels,
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
