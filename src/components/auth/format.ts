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
 * User-Agent 太长了（一屏放不下），这里只提取"什么浏览器 + 什么系统"。
 *
 * 不引 UA 解析库：访问日志是给自己看的，认得出"是手机还是电脑、是不是那个爬虫"就够。
 * 认不出来时原样截断前 60 个字符——**宁可难看也不要假装认出来了**。
 */
export function shortenUserAgent(ua: string): string {
  if (!ua) return '（没有 UA）'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ''
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  if (browser || os) return [browser || '未知浏览器', os || '未知系统'].join(' · ')
  return ua.slice(0, 60)
}

/** 用户名的首字（没有头像时用字母/汉字占位）。 */
export function initialOf(username: string): string {
  return Array.from(username.trim())[0] ?? '?'
}
