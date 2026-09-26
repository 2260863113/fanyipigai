import type { JSX } from 'react'
import { DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import { pageSourceOf } from '../domain/exercise-source'
import type { Favorite, MarkFavorite } from '../domain/favorites'
import { withCircledBreaks } from './explain-lines'

interface Props {
  favorites: readonly Favorite[]
  onRemove: (id: string) => void
  onClear: () => void
}

/**
 * 一句话，其中**这一处改动**标出来。
 *
 * `tinted`：改前那句加荧光底色（与译文上同一套荧光笔），改后那句只给文字上色——
 * 用户要的就是"荧光出现在原译文里，改后的内容只标字体颜色"。
 * 只标这一处：同一句里别的错误一律不上色，收藏的重点就是这一处。
 */
function withHighlight(favorite: MarkFavorite, text: string, tinted: boolean, start: number, end: number): JSX.Element {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  if (to <= from) return <>{text}</>
  return (
    <>
      {text.slice(0, from)}
      <span
        className={tinted ? 'fav-hi fav-hi-tinted' : 'fav-hi'}
        style={{
          color: MARK_COLOR_VALUE[favorite.color],
          ...(tinted ? { background: MARK_BG_VALUE[favorite.color] } : null),
        }}
      >
        {text.slice(from, to)}
      </span>
      {text.slice(to)}
    </>
  )
}

/**
 * 收藏页。
 *
 * 与「练习记录」不同：这里**不是**按次存档，而是用户自己挑出来的句子——
 * 所以每条都把**修改前的整句**与**修改后的整句**都摊开，一屏能扫过去，不用点开；
 * 改后那句里只给这一处上色，别的错误不上色，重点就是这一处。
 *
 * ## 两种收藏画法不同（第 17 条第 5 条）
 *
 *   - `mark`（精修档点某一处批注）：改前 / 改后各一行，只给**那一处**上色；
 *   - `sentence`（大改档每句原文后面那颗「收藏」）：**原文 / 我的译文 / 修改译文 / 解释**
 *     四行摊开——那四样就是用户点名要存下来的东西，一样都不能少。
 *     解释那一行走 `withCircledBreaks`（按分号断行、带圈号），与大改视图里印在句子下面
 *     的那段说明**同一个排版**：同一段解释在两处长得不一样的话，读的人会以为是两件事。
 */
export function FavoritesView({ favorites, onRemove, onClear }: Props) {
  return (
    <main className="favorites">
      <header className="screen-head">
        <h2>收藏</h2>
        <div className="head-meta">
          <span className="chip">共 {favorites.length} 条</span>
          {favorites.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={onClear} title="清空全部收藏（不可撤销）">
              全部清空
            </button>
          )}
        </div>
      </header>

      <div className="screen-body">
        {favorites.length === 0 ? (
          <p className="hint">
            还没有收藏。做题时点译文上任意一处勾画（或上方补写的字），右下角会出现「收藏」——
            点它就把这一处的「改前 / 改后 / 为什么」连同所在的整句存到这里，以后回来复习。
            大改档则是每一句原文后面那颗「收藏」：点一下把这一句的原文、你的译文、修改译文与解释
            四样一起存下来。
          </p>
        ) : (
          <ul className="fav-list">
            {favorites.map((favorite) => (
              <li key={favorite.id} className="fav-item" style={{ borderLeftColor: MARK_COLOR_VALUE[favorite.color] }}>
                <div className="fav-head">
                  <span className="fav-kind" style={{ color: MARK_COLOR_VALUE[favorite.color] }}>
                    {favorite.kind === 'sentence' ? '大改 · 整句收藏' : `${favorite.typeLabel} · ${favorite.categoryLabel}`}
                  </span>
                  <span className="fav-meta">
                    {KIND_LABEL[favorite.mode]} · {DIRECTION_LABEL[favorite.direction]} · {favorite.topic}
                  </span>
                  <button
                    type="button"
                    className="detail-close"
                    onClick={() => onRemove(favorite.id)}
                    aria-label="从收藏里删掉这一条"
                    title="删掉这一条"
                  >
                    ×
                  </button>
                </div>

                {favorite.kind === 'sentence' ? (
                  /* 大改档：原文 / 我的译文 / 修改译文 / 解释——用户点名要的那四部分 */
                  <>
                    {favorite.source && (
                      <p className="fav-source">
                        <span className="fav-label">原文</span>
                        {favorite.source}
                      </p>
                    )}
                    <p className="fav-sentence">
                      <span className="fav-label">我的译文</span>
                      {favorite.sentenceBefore}
                    </p>
                    {favorite.sentenceAfter && favorite.sentenceAfter !== favorite.sentenceBefore && (
                      <p className="fav-sentence fav-sentence-after">
                        <span className="fav-label">修改译文</span>
                        {favorite.sentenceAfter}
                      </p>
                    )}
                    <p className="fav-why">{withCircledBreaks(favorite.why)}</p>
                  </>
                ) : (
                  <>
                    {/*
                      这一处是从**哪一段**原文里来的（用户要求："收藏模式下，原文应该是当前一段的
                      原文，而不是整篇文章"）。文章题按记录里的页号取那一页；其它题型就是那一段本身。
                      取不到就整行不显示——不要拿整篇文章来充数。
                    */}
                    {pageSourceOf(favorite.exerciseId, favorite.sectionIndex) && (
                      <p className="fav-source">
                        <span className="fav-label">{favorite.mode === 'article' ? '原文·这一段' : '原文'}</span>
                        {pageSourceOf(favorite.exerciseId, favorite.sectionIndex)}
                      </p>
                    )}

                    {favorite.sentenceBefore && (
                      <p className="fav-sentence">
                        <span className="fav-label">改前</span>
                        {withHighlight(favorite, favorite.sentenceBefore, true, favorite.beforeStart, favorite.beforeEnd)}
                      </p>
                    )}
                    {favorite.sentenceAfter && favorite.sentenceAfter !== favorite.sentenceBefore && (
                      <p className="fav-sentence fav-sentence-after">
                        <span className="fav-label">改后</span>
                        {withHighlight(favorite, favorite.sentenceAfter, false, favorite.afterStart, favorite.afterEnd)}
                      </p>
                    )}

                    <p className="fav-why">{favorite.why}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
