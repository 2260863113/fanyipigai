/**
 * 选文章的弹窗：把某个「领域 × 方向」下的文章以**卡片**罗列，点一张即开始练。
 *
 * 卡片上三样：
 *   - **标题就是那一篇的「事件锚点」**——一行说明它讲的是哪件事，这是用户定的口径
 *     （这批材料没有来源媒体、也没有链接，编不出真实出处就不要编，见 ADR 0010）；
 *   - **全文篇幅 + 一共几页**——练习时"一页 = 一个自然段"，因此"共几页"才是该告诉用户的事；
 *   - **最高分**（用户第 12 条要求）——这篇文章历次批改里的最高分，没得分就写 0 分，
 *     用来一眼看出"哪一篇我练得好、哪一篇还得再来"。只算精修档：大改不打分
 *     （用户拍板的口径："分数打分只有精修部分有"）。
 * 不在卡片上放原文摘要：那会把卡片撑得很高，而"要不要练这一篇"看那行锚点就够定了。
 *
 * ## 顺序：没练完的在前面，练完的排到最后
 *
 * 用户要求「整篇翻译完并批改的文章，以后『换一换』留到最后」。
 * 选文章列表与「换一换」走的是同一个顺序函数（`orderForPicker`），因此两处一致；
 * 练完的那些还会挂一个「已完成」的标记，点开也仍然能再练一遍。
 */

import type { JSX } from 'react'
import { Modal } from './Modal'
import { articlesOf, hasArticles, labelOfDomain, type Article, type ArticleDomain } from '../domain/articles'
import { pageCountOf } from '../domain/exercise-source'
import { DIRECTION_LABEL, type Direction } from '../domain/types'
import { isCompleted, orderForPicker, type ProgressMap } from './article-progress'

function unitsHint(item: Article): string {
  const unit = item.direction === 'en-to-zh' ? '词' : '字'
  return `全文 ${item.units} ${unit} · 共 ${pageCountOf(item.id)} 页（一段一页）`
}

export function ArticlePickerModal({
  domain,
  direction,
  activeArticleId,
  progress,
  maxScores,
  onSwitchDirection,
  onPick,
  onClose,
}: {
  domain: ArticleDomain
  direction: Direction
  /** 当前正在练的那一篇，用于在卡片上标出来 */
  activeArticleId: string | null
  /** 文章进度（哪几页批过），用来标出"已完成"并把它排到最后 */
  progress: ProgressMap
  /**
   * 每篇文章的**最高分**（题号 → 分数）；没练过或没得分的文章不在表里，卡片上显示 0 分。
   *
   * 由 App 现算（本组件不去碰练习记录）：分数**不是存下来的**，
   * 精修档每次都是按错误列表现算（见 domain/scoring.ts），因此只能在上层算好再传进来。
   */
  maxScores: Record<string, number>
  /** 切方向（只在该方向有文章时可用） */
  onSwitchDirection: (direction: Direction) => void
  onPick: (article: Article) => void
  onClose: () => void
}): JSX.Element {
  const articles = orderForPicker(articlesOf(domain, direction), progress, (item) => pageCountOf(item.id))
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
          {articles.map((item) => {
            const done = isCompleted(progress, item.id, pageCountOf(item.id))
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === activeArticleId ? 'article-card article-card-active' : 'article-card'}
                  onClick={() => onPick(item)}
                >
                  <span className="article-card-title">
                    {item.title}
                    {/* 练完的排到最后，并且明说是练完的——不然用户会以为它被弄丢了 */}
                    {done && <span className="article-card-done">已完成</span>}
                  </span>
                  <span className="article-card-meta">
                    <span className="article-card-units">{unitsHint(item)}</span>
                    {/*
                      最高分（用户第 12 条要求）。没有就写 0 分——**如实显示一个数字**，
                      而不是把标签藏起来：藏起来会让"这篇我还没练过"和"练过但没得分"
                      看起来一样，而用户要的正是"一眼看出哪篇练出的分高"。
                      口径见 App 里的 maxScoreByArticle：只算**精修**（大改不打分）。
                    */}
                    <span className="article-card-best" title="这篇文章历次批改里的最高分（只算精修档；大改不打分）">
                      最高分 {maxScores[item.id] ?? 0} 分
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
