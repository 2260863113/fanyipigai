/**
 * 「个人资料」接口的字段校验（纯逻辑，无 DB）。
 *
 * 复用自「地图记忆」的 `functions/_lib/profile.ts`，去掉那边的 `hometown`（家乡 adcode，
 * 是地图站特有的字段），保留头像与改密码两条——这两条是**安全相关**的
 * （头像的体积上限、改密码时的旧哈希比对），因此值得单独成模块、可当纯函数测。
 *
 * 校验失败一律抛 `ApiError`，由 `http.ts` 的 `handle()` 转成统一的错误响应。
 */

import { ApiError } from './http'
import { MAX_AVATAR_DATAURL_LEN, MAX_AVATAR_SIZE } from './limits'
import { normalizePasswordHash } from './validate'
import type { UserRow } from './auth'

export interface Avatar {
  dataUrl: string
  name: string
  size: number
  type: string
}

export interface ProfileBody {
  username?: unknown
  avatar?: Avatar | null
  oldPasswordHash?: unknown
  newPasswordHash?: unknown
}

/** 库里存的三件套（改密码时只用到这三列）。 */
export type PasswordTriple = Pick<UserRow, 'password_salt' | 'password_hash' | 'password_iterations'>

/**
 * 头像：前缀必须是 `data:image/`，size 有上限，且 dataUrl **实际长度**也有上限。
 * 最后一条是刻意的：只信客户端自报的 `size` 会让超大文本绕过限制入库。
 * `undefined` = 本次不改（沿用原值），`null` = 显式清空。
 */
export function resolveAvatar(body: ProfileBody, current: string | null): string | null {
  if (body.avatar === undefined) return current
  if (body.avatar === null) return null
  const av = body.avatar
  if (typeof av.dataUrl !== 'string' || !av.dataUrl.startsWith('data:image/')) {
    throw new ApiError(400, 'invalid_avatar', '头像格式错误')
  }
  if (typeof av.size !== 'number' || av.size < 0 || av.size > MAX_AVATAR_SIZE) {
    throw new ApiError(400, 'invalid_avatar', '头像不能超过 20KB')
  }
  if (av.dataUrl.length > MAX_AVATAR_DATAURL_LEN) {
    throw new ApiError(400, 'invalid_avatar', '头像体积过大')
  }
  return JSON.stringify({ dataUrl: av.dataUrl, name: av.name ?? '', size: av.size, type: av.type ?? '' })
}

/**
 * 改密码：旧哈希必须与库中一致，新哈希自带 salt / iterations。
 *
 * 两者都没提供 = 本次不改密码，沿用原值；**只提供一个**是客户端 bug，明确报 400
 * （而不是静默不改 —— 那会让用户以为改成功了）。
 */
export function resolvePassword(
  user: PasswordTriple,
  body: ProfileBody,
): { salt: string; hash: string; iterations: number } {
  const keep = { salt: user.password_salt, hash: user.password_hash, iterations: user.password_iterations }
  if (!body.oldPasswordHash && !body.newPasswordHash) return keep
  if (!body.oldPasswordHash || !body.newPasswordHash) {
    throw new ApiError(400, 'old_password_required', '请输入旧密码和新密码')
  }
  let oldPwd: ReturnType<typeof normalizePasswordHash>
  let newPwd: ReturnType<typeof normalizePasswordHash>
  try {
    oldPwd = normalizePasswordHash(body.oldPasswordHash)
    newPwd = normalizePasswordHash(body.newPasswordHash)
  } catch {
    throw new ApiError(400, 'invalid_password_hash', '密码哈希格式错误')
  }
  if (oldPwd.hash !== user.password_hash || oldPwd.salt !== user.password_salt) {
    throw new ApiError(400, 'old_password_wrong', '旧密码不正确')
  }
  return { salt: newPwd.salt, hash: newPwd.hash, iterations: newPwd.iterations }
}
