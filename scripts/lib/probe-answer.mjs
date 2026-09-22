/**
 * 造一段**能过提交前那两道门**的假译文（探针、截屏、验收脚本共用）。
 *
 * ## 为什么需要它
 *
 * 2026-09-22 起，提交批改前有两道门（判据在 `src/domain/submit-gate.ts`）：
 *   1. 文章题与段落题**必须多于 30 个单位**（英译中数汉字、中译英数单词）；
 *   2. 不能与这一段**之前任何一次提交**一字不差。
 *
 * 探针与截屏脚本过去是"把屏幕上的原文当作答打进去"，或者随手填一句"（改了一下）"——
 * 那两样都过不了第一道门（中文原文按单词数只有 1 个词，短句连 31 个汉字都不到）。
 * 现象是"提交之后一次批改都没发出去"，很容易被误读成功能坏了。
 *
 * ## 两件必须守住的事
 *
 * 1. **`answerForPage` 是自足的**（不引用本文件里的其它名字）：
 *    截屏脚本要把这个函数**整个塞进浏览器页面**执行（`Function.prototype.toString`），
 *    因此它不能依赖任何外部绑定。它是本文件里唯一有这个约束的函数。
 * 2. **口径不许各自漂**：造出来的作答必须真的过 `checkSubmit`——
 *    smoke 里有一条断言拿真实的 `src/domain/submit-gate.ts` 去验它。
 */

/** 与 submit-gate.ts 的 SUBMIT_MIN_UNITS 对齐（那边是"必须多于 30"，也就是至少 31）。 */
export const MIN_UNITS = 30

/**
 * 这一页该填什么作答。
 *
 * 方向**按原文判断**（原文有汉字 → 作答写英文），而不是去读界面上的方向开关：
 * 段落/句子/术语/自己贴的题都没有那个开关，而这道判断在整站是同一套口径。
 *
 * ⚠️ 自足函数，见文件头。
 */
export function answerForPage(sourceText, pageIndex) {
  const chinese = /[\u4e00-\u9fff]/.test(sourceText || '')
  if (chinese) {
    // 中文原文 → 中译英 → 作答得是英文（词数 50 以上）
    return (
      'This is a placeholder translation for page ' + (pageIndex + 1) + ', written only for the browser probe. ' +
      'It is not a real translation and it is not meant to be a good one; the probe needs the text to be ' +
      'longer than thirty words so that the grading request is actually sent out, and it needs the text to ' +
      'differ from the answers submitted for the other pages of the same article. Everything the probe ' +
      'checks after that point is structural.'
    )
  }
  // 英文原文 → 英译中 → 作答得是中文（汉字 80 以上）
  return (
    '这是探针给第 ' + (pageIndex + 1) + ' 页写的占位译文，它并不是真的翻译，只要够长、能过提交前那道门槛就行。' +
    '批改接口拿到它之后会回一份固定的结果，界面上的结构断言照旧成立，因此这段文字的长短与好坏都无关紧要。'
  )
}

/**
 * 在不改变方向的前提下把作答**改一下**（用于"返回编辑之后重新提交"这类流程）。
 *
 * 只追加，不删改：追加只会让篇幅更长，第一道门因此只会更稳；
 * 而"与上一次不同"正是第二道门要的。
 */
export function appendNote(text, note) {
  return `${text}\n${note}`
}
