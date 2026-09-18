/**
 * 查看 AI 失败存档。
 *
 * 用途：失败记录的价值全在于事后能不能快速看出"提示词该改哪里"。
 * 这个脚本把 .ai-failures/ 里的记录汇总成一张表，并支持看某一条的原始返回全文。
 *
 * 用法：
 *   node scripts/failures.mjs            列出全部失败记录（按时间倒序）
 *   node scripts/failures.mjs --raw <编号>  打印某一条的原始返回全文
 *   node scripts/failures.mjs --stats     只按失败类型统计
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dir = path.join(root, '.ai-failures')

if (!existsSync(dir)) {
  console.log('还没有失败存档。批改失败时会自动写入 .ai-failures/。')
  process.exit(0)
}

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .reverse()

const records = files.map((name) => {
  const raw = readFileSync(path.join(dir, name), 'utf8')
  return { file: name, data: JSON.parse(raw) }
})

const args = process.argv.slice(2)

if (args[0] === '--raw') {
  const index = Number(args[1] ?? '1') - 1
  const record = records[index]
  if (!record) {
    console.log(`没有第 ${index + 1} 条记录（共 ${records.length} 条）`)
    process.exit(1)
  }
  console.log(`\n文件：${record.file}`)
  console.log(`时间：${record.data.at}   类型：${record.data.kind}   尝试 ${record.data.attempts} 次`)
  console.log(`方向/文体/风格：${record.data.request.direction} / ${record.data.request.genre} / ${record.data.request.level}`)
  console.log(`\n──── 学生作答（${record.data.request.answerLength} 字符）────\n${record.data.request.answer}`)
  for (const attempt of record.data.history) {
    console.log(`\n──── 第 ${attempt.attempt} 次返回的原始内容（finish_reason=${attempt.finishReason}）────`)
    console.log(`判定出的问题：`)
    for (const problem of attempt.problems) console.log(`  - ${problem}`)
    console.log(`\n原始返回全文：\n${attempt.raw}`)
  }
  console.log('')
  process.exit(0)
}

if (records.length === 0) {
  console.log('还没有失败存档。')
  process.exit(0)
}

if (args[0] === '--stats') {
  const byKind = new Map()
  for (const { data } of records) byKind.set(data.kind, (byKind.get(data.kind) ?? 0) + 1)
  console.log(`共 ${records.length} 条失败记录\n`)
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(18)} ${count} 次`)
  }
  console.log('')
  process.exit(0)
}

console.log(`共 ${records.length} 条失败记录（最新的在前）\n`)
console.log('序号  时间                  类型               尝试  方向/文体/风格')
console.log('----  --------------------  -----------------  ----  --------------------------')
records.forEach(({ data }, index) => {
  const time = String(data.at).replace('T', ' ').slice(0, 19)
  const meta = `${data.request.direction}/${data.request.genre}/${data.request.level}`
  console.log(
    `${String(index + 1).padEnd(4)}  ${time.padEnd(20)}  ${String(data.kind).padEnd(17)}  ` +
      `${String(data.attempts).padEnd(4)}  ${meta}`,
  )
  const firstProblem = data.history?.[0]?.problems?.[0]
  if (firstProblem) console.log(`      首因：${String(firstProblem).slice(0, 110)}`)
})

console.log('\n看某一条的原始返回全文：node scripts/failures.mjs --raw <序号>')
console.log('按类型统计：            node scripts/failures.mjs --stats')
