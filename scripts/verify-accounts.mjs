/**
 * 账号体系的接口验收：注册 / 登录 / 会话 / 个人资料 / 留言板 / 权限 / 访问上报。
 *
 * 为什么要有它：这一套是从「地图记忆」搬过来的，**搬过来之后必须在这边真跑一遍**——
 * 两个项目的 Env、表结构、目录层级都不一样（比如这边没有 hometown 列），
 * 而 SQL 与绑定参数的错误，类型检查一个都发现不了。
 *
 * 跑法（需要先起本地 workerd 与本地 D1）：
 *
 *   npm run build
 *   npx wrangler d1 execute fanyipigai-db --local --file=schema.sql
 *   npx wrangler pages dev dist --port 8788
 *   node scripts/verify-accounts.mjs                     # 默认 http://127.0.0.1:8788
 *
 * 它每跑一次都会注册两个随机用户名（`vt-` 前缀）并留下数据；这是刻意的：
 * 用户名冲突、级联删除这类事只有在真库上才验得准。清理见脚本末尾的提示。
 */

const BASE = process.env.VERIFY_BASE ?? process.argv[2] ?? 'http://127.0.0.1:8788'
const ITERATIONS = 120_000

let checks = 0
let failures = 0
/** 环境不具备而跳过的项数（管理员那几条需要一个 is_admin=1 的账号） */
let skipped = 0

