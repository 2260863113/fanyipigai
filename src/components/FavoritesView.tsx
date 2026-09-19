import { DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { MARK_COLOR_VALUE } from '../domain/color'
import type { Favorite } from '../domain/favorites'

interface Props {
  favorites: readonly Favorite[]
  onRemove: (id: string) => void
  onClear: () => void
}

/**
 * 收藏页。
 *
 * 与「练习记录」不同：这里**不是**按次存档，而是用户自己挑出来的句子——
 * 所以每条都把「改前 / 改后 / 为什么」和**它所在的那一整句**一起摊开，
 * 一屏能扫过去，不用点开。做题时点一下卡片下方的「收藏」就会进来。
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

                {favorite.sentence && <p className="fav-sentence">{favorite.sentence}</p>}

                <p className="fav-change">
                  {favorite.from && (
                    <>
                      <span className="fav-label">{favorite.fromLabel}</span>
                      <span className="fav-from">{favorite.from}</span>
                    </>
                  )}
                  {favorite.from && favorite.to && <span className="fav-arrow">→</span>}
                  {favorite.to && (
                    <>
                      {favorite.from && <span className="fav-label">{favorite.toLabel}</span>}
                      <span className="fav-to">{favorite.to}</span>
                    </>
                  )}
                </p>

                <p className="fav-why">{favorite.why}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
