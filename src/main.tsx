import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载点 #root')

/*
 * 渲染错误一律交给 ErrorBoundary 显示，不要让整棵树被卸掉变成白屏。
 * 见 ErrorBoundary 的说明：它不修错，只让错误可见、可报告。
 */
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
