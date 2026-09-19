/**
 * 选文章的弹窗：把某个「领域 × 方向」下的文章以**卡片**罗列，点一张即开始练。
 *
 * 只显示标题 + 来源 + 篇幅三样：
 *   - 标题让你认出是哪一篇；
 *   - 来源让"这是哪家媒体"一目了然（文章库只收中国官方对外媒体，见 ADR 0007）；
 *   - 篇幅（英译中计词数、中译英计汉字数）让你知道够不够赛制要求
 *     （英译汉 250–350 词、汉译英 200–300 字）。
 * 不在卡片上放原文摘要：那会把卡片撑得很高，而"要不要练这一篇"看标题与来源就够定了。
 */

import type { JSX } from 'react'
import { Modal } from './Modal'
import { articlesOf, hasArticles, labelOfDomain, type ArticleExcerpt, type ArticleDomain } from '../domain/articles'
import { DIRECTION_LABEL, type Direction } from '../domain/types'

/** 篇幅落在赛制区间内吗。区间由 API 方向决定：英译汉计词、汉译英计字。 */
function inBand(item: ArticleExcerpt): boolean {
  const [min, max] = item.direction === 'en-to-zh' ? [250, 350] : [200, 300]
  return item.units >= min && item.units <= max
}

function bandHint(item: ArticleExcerpt): string {
  const [min, max] = item.direction === 'en-to-zh' ? [250, 350] : [200, 300]
  const unit = item.direction === 'en-to-zh' ? '词' : '字'
  return inBand(item)
    ? `${item.units} ${unit}（符合赛制 ${min}–${max} ${unit}）`
    : `${item.units} ${unit}（赛制要求 ${min}–${max} ${unit}）`
}

export function ArticlePickerModal({
  domain,
  direction,
  activeArticleId,
  onSwitchDirection,
  onPick,
  onClose,
}: {
  domain: ArticleDomain
  direction: Direction
  /** 当前正在练的那一篇，用于在卡片上标出来 */
  activeArticleId: string | null
  /** 切方向（只在该方向有文章时可用） */
  onSwitchDirection: (direction: Direction) => void
  onPick: (article: ArticleExcerpt) => void
  onClose: () => void
}): JSX.Element {
  const articles = articlesOf(domain, direction)
  const directions: Direction[] = ['zh-to-en', 'en-to-zh']

  return (
    <Modal
      title="选择文章"
      note={labelOfDomain(domain)}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {/*
        方向切换在这一行也放一份：用户点领域进来是为了挑文章，
        若这一格没有该方向的文章，能就地切过去比"关掉弹窗、回那一行再切"顺手。
      */}
      <div className="gen-chips picker-dirs">
        {directions.map((item) => {
          const available = hasArticles(domain, item)
          return (
            <button
              key={item}
              type="button"
              className={item === direction ? 'gen-chip gen-chip-active' : 'gen-chip'}
              onClick={() => onSwitchDirection(item)}
              disabled={!available}
              title={available ? undefined : '这个领域暂时没有该方向的文章'}
            >
              {DIRECTION_LABEL[item]}
            </button>
          )
        })}
      </div>

      {articles.length === 0 ? (
        <p className="hint">
          这个领域在「{DIRECTION_LABEL[direction]}」方向下还没有文章。换一个领域，或切到另一个方向看看。
        </p>
      ) : (
        <ul className="article-cards">
          {articles.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === activeArticleId ? 'article-card article-card-active' : 'article-card'}
                onClick={() => onPick(item)}
              >
                <span className="article-card-title">{item.title}</span>
                <span className="article-card-meta">
                  <span className="article-card-source">{item.source}</span>
                  <span className={inBand(item) ? 'article-card-units' : 'article-card-units article-card-units-off'}>
                    {bandHint(item)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
