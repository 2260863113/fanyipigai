import { revokeSession } from '../../../src/server/auth'
import { json, handle } from '../../../src/server/http'

/** 退出登录：删掉这个 token 对应的会话行（其他设备上的会话不受影响）。 */
export const onRequestPost = handle(async (context) => {
  await revokeSession(context.request, context.env)
  return json({ ok: true })
})
