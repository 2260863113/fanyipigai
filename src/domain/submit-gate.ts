/**
 * 提交批改前的两道门：**篇幅**与**重复**（用户要求）。
 *
 * 用户的原话：
 *   "每次提交批改需要进行检测才能提交，要求字数必须大于30字（英文30个单词），
 *    且不能与这一段之前任意一次提交内容100%相同（防止重复提交），一旦违反，
 *    用吐司提示用户，并不提交批改。"
 *
 * ## 为什么门开在这里，而不是在界面上把按钮按灰
 *
 * 按灰的按钮只能表达"还不行"，说不出**为什么**不行、还差多少。这两条判据都要看内容
 * （多少个单位、与哪一次重复），因此按下去再拦、并且把原因原样说出来，用户才知道怎么改。
 * 拦截点只有一个：`submitPage` 里发起请求之前——**没有第二个入口**能发出批改请求，
 * 所以写在这一处就够了（提交按钮、翻页都不提交，见 session.ts 的说明）。
 *
 * ## 篇幅的口径：数**译文那一侧**
 *
 * 与漏译/多译的轻重（domain/severity.ts）同一个口径：**量的是译文里的那段文字**，
 * 中译英的译文是英文 → 数词；英译中的译文是中文 → 数汉字。
 * 这与文章篇幅的口径（原文那一侧，见 sections.ts 的 countUnits）恰好相反，
 * 所以下面把方向翻过来再交给 countUnits——两处都别记反。
 *
 * ## 只管文章题与段落题
 *
 * 用户拍板："只管文章题与段落题"。句子题、术语题本来就短（一句、一条短语），
 * 加 31 个单位的门槛会让它们**永远交不出去**；自己贴的题若被判成句子题/术语题同理。
 *
 * ## 重复判定：去掉首尾空白后**逐字符完全相同**
 *
 * 用户拍板的口径。因此只改标点、改大小写、多敲空格都**不算**重复——那些是真实改动，
 * 不该被拦住；而"一个字不改再交一次"正是要挡的那件事。
 * 比对范围是"这一段（这一页）在练习记录里**还留着**的每一次提交"：
 * 用户在下拉里删掉的记录等于把那一次从历史里抹掉，也就不再拦他（见 ADR 0018）。
 */

import { countUnits } from './sections'
import type { Direction, Mode } from './types'

/**
 * 篇幅下限：**必须多于 30 个单位**（用户要求"大于30"），也就是至少 31 个。
 */
export const SUBMIT_MIN_UNITS = 30

/** 受篇幅门槛约束的题型（用户指定：文章题与段落题）。 */
export function gatedByLength(mode: Mode): boolean {
  return mode === 'article' || mode === 'paragraph'
}

/**
 * 数译文里有几个单位：中译英数**词**，英译中数**汉字**。
 *
 * 方向要翻过来（见文件头）。口径与 severity.ts 的 severityUnits 一致。
 */
export function countAnswerUnits(answer: string, direction: Direction): number {
  const translationSide: Direction = direction === 'zh-to-en' ? 'en-to-zh' : 'zh-to-en'
  return countUnits(answer, translationSide)
}

/** 门槛里那个单位叫什么（写在提示语里，用户要对得上账）。 */
export function unitLabel(direction: Direction): string {
  return direction === 'zh-to-en' ? '个单词' : '个汉字'
}

export type SubmitCheck = { ok: true } | { ok: false; message: string }

/** 判定结果里用的短标签："第几次提交"由调用方数，这里只要一段能读的文字。 */
export interface SubmitGateInput {
  mode: Mode
  direction: Direction
  answer: string
  /**
   * 这一段历史上**还留着**的每一次提交（顺序不重要，只要覆盖全部）。
   * 传进来的是当时的原文，比对时两边都去掉首尾空白。
   */
  previousAnswers: readonly string[]
}

/**
 * 能不能交出去。**任何一条不过都返回原因**，调用方只管把这句话吐出来、然后什么都不做。
 */
export function checkSubmit(input: SubmitGateInput): SubmitCheck {
  const answer = input.answer
  const trimmed = answer.trim()

  if (gatedByLength(input.mode)) {
    const units = countAnswerUnits(trimmed, input.direction)
    if (units <= SUBMIT_MIN_UNITS) {
      return {
        ok: false,
        message:
          `这一段只有 ${units} ${unitLabel(input.direction)}，还不够 ${SUBMIT_MIN_UNITS + 1} 个，先写完整再交。` +
          `（太短的批改说明不了问题，也白花一次调用）`,
      }
    }
  }

  const duplicated = input.previousAnswers.findIndex((previous) => previous.trim() === trimmed)
  if (duplicated >= 0) {
    return {
      ok: false,
      message:
        '这一段与之前提交过的一次**一字不差**——重复交同一份译文不会得到新的批改，' +
        '先改动一下再交（想知道那一次批成什么样，右边「批改记录」下拉里就能调出来）。',
    }
  }

  return { ok: true }
}
