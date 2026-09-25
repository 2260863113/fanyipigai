/**
 * 访问口令与登录凭证。
 *
 * 站点的网址是公开的，而每次批改都要花 API 的钱，所以门口必须有人看着
 * （README「技术架构」里那条"访问控制：全局口令 + 长期登录凭证"，此前一直是"尚未开始"）。
 *
 * 为什么自己写而不是引一个库：要用到的只有两件小事——比一串口令、签一个 cookie。
 * 两边运行时（Node 18+ 与 workerd）都有 WebCrypto，因此这几行代码在哪儿都跑得一样；
 * 引一个库反而要跟着它的版本走，还得替它的 Node 依赖做兼容层。
 *
 * ⚠️ 口令比对与 cookie 校验都必须**常量时间**：早退（发现第一个字符不同就立刻返回）
 * 会通过响应快慢泄露"前几位猜对了没有"，口令再长也能被逐位试出来。
 * 这里的办法是先各自哈希成**等长**的摘要再逐字节异或累加——长度信息也被抹掉了。
 */

/** cookie 名。带着项目名，同一台机器上开几个站也不会串。 */
const COOKIE_NAME = 'fanyipigai_session'

/**
 * cookie 里格式的版本号。
 *
 * 有它的理由：以后若要往里加字段（比如"记住这台设备"），校验逻辑得能分辨
 * "这是老格式"和"这是别人伪造的乱码"。不带版本号时这两件事长得一样。
 */
const COOKIE_VERSION = 'v1'

/** 登录凭证的有效期：30 天。口径是"长期登录凭证"——练一次翻译不该每次重新输口令。 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export const SESSION_COOKIE_NAME = COOKIE_NAME

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | undefined {
  // atob 对非法字符会抛异常，而这里收到的是**用户可控**的 cookie 值，因此必须兜住。
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

/** 逐字节异或累加：不因为"前几位不同"而提前返回。 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return diff === 0
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

/**
 * 比对口令。
 *
 * 两边都先过一遍 SHA-256 再比：这样比较的是两个**等长**的摘要，
 * "口令多长"这件事本身也不泄露。空口令一律判否——否则"没配口令"会变成"空口令就能进"。
 */
export async function passwordMatches(expected: string, given: string): Promise<boolean> {
  if (!expected || !given) return false
  const [a, b] = await Promise.all([sha256(expected), sha256(given)])
  return equalBytes(a, b)
}

/** 签一张登录凭证：`v1.<过期时间戳>.<签名>`。 */
export async function signSession(secret: string, expiresAtSeconds: number): Promise<string> {
  const payload = `${COOKIE_VERSION}.${expiresAtSeconds}`
  const signature = await hmac(secret, payload)
  return `${payload}.${toBase64Url(signature)}`
}

/**
 * 校验一张登录凭证：格式对、没过期、签名对，三者全中才算数。
 *
 * 注意"签名对"这一条才是它的全部意义所在——过期时间写在**浏览器拿着的那串里**，
 * 没有签名的话，谁都能把它改成一个遥远的未来。
 */
export async function verifySession(
  secret: string,
  cookieValue: string | undefined,
  nowSeconds: number,
): Promise<boolean> {
  if (!secret || !cookieValue) return false
  const parts = cookieValue.split('.')
  if (parts.length !== 3) return false
  const [version, expiresRaw, signatureRaw] = parts
  if (version !== COOKIE_VERSION || !expiresRaw || !signatureRaw) return false

  const expiresAt = Number(expiresRaw)
  if (!Number.isInteger(expiresAt) || expiresAt <= nowSeconds) return false

  const given = fromBase64Url(signatureRaw)
  if (!given) return false
  const expected = await hmac(secret, `${version}.${expiresRaw}`)
  return equalBytes(expected, given)
}

/** 从 Cookie 头里取一个值。取不到就是 `undefined`——不抛异常，调用方只需判真假。 */
export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1)
  }
  return undefined
}

/**
 * 拼 Set-Cookie。
 *
 * - `HttpOnly`：脚本读不到它，XSS 也偷不走登录状态。
 * - `SameSite=Lax`：别的站点发起的请求带不上它（CSRF 挡住），而站内跳转正常。
 * - `Secure`：只有 https 才加。本地 `wrangler pages dev` 是 http，
 *   加了浏览器就不会回传，表现为"口令输对了却一直退回登录页"——这种坑不值得踩。
 */
export function sessionCookie(value: string, secure: boolean): string {
  return (
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`
  )
}

/** 退出：把 cookie 立刻作废（值留空、寿命归零）。 */
export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
