/**
 * `POST /api/refine` —— 大改档：把整篇译文逐句重写，每句给出为什么这么改（不打分）。
 *
 * ⚠️ 路径里的 `refine` 指的是界面上的**「大改」**，不是「精修」。
 * 这两个名字换过一次（用户要求），而**内部键一律没动**（它们写进了解析、提示词与落盘记录），
 * 因此读代码时以键为准，见 CONTEXT.md 的「修改风格」那条。
 */

import { methodNotAllowed, runEndpoint, type PagesContext } from '../../src/server/host'

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return methodNotAllowed()
  return runEndpoint('refine', context)
}
