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
import { validateCorrection } from '../src/domain/validate'

export interface RenderProbe {
  html: string
  text: string
  /** 模拟接口被调用的次数 */
  judgeCalls: number
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
    const body = JSON.parse(String(init?.body ?? '{}')) as { answer?: string }
    const submitted = body.answer ?? ''
    const exercise = MOCK_CASES.find((item) => submitted.startsWith(item.sampleAnswer)) ?? MOCK_CASES[0]
    if (!exercise) throw new Error('题库为空')

    const correction = fixtureCorrectionFor(exercise.exercise.id, submitted)
    // 与真实接口保持严格同构：真实接口也会把位置校验的结果一起返回
    const checked = validateCorrection(correction.errors, correction.highlights, submitted)
    const payload = {
      ok: true,
      attempts: 1,
      repaired: checked.rejections.map((rejection) => `${rejection.id}：${rejection.message}`),
      correction: {
        total: correction.total,
        dimensions: correction.dimensions,
        summary: correction.summary,
        dimensionComments: correction.dimensionComments,
        errors: correction.errors,
        highlights: correction.highlights,
      },
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
export async function renderApp(): Promise<RenderProbe> {
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

  // 提交批改
  const submit = container.querySelector<HTMLButtonElement>('.btn-primary')
  if (!submit) throw new Error('找不到「提交批改」按钮')
  await act(async () => {
    submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  // 点第一处批注，验证详情面板
  const firstMark = container.querySelector<HTMLElement>('.mk-delete, .mk-replace, .mk-insert, .mk-highlight')
  if (firstMark) {
    await act(async () => {
      firstMark.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  return { html: container.innerHTML, text: textOf('.panel-result'), judgeCalls: judgeFetch.calls() }
}
