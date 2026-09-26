/**
 * 时间与文本的小工具（留言板、用户管理、访问日志三处共用）。
 *
 * 为什么单独放一个文件：这三处都要显示"什么时候发的"，各自写一遍就会出现
 * "留言板写 2026/9/25、日志写 9月25日"这种不一致；而时间格式一旦不一致，
 * 读的人会怀疑是不是两套时钟。
 */

/** `2026-09-25 20:31`（本地时区，秒级以下不显示）。 */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 相对时间：「刚刚 / 5 分钟前 / 3 小时前 / 2 天前」，更久就回落到具体日期。 */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatTime(ms)
}

/**
 * 设备名：从 User-Agent 里认出"什么浏览器 + 什么系统 + 什么机器"（**完整**的一份，第 17 条第 8 条）。
 *
 * 用户原话："对于日志记录登录的游客，对他们的设备名称的完整名称记录下来。"
 *
 * 两件事要说清楚：
 *   1. **库里一直存着完整的 User-Agent**（`access_logs.ua` 存的就是请求头原样，
 *      见 `functions/api/visit.ts`），游客也一样。缺的从来不是"记录"，而是"显示"——
 *      日志那一列原先只画 `shortenUserAgent` 的四个字（「Chrome · Windows」），
 *      完整串只藏在悬停提示里。因此这一轮把**完整名称摊在列表上**（可选中、可折行），
 *      另外给一行"人话版本"（带版本号，见 `label`）。
 *   2. 这一行**仍然是"认得出就行"**：不引 UA 解析库，认不出来的部分照实空着，
 *      宁可难看也不要假装认出来了（与 `shortenUserAgent` 同一条取舍）。
 */
export interface DeviceInfo {
  /** 浏览器名（`Edge` / `Chrome` / …）；认不出是空串 */
  browser: string
  /** 浏览器主版本号（`140`）；认不出是空串 */
  browserVersion: string
  /** 系统族（`Windows` / `Android` / `iOS` / `macOS` / `Linux`）；认不出是空串 */
  os: string
  /** 系统版本（`10/11` / `13` / `17.0`）；认不出是空串 */
  osVersion: string
  /** 设备形态：电脑 / 手机 / 平板 */
  kind: string
  /** 机型（安卓 UA 里常带着，如 `SM-G991B`）；没有就是空串 */
  model: string
  /** 给人看的一行：`Edge 140 · Windows 10/11 · 电脑` */
  label: string
}

const ANDROID_MODEL = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build[/)]|\))/

/**
 * User-Agent → 设备名。
 *
 * 判断顺序是有讲究的：**先特例后通例**——Edge 与 Opera 的 UA 里都写着 `Chrome/`，
 * iOS/安卓上的 Chrome 也写着 `Safari/`，因此必须先认 `Edg/`、`OPR/`、`CriOS`、`FxiOS`，
 * 最后才轮到 `Chrome/` 与 `Safari/`。写反了会把 Edge 认成 Chrome（两份 UA 里都写着）。
 */
export function describeDevice(ua: string): DeviceInfo {
  if (!ua) return { browser: '', browserVersion: '', os: '', osVersion: '', kind: '', model: '', label: '（没有 UA）' }

  const versionOf = (pattern: RegExp): string => {
    const matched = pattern.exec(ua)
    return matched?.[1]?.split('.')[0] ?? ''
  }
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /(?:Firefox|FxiOS)\//.test(ua)
        ? 'Firefox'
        : /(?:Chrome|CriOS)\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /(?:curl|Wget|python-requests|okhttp)/i.test(ua)
              ? '命令行 / 脚本'
              : ''
  const browserVersion = /Edg\//.test(ua)
    ? versionOf(/Edg\/([\d.]+)/)
    : /OPR\//.test(ua)
      ? versionOf(/OPR\/([\d.]+)/)
      : /FxiOS\//.test(ua)
        ? versionOf(/FxiOS\/([\d.]+)/)
        : /Firefox\//.test(ua)
          ? versionOf(/Firefox\/([\d.]+)/)
          : /CriOS\//.test(ua)
            ? versionOf(/CriOS\/([\d.]+)/)
            : /Chrome\//.test(ua)
              ? versionOf(/Chrome\/([\d.]+)/)
              : /Version\/([\d.]+).*Safari\//.test(ua)
                ? versionOf(/Version\/([\d.]+)/)
                : ''

  /*
   * Windows 的 UA 只给 `Windows NT 10.0`——**Windows 11 与 10 共用这一个号**
   * （微软让它俩在 UA 上无法区分），因此照实写「10/11」，不猜。
   */
  const windows = /Windows NT ([\d.]+)/.exec(ua)
  const android = /Android ([\d.]+)/.exec(ua)
  const ios = /(?:iPhone|iPad); CPU (?:iPhone )?OS ([\d_]+)/.exec(ua)
  const mac = /Mac OS X ([\d_.]+)/.exec(ua)
  const os = windows
    ? 'Windows'
    : android
      ? 'Android'
      : ios
        ? 'iOS'
        : mac
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  const osVersion = windows
    ? windows[1] === '10.0'
      ? '10/11'
      : windows[1] === '6.3'
        ? '8.1'
        : windows[1] === '6.2'
          ? '8'
          : windows[1] === '6.1'
            ? '7'
            : (windows[1] ?? '')
    : android
      ? (android[1] ?? '')
      : ios
        ? (ios[1]?.replace(/_/g, '.') ?? '')
        : mac
          ? (mac[1]?.replace(/_/g, '.').split('.').slice(0, 2).join('.') ?? '')
          : ''

  const kind = /iPad|Tablet/.test(ua) ? '平板' : /Mobile|Android|iPhone/.test(ua) ? '手机' : '电脑'
  const model = ANDROID_MODEL.exec(ua)?.[1]?.trim() ?? ''

  const head = [browser, browserVersion].filter(Boolean).join(' ')
  const system = [os, osVersion].filter(Boolean).join(' ')
  const label = [head || '未知浏览器', system || '未知系统', kind, model].filter(Boolean).join(' · ')
  return { browser, browserVersion, os, osVersion, kind, model, label }
}

/**
 * User-Agent 太长了（一屏放不下），这里只提取"什么浏览器 + 什么系统"。
 *
 * 不引 UA 解析库：访问日志是给自己看的，认得出"是手机还是电脑、是不是那个爬虫"就够。
 * 认不出来时原样截断前 60 个字符——**宁可难看也不要假装认出来了**。
 *
 * ⚠️ 这一份是**短名字**（不带版本号），给列表里那一列"设备"当标签用；
 * 要完整的说法（带版本号与机型）用 `describeDevice().label`，
 * 要最完整的原始串就直接显示 `ua` 本身（第 17 条第 8 条：三条一起用）。
 */
export function shortenUserAgent(ua: string): string {
  if (!ua) return '（没有 UA）'
  const device = describeDevice(ua)
  if (device.browser || device.os) return [device.browser || '未知浏览器', device.os || '未知系统'].join(' · ')
  return ua.slice(0, 60)
}

/** 用户名的首字（没有头像时用字母/汉字占位）。 */
export function initialOf(username: string): string {
  return Array.from(username.trim())[0] ?? '?'
}
