/**
 * 验收「账号那一组界面」：**个人中心下拉栏 / 修改密码 / 管理三屏 / 留言板头像**（用户第 17 条）。
 *
 * 覆盖第 5～9 条里**只有真浏览器才验得动**的那一半：
 *   - 下拉栏是不是真弹出来了、点「用户管理」是不是真落到用户那一屏（点错就是"看着像"，一点就露）；
 *   - 流量板那张折线图**画出来了没有、鼠标挪上去弹不弹**——用 `Input.dispatchMouseEvent` 发**真鼠标**
 *     到圆点的真实像素位置上，再读弹出来的字（只验"配置里写了 tooltip"证明不了这件事）；
 *   - 留言板每条前面的头像**是不是 20px 的圆**、没头像的那条画的是不是首字；
 *   - 日志里那一列设备名**完不完整**（游客那行要能看到原样的 User-Agent，而且不因为太长被裁掉）。
 *
 * 怎么让这些页面有数据：本机 `npm run dev` **没有 D1**（留言板/管理端读的是真库），
 * 因此这里在页面加载**之前**注入一层 fetch 桩（只回那几条只读接口），
 * 并把一条**管理员会话**写进 localStorage——页面代码一行都不用改，走的仍是真实渲染路径。
 *
 * 用法：node scripts/verify-admin-ui.mjs [地址]
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const debugPort = 9243
const root = process.cwd()

function findBrowser() {
  if (process.env.DSH_NO_BROWSER) return undefined
  const explicit = process.env.CHROME_PATH
  if (explicit) return existsSync(explicit) ? explicit : undefined
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((candidate) => existsSync(candidate))
}

function removeDir(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) removeDir(full)
    else unlinkSync(full)
  }
  try {
    rmdirSync(dir)
  } catch {
    /* 浏览器还没退干净时目录会被占用 */
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.errors = []
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (typeof message.id === 'number') {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${entry.method} 失败：${message.error.message}`))
        else entry.resolve(message.result ?? {})
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails ?? {}
        this.errors.push('EXCEPTION: ' + (details.exception?.description ?? details.text ?? ''))
      }
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(`页面脚本出错：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }
  close() {
    this.ws.close()
  }
}

const results = []
function check(ok, label, detail) {
  results.push({ ok })
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
}

/**
 * 注入到页面里的那一层桩 + 会话种子。
 *
 * `Page.addScriptToEvaluateOnNewDocument` 让它**先于**页面脚本执行，因此：
 *   - `localStorage` 里那条会话是 App 启动时就能读到的（authStore 在模块加载时读一次）；
 *   - `window.fetch` 已经被换掉，留言板/管理端那几条只读接口拿到的就是这里给的固定响应。
 * 响应体与真实 DTO 严格同形（少一个字段就会在渲染时炸掉，那种失败看起来像功能坏了）。
 */
