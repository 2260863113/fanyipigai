import { useMemo } from 'react'
import type { Correction, Direction, Mode, PolishLevel } from '../domain/types'
import { DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { EXERCISE_SOURCES } from '../domain/mock'
import type { ValidatedCorrection } from '../domain/validate'
import { scoreCorrection } from '../domain/scoring'
import { AnnotationList } from './AnnotationList'
import { ScoreSummary } from './ScoreSummary'
import { DetailPanel, type SelectionData } from './DetailPanel'
import type { Selection } from './AnnotationText'

/** 一次作答的存档视图。第一版只存在内存里，接入 D1 后改为从服务端读取。 */
export interface RecordView {
  id: string
  exerciseId: string
  mode: Mode
  direction: Direction
  topic: string
  attempt: number
  level: PolishLevel
  answer: string
  correction: Correction
  validated: ValidatedCorrection
  source: 'live' | 'fixture'
  createdAt: Date
}

interface Props {
  records: RecordView[]
  openRecord: RecordView | null
  onOpen: (record: RecordView | null) => void
  selection: Selection | null
  /** 选中一处批注；传 null 表示关闭详情 */
  onSelect: (selection: Selection | null) => void
}

/**
 * 练习记录页。
 *
 * 顶部导航栏里的一栏，因此占据整个主体区域：左边是全部记录的列表，
 * 右边沿用练习页的四栏结构——上排是题干原文与当时写的译文，下排是计分与逐处批注。
 */
export function RecordsView({ records, openRecord, onOpen, selection, onSelect }: Props) {
  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(openRecord?.validated.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(
      openRecord?.validated.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [],
    )
    return { errors, highlights }
  }, [openRecord])

  const source = openRecord ? (EXERCISE_SOURCES[openRecord.exerciseId] ?? '') : ''

  return (
    <main className="split split-records">
      <section className="screen screen-left">
        <header className="screen-head">
          <h2>练习记录</h2>
          <div className="head-meta">
            <span className="chip">共 {records.length} 次作答</span>
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
                          {KIND_LABEL[record.mode]} · 第 {record.attempt} 次
                        </span>
                        <span className="record-score">
                          {scoreCorrection(record.correction, record.answer).total} 分
                        </span>
                      </span>
                      <span className="record-meta">
                        {DIRECTION_LABEL[record.direction]} · {record.topic} ·{' '}
                        {record.level === 'polish' ? '润色' : '精修'} · 错误{' '}
                        {record.validated.errors.length} 处
                        {record.source === 'fixture' && ' · 示例'}
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

      <section className="screen screen-right">
        <header className="screen-head">
          <h2>{openRecord ? `${KIND_LABEL[openRecord.mode]} · 第 ${openRecord.attempt} 次作答的批改` : '批改详情'}</h2>
          {openRecord && (
            <div className="head-meta">
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
          <div className="split split-nested">
            <section className="pane pane-source">
              <header className="pane-head">
                <h2>原文</h2>
              </header>
              <div className="pane-body">
                <p className="source-text">{source || '（未保存题干）'}</p>
              </div>
            </section>

            <section className="pane pane-answer">
              <header className="pane-head">
                <h2>当时的译文</h2>
              </header>
              <div className="pane-body">
                <p className="answer-static">{openRecord.answer}</p>
              </div>
            </section>

            <section className="pane pane-score">
              <header className="pane-head">
                <h2>总体评分</h2>
              </header>
              <div className="pane-body">
                <ScoreSummary
                  correction={openRecord.correction}
                  validated={openRecord.validated}
                  answer={openRecord.answer}
                  level={openRecord.level}
                  attempt={openRecord.attempt}
                />
              </div>
            </section>

            <section className="pane pane-notes">
              <header className="pane-head">
                <h2>逐处批注</h2>
                <div className="head-meta">
                  <span className="chip">
                    {openRecord.validated.errors.length} 处错误
                    {openRecord.validated.highlights.length > 0 &&
                      ` · ${openRecord.validated.highlights.length} 处优秀`}
                  </span>
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
              <DetailPanel selection={selection} data={selectionData} onClose={() => onSelect(null)} />
            </section>
          </div>
        )}
      </section>
    </main>
  )
}
