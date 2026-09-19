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
 * 一句话，其中**这一处改动**用相应颜色标出来。
 *
 * 只标这一处：同一句里别的错误一律不上色——收藏是"我要记这一处"，
 * 整句都花掉就没了重点。上色用的是与译文上同一套荧光笔底色 + 同色文字。
 */
function withHighlight(favorite: Favorite, text: string): JSX.Element {
  const start = Math.max(0, Math.min(favorite.colorStart, text.length))
  const end = Math.max(start, Math.min(favorite.colorEnd, text.length))
  if (end <= start) return <>{text}</>
  return (
    <>
      {text.slice(0, start)}
      <span
        className="fav-hi"
        style={{ background: MARK_BG_VALUE[favorite.color], color: MARK_COLOR_VALUE[favorite.color] }}
      >
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
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
                    {favorite.colorOn === 'before'
                      ? withHighlight(favorite, favorite.sentenceBefore)
                      : favorite.sentenceBefore}
                  </p>
                )}
                {favorite.sentenceAfter && favorite.sentenceAfter !== favorite.sentenceBefore && (
                  <p className="fav-sentence fav-sentence-after">
                    <span className="fav-label">改后</span>
                    {favorite.colorOn === 'after'
                      ? withHighlight(favorite, favorite.sentenceAfter)
                      : favorite.sentenceAfter}
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
