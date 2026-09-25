import { json, handle } from '../../../src/server/http'
import { requireSession } from '../../../src/server/guard'
import { toPublicUser } from '../../../src/server/rows'

/**
 * 当前登录者是谁。
 *
 * 前端每次打开站点都会用本地存的 token 打一次这个接口：
 * 401 说明会话已失效（被删、过期），界面据此把用户送回登录框；
 * 网络错误则保留本地缓存，不把用户踢出去（见 `auth/session.ts` 的 restore）。
 */
export const onRequestGet = handle(
  requireSession(async (context) => {
    return json({ user: toPublicUser(context.session.user) })
  }),
)
