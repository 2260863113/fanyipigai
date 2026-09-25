/**
 * `POST /api/generate` —— AI 出题（同一条路径、同一把密钥，只是提示词与校验不同）。
 */

import { methodNotAllowed, runEndpoint, type PagesContext } from '../../src/server/host'

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') return methodNotAllowed()
  return runEndpoint('generate', context)
}
