/**
 * 账号这一套接口的公共底座：环境、上下文、JSON 响应、错误类型、请求体读取。
 *
 * 复用自「地图记忆」的 `functions/_lib/http.ts`，只改了两处：
 * - `Env` 多带 DeepSeek 那两个（批改接口与账号接口共用一个 Env，见 `host.ts`）；
 * - `Ctx` 多一个 `next()`（本项目的 Pages 上下文里有它，中间件要用）。
 * 其余逐字保留，包括"抛 ApiError、由 handle() 统一转成 JSON"这个约定。
 */

import type { D1Database } from './db'

export interface Env {
  /** D1：账号、会话、留言板、访问日志。**没绑库时所有账号接口都会 500**（见 wrangler.toml） */
  DB: D1Database
  /** 批改用的 DeepSeek 密钥（本地来自 .dev.vars，线上来自 Secret） */
  DEEPSEEK_API_KEY?: string
  /** 可选：覆盖模型名 */
  DEEPSEEK_MODEL?: string
}

/** 一个路由的上下文。`params` 只声明字符串：本项目用到的只有 `[id]` 这种单段参数。 */
export interface Ctx {
  request: Request
  env: Env
  params: Record<string, string>
  next(): Promise<Response>
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 从请求体解析 JSON；失败抛 ApiError 400。 */
export async function readJson<T>(request: Request): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, 'invalid_json', '请求体不是合法 JSON')
  }
  return body as T
}

/** 取 Authorization: Bearer <token>，无则返回 null。 */
export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m?.[1] ?? null
}

/**
 * 包一层 onRequest：内部抛 ApiError → 统一转成 JSON 错误响应。
 *
 * 这一层是"错误响应只有一种形状"的保证：`{ error: { code, message } }`。
 * 前端据此把 `code` 翻成人话（见 `src/components/auth/errors.ts`）。
 */
export function handle(handler: (context: Ctx) => Promise<Response>) {
  return async (context: Ctx) => {
    try {
      return await handler(context)
    } catch (err) {
      if (err instanceof ApiError) return apiError(err.status, err.code, err.message)
      console.error(err)
      return apiError(500, 'internal', '服务器内部错误')
    }
  }
}
