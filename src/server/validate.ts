/**
 * 入参校验与纯函数规则（与前端 `src/components/auth/password.ts` 的口径对齐）。
 *
 * 复用自「地图记忆」的 `functions/_lib/validate.ts`，只留下这个站用得到的两个函数：
 * 用户名归一化与密码哈希结构校验。那边其余内容（排行榜的范围哨兵、成绩校验）与本项目无关。
 */

import { ApiError } from './http'

export interface PasswordHashPayload {
  algorithm: string
  salt: string
  hash: string
  iterations: number
}

/**
 * 用户名归一化：与前端 `cleanUsername` **逐字一致**（trim、压缩空白、截 24）。
 *
 * 两边必须一致的理由：前端用它判断"这个名字合不合法"，后端用它决定"存哪个名字"。
 * 一旦漂移，用户会看到"界面说可以、提交却被拒"，或者注册完发现名字被悄悄改了。
 */
export function cleanUsername(username: unknown): string {
  return typeof username === 'string' ? username.trim().replace(/\s+/g, ' ').slice(0, 24) : ''
}

/**
 * 校验前端传来的 PBKDF2 哈希结构。
 *
 * 三件事必须挡住：算法名、base64 形状、**迭代次数下限**。
 * 最后一条最要紧：迭代次数是前端自报的，若允许 `iterations: 1`，
 * 攻击者拿一个弱哈希就能换到一张合法会话——这条下限是整套方案的地基。
 */
export function normalizePasswordHash(value: unknown): PasswordHashPayload {
  if (!value || typeof value !== 'object') throw new ApiError(400, 'invalid_password_hash', '密码哈希格式错误')
  const row = value as Partial<PasswordHashPayload>
  if (row.algorithm !== 'PBKDF2-SHA-256') throw new ApiError(400, 'invalid_password_hash', '不支持的密码算法')
  if (typeof row.salt !== 'string' || typeof row.hash !== 'string') {
    throw new ApiError(400, 'invalid_password_hash', '密码哈希格式错误')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(row.salt) || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.hash)) {
    throw new ApiError(400, 'invalid_password_hash', '密码哈希格式错误')
  }
  const iterations = typeof row.iterations === 'number' && Number.isInteger(row.iterations) ? row.iterations : 0
  if (iterations < 120000) throw new ApiError(400, 'invalid_password_hash', '密码迭代次数过低')
  return { algorithm: row.algorithm, salt: row.salt, hash: row.hash, iterations }
}
