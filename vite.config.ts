import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { judgeApiPlugin } from './vite-plugin-judge-api'

// 本地开发阶段：纯 Vite 开发服务器 + 一个本地 /api/judge 接口（密钥只在服务端使用）。
// 接入 Cloudflare Workers + D1 时，这里会换成 @cloudflare/vite-plugin，
// 那个插件会保留插件顺序，把 /api/judge 交给 Worker 承担。
export default defineConfig({
  plugins: [judgeApiPlugin(), react()],
  server: {
    // 显式绑定 127.0.0.1：默认的 localhost 在 Windows 上会解析到 IPv6，
    // 用 127.0.0.1 访问时会连不上。
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
  },
})
