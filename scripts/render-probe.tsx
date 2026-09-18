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

/** 顶层导航的标签文案，用于按题型切换（与 types.ts 的 MODE_TABS 保持一致）。 */
const MODE_TAB_LABEL: Record<string, string> = {
  article: '文章',
  paragraph: '段落',
  sentence: '句子',
  term: '术语',
}

export interface RenderProbe {
  html: string
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
  /** 左上角原文栏里有没有「换一换」按钮 */
  hasRotateButton: boolean
  /** 顶部导航里的模式标签 */
  modeTabLabels: string[]
  /** 切换到的第一个示例（用来核对四类题型都有题） */
  sampleIds: string[]
  judgeCalls: number
  /** 还原被这个探针改写过的全局对象，避免污染后续检查 */
  restore: () => void
}

/**
 * 批改接口的模拟响应。
 * 真实批改由 AI 完成，冒烟测试不该依赖网络与密钥；
 * 这里用内置假数据构造一个与真实接口**同结构**的响应，
 * 专门用来验证「提交 → 校验 → 渲染」这条链路本身。
 */
function makeJudgeFetch(): { fetch: typeof fetch; calls: () => number } {
  let calls = 0

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const pathname = new URL(url, 'http://localhost/').pathname
    if (pathname !== '/api/judge') throw new Error(`渲染测试未预期的请求：${pathname}`)
    calls += 1

    // 用请求里实际提交的作答来构造批注，与真实流程一致
    const body = JSON.parse(String(init?.body ?? '{}')) as {
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
    // 与真实接口保持严格同构：真实接口也会把位置校验的结果一起返回
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
          span: entry.span,
          insertPoint: entry.insertPoint,
          reorderSpans: entry.reorderSpans,
          reordered: entry.reordered,
        })),
        highlights: checked.highlights.map((entry) => ({ highlight: entry.highlight, span: entry.span })),
        rejections: checked.rejections,
      },
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return { fetch: impl as unknown as typeof fetch, calls: () => calls }
}

/** 在 jsdom 环境里挂载界面并与之交互，返回渲染出的 HTML 与纯文本。 */
export async function renderApp(options: { exerciseId?: string } = {}): Promise<RenderProbe> {
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
  install('IS_REACT_ACT_ENVIRONMENT', true)

  const judgeFetch = makeJudgeFetch()
  install('fetch', judgeFetch.fetch)

  // jsdom 不实现 ResizeObserver；调序弧线依赖它做尺寸观测
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  install('ResizeObserver', StubResizeObserver)
  Object.defineProperty(dom.window, 'ResizeObserver', { value: StubResizeObserver, configurable: true })

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

  // 如果指定了题目，需要先切到对应题型与题目
  if (options.exerciseId && sample.exercise.id !== MOCK_CASES[0]?.exercise.id) {
    const modeTab = [...container.querySelectorAll<HTMLButtonElement>('.mode-tab')].find(
      (node) => node.textContent?.trim() === MODE_TAB_LABEL[sample.exercise.mode],
    )
    if (modeTab) {
      await act(async () => {
        modeTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    const caseTab = [...container.querySelectorAll<HTMLButtonElement>('.case-tab')].find((node) =>
      node.textContent?.includes(sample.exercise.topic),
    )
    if (caseTab) {
      await act(async () => {
        caseTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
  }

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
    if (index > 0) {
      const next = [...container.querySelectorAll<HTMLButtonElement>('.section-nav .btn')].find((button) =>
        button.textContent?.includes('下一段'),
      )
      if (!next) throw new Error('分段导航里找不到「下一段」按钮')
      await act(async () => {
        next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
    await typeInto(section.text)
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

  const submit = container.querySelector<HTMLButtonElement>('.btn-primary')
  if (!submit) throw new Error('找不到「提交批改」按钮')
  await act(async () => {
    submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  // 关键：提交后输入框应当从右上角消失，左下与右下换成计分与批注
  const inputReplacedByResult =
    container.querySelector('.answer-input') === null &&
    container.querySelector('.pane-score') !== null &&
    container.querySelector('.pane-notes') !== null &&
    container.querySelector('.note-list') !== null

  // 点第一条批注，验证详情面板
  const firstNote = container.querySelector<HTMLElement>('.note-item')
  if (firstNote) {
    await act(async () => {
      firstNote.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  return {
    html: container.innerHTML,
    text: `${textOf('.pane-score')} ${textOf('.pane-notes')}`,
    composeStageHadInput,
    inputReplacedByResult,
    answerPaneText: textOf('.pane-answer'),
    answerPaneHtml: container.querySelector('.pane-answer')?.innerHTML ?? '（找不到该栏）',
    hasRotateButton: textOf('.pane-source').includes('换一换'),
    modeTabLabels,
    sampleIds,
    judgeCalls: judgeFetch.calls(),
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
