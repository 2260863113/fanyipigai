/**
 * `POST /api/judge` —— 精修档的批改（逐处批注 + 打分）。
 *
 * 这个文件别无内容，是**故意**的：真正干活的是 `src/server/api.ts`，
 * 本地开发时同一份实现由 `vite-plugin-judge-api.ts` 调用。
 * 端点薄到只剩"把请求读出来、把结果写回去"，两边就不可能长出不一样的行为。
 */

import { methodNotAllowed, runEndpoint, type PagesContext } from '../../src/server/host'

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return methodNotAllowed()
  return runEndpoint('judge', context)
}
