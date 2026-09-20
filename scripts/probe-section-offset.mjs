/**
 * 一次性探针：服务端返回的批注位置，是**相对这一页**还是**相对整篇重建文本**？
 *
 * 为什么要问：逐页提交时 `answerSections[0].start` 传的是"这一页在整篇里的起点"（>0）。
 * 服务端把这一页的批注按这个起点平移后再返回（`mergeSectionCorrections`），
 * 而浏览器是拿**这一页的文字**去画勾画的——若位置是整篇坐标，第 2 页以后的勾画就全错位了。
 *
 * 判据：同一份作答发两次，一次 start=0、一次 start=50；
 * 若两次返回的 span 完全相同 → 位置是**页内坐标**（传 start 无副作用）；
 * 若第二次比第一次大 50 → 是整篇坐标，客户端必须自己减回来。
 *
 * 用法：node scripts/probe-section-offset.mjs [地址]
 */

const base = process.argv[2] ?? 'http://127.0.0.1:5180'
const source = 'The report said the economy grew by 5 percent last year, and analysts expect the pace to hold.'
const answer = '这个报告说经济去年增长了百分之五，分析人士预期这个速度会保持。'

async function ask(start) {
  const response = await fetch(`${base}/api/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      direction: 'en-to-zh',
      genre: 'news',
      level: 'polish',
      sourceSections: [{ start: 0, text: source }],
      answerSections: [{ start, text: answer }],
    }),
  })
  const body = await response.json()
  if (!body.ok) return { ok: false, message: body.message }
  const spans = body.validated.errors.map((entry) => `${entry.error.id}:${entry.span.start}-${entry.span.end}`)
  const highlights = body.validated.highlights.map((entry) => `${entry.highlight.id}:${entry.span.start}-${entry.span.end}`)
  return { ok: true, spans, highlights, answerLength: answer.length }
}

console.log(`作答长度 ${answer.length} 字，逐页提交时这一页的起点本可以 >0`)
const zero = await ask(0)
console.log('start=0  →', JSON.stringify(zero))
const shifted = await ask(50)
console.log('start=50 →', JSON.stringify(shifted))
if (!zero.ok || !shifted.ok) {
  console.log('有请求没成功，判不出来')
  process.exitCode = 1
} else {
  const same = JSON.stringify(zero.spans) === JSON.stringify(shifted.spans)
  console.log(
    same
      ? '\n→ 两次位置完全相同：服务端返回的是**页内坐标**（嗯？与代码里 mergeSectionCorrections 的平移不符，需要再查）'
      : '\n→ 位置随 start 平移：服务端返回的是**整篇坐标**，客户端渲染前必须减回这一页的起点',
  )
}
