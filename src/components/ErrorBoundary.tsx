/**
 * 渲染错误的兜底界面。
 *
 * 为什么需要它：React 在渲染期遇到未捕获的错误时，会把**整棵树卸掉**——
 * 用户看到的就是一片白屏，既没有任何提示，也不知道能做什么，只能刷新。
 * 这一类"白屏"最难查的地方在于：错误信息只出现在控制台，而用户通常不会打开它。
 *
 * 有了这一层，同样的错误会变成一句能读的话 + 一块可展开的堆栈 + 一个刷新按钮。
 * 注意它**不修错**，只是让错误可见、可复现、可报告——排查的第一步。
 *
 * 样式写在这里而不是 styles.css：这是最后一道兜底界面，
 * 万一问题恰好出在样式加载上，它也必须能正常显示，所以不依赖外部样式表。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  info: ErrorInfo | null
}

const box: React.CSSProperties = {
  maxWidth: 860,
  margin: '48px auto',
  padding: '20px 24px',
  border: '1px solid #d9534f',
  borderLeft: '6px solid #d9534f',
  borderRadius: 6,
  background: '#fff8f8',
  color: '#3a2b2b',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  lineHeight: 1.7,
}
const pre: React.CSSProperties = {
  margin: '12px 0 0',
  padding: 12,
  maxHeight: 320,
  overflow: 'auto',
  background: '#2b2b2b',
  color: '#eee',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info })
    // 控制台里也留一份完整的：用户把这段贴出来就能直接定位
    console.error('界面渲染出错：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={box}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>界面出错了，这一屏没能画出来</h2>
        <p style={{ margin: '0 0 12px' }}>
          这不是你的操作有问题——是页面代码在渲染时抛了异常。下面的内容请原样复制给开发者，
          它比"白屏了"有用得多。刷新一般能回到可用状态（作答与批改结果都存在浏览器里，不会丢）。
        </p>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
          {error.name}: {error.message}
        </p>
        <pre style={pre}>{`${error.stack ?? '(没有堆栈)'}\n\n--- 组件栈 ---${info?.componentStack ?? '(没有组件栈)'}`}</pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 14,
            padding: '8px 18px',
            border: '1px solid #d9534f',
            borderRadius: 4,
            background: '#d9534f',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          刷新页面
        </button>
      </div>
    )
  }
}
