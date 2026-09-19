import type { JSX } from 'react'
import { DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { MARK_BG_VALUE, MARK_COLOR_VALUE } from '../domain/color'
import type { Favorite } from '../domain/favorites'

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
function withHighlight(favorite: Favorite, text: string, tinted: boolean, start: number, end: number): JSX.Element {
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
          </p>
        ) : (
          <ul className="fav-list">
            {favorites.map((favorite) => (
              <li key={favorite.id} className="fav-item" style={{ borderLeftColor: MARK_COLOR_VALUE[favorite.color] }}>
                <div className="fav-head">
                  <span className="fav-kind" style={{ color: MARK_COLOR_VALUE[favorite.color] }}>
                    {favorite.typeLabel} · {favorite.categoryLabel}
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
