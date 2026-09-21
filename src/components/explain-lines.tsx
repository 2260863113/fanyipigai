/**
 * 说明文字按**分号**断行、每行前面加一个圈号（①②③…）。
 *
 * ## 为什么需要它
 *
 * AI 写的说明常是"第一人称代词 I 必须大写；主语 I 搭配的 be 动词是 am，不是 is"
 * 这种两三个分句挤在一句里；而放它的地方一律很窄（译文旁边的小卡片）或者很长
 * （大改档的逐句解释）。不分行的话，一处看不到头、也数不清一共几条。
 * 因此在分号处断开，并给每一行编上号。分号本身留着：它是句子的标点。
 *
 * ## 谁在用
 *
 *   - 点一处批注浮出的小卡片（`AnnotationText` 的 `ann-bubble-why`）；
 *   - **大改档的逐句解释**（`CompareLines` 的 `compare-note`）——
 *     用户要求"大改模式下，解释部分也要按照分号进行圈一圈二的序号标注分行"；
 *   - 右下角详情栏的「说明」走的是同一份文本，但那一栏宽，保持整段（见 DetailPanel）。
 *
 * ⚠️ 判据只有这一份。早先它长在 `AnnotationText.tsx` 里，大改档要用时只能再抄一遍——
 * 那正是本项目反复踩过的坑（同一件事两份实现，改一处漏一处）。
 */

import type { JSX } from 'react'

/** 圈号只备到 ⑩：说明里的分句条数远少于这个数，超了就退回 `11.` 这种写法 */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function withCircledBreaks(text: string): JSX.Element[] {
  const parts = text.split('；').filter((part) => part.trim().length > 0)
  if (parts.length <= 1) return [<span key="only">{text}</span>]
  return parts.flatMap((part, index) => {
    const marker = CIRCLED[index] ?? `${index + 1}.`
    const body = index === parts.length - 1 ? part : `${part}；`
    const line = (
      <span key={`line-${index}`} className="explain-line">
        <span className="explain-num">{marker}</span>
        {body}
      </span>
    )
    return index === parts.length - 1 ? [line] : [line, <br key={`br-${index}`} />]
  })
}
