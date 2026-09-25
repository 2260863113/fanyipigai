/**
 * 门口的**两个页面**：登录页、以及"服务端还没配好"的说明页。
 *
 * 为什么不用 React 那份界面：这道门在**前端包加载之前**就要拦住人。
 * 若做成前端路由，未登录的人会先把整个应用（连同题库数据）下载下来，再看到一个登录框——
 * 门就成了摆设。因此这里是几行自带的 HTML，样式内联，一个外部请求都不发。
 *
 * 它也在 `src/server/` 而不是 `functions/` 里：`functions/` 下每个文件都是一个路由，
 * 放个 `page.ts` 进去就等于开了条 `/page`（见 `host.ts` 顶部那段说明）。
 *
 * 配色跟着站点走一遍：深浅两套，跟随系统（口径与 `index.html` 里那段抢占式脚本一致）。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: #f5f6f8; color: #1d2129;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.7;
  }
  .card {
    width: 100%; max-width: 440px; background: #fff; border: 1px solid #e3e5e8;
    border-radius: 12px; padding: 28px 28px 24px; box-shadow: 0 8px 28px rgba(20, 24, 34, .08);
  }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .06em; }
  .tagline { margin: 0 0 20px; color: #6b7280; font-size: 13px; }
  label { display: block; font-size: 13px; color: #4b5563; margin-bottom: 6px; }
  input[type=password] {
    width: 100%; padding: 10px 12px; font-size: 15px; border-radius: 8px;
    border: 1px solid #cbd0d8; background: #fff; color: inherit;
  }
  input[type=password]:focus { outline: 2px solid #3b82f6; outline-offset: 1px; border-color: #3b82f6; }
  button {
    width: 100%; margin-top: 16px; padding: 11px 14px; font-size: 15px; cursor: pointer;
    border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-family: inherit;
  }
  button:hover { background: #1d4ed8; }
  .note { margin: 18px 0 0; font-size: 12.5px; color: #6b7280; }
  .error {
    margin: 14px 0 0; padding: 9px 12px; font-size: 13.5px; border-radius: 8px;
    background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: rgba(127,127,127,.14); padding: 1px 5px; border-radius: 4px; }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e8eaed; }
    .card { background: #1c1f24; border-color: #2c3138; box-shadow: none; }
    .tagline, .note, label { color: #9aa1ab; }
    input[type=password] { background: #14161a; border-color: #3a4049; }
    .error { background: #2a1a1c; border-color: #5a2a2f; color: #f2a2a2; }
  }
`

function htmlDocument(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>${BASE_STYLE}</style>
  </head>
  <body>
    <main class="card">${body}</main>
  </body>
</html>
`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  )
}

/**
 * 登录页。`status` 可以给 401：口令不对时该让浏览器与日志都看出"这次是拒绝"，
 * 而页面本身长什么样不变。
 */
export function loginPage(message?: string, status = 200): Response {
  const error = message ? `<p class="error">${escapeHtml(message)}</p>` : ''
  return htmlDocument(
    '翻译批改 · 请输入访问口令',
    `<h1>翻译批改</h1>
      <p class="tagline">外研社·国才杯 笔译赛项 · 个人练习站</p>
      <form method="POST" action="/login">
        <label for="password">访问口令</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">进入</button>
      </form>
      ${error}
      <p class="note">这是站主设的一道门：站点的批改要花钱调用 AI，所以只有知道口令的人能进。<br />
      进去之后 30 天内不用再输；想退出访问 <code>/logout</code>。</p>`,
    status,
  )
}

/**
 * "服务端缺配置"页。
 *
 * 状态码 500 而不是 200：这是配置事故，不是正常页面。它会出现在 Cloudflare 的部署日志里，
 * 一眼能对上。文案点名缺的是哪一个变量——因为这时用户能做的只有一件具体的事。
 */
export function misconfiguredPage(missing: 'ACCESS_PASSWORD' | 'SESSION_SECRET'): Response {
  const what =
    missing === 'ACCESS_PASSWORD'
      ? '站点访问口令（<code>ACCESS_PASSWORD</code>）'
      : '登录凭证的签名密钥（<code>SESSION_SECRET</code>）'
  return htmlDocument(
    '翻译批改 · 服务端还没配置好',
    `<h1>服务端还没配置好</h1>
      <p class="tagline">缺少：${what}</p>
      <p class="note">在 Cloudflare 项目的 <strong>Settings → Variables and Secrets</strong> 里加上它，然后重新部署。</p>
      <p class="note">这里<strong>宁可让站点打不开，也不放行</strong>：放行的话，任何拿到网址的人都能用站主的
      API 密钥去批改、把余额花掉；而打不开只表现为"配置没做完"，一眼看得出来。</p>`,
    500,
  )
}