function check(ok, label, detail = '') {
  checks += 1
  if (ok) {
    console.log(`  ✓ ${label}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
}

/** 一次带 JSON 的请求；返回 { status, body }，不抛。 */
async function call(path, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body: parsed }
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

/** 与前端 authStore 同一套：随机盐 + PBKDF2-SHA-256 120000 次、256 位。 */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)
  return { algorithm: 'PBKDF2-SHA-256', salt: toBase64(salt), hash: toBase64(new Uint8Array(bits)), iterations: ITERATIONS }
}

async function hashWithSalt(password, saltB64, iterations) {
  const salt = new Uint8Array(Buffer.from(saltB64, 'base64'))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return { algorithm: 'PBKDF2-SHA-256', salt: saltB64, hash: toBase64(new Uint8Array(bits)), iterations }
}

const suffix = Math.random().toString(36).slice(2, 8)
const userA = `vt-a-${suffix}`
const userB = `vt-b-${suffix}`
const password = 'verify-password-123'

async function register(username) {
  const res = await call('/api/auth/register', {
    method: 'POST',
    body: { username, passwordHash: await hashPassword(password) },
  })
  return res
}

async function login(username, pwd = password) {
  const saltRes = await call('/api/auth/salt', { method: 'POST', body: { username } })
  const payload = await hashWithSalt(pwd, saltRes.body.salt, saltRes.body.iterations)
  return call('/api/auth/login', { method: 'POST', body: { username, passwordHash: payload } })
}

console.log(`验收账号体系 @ ${BASE}\n`)

try {
  /* ── 留言板是公开可读的，但发帖要登录 ─────────────────────────── */
  const publicList = await call('/api/board')
  check(publicList.status === 200 && Array.isArray(publicList.body.posts), '没登录也能读留言板')

  const anonPost = await call('/api/board', { method: 'POST', body: { content: '游客发帖' } })
  check(anonPost.status === 401, '没登录发帖 → 401（这就是"提交批改必须先登录"的同一条地基）')

  /* ── 注册 ─────────────────────────────────────────────────── */
  const regA = await register(userA)
  check(regA.status === 201 && typeof regA.body.token === 'string', `注册 ${userA} → 201 并直接给了会话`)
  check(regA.body.user?.username === userA, '注册返回的用户名与提交的一致')
  check(regA.body.user?.isAdmin === false, '新注册的账号不是管理员（管理权限没有自助入口）')
  check(!('password_hash' in (regA.body.user ?? {})), '返回里**没有**密码哈希（服务端唯一出口是 toPublicUser）')
  const tokenA = regA.body.token

  const dup = await register(userA)
  check(dup.status === 409, '同名再注册 → 409（不覆盖已有账号）')

  const badHash = await call('/api/auth/register', {
    method: 'POST',
    body: { username: `vt-bad-${suffix}`, passwordHash: { algorithm: 'PBKDF2-SHA-256', salt: 'AAAA', hash: 'BBBB', iterations: 1000 } },
  })
  check(badHash.status === 400, '迭代次数只有 1000 的"弱哈希" → 400（下限是这套方案的地基）')

  /* ── 登录与枚举防护 ───────────────────────────────────────── */
  const okLogin = await login(userA)
  check(okLogin.status === 200 && typeof okLogin.body.token === 'string', '正确的用户名 + 密码 → 200 并有 token')

  const wrongPassword = await login(userA, 'definitely-not-the-password')
  const noSuchUser = await login(`vt-none-${suffix}`, password)
  check(wrongPassword.status === 401, '密码错 → 401')
  check(noSuchUser.status === 401, '用户名不存在 → 也是 401（不让人枚举出哪些名字被注册了）')
  check(
    wrongPassword.body?.error?.code === noSuchUser.body?.error?.code,
    '两种失败的错误码与文案完全相同',
    `密码错=${JSON.stringify(wrongPassword.body)} 用户不存在=${JSON.stringify(noSuchUser.body)}`,
  )

  /* ── 会话 ─────────────────────────────────────────────────── */
  const me = await call('/api/auth/me', { token: tokenA })
  check(me.status === 200 && me.body.user.username === userA, '带 token 的 /api/auth/me → 拿到自己')
  check((await call('/api/auth/me')).status === 401, '不带 token 的 /api/auth/me → 401')
  check((await call('/api/auth/me', { token: 'f'.repeat(64) })).status === 401, '伪造的 token → 401')

  /* ── 个人资料 ─────────────────────────────────────────────── */
  const tooBigAvatar = await call('/api/auth/profile', {
    method: 'POST',
    token: tokenA,
    body: { username: userA, avatar: { dataUrl: 'data:image/png;base64,AAAA', name: 'a.png', size: 999_999, type: 'image/png' } },
  })
  check(tooBigAvatar.status === 400, '头像自报体积超上限 → 400')

  const saveAvatar = await call('/api/auth/profile', {
    method: 'POST',
    token: tokenA,
    body: { username: userA, avatar: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', name: 'a.png', size: 12, type: 'image/png' } },
  })
  check(saveAvatar.status === 200 && saveAvatar.body.user.avatar?.dataUrl === 'data:image/png;base64,iVBORw0KGgo=', '存一张小头像 → 200 且读回来一致')

  const wrongOld = await call('/api/auth/profile', {
    method: 'POST',
    token: tokenA,
    body: { username: userA, oldPasswordHash: await hashPassword('wrong-old'), newPasswordHash: await hashPassword('new-password-456') },
  })
  check(wrongOld.status === 400 && wrongOld.body?.error?.code === 'old_password_wrong', '改密码时旧密码不对 → 400 old_password_wrong')

  /* ── 留言板：发帖 / 回复 / 只能删自己的 ─────────────────────── */
  const postA = await call('/api/board', { method: 'POST', token: tokenA, body: { content: '第一条验收留言' } })
  check(postA.status === 201 && typeof postA.body.post?.id === 'number', '登录后发帖 → 201 并返回帖子 id')
  const postId = postA.body.post.id

  const regB = await register(userB)
  const tokenB = regB.body.token

  const replyB = await call('/api/board/reply', { method: 'POST', token: tokenB, body: { postId, content: '来自另一个账号的回复' } })
  check(replyB.status === 201, '另一个账号可以回复')
  const replyId = replyB.body.reply.id

  const list = await call('/api/board')
  const found = (list.body.posts ?? []).find((p) => p.id === postId)
  check(Boolean(found), '列表里能找到刚发的帖子')
  check(found?.replyCount === 1 && found?.replies?.length === 1, '帖子带着回复数与预览回复一起返回')

  const longPost = await call('/api/board', { method: 'POST', token: tokenA, body: { content: '汉'.repeat(201) } })
  check(longPost.status === 400, '超过 200 个汉字的帖子 → 400')

  const deleteOthersReply = await call(`/api/board/reply/${replyId}`, { method: 'DELETE', token: tokenA })
  check(deleteOthersReply.status === 403, '删别人的回复 → 403（自己的帖也不行）')
  const deleteOthersPost = await call(`/api/board/${postId}`, { method: 'DELETE', token: tokenB })
  check(deleteOthersPost.status === 403, '删别人的帖子 → 403')

  const deleteOwnReply = await call(`/api/board/reply/${replyId}`, { method: 'DELETE', token: tokenB })
  check(deleteOwnReply.status === 200, '删自己的回复 → 200')
  const deleteOwnPost = await call(`/api/board/${postId}`, { method: 'DELETE', token: tokenA })
  check(deleteOwnPost.status === 200, '删自己的帖子 → 200')
  const afterDelete = await call('/api/board')
  check(!(afterDelete.body.posts ?? []).some((p) => p.id === postId), '删掉的帖子不再出现在列表里')

  /* ── 管理接口的权限 ───────────────────────────────────────── */
  check((await call('/api/admin/users')).status === 403, '没登录看用户管理 → 403')
  check((await call('/api/admin/users', { token: tokenA })).status === 403, '普通账号看用户管理 → 403（不是"有 token 就行"）')
  check((await call('/api/admin/logs', { token: tokenA })).status === 403, '普通账号看访问日志 → 403')

  /*
   * 管理员那几条：需要一个 **is_admin = 1** 的账号，而管理权限没有自助入口
   * （只能由站主用 SQL 指定，见 schema.sql 末尾）。因此这里读环境变量，
   * 没给就跳过——跳过要如实报出来，不能让"没跑"看起来像"跑过了"。
   */
  const adminUsername = process.env.VERIFY_ADMIN_USER
  if (adminUsername) {
    const adminLogin = await login(adminUsername, process.env.VERIFY_ADMIN_PASSWORD ?? password)
    if (adminLogin.status !== 200) {
      check(false, `管理员账号 ${adminUsername} 登录不上`, JSON.stringify(adminLogin.body))
    } else {
      const adminToken = adminLogin.body.token
      const usersRes = await call('/api/admin/users', { token: adminToken })
      check(usersRes.status === 200 && Array.isArray(usersRes.body.users), '管理员看用户列表 → 200')
      check((usersRes.body.users ?? []).some((u) => u.username === adminUsername), '用户列表里能看到管理员自己')
      check((usersRes.body.users ?? []).every((u) => !('password_hash' in u)), '用户列表里同样没有密码哈希')

      const logsRes = await call('/api/admin/logs', { token: adminToken })
      check(logsRes.status === 200 && Array.isArray(logsRes.body.logs), '管理员看访问日志明细 → 200')
      check((logsRes.body.logs ?? []).length > 0, '日志里已经有本次验收产生的访问记录')

      const statsRes = await call('/api/admin/logs?view=stats&range=week', { token: adminToken })
      check(statsRes.status === 200 && (statsRes.body.points ?? []).length === 7, '流量看板按天分桶 → 正好 7 个点（缺桶补 0）')
      check(
        (statsRes.body.points ?? []).every((p) => typeof p.count === 'number' && typeof p.label === 'string'),
        '每个点都有 label 与 count',
      )

      /* 公告：谁都能读，只有管理员能写 */
      const publicBefore = await call('/api/announcements')
      check(publicBefore.status === 200 && Array.isArray(publicBefore.body.announcements), '没登录也能读公告列表')

      const anonWrite = await call('/api/admin/announcements', {
        method: 'POST',
        body: { title: '游客发的', content: '不该成功' },
      })
      check(anonWrite.status === 403, '没登录发公告 → 403')

      const created = await call('/api/admin/announcements', {
        method: 'POST',
        token: adminToken,
        body: { title: `验收公告 ${suffix}`, content: '这条是验收脚本发的。', pinned: true },
      })
      check(created.status === 201 && typeof created.body.announcement?.id === 'number', '管理员发公告 → 201')
      const announceId = created.body.announcement.id

      const emptyTitle = await call('/api/admin/announcements', {
        method: 'POST',
        token: adminToken,
        body: { title: '   ', content: '标题全是空白' },
      })
      check(emptyTitle.status === 400, '标题只有空白 → 400')

      const listed = await call('/api/announcements')
      const mine = (listed.body.announcements ?? []).find((item) => item.id === announceId)
      check(Boolean(mine), '公告出现在公开列表里')
      check(listed.body.announcements?.[0]?.id === announceId, '置顶的公告排在最前面（公开列表按置顶优先 + 时间倒序）')

      const updated = await call(`/api/admin/announcements/${announceId}`, {
        method: 'PUT',
        token: adminToken,
        body: { title: `验收公告 ${suffix}`, content: '改过的内容。', pinned: false },
      })
      check(updated.status === 200 && updated.body.announcement?.content === '改过的内容。', '改公告 → 200 且内容换了')

      const removed = await call(`/api/admin/announcements/${announceId}`, { method: 'DELETE', token: adminToken })
      check(removed.status === 200, '删公告 → 200')
      const gone = await call('/api/announcements')
      check(!(gone.body.announcements ?? []).some((item) => item.id === announceId), '删掉的公告不再出现在公开列表里')
    }
  } else {
    skipped += 1
    console.log('  – 跳过管理员那几条（设 VERIFY_ADMIN_USER / VERIFY_ADMIN_PASSWORD 之后才会跑）')
  }

  /* ── 访问上报 ─────────────────────────────────────────────── */
  check((await call('/api/visit', { method: 'POST' })).status === 200, '游客上报访问 → 200')
  check((await call('/api/visit', { method: 'POST', token: tokenA })).status === 200, '登录用户上报访问 → 200')

  /* ── 退出 ─────────────────────────────────────────────────── */
  check((await call('/api/auth/logout', { method: 'POST', token: tokenA })).status === 200, '退出 → 200')
  check((await call('/api/auth/me', { token: tokenA })).status === 401, '退出之后原 token 立即失效')
} catch (error) {
  failures += 1
  checks += 1
  console.log(`  ✗ 验收过程抛异常：${error instanceof Error ? error.message : String(error)}`)
  console.log(`     先确认 wrangler pages dev 起着、schema 已经灌进本地 D1（见本文件顶部）`)
}

console.log(
  `\n${checks} 项检查，${failures === 0 ? '全部通过' : `${failures} 项失败`}。` +
    (skipped ? `另有 ${skipped} 项因环境不具备而跳过。` : ''),
)
if (failures === 0) {
  console.log(`本次留下的测试账号：${userA}、${userB}（本地库，可删可留）`)
}
process.exit(failures === 0 ? 0 : 1)
