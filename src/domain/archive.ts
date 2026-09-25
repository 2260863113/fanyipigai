/**
 * AI 返回结果的失败存档——**只有本地能用**的那一半：把一条记录写进 `.ai-failures/`。
 *
 * 为什么需要它：批改失败的原始返回是最有价值的调试材料，但它只存在于那一次调用里。
 * 没有存档，想优化提示词就只能靠回忆"它当时好像是返回了坏 JSON"。
 *
 * 存什么：每一次失败尝试的原始返回全文、finish_reason、失败原因、以及这一次请求的完整上下文
 *        （原文、学生作答、方向、文体、风格、模型名）。**不含参考译文**——它本来就没发给模型。
 *        原始返回是排查提示词问题的唯一直接证据，所以必须完整保留、不做截断。
 *
 * 不存什么：API 密钥。这条是硬性的——存档目录会被频繁查看和分享。
 *
 * 存在哪：项目根目录的 `.ai-failures/`，已被 .gitignore 忽略。
 *        文件形式而不是数据库，是为了能直接用编辑器打开、也能用 git diff 观察趋势。
 *
 * ⚠️ 记录的**形状**与**拼记录**的逻辑不在这里，在 `failure-collector.ts`——
 * 线上（workerd）没有文件系统，但同样要能拼出同一种记录、打进服务端日志，
 * 而本文件里的 `await import('node:fs')` 会让线上那份包**构建期**就失败。
 * 于是"两边共用"的搬走，"只能本地用"的留下（见 ADR 0023）。
 */

import {
  FailureCollector,
  buildFailureRecord,
  summarizeFailureRecord,
  type FailureKind,
  type FailureRecord,
} from './failure-collector'

// 老调用点（ai.ts、vite-plugin-judge-api.ts、冒烟测试）原本都从这个文件取这几样东西。
// 拆文件是内部结构问题，不该逼着它们全改一遍，因此在这里原样再导出一次。
export { FailureCollector }
export type { FailureAttempt, FailureKind, FailureRecord } from './failure-collector'

/** 存档目录名（相对于项目根目录）。测试会传自己的临时目录，见 outDir 参数。 */
export const FAILURE_DIR_NAME = '.ai-failures'

/**
 * 把一条拼好的记录落盘。返回实际的错误信息（成功时为空）。
 *
 * `outDir` 存在时写进它，否则写进项目根目录下的 `.ai-failures/`。
 *
 * 为什么要留这个参数：冒烟测试原本也往 `.ai-failures/` 写，而那个目录正是
 * `scripts/failures.mjs` 用来做提示词迭代分诊的地方——结果 178 份记录里 177 份是
 * 测试产生的假数据（model 是 test-model、note 是"冒烟测试写入"），
 * 任何从那张表得出的结论都是噪声。测试改用临时目录之后，这个目录才只装真实失败。
 */
export async function writeFailureRecord(
  record: FailureRecord,
  outDir?: string,
): Promise<string | undefined> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = outDir ?? path.resolve(process.cwd(), FAILURE_DIR_NAME)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    fs.appendFileSync(path.join(dir, 'summary.log'), `${summarizeFailureRecord(record)}\n`, 'utf8')
    return undefined
  } catch (error) {
    // 部署到没有文件系统的运行环境时走到这里。批改本身不受影响。
    return error instanceof Error ? error.message : String(error)
  }
}

/** 收集 + 拼记录 + 落盘，本地那条链路的一次调用。 */
export async function archiveFailure(
  request: { source: string; direction: string; genre: string; level: string },
  model: string,
  kind: FailureKind,
  collector: FailureCollector,
  fullAnswer: string,
  extraNote?: string,
  outDir?: string,
): Promise<string | undefined> {
  return writeFailureRecord(
    buildFailureRecord(request, model, kind, collector, fullAnswer, extraNote),
    outDir,
  )
}
