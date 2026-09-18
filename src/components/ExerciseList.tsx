import type { Exercise } from '../domain/types'

/** 一次作答的存档视图。第一版只存在内存里，接入 D1 后改为从服务端读取。 */
export interface RecordView {
  id: string
  exerciseId: string
  attempt: number
  level: 'polish' | 'refine'
  answer: string
  correction: import('../domain/types').Correction
  validated: import('../domain/validate').ValidatedCorrection
  createdAt: Date
}

interface Props {
  exercise: Exercise
  records: RecordView[]
  onOpenRecord: (record: RecordView) => void
}

export function ExerciseList({ exercise, records, onOpenRecord }: Props) {
  const sentences = exercise.source.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)

  return (
    <aside className="panel panel-records">
      <header className="panel-head">
        <h2>练习记录</h2>
        <span className="head-meta">
          <span className="chip">{records.length} 次作答</span>
        </span>
      </header>
      <div className="panel-body">
        {records.length === 0 ? (
          <p className="hint">
            这道题还没有作答记录。提交后会在这里留下一条存档，以后可以点进去回看当时的完整批改。
          </p>
        ) : (
          <ul className="record-list">
            {records
              .slice()
              .reverse()
              .map((record) => (
                <li key={record.id}>
                  <button type="button" className="record-item" onClick={() => onOpenRecord(record)}>
                    <span className="record-top">
                      <span className="record-attempt">第 {record.attempt} 次</span>
                      <span className="record-score">{record.correction.total} 分</span>
                    </span>
                    <span className="record-meta">
                      {record.level === 'polish' ? '润色' : '精修'} · 错误 {record.validated.errors.length} 处
                    </span>
                    <span className="record-time">
                      {record.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className="hint">
          <span className="source-meta">
            共 {sentences.length} 句 · {exercise.source.length} 字符
          </span>
        </p>
      </div>
    </aside>
  )
}
