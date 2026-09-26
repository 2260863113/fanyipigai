/**
 * 术语模式里"写错的那个词上方那一行更正"该怎么摆（用户第 17 条第 2 条）。
 *
 * 用户原话："术语模式下，我的译文的修改方式和文章模式一样，需要让修改内容一行就写完，
 * 如果太窄写不下，那么就把标记颜色的部分拓宽（左右加空格），直到修改内容可以一行装下。"
 *
 * 拆成两件事，这里各管一件：
 *   1. **一行就写完**：`.term-above` 不再按"被划掉那个词的宽度"折行
 *      （早先是 `max-width: 100%`，于是被划掉的是一个词时，上方那行更正会被折成三四行）。
 *      改为 `white-space: nowrap`——但要先问一句"这一行到底放不放得下"，
 *      放不下时退回折行（与第 1 条给"参考译文"定的口径同一句话：装得下就一行，装不下才两行）。
 *   2. **拓宽标记段**：放得下时，给划掉的那一段**左右各加一点空白**，让它至少和上方那行更正
 *      一样宽——"标记颜色的部分"于是包住了要写的字，看起来是"在它上面写"，而不是"悬空在左上方"。
 *
 * 为什么要有量尺：这两件事都取决于**文字实际有多宽**，而 CSS 算不出来。
 * 因此这里给一把屏幕外的尺（`measureOneLineWidth`），量出来的宽度与"它此刻是怎么摆的"无关
 * ——量一个 `white-space: normal` 的盒子只会量到折行后的宽度，那样会出现
 * "折行 → 看着放得下 → 改成一行 → 又放不下"的来回跳。
 *
 * 判据本身（`correctionFit`）是**纯函数**，可以对着数字单测；涉及 DOM 的只有那把尺。
 */

/** 一条更正怎么摆。 */
export interface CorrectionFit {
  /** 标记段**左右各**要加多少空白（px，0 表示不用加） */
  pad: number
  /** 一行放得下（放不下时上层会把它摆成折行的样子） */
  oneLine: boolean
}

/** 更正那一行与行尾的 ✗ 之间要留的缝（px）：不留的话长更正会顶到 ✗ 上。 */
export const CORRECTION_GAP = 6

/**
 * 这一行更正怎么摆。
 *
 * 三个数都从界面上量来（见 `TermResults` 的测量 effect）：
 *   - `correctionWidth`：更正那一行**一行**有多宽；
 *   - `anchorWidth`：被划掉的那一段现在有多宽；
 *   - `availableWidth`：从被划掉那段的**左边缘**到这一行还有多少可用宽度
 *     （右边要减掉 ✗ 与那条缝）。
 *
 * 规矩：
 *   - 更正比可用宽度还宽 → **折行**（`pad: 0`）。这种情形就是"物理上塞不下一行"，
 *     例如《手册》那三个板块里整句的当代术语，一条就有上千像素；
 *   - 否则一行摆下，并把标记段左右各撑开 `(更正宽度 - 标记段宽度) / 2`——
 *     撑到正好包住更正为止；再宽也没有意义（那只是白白推开后面的字）。
 *     撑开量受可用宽度约束：**不许把这一行撑出 ✗ 之外**。
 */
export function correctionFit(input: {
  correctionWidth: number
  anchorWidth: number
  availableWidth: number
}): CorrectionFit {
  const correction = Math.max(0, input.correctionWidth)
  const anchor = Math.max(0, input.anchorWidth)
  const available = Math.max(0, input.availableWidth)
  if (correction > available) return { pad: 0, oneLine: false }
  const need = Math.ceil((correction - anchor) / 2)
  const room = Math.floor((available - anchor) / 2)
  return { pad: Math.max(0, Math.min(need, room)), oneLine: true }
}

/**
 * 屏幕外的一把量尺：量一段文字在指定字体下**一行**有多宽。
 *
 * 为什么不用 `scrollWidth`/`getClientRects`：那两样量到的是"它**现在**这么摆时的宽度"。
 * 折行状态下量出来的是折行后的宽度（≈盒子宽度），于是判据会自己骗自己。
 * 这把尺始终 `nowrap`、藏在屏幕外，与界面上怎么摆无关，量完就摘掉。
 */
export function measureOneLineWidth(text: string, font: string): number {
  const ruler = document.createElement('span')
  ruler.style.position = 'absolute'
  ruler.style.left = '-99999px'
  ruler.style.top = '0'
  ruler.style.whiteSpace = 'nowrap'
  ruler.style.visibility = 'hidden'
  if (font) ruler.style.font = font
  ruler.textContent = text
  document.body.appendChild(ruler)
  const width = ruler.getBoundingClientRect().width
  ruler.remove()
  return width
}