const injected = `
(() => {
  const avatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABF';
  const posts = [
    { id: 2, content: '今天练了一篇英译中。', createdAt: Date.now() - 60000, username: '有头像的人', avatar, replyCount: 1,
      replies: [{ id: 11, postId: 2, content: '一起加油。', createdAt: Date.now() - 30000, username: '有头像的人', avatar }] },
    { id: 1, content: '术语那一栏十个格子很好用。', createdAt: Date.now() - 120000, username: '没头像的人', avatar: null, replyCount: 0, replies: [] },
  ];
  const announcements = [{ id: 1, title: '公告标题', content: '公告正文', pinned: true, createdAt: Date.now() - 3600000, updatedAt: Date.now() - 3600000 }];
  const users = [
    { id: 1, username: '有头像的人', avatar, isAdmin: true, createdAt: Date.now() - 86400000 },
    { id: 2, username: '没头像的人', avatar: null, isAdmin: false, createdAt: Date.now() - 43200000 },
    { id: 3, username: '第三个人', avatar: null, isAdmin: false, createdAt: Date.now() - 3600000 },
  ];
  const logs = [
    { id: 2, username: '探针管理员', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', createdAt: Date.now() - 5000 },
    { id: 1, username: null, ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36', createdAt: Date.now() - 60000 },
  ];
  const stats = { range: 'week', unit: 'day', points: [
    { label: '2026-09-20', count: 3 }, { label: '2026-09-21', count: 0 }, { label: '2026-09-22', count: 8 },
    { label: '2026-09-23', count: 2 }, { label: '2026-09-24', count: 11 }, { label: '2026-09-25', count: 5 },
    { label: '2026-09-26', count: 7 },
  ] };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const parsed = new URL(url, location.origin);
    const path = parsed.pathname;
    if (path === '/api/board') {
      const post = parsed.searchParams.get('post');
      if (post) {
        const found = posts.find((item) => item.id === Number(post));
        return json({ replies: found ? found.replies : [] });
      }
      return json({ posts });
    }
    if (path === '/api/announcements') return json({ announcements });
    if (path === '/api/admin/users') return json({ users });
    if (path === '/api/admin/logs') {
      return parsed.searchParams.get('view') === 'stats' ? json(stats) : json({ logs });
    }
    if (path === '/api/auth/me') return json({ user: { username: '探针管理员', avatar: null, isAdmin: true, createdAt: 0, updatedAt: 1 } });
    // 改密码要先把旧密码按服务端的盐算一遍哈希（见 authStore.saveProfile），因此这个接口也要有
    if (path === '/api/auth/salt') return json({ salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iterations: 120000 });
    if (path === '/api/auth/profile') return json({ user: { username: '探针管理员', avatar: null, isAdmin: true, createdAt: 0, updatedAt: 2 } });
    if (path === '/api/visit') return json({ ok: true });
    return original(input, init);
  };

  try {
    window.localStorage.setItem('translation-practice.session.v1', JSON.stringify({
      token: 'verify-admin-token',
      user: { username: '探针管理员', avatar: null, isAdmin: true, createdAt: 0, updatedAt: 1 },
    }));
    window.localStorage.removeItem('translation-practice.last-view.v1');
  } catch (error) {}
  window.__adminStub = true;
})();
`

