# 部署用 Cloudflare Workers + Static Assets，不用 Cloudflare Pages

这个选择不是偏好，而是被数据存储唯一确定的：**D1 数据库绑定只能在 Workers 上使用，Pages 不直接支持 D1**。既然批改要落库，Pages 这条路就被排除了。

因此项目结构采用 Cloudflare 官方的 Vite 插件方案：一个 Worker 同时承担静态资源服务与 API（`/api/*`），前端是 React + TypeScript。GitHub 推送后由 Cloudflare 自动构建部署。

## 为什么这不是显而易见的选择

按直觉，「一个 React 前端 + 一点后端接口」最自然的落点是 Pages（Pages 也确实是更早、更常见的选择）。所以未来的读者看到 Worker 里同时挂着前端资源和 API 时会疑惑。记录在这里：是 D1 把答案锁死了。

## 连带影响

- 密钥只能通过 `wrangler secret put` 或 Cloudflare 控制台注入，不能由 Pages 的环境变量面板兼顾
- 本地开发要用 `.dev.vars`（已列入 `.gitignore`），而不是把密钥写进任何配置文件
