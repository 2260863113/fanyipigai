import { useMemo } from 'react'
import type { Correction, Direction, ErrorCategory, Mode, PolishLevel } from '../domain/types'
import { CATEGORY_LABEL, DIRECTION_LABEL, KIND_LABEL } from '../domain/types'
import { colorForCategory, type ValidatedCorrection } from '../domain/validate'
import { buildLayout } from '../domain/layout'
import { scoreCorrection } from '../domain/scoring'
import { AnnotationText, type Selection } from './AnnotationText'
import { DetailPanel, type SelectionData } from './DetailPanel'
import { MARK_COLOR_VALUE } from '../domain/color'

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
 * 右边是选中那一条的完整批改（计分、错误归类、逐处批注）。
 */
export function RecordsView({ records, openRecord, onOpen, selection, onSelect }: Props) {
  const layout = useMemo(
    () => (openRecord ? buildLayout(openRecord.validated, openRecord.answer) : null),
    [openRecord],
  )
  const score = useMemo(
    () => (openRecord ? scoreCorrection(openRecord.correction, openRecord.answer) : null),
    [openRecord],
  )

  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(openRecord?.validated.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(
      openRecord?.validated.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [],
    )
    return { errors, highlights }
  }, [openRecord])

  const stats = new Map<ErrorCategory, number>()
  for (const entry of openRecord?.validated.errors ?? []) {
    stats.set(entry.error.category, (stats.get(entry.error.category) ?? 0) + 1)
  }

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

        {!openRecord || !layout || !score ? (
          <div className="screen-body">
            <p className="hint">从左边选一条记录，这里会显示当时的完整批改。</p>
          </div>
        ) : (
          <>
            <div className="screen-body">
              <div className="result-panel">
                <section className="result-left">
                  <div className="score-total">
                    <span className="score-number">{score.total}</span>
                    <span className="score-unit">/ 100</span>
                  </div>
                  <ul className="score-legend">
                    <li style={{ color: MARK_COLOR_VALUE.red }}>
                      硬性错误 <span className="score-count">×{score.hardCount}</span>
                    </li>
                    <li style={{ color: MARK_COLOR_VALUE.orange }}>
                      表达问题 <span className="score-count">×{score.softCount}</span>
                    </li>
                    {score.highlightCount > 0 && (
                      <li style={{ color: MARK_COLOR_VALUE.green }}>
                        表达优秀 <span className="score-count">×{score.highlightCount}</span>
                      </li>
                    )}
                  </ul>
                  <div className="stats">
                    <h3>错误归类</h3>
                    {stats.size === 0 ? (
                      <p className="hint">本次没有发现错误。</p>
                    ) : (
                      <ul className="stats-list">
                        {[...stats.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([category, count]) => (
                            <li key={category} style={{ color: MARK_COLOR_VALUE[colorForCategory(category)] }}>
                              {CATEGORY_LABEL[category]}
                              <span className="stats-count">×{count}</span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                  <p className="hint">
                    当时的作答：
                    <br />
                    {openRecord.answer}
                  </p>
                </section>
                <section className="result-right">
                  <AnnotationText layout={layout} answer={openRecord.answer} onSelect={onSelect} />
                </section>
              </div>
            </div>
            <DetailPanel selection={selection} data={selectionData} onClose={() => onSelect(null)} />
          </>
        )}
      </section>
    </main>
  )
}
