/**
 * 找出可用的无头浏览器（Edge / Chrome）。
 *
 * 为什么单独成文件：这段逻辑原先散在 visual.ts 与 probe-fix-align.mjs 里各一份，
 * 而且两份的候选路径**并不一致**（探针那份漏了 Program Files (x86) 下的 Chrome）——
 * 同一台机器上"冒烟测试找得到、探针找不到"这种事，正是复制出来的。
 *
 * 为什么要覆盖多个平台：vite.config.ts 与 .gitattributes 说明将来要从 git 在 Linux 上构建。
 * 原先只硬编码了四个 Windows 路径，于是这套测试在 macOS/Linux 上永远绿不了。
 *
 * 为什么认 DSH_NO_BROWSER：没有这条路的话，"找不到浏览器时应当跳过"这个分支
 * 在任何装了 Edge 的机器上都**执行不到**，也就没人能证明它真的跳过而不是报错。
 * 冒烟测试用它把跳过路径真正跑一遍。
 */

import { existsSync } from 'node:fs'

/** 各平台常见的安装位置。不存在的会被 existsSync 滤掉。 */
const CANDIDATES: readonly string[] = [
  // Windows：Edge 优先——它在 Windows 上几乎一定存在，且实测可用
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

/**
 * 找浏览器。
 *
 * `CHROME_PATH` 显式指定时**只认它**：用户明确说了用哪个，就不要再自作主张去猜别的
 * （否则"我指定了路径却还是用了别的浏览器"会让人查半天）。
 * 但它指向的文件不存在时返回 undefined，而不是悄悄退回候选列表。
 */
export function findBrowser(): string | undefined {
  if (process.env.DSH_NO_BROWSER) return undefined

  const explicit = process.env.CHROME_PATH
  if (explicit) return existsSync(explicit) ? explicit : undefined

  return CANDIDATES.find((candidate) => existsSync(candidate))
}

/** 供报错信息用的说明：告诉用户怎么让它找到浏览器。 */
export const BROWSER_HINT = '未找到 Edge 或 Chrome；可用 CHROME_PATH 指定路径，或设 DSH_NO_BROWSER=1 跳过浏览器相关检查'
