import { useMemo, useState, type JSX } from 'react'
import { DEMO_ANSWER_TAIL, MOCK_CASES, mockCorrectionFor } from '../domain/mock'
import { DIRECTION_LABEL, GENRE_LABEL, KIND_LABEL, LEVEL_LABEL, type Correction, type PolishLevel } from '../domain/types'
import { validateCorrection, type ValidatedCorrection } from '../domain/validate'
import { ExerciseList, type RecordView } from './ExerciseList'
import { CorrectionPanel } from './CorrectionPanel'
import { DetailPanel, type SelectionData } from './DetailPanel'
import type { Selection } from './AnnotationText'

/** 演示时自动填入的作答：示例作答 + 一句中文，用来验证作答尾部也能正常显示。 */
function hydrate(sample: string): string {
  return sample + DEMO_ANSWER_TAIL
}

export function App(): JSX.Element {
  const [caseIndex, setCaseIndex] = useState(0)
  const [answer, setAnswer] = useState(() => hydrate(MOCK_CASES[0]?.sampleAnswer ?? ''))
  const [level, setLevel] = useState<PolishLevel>('polish')
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [validated, setValidated] = useState<ValidatedCorrection | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>([])
  const [showRecord, setShowRecord] = useState<RecordView | null>(null)

  const activeCase = MOCK_CASES[caseIndex] ?? MOCK_CASES[0]
  if (!activeCase) throw new Error('假数据题库为空')

  const shownAnswer = showRecord ? showRecord.answer : answer
  const shownCorrection = showRecord ? showRecord.correction : correction
  const shownValidated = showRecord ? showRecord.validated : validated

  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(shownValidated?.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(shownValidated?.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [])
    return { errors, highlights }
  }, [shownValidated])

  const caseRecords = records.filter((record) => record.exerciseId === activeCase.exercise.id)

  function selectCase(nextIndex: number): void {
    const next = MOCK_CASES[nextIndex]
    if (!next) return
    setCaseIndex(nextIndex)
    setAnswer(hydrate(next.sampleAnswer))
    setCorrection(null)
    setValidated(null)
    setSelection(null)
    setShowRecord(null)
  }

  function submit(): void {
    if (!activeCase || answer.trim().length === 0) return
    // 假批改与真实 AI 走同一条路径：先产出批改结果，再过一遍位置校验
    const full: Correction = mockCorrectionFor(activeCase.exercise.id, answer)
    const result = validateCorrection(full.errors, full.highlights, answer)
    setCorrection(full)
    setValidated(result)
    setSelection(null)
    setShowRecord(null)
    setRecords((previous) => [
      ...previous,
      {
        id: `record-${previous.length + 1}`,
        exerciseId: activeCase.exercise.id,
        attempt: previous.filter((r) => r.exerciseId === activeCase.exercise.id).length + 1,
        level,
        answer,
        correction: full,
        validated: result,
        createdAt: new Date(),
      },
    ])
  }

  function backToEditing(): void {
    setShowRecord(null)
    setSelection(null)
  }

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <h1>英语翻译练习站</h1>
          <span className="tagline">外研社·国才杯 笔译赛项 · 逐处批注练习</span>
        </div>
        <div className="mock-banner">
          假数据阶段：批改结果由本地假批改器给出，尚未接入 DeepSeek
        </div>
      </header>

      <nav className="case-strip">
        <span className="strip-label">{KIND_LABEL[activeCase.exercise.kind]}</span>
        {MOCK_CASES.map((item, index) => (
          <button
            key={item.exercise.id}
            type="button"
            className={index === caseIndex ? 'case-tab case-tab-active' : 'case-tab'}
            onClick={() => selectCase(index)}
          >
            <span className="case-tab-title">
              {DIRECTION_LABEL[item.exercise.direction]} · {item.exercise.topic}
            </span>
            <span className="case-tab-sub">{GENRE_LABEL[item.exercise.genre]}</span>
          </button>
        ))}
      </nav>

      <main className="grid">
        <ExerciseList exercise={activeCase.exercise} records={caseRecords} onOpenRecord={setShowRecord} />

        <section className="panel panel-source">
          <header className="panel-head">
            <h2>待译原文</h2>
            <div className="head-meta">
              <span className="chip">{DIRECTION_LABEL[activeCase.exercise.direction]}</span>
              <span className="chip">{GENRE_LABEL[activeCase.exercise.genre]}</span>
              <span className="chip">官方建议用时 {activeCase.exercise.suggestedMinutes} 分钟</span>
            </div>
          </header>
          <div className="panel-body">
            <p className="source-text">{activeCase.exercise.source}</p>
            <details className="reference">
              <summary>参考译文（随题固定，可折叠）</summary>
              <p>{activeCase.exercise.referenceTranslation}</p>
            </details>
          </div>
        </section>

        <section className="panel panel-answer">
          <header className="panel-head">
            <h2>我的译文</h2>
            <div className="head-meta">
              {showRecord ? (
                <button type="button" className="btn btn-ghost" onClick={backToEditing}>
                  返回编辑
                </button>
              ) : (
                <>
                  <span className="chip">{LEVEL_LABEL[level].split('（')[0]}</span>
                  <span className="chip">{answer.length} 字符</span>
                </>
              )}
            </div>
          </header>
          <div className="panel-body">
            {showRecord ? (
              <p className="answer-static">{showRecord.answer}</p>
            ) : (
              <>
                <textarea
                  className="answer-input"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="在这里写下你的译文……"
                  spellCheck={false}
                />
                <div className="answer-bar">
                  <div className="level-switch" role="group" aria-label="修改风格">
                    {(Object.keys(LEVEL_LABEL) as PolishLevel[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={key === level ? 'level-btn level-btn-active' : 'level-btn'}
                        onClick={() => setLevel(key)}
                        title={LEVEL_LABEL[key]}
                      >
                        {LEVEL_LABEL[key].split('（')[0]}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-primary" onClick={submit} disabled={answer.trim().length === 0}>
                    提交批改
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <DetailPanel selection={selection} data={selectionData} onClose={() => setSelection(null)} />
      </main>

      <CorrectionPanel
        correction={shownCorrection}
        validated={shownValidated}
        answer={shownAnswer}
        level={showRecord ? showRecord.level : level}
        attempt={showRecord ? showRecord.attempt : caseRecords.length + 1}
        onSelect={setSelection}
      />

      <footer className="app-foot">
        <span>颜色约定：红 = 语法错误与严重表达不当，橙 = 表达生硬别扭，绿 = 表达优秀。</span>
      </footer>
    </div>
  )
}
