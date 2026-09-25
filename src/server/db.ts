/**
 * D1 的最小结构类型。
 *
 * 为什么自己写：这一整套账号接口是从「地图记忆」搬过来的，那边用的是
 * `import('@cloudflare/workers-types').D1Database`。本项目**故意不引**那套全局类型——
 * 它会和前端那份 DOM 类型打架（两份 `Request`/`Response` 混在一起报错最费时间），
 * 而这里的 ADR 0026 已经定了"不引 workers-types，自己写结构类型"的口径。
 *
 * 只声明真正用到的四个方法：`prepare` / `bind` / `first` / `run` / `all`。
 * 少声明一个就会在编译期报错，不会静默出问题——这是"最小"的安全之处。
 */

export interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: {
    /** INSERT/UPDATE/DELETE 影响的行数；`INSERT OR IGNORE` 靠它判断是否真的插进去了 */
    changes?: number
    /** 最后一次插入的自增 id */
    last_row_id?: number
    [key: string]: unknown
  }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(columnName?: string): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}
