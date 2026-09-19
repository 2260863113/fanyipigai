/**
 * 清空目录。
 *
 * 为什么不用 `rmSync(dir, { recursive: true, force: true })`：
 * **在受管/沙箱环境里它是静默的空操作**——不抛错、也不删任何东西。
 * 本机实测（Node 24）：`rmSync` 与 `rmdirSync({recursive:true})` 都不生效，
 * 而 `unlinkSync` + `rmdirSync` 生效。
 *
 * 这个坑不是理论问题：它已经造成两处实际后果——
 *   1. 冒烟测试写的失败存档，清理那一步形同虚设，堆了 182 份假数据，
 *      而那个目录正是提示词迭代分诊用的，等于把诊断轴变成了噪声；
 *   2. 无头浏览器用的两份 profile 目录没删掉，堆到 **122 MB**。
 * 两处都是"删了、但没报错、也没删掉"，所以谁都没发现。
 *
 * 这里逐个文件删，两种环境下都能真正删掉。目录本身保留（调用方通常紧接着还要往里写）；
 * 需要连目录一起删时用 removeDir。
 */

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** 清空目录的内容，保留目录本身。目录不存在时什么都不做。 */
export function clearDir(dir: string): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) removeDir(full)
    else unlinkSync(full)
  }
}

/** 连目录本身一起删掉。目录不存在时什么都不做。 */
export function removeDir(dir: string): void {
  if (!existsSync(dir)) return
  clearDir(dir)
  try {
    rmdirSync(dir)
  } catch {
    // 目录非空或正被占用（例如浏览器进程还没退干净）时保留，不阻塞调用方
  }
}
