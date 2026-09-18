import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地开发阶段使用纯 Vite 开发服务器。
// 接入 Cloudflare Workers + D1 时，这里会换成 @cloudflare/vite-plugin，
// 以便在本地就能使用 D1 绑定与 /api/* 接口。
export default defineConfig({
  plugins: [react()],
  server: {
    // 显式绑定 127.0.0.1：默认的 localhost 在 Windows 上会解析到 IPv6，
    // 用 127.0.0.1 访问时会连不上。
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
  },
})
