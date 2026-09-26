import { useMemo, useRef, useState } from 'react'
import type { Correction, Direction, JudgeSource, Mode, PolishLevel } from '../domain/types'
import { DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { pageReferenceOf, pageSourceOf } from '../domain/exercise-source'
import type { RefineResult } from '../domain/refine'
import type { ValidatedCorrection } from '../domain/validate'
import { scoreCorrection } from '../domain/scoring'
import { AnnotationList } from './AnnotationList'
import { AnnotationText, type Selection } from './AnnotationText'
import { AnswerViewSwitch } from './AnswerViewSwitch'
import { CompareView } from './CompareView'
import { RefineView } from './RefineView'
import { RefineNoScore } from './ScorePane'
import { SourceText } from './SourcePane'
import { buildLayout } from '../domain/layout'
import { ScoreSummary } from './ScoreSummary'
import { DetailPanel } from './DetailPanel'
import { RawResponseButton } from './RawResponseButton'
import { favoriteFor } from './annotation-summary'
import { useSplitDrag } from './split-drag'
import type { Favorite } from '../domain/favorites'
import type { ViewSettings } from './settings'

/**
 * 一次作答的存档视图。
 *
 * ⚠️ 逐页批改之后，**一条记录 = 一页**，不再是"一整篇"。因此 `answer` 是
 * **那一页**的译文、`sectionIndex` 是它在这一篇里的页号（从 0 开始）。
 * "第几次作答"（attempt）仍然是按**题目**数的：同一篇译文的第 1 页、第 2 页
 * 会各自留下一条，编号连续往下走，回看时能看清先后。
 */
export interface RecordView {
  id: string
  exerciseId: string
  mode: Mode
  direction: Direction
  topic: string
  attempt: number
  /** 这一页在这一篇原文里的页号（从 0 开始）。术语题也是逐页的（一页十条） */
  sectionIndex: number
  level: PolishLevel
  answer: string
  correction: Correction
  validated: ValidatedCorrection
  source: JudgeSource
  /** AI 原样返回的完整文本（与练习页共用同一个弹窗） */
  raw: string
  createdAt: Date
  /**
   * 大改档专有：整篇逐句重写 + 逐句解释 + AI 给的总体分数（见 domain/refine.ts）。
   * 有它的记录回看时只能看对照视图，分数显示 AI 总评、没有逐处批注。
   */
  refine?: RefineResult
}

interface Props {
  records: RecordView[]
  openRecord: RecordView | null
  onOpen: (record: RecordView | null) => void
  selection: Selection | null
  /** 界面偏好（行距、是否显示修改框）*/
  settings: ViewSettings
  /** 改界面偏好；练习记录页只用它切译文视图（与练习页同一个开关） */
  onSettingsChange: (patch: Partial<ViewSettings>) => void
  /** 选中一处批注；传 null 表示关闭详情 */
  onSelect: (selection: Selection | null) => void
  /** 收藏列表：右下角那颗「收藏」要知道这一处是不是已经收藏过 */
  favorites: readonly Favorite[]
  onToggleFavorite: (favorite: Favorite) => void
  /**
   * 删掉一条记录（用户第 11 条要求：练习记录里也加删除按钮，与「批改记录」下拉里那颗叉号是同一件事）。
   *
   * 连带的事（进度、正在看的那一次、屏幕上摆着的那份结果）由 App 处理：
   * 这一页只知道"用户要删哪一条"。
   */
  onDelete: (record: RecordView) => void
}

/**
 * 练习记录页。
 *
 * 顶部导航栏里的一栏，因此占据整个主体区域：左边是全部记录的列表，
 * 右边沿用练习页的四栏结构——上排是题干原文与当时写的译文，下排是计分与逐处批注。
 */
export function RecordsView({ records, openRecord, onOpen, selection, settings, onSettingsChange, onSelect, favorites, onToggleFavorite, onDelete }: Props) {
  /** 正在问"确定删这一条吗"的那一条；null = 没在问（与批改记录下拉里那颗叉号同一套做法） */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  /*
   * 题干原文：**这一条记录当时做的那一段**，不是整篇。
   *
   * 用户要求：「收藏模式下，原文应该是当前一段的原文，而不是整篇文章。」
   * 文章题一篇被切成好几页（见 domain/sections.ts 的 paginateArticle），
   * 一条记录就是**一页**，所以这里按记录里的页号取那一页。
   * 五个来源（文章库/内置题/自己贴的/句子库/术语库）的查找集中在 domain/exercise-source.ts，
   * 与练习页同一套分页，因此拿到的永远是"当时屏幕上那一段"。
   */
  const source = openRecord ? pageSourceOf(openRecord.exerciseId, openRecord.sectionIndex) : ''
  /** 文章题才有分页概念，界面上如实标出是第几页 */
  const sourceIsPage = openRecord ? openRecord.mode === 'article' : false
  /*
   * 这一段对应的**参考译文**（用户要求：记录页也显示）。
   *
   * 复盘时最有用的一句话就是"我当时这么译，标准译文是这么写"——参考译文存在的意义之一
   * 就是给用户自查（ADR 0003）。文章库自带逐段对齐的译文，因此这一段查得到；
   * 自己贴的题、句子题、术语题没有译文，这一块就不出现。
   */
  const reference = openRecord ? pageReferenceOf(openRecord.exerciseId, openRecord.sectionIndex) : ''
  /**
   * 记录页也要能"点某处批改 → 原文里对应那一段标同色"（用户要求，练习页与记录页同一套行为）。
   * 位置来自存下来的 `sourceAnchor`（AI 给的 sourceText 在解析时定位出来的），
   * 因此回看旧记录照样点得出来。
   */
  const recordSourceMark = useMemo(() => {
    if (selection?.kind !== 'error' || !openRecord) return null
    const entry = openRecord.validated.errors.find((item) => item.error.id === selection.id)
    const anchor = entry?.error.sourceAnchor
    if (!entry || !anchor) return null
    return { start: anchor.start, end: anchor.end, color: entry.hard ? ('red' as const) : ('orange' as const) }
  }, [selection, openRecord])

  /*
   * 左右两屏的边界也能拖（与练习页同一套 useSplitDrag）。
   * 记录页有三条边界：外层左右、右边那一屏里上下两排、以及上排的原文/译文——
   * 三条都各自一个实例（双层嵌套的 split 各有各的比例）。
   */
  const splitRef = useRef<HTMLElement | null>(null)
  const { split, style: splitStyle, beginDrag, resetSplit } = useSplitDrag('records-outer', splitRef)
  const nestedRef = useRef<HTMLDivElement | null>(null)
  const nested = useSplitDrag('records-nested', nestedRef)

  /** 当前选中那一处的收藏内容（记录页也要能收藏） */
  const favorite = openRecord
    ? favoriteFor({
        selection,
        validated: openRecord.validated,
        answer: openRecord.answer,
        context: {
          exerciseId: openRecord.exerciseId,
          mode: openRecord.mode,
          direction: openRecord.direction,
          topic: openRecord.topic,
          sectionIndex: openRecord.sectionIndex,
        },
      })
    : null

  /*
   * 存档里的译文同样要带勾画：练习记录的意义就是"回头看清当时哪里错了"，
   * 只给一份纯文本，用户得自己在脑子里重做一遍定位。
   * 区间早就存在 validated 里了，这里只是把它排成片段序列。
   */
  const answerLayout = useMemo(
    () =>
      openRecord
        ? buildLayout(openRecord.validated, openRecord.answer)
        : { segments: [], reorderGroups: [], rejectedIds: [], droppedCount: 0 },
    [openRecord],
  )

  return (
    <main className={`split split-records${split ? ' split-manual' : ''}`} ref={splitRef} style={splitStyle}>
      <section className="screen screen-left">
        <header className="screen-head">
          <h2>练习记录</h2>
          <div className="head-meta">
            {/* 逐页批改之后一条记录是**一页**，因此这里说的是"页"，不再说"次作答" */}
            <span className="chip">共 {records.length} 页记录</span>
          </div>
        </header>
        <div className="screen-body">
          {records.length === 0 ? (
            <p className="hint">
              还没有练习记录。回到任意题型提交一次批改，这里就会留下存档，以后可以回看当时的完整批改。
            </p>
          ) : (
            <ul className="record-list">
              {records
                .slice()
                .reverse()
                .map((record) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      className={record.id === openRecord?.id ? 'record-item record-item-active' : 'record-item'}
                      onClick={() => onOpen(record)}
                    >
                      <span className="record-top">
                        <span className="record-attempt">
                          {KIND_LABEL[record.mode]} · 第 {record.attempt} 次 · 第 {record.sectionIndex + 1} 页
                          {/* 大改档不打分（ADR 0020），列表上照实说，不写一个假分数 */}
                          {record.refine && <span className="record-refine">大改</span>}
                        </span>
                        <span className="record-score">
                          {record.refine
                            ? '不打分'
                            : `${scoreCorrection(record.correction, record.answer, record.direction).total} 分`}
                        </span>
                      </span>
                      <span className="record-meta">
                        {DIRECTION_LABEL[record.direction]} · {record.topic} ·{' '}
                        {record.level === 'polish' ? '精修' : '大改'} · 错误{' '}
                        {record.validated.errors.length} 处
                        {record.source === 'fixture' && ' · 示例'}
                        {record.source === 'local' && ' · 本地判分'}
                      </span>
                      <span className="record-time">
                        {record.createdAt.toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>

      <div
        className="splitter splitter-v"
        role="separator"
        aria-orientation="vertical"
        title="拖动调整左右宽度；双击恢复自动"
        onPointerDown={(event) => beginDrag('v', event)}
        onDoubleClick={resetSplit}
      />

      <section className="screen screen-right">
        <header className="screen-head">
          <h2>
            {openRecord
              ? `${KIND_LABEL[openRecord.mode]} · 第 ${openRecord.attempt} 次作答的第 ${openRecord.sectionIndex + 1} 页批改`
              : '批改详情'}
          </h2>
          {openRecord && (
            <div className="head-meta">
              {/*
                删掉这一条（用户第 11 条要求）。它与「批改记录」下拉里那颗叉号删的是**同一条数据**，
                因此两处的文案与后果必须一模一样：删掉就真没了，练习记录与下拉同步消失。
              */}
              {confirmingDelete === openRecord.id ? (
                <>
                  <span className="hint">删掉这一条？练习记录里也会消失。</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger"
                    onClick={() => {
                      onDelete(openRecord)
                      setConfirmingDelete(null)
                    }}
                  >
                    删除
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmingDelete(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmingDelete(openRecord.id)}
                  title="删掉这一条记录（批改记录下拉里也会消失）"
                >
                  删除这一条
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => onOpen(null)}>
                关闭
              </button>
            </div>
          )}
        </header>

        {!openRecord ? (
          <div className="screen-body">
            <p className="hint">从左边选一条记录，这里会显示当时的完整批改。</p>
          </div>
        ) : (
          <div
            className={`split split-nested${nested.split ? ' split-manual' : ''}`}
            ref={nestedRef}
            style={nested.style}
          >
            <div className="split-row split-row-top">
            <section className="pane pane-source">
              <header className="pane-head">
                <h2>原文{sourceIsPage && openRecord ? ` · 第 ${openRecord.sectionIndex + 1} 页` : ''}</h2>
                {sourceIsPage && openRecord && (
                  <div className="head-meta">
                    <span className="chip" title="文章题按页练、按页批，一条记录就是一页；这里显示的就是当时那一页">
                      只显示当时这一段
                    </span>
                  </div>
                )}
              </header>
              <div className="pane-body">
                <SourceText text={source || '（未保存题干）'} mark={recordSourceMark} />
                {/*
                  参考译文折叠在原文下面（练习页的那份折叠块已换成标题栏的「对照」按钮，
                  记录页是只读的复盘视图，折叠着更省地方，因此这里仍然用折叠块）。
                */}
                {reference.length > 0 && (
                  <details className="reference">
                    <summary>参考译文{sourceIsPage && openRecord ? `（第 ${openRecord.sectionIndex + 1} 页）` : ''}</summary>
                    <p>{reference}</p>
                  </details>
                )}
              </div>
            </section>

            <div
              className="splitter splitter-v"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整左右宽度；双击恢复自动"
              onPointerDown={(event) => nested.beginDrag('v', event)}
              onDoubleClick={nested.resetSplit}
            />

            <section className="pane pane-answer">
              <header className="pane-head">
                <h2>当时的译文</h2>
                {/*
                  译文视图的分段按钮（用户要求："练习记录，译文部分也要支持不同视图的分段按钮"）。
                  用的是**设置里那一个** answerView：练习页切过之后打开记录就是同一个视图，
                  两个页面里的"同一个开关"不会各说各话。
                */}
                <div className="head-meta">
                  <AnswerViewSwitch view={settings.answerView} onChange={onSettingsChange} locked={openRecord.refine !== undefined} />
                </div>
              </header>
              <div className="pane-body">
                {openRecord.refine ? (
                  /* 大改档：回看时同样只有一种看法——逐句「原译 / 改后」+ 每句的解释 */
                  <RefineView refine={openRecord.refine} />
                ) : settings.answerView === 'compare' ? (
                  /* 对照视图：与练习页同一套排版（一句原译、一句改后，各占一行） */
                  <CompareView
                    validated={openRecord.validated}
                    answer={openRecord.answer}
                    selection={selection}
                    onSelect={onSelect}
                  />
                ) : (
                  <AnnotationText
                    layout={answerLayout}
                    answer={openRecord.answer}
                    validated={openRecord.validated}
                    selection={selection}
                    lineHeightBase={settings.lineHeight}
                    showFixBoxes={settings.showFixBoxes}
                    onSelect={onSelect}
                  />
                )}
              </div>
            </section>

            </div>

            <div
              className="splitter splitter-h"
              role="separator"
              aria-orientation="horizontal"
              title="拖动调整上下高度；双击恢复自动"
              onPointerDown={(event) => nested.beginDrag('h', event)}
              onDoubleClick={nested.resetSplit}
            />

            <div className="split-row split-row-bottom">
            <section className="pane pane-score">
              <header className="pane-head">
                <h2>总体评分</h2>
              </header>
              <div className="pane-body">
                {openRecord.refine ? (
                  /* 大改档回看：同样不打分、不给总评（用户拍板，见 ScorePane 的说明） */
                  <RefineNoScore />
                ) : (
                  <ScoreSummary
                    correction={openRecord.correction}
                    validated={openRecord.validated}
                    answer={openRecord.answer}
                    direction={openRecord.direction}
                    level={openRecord.level}
                    attempt={openRecord.attempt}
                  />
                )}
              </div>
            </section>

            {/*
              ⚠️ 这一条竖分割线**不能省**（用户报的 bug：右下角批注栏很窄、右边一大片空白）。
              原因是 `.split-manual > .split-row` 把每一排都排成**三列**
              （`--col-left` / 8px / `--col-right`）。原来这一排只有两块（评分、批注），
              一旦拖过任意一条分割线（现在还会**落盘**，所以拖一次就永远是手动模式），
              三列模板配两块内容 → 批注被塞进那 8px 的第二列、第三列空着。
              练习页的同一排本来就有这一条，两处结构因此一致。
            */}
            <div
              className="splitter splitter-v"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整左右宽度；双击恢复自动"
              onPointerDown={(event) => nested.beginDrag('v', event)}
              onDoubleClick={nested.resetSplit}
            />

            <section className="pane pane-notes">
              <header className="pane-head">
                <h2>逐处批注</h2>
                <div className="head-meta">
                  <span className="chip">
                    {openRecord.validated.errors.length} 处错误
                    {openRecord.validated.highlights.length > 0 &&
                      ` · ${openRecord.validated.highlights.length} 处优秀`}
                  </span>
                  <RawResponseButton raw={openRecord.raw} />
                </div>
              </header>
              <div className="pane-body">
                <AnnotationList
                  correction={openRecord.correction}
                  validated={openRecord.validated}
                  answer={openRecord.answer}
                  onSelect={onSelect}
                  selectedId={selection?.id}
                />
              </div>
              <DetailPanel
                selection={selection}
                validated={openRecord.validated}
                answer={openRecord.answer}
                onClose={() => onSelect(null)}
                {...(favorite
                  ? {
                      onToggleFavorite: () => onToggleFavorite(favorite),
                      favorited: favorites.some((item) => item.id === favorite.id),
                    }
                  : null)}
              />
            </section>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
