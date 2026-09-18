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

export interface RenderProbe {
  html: string
  text: string
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

  return { html: container.innerHTML, text: textOf('.panel-result') }
}