const browser = findBrowser()
if (!browser) throw new Error('没有找到 Edge 或 Chrome')
const profileDir = path.join(root, 'node_modules', '.cache', 'verify-admin-ui-profile')
removeDir(profileDir)
const browserProcess = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  let ready = false
  for (let i = 0; i < 40 && !ready; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      ready = true
    } catch {
      await sleep(300)
    }
  }
  if (!ready) throw new Error('调试端口未就绪')

  const { WebSocket } = await import('ws')
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const target = list.find((t) => t.type === 'page') ?? list[0]
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('连接调试通道失败')))
  })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injected })
  await cdp.send('Page.navigate', { url: `${base}/` })
  let mounted = false
  for (let i = 0; i < 40 && !mounted; i += 1) {
    await sleep(250)
    mounted = Boolean(await cdp.evaluate("!!document.querySelector('.mode-tabs')"))
  }
  if (!mounted) throw new Error('界面没有挂载')
  await sleep(500)

  /* 页内小工具：按文字点按钮、量矩形、读文字 */
  await cdp.evaluate(`
    window.__A = (() => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const q = (s) => document.querySelector(s);
      const qa = (s) => [...document.querySelectorAll(s)];
      const text = (s) => (q(s)?.textContent || '').trim();
      const clickText = async (selector, label, pause) => {
        const node = qa(selector).find((item) => (item.textContent || '').trim() === label);
        if (!node) return false;
        node.click();
        await sleep(pause === undefined ? 350 : pause);
        return true;
      };
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), right: Math.round(box.right), bottom: Math.round(box.bottom) };
      };
      return { sleep, q, qa, text, clickText, rect };
    })();
  `)

  console.log('\n=== 1. 顶栏：管理入口从导航里撤掉，账号按钮变成下拉栏触发器 ===')
  const topbar = await cdp.evaluate(`(() => {
    const A = window.__A;
    const tabs = A.qa('.mode-tab').map((n) => (n.textContent || '').trim());
    const account = A.q('.user-center');
    return {
      tabs,
      hasAdminTab: tabs.includes('管理'),
      hasBoardTab: tabs.includes('留言板'),
      accountText: (account?.textContent || '').trim(),
      hasCaret: Boolean(A.q('.account-caret')),
      menuBeforeClick: Boolean(A.q('.user-menu')),
      ariaExpanded: account?.getAttribute('aria-expanded'),
    };
  })()`)
  check(!topbar.hasAdminTab && topbar.hasBoardTab, `导航里没有「管理」、有「留言板」（实际 ${JSON.stringify(topbar.tabs)}）`)
  check(
    topbar.menuBeforeClick === false && topbar.ariaExpanded === 'false',
    '没点之前下拉栏是关着的（`aria-expanded=false`）',
    JSON.stringify(topbar),
  )

  const menu = await cdp.evaluate(`(async () => {
    const A = window.__A;
    A.q('.user-center').click();
    await A.sleep(400);
    const items = A.qa('.user-menu button').map((n) => (n.textContent || '').trim());
    const menuRect = A.rect(A.q('.user-menu'));
    const buttonRect = A.rect(A.q('.user-center'));
    const barRect = A.rect(A.q('.topbar'));
    return { items, menuRect, buttonRect, barRect, expanded: A.q('.user-center').getAttribute('aria-expanded') };
  })()`)
  check(
    menu.items.join('｜') === '个人中心｜修改密码｜用户管理｜日志管理｜发布公告｜退出登录',
    `下拉栏里那几项、顺序也对（实际 ${menu.items.join('｜')}）`,
    JSON.stringify(menu),
  )
  check(menu.expanded === 'true', '点开之后 `aria-expanded=true`（无障碍地告诉人它开着）')
  check(
    Boolean(menu.menuRect) &&
      menu.menuRect.y >= menu.buttonRect.bottom &&
      menu.menuRect.y <= menu.buttonRect.bottom + 16 &&
      menu.menuRect.bottom <= 900 &&
      Math.abs(menu.menuRect.right - menu.buttonRect.right) <= 2,
    `菜单挂在账号按钮**正下方**（挨着按钮下沿 8px）、右边缘对齐、整块在视口里（按钮底 ${menu.buttonRect.bottom}、菜单 ${JSON.stringify(menu.menuRect)}）`,
    JSON.stringify(menu),
  )

  console.log('\n=== 2. 点别处 / Esc 都要能收起菜单 ===')
  const dismiss = await cdp.evaluate(`(async () => {
    const A = window.__A;
    // 点空白处：菜单应当自己收起（少了这一条，菜单会一直挂着挡住「设置」）
    document.querySelector('.mode-tabs').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await A.sleep(250);
    const afterOutside = Boolean(A.q('.user-menu'));
    A.q('.user-center').click();
    await A.sleep(250);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await A.sleep(250);
    return { afterOutside, afterEscape: Boolean(A.q('.user-menu')) };
  })()`)
  check(
    dismiss.afterOutside === false && dismiss.afterEscape === false,
    `点别处收起、按 Esc 也收起（${JSON.stringify(dismiss)}）`,
    JSON.stringify(dismiss),
  )

  console.log('\n=== 3. 修改密码：三格 + 确认不一致要拦住 + 保存成功自己关掉 ===')
  const password = await cdp.evaluate(`(async () => {
    const A = window.__A;
    A.q('.user-center').click();
    await A.sleep(250);
    await A.clickText('.user-menu button', '修改密码', 400);
    const fields = A.qa('.auth-card .form-row').map((n) => (n.textContent || '').replace(/\\s+/g, '').trim());
    const title = A.text('.raw-modal-head');
    // 两次新密码不一致：应当当场拦住（不发请求）
    const inputs = A.qa('.auth-card input');
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let profileCalls = 0;
    let saltCalls = 0;
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/auth/profile')) profileCalls += 1;
      if (url.includes('/api/auth/salt')) saltCalls += 1;
      return original(input, init);
    };
    setValue(inputs[0], 'old-password');
    setValue(inputs[1], 'new-password-1');
    setValue(inputs[2], 'new-password-2');
    await A.sleep(150);
    document.querySelector('.gen-body button[type="submit"]')?.click();
    await A.sleep(400);
    const mismatch = A.text('.auth-message');
    const stillOpen = Boolean(A.q('.raw-modal-backdrop'));
    const callsAfterMismatch = profileCalls + saltCalls;
    // 改成一致：这一次应当提交（接口是桩），成功之后弹窗自己关掉
    setValue(inputs[2], 'new-password-1');
    await A.sleep(150);
    document.querySelector('.gen-body button[type="submit"]')?.click();
    await A.sleep(900);
    const closed = !A.q('.raw-modal-backdrop');
    const message = A.text('.auth-message');
    window.fetch = original;
    return { fields, title, mismatch, stillOpen, callsAfterMismatch, closed, calls: profileCalls, message };
  })()`)
  check(
    password.fields.join('｜') === '旧密码｜新密码｜确认新密码',
    `弹窗里是三格：旧密码 / 新密码 / 确认新密码（实际 ${password.fields.join('｜')}）`,
    JSON.stringify(password),
  )
  check(
    password.mismatch.includes('两次输入的新密码不一样') && password.stillOpen && password.callsAfterMismatch === 0,
    `两次新密码不一致 → 当场拦住、一个请求都不发（提示 ${JSON.stringify(password.mismatch)}）`,
    JSON.stringify(password),
  )
  check(
    password.closed && password.calls === 1,
    `改好之后提交一次、弹窗自己关掉（profile 调用 ${password.calls} 次、关掉 ${password.closed}、提示 ${JSON.stringify(password.message)}）`,
    JSON.stringify(password),
  )

  console.log('\n=== 4. 下拉栏点「个人中心」：那一屏只剩改名字与头像（密码格搬走了） ===')
  const profile = await cdp.evaluate(`(async () => {
    const A = window.__A;
    A.q('.user-center').click();
    await A.sleep(250);
    await A.clickText('.user-menu button', '个人中心', 500);
    const rows = A.qa('.admin-container .form-row').map((n) => (n.textContent || '').replace(/\\s+/g, '').trim());
    const buttons = A.qa('.admin-container .card-actions button').map((n) => (n.textContent || '').trim());
    return { rows, buttons, heading: A.text('.admin-heading'), avatar: A.rect(A.q('.profile-avatar')) };
  })()`)
  check(
    profile.heading === '个人中心' && profile.rows.join('｜') === '用户名',
    `个人中心那一屏只剩「用户名」一格（实际 ${profile.rows.join('｜')}）`,
    JSON.stringify(profile),
  )
  check(
    profile.buttons.includes('保存') && profile.buttons.includes('退出登录') && !profile.buttons.includes('管理'),
    `按钮是「保存 / 退出登录」，那颗「管理」撤掉了（实际 ${JSON.stringify(profile.buttons)}）`,
    JSON.stringify(profile),
  )

  console.log('\n=== 5. 下拉栏点「用户管理」：直接落到那一屏，每行一个头像 ===')
  const users = await cdp.evaluate(`(async () => {
    const A = window.__A;
    A.q('.user-center').click();
    await A.sleep(250);
    await A.clickText('.user-menu button', '用户管理', 700);
    const active = A.text('.admin-tab.active');
    const rows = A.qa('.admin-user-row');
    const avatars = A.qa('.admin-user-row .user-avatar');
    const firstAvatar = avatars[0];
    const firstName = A.q('.admin-user-row .admin-user-name');
    return {
      active,
      rowCount: rows.length,
      avatarCount: avatars.length,
      firstAvatar: A.rect(firstAvatar),
      avatarStyle: firstAvatar?.getAttribute('style') || '',
      defaultAvatars: A.qa('.admin-user-row .user-avatar.default-avatar').length,
      overflows: avatars.some((node) => {
        const box = node.getBoundingClientRect();
        const row = node.closest('.admin-user-row').getBoundingClientRect();
        return box.left < row.left - 1 || box.right > row.right + 1;
      }),
      nameBox: A.rect(firstName),
      nameText: (firstName?.textContent || '').trim(),
    };
  })()`)
  check(users.active === '用户管理' && users.rowCount === 3, `直接落在用户那一屏（高亮 ${users.active}、${users.rowCount} 行）`, JSON.stringify(users))
  check(
    users.avatarCount === users.rowCount && Math.round(users.firstAvatar?.w) === 24 && Math.round(users.firstAvatar?.h) === 24,
    `每行一个 24px 的圆头像（${users.avatarCount}/${users.rowCount}，实测 ${users.firstAvatar?.w}×${users.firstAvatar?.h}）`,
    JSON.stringify(users),
  )
  check(
    users.avatarStyle.includes('data:image/jpeg') && users.defaultAvatars === 2 && !users.overflows,
    `有头像的铺图、没头像的走 default-avatar（${users.defaultAvatars} 个），而且都没出界`,
    JSON.stringify(users),
  )

  console.log('\n=== 6. 日志管理：折线图（真鼠标悬停）+ 完整设备名 ===')
  const logs = await cdp.evaluate(`(async () => {
    const A = window.__A;
    await A.clickText('.admin-tab', '日志管理', 800);
    const svg = A.q('.traffic-svg');
    const chart = A.q('.traffic-chart');
    const dots = A.qa('.traffic-dot');
    const hit = A.q('.traffic-hit[data-traffic-index="4"]');
    const line = A.q('.traffic-line');
    const area = A.q('.traffic-area');
    const axis = A.qa('.traffic-axis-label');
    if (chart) chart.scrollIntoView({ block: 'center' });
    await A.sleep(400);
    const dotBox = dots[4] ? A.rect(dots[4]) : null;
    return {
      hasSvg: Boolean(svg),
      svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      chartWidth: chart ? Math.round(chart.getBoundingClientRect().width) : 0,
      svgHeight: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
      dots: dots.length,
      dotRadius: dots[0]?.getAttribute('r'),
      hasHit: Boolean(hit),
      linePath: (line?.getAttribute('d') || '').slice(0, 24),
      lineStroke: line ? getComputedStyle(line).stroke : '',
      areaPath: (area?.getAttribute('d') || '').slice(-18),
      yLabels: axis.map((n) => (n.textContent || '').trim()).filter((t) => /^\\d+$/.test(t)),
      xLabels: axis.map((n) => (n.textContent || '').trim()).filter((t) => t.includes('/')),
      dotBox,
      // 日志明细：设备名那一列与完整 UA
      logRows: A.qa('.log-row').map((row) => {
        const ua = row.querySelector('.log-ua-full');
        const device = row.querySelector('.log-device');
        return {
          user: (row.querySelector('.log-user')?.textContent || '').trim(),
          device: (device?.textContent || '').trim(),
          ua: (ua?.textContent || '').trim(),
          uaClipped: ua ? ua.scrollWidth > ua.clientWidth + 1 : false,
          rowOverflow: row.scrollWidth > row.clientWidth + 1,
        };
      }),
    };
  })()`)
  check(
    logs.hasSvg && logs.svgWidth > 300 && logs.chartWidth === logs.svgWidth && logs.svgHeight === 240,
    `折线图画出来了：SVG ${logs.svgWidth}×${logs.svgHeight}、与容器同宽（容器 ${logs.chartWidth}）`,
    JSON.stringify(logs),
  )
  check(
    logs.dots === 7 && logs.dotRadius === '3.5',
    `七个桶 → 七个圆点（实际 ${logs.dots} 个，半径 ${logs.dotRadius}）`,
    JSON.stringify(logs),
  )
  check(
    logs.linePath.startsWith('M ') && logs.areaPath.endsWith('Z') && logs.lineStroke.length > 0,
    `折线与渐变面积都画出来了（路径 ${logs.linePath}…、面积以 Z 收口、折线色 ${logs.lineStroke}）`,
    JSON.stringify(logs),
  )
  check(
    logs.yLabels.length >= 3 && logs.xLabels.length >= 4,
    `两轴刻度写了（y ${logs.yLabels.join(',')}；x ${logs.xLabels.join(',')}）`,
    JSON.stringify(logs),
  )
  const guest = logs.logRows.find((row) => row.user === '游客')
  check(
    logs.logRows.length === 2 && Boolean(guest),
    `访问明细两条都在（${logs.logRows.map((row) => row.user).join('／')}）`,
    JSON.stringify(logs.logRows),
  )
  check(
    Boolean(guest?.ua.startsWith('Mozilla/5.0 (Linux; Android 13; SM-G991B')) && guest?.uaClipped === false,
    `游客那行的**完整设备名称**原样摊在列表上、没有被裁掉（${JSON.stringify(guest?.ua?.slice(0, 50))}）`,
    JSON.stringify(guest),
  )
  check(
    (guest?.device ?? '').includes('Android 13') && (guest?.device ?? '').includes('Chrome 118') && (guest?.device ?? '').includes('手机'),
    `设备名那一列是带版本号的人话版本（${JSON.stringify(guest?.device)}）`,
    JSON.stringify(guest),
  )

  /* 真鼠标：把指针挪到第 5 个圆点的中心，看提示弹不弹、弹的是什么 */
  /*
   * 先记一笔"鼠标到底打在了谁身上"：命中区（`.traffic-hit`）是一块透明矩形，
   * 若它没有吃到指针事件，这一段就会以"提示空着"的形式失败——而那既可能是产品的错，
   * 也可能是探针自己的错。把证据留下，省得下次又从头猜。
   */
  await cdp.evaluate(`(() => {
    window.__hoverLog = [];
    document.addEventListener('mouseover', (event) => {
      const node = event.target;
      window.__hoverLog.push(((node.getAttribute && node.getAttribute('class')) || node.tagName || '') + '');
    }, true);
    return true;
  })()`)
  const hover = await cdp.evaluate(`(() => {
    const A = window.__A;
    const dot = A.qa('.traffic-dot')[4];
    const box = dot.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), box: A.rect(dot) };
  })()`)
  /* 先挪到一个别的地方再挪过来：浏览器要靠一次"位置变化"才会发出 enter */
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10, buttons: 0 })
  await sleep(150)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y, buttons: 0 })
  await sleep(500)
  const tooltip = await cdp.evaluate(`(() => {
    const A = window.__A;
    const tip = A.q('.traffic-tip');
    const chart = A.rect(A.q('.traffic-chart'));
    const tipRect = A.rect(tip);
    const dot = A.qa('.traffic-dot')[4];
    const at = document.elementFromPoint(${hover.x}, ${hover.y});
    return {
      text: (tip?.textContent || '').trim(),
      tipRect,
      chart,
      dotRadius: dot?.getAttribute('r'),
      atPoint: at ? ((at.getAttribute('class') || at.tagName) + '') : null,
      hoverLog: (window.__hoverLog || []).slice(0, 6),
      inside: tipRect ? tipRect.x >= chart.x - 1 && tipRect.right <= chart.right + 1 : false,
    };
  })()`)
  check(
    tooltip.text.includes('9月24日') && tooltip.text.includes('11 次访问'),
    `鼠标挪到第 5 个点（11 次那一桶）上弹出提示（实际 ${JSON.stringify(tooltip.text)}）`,
    JSON.stringify(tooltip),
  )
  check(
    Number(tooltip.dotRadius) > 3.5,
    `悬停的那个圆点也变大了（半径 ${tooltip.dotRadius}）`,
    JSON.stringify(tooltip),
  )
  check(
    tooltip.inside,
    `提示框没有跑出图表框（提示 ${JSON.stringify(tooltip.tipRect)} / 图表 ${JSON.stringify(tooltip.chart)}）`,
    JSON.stringify(tooltip),
  )

  console.log('\n=== 7. 留言板：每条帖子/回复前面一个头像 ===')
  const board = await cdp.evaluate(`(async () => {
    const A = window.__A;
    await A.clickText('.mode-tab', '留言板', 900);
    const posts = A.qa('.board-post');
    const firstAvatar = A.q('.board-post .board-post-head .user-avatar');
    const replyAvatar = A.q('.board-reply .board-reply-head .user-avatar');
    const defaults = A.qa('.board-list .user-avatar.default-avatar');
    const authorBox = A.rect(A.q('.board-post .board-author'));
    const postHeadBox = A.rect(A.q('.board-post .board-post-head'));
    return {
      posts: posts.length,
      postAvatars: A.qa('.board-post-head .user-avatar').length,
      replyAvatars: A.qa('.board-reply-head .user-avatar').length,
      firstAvatar: A.rect(firstAvatar),
      avatarStyle: firstAvatar?.getAttribute('style') || '',
      defaultCount: defaults.length,
      defaultText: (defaults[0]?.textContent || '').trim(),
      orderOk: Boolean(firstAvatar && authorBox && firstAvatar.getBoundingClientRect().right <= authorBox.x + 1),
      insideHead: Boolean(firstAvatar && postHeadBox && firstAvatar.getBoundingClientRect().left >= postHeadBox.x - 1),
    };
  })()`)
  check(
    board.postAvatars === board.posts && board.replyAvatars >= 1,
    `每条帖子（${board.postAvatars}）与回复（${board.replyAvatars}）前面都有头像`,
    JSON.stringify(board),
  )
  check(
    Math.round(board.firstAvatar?.w) === 20 && board.avatarStyle.includes('data:image/jpeg'),
    `头像是 20px 的小圆（实测 ${board.firstAvatar?.w}×${board.firstAvatar?.h}），有图的铺 dataUrl`,
    JSON.stringify(board),
  )
  check(
    board.orderOk && board.insideHead && board.defaultCount === 1 && board.defaultText === '没',
    `头像排在名字前面、没头像的那条画首字（${JSON.stringify(board.defaultText)}）`,
    JSON.stringify(board),
  )

  console.log('\n=== 8. 退出登录：菜单那一项真的把会话清掉 ===')
  const logout = await cdp.evaluate(`(async () => {
    const A = window.__A;
    const stored = () => { try { return window.localStorage.getItem('translation-practice.session.v1'); } catch (e) { return 'x'; } };
    const before = Boolean(stored());
    A.q('.user-center')?.click();
    await A.sleep(250);
    await A.clickText('.user-menu button', '退出登录', 500);
    const after = stored();
    return { before, after, hasAccountButton: Boolean(A.q('.user-center')), hasLoginButton: A.qa('.account-button').some((n) => (n.textContent || '').includes('登录 / 注册')) };
  })()`)
  check(
    logout.before && logout.after === null && !logout.hasAccountButton && logout.hasLoginButton,
    `退出之后本机会话被清掉、按钮变回「登录 / 注册」（${JSON.stringify(logout)})`,
    JSON.stringify(logout),
  )

  check(cdp.errors.length === 0, '全程没有页面异常', cdp.errors.join(' ｜ '))
} catch (error) {
  check(false, '整条验收流程跑完（没有中途抛错）', error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  if (browserProcess?.pid) spawnSync('taskkill', ['/pid', String(browserProcess.pid), '/T', '/F'], { stdio: 'ignore' })
}

const failed = results.filter((item) => !item.ok).length
console.log(failed === 0 ? `\n✓ 全部 ${results.length} 项通过` : `\n✗ ${failed} / ${results.length} 项未通过`)
process.exitCode = failed === 0 ? 0 : 1
