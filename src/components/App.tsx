import { useMemo, useState, type JSX } from 'react'
import { DEMO_ANSWER_TAIL, DEMO_ANSWERS, MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import { DIRECTION_LABEL, GENRE_LABEL, KIND_LABEL, LEVEL_LABEL, type Correction, type PolishLevel } from '../domain/types'
import { validateCorrection, type ValidatedCorrection } from '../domain/validate'
import { requestJudgment } from '../domain/client'
import type { JudgeFailureKind } from '../domain/ai'
import { ExerciseList, type RecordView } from './ExerciseList'
import { CorrectionPanel } from './CorrectionPanel'
import { DetailPanel, type SelectionData } from './DetailPanel'
import type { Selection } from './AnnotationText'

/** 演示时自动填入的作答：示例作答 + 一句中文，用来验证作答尾部也能正常显示。 */
function hydrate(sample: string): string {
  return sample + DEMO_ANSWER_TAIL
}

type Source = 'live' | 'fixture'

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

export function App(): JSX.Element {
  const [caseIndex, setCaseIndex] = useState(0)
  const [answer, setAnswer] = useState(() => hydrate(MOCK_CASES[0]?.sampleAnswer ?? ''))
  const [level, setLevel] = useState<PolishLevel>('polish')
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [validated, setValidated] = useState<ValidatedCorrection | null>(null)
  const [source, setSource] = useState<Source>('live')
  const [judging, setJudging] = useState(false)
  const [error, setError] = useState<JudgeError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>([])
  const [showRecord, setShowRecord] = useState<RecordView | null>(null)

  const activeCase = MOCK_CASES[caseIndex] ?? MOCK_CASES[0]
  if (!activeCase) throw new Error('题库为空')

  const shownAnswer = showRecord ? showRecord.answer : answer
  const shownCorrection = showRecord ? showRecord.correction : correction
  const shownValidated = showRecord ? showRecord.validated : validated
  const shownSource: Source = showRecord ? showRecord.source : source

  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(shownValidated?.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(shownValidated?.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [])
    return { errors, highlights }
  }, [shownValidated])

  const caseRecords = records.filter((record) => record.exerciseId === activeCase.exercise.id)
  const isDemoAnswer = DEMO_ANSWERS.includes(answer)

  function selectCase(nextIndex: number): void {
    const next = MOCK_CASES[nextIndex]
    if (!next) return
    setCaseIndex(nextIndex)
    setAnswer(hydrate(next.sampleAnswer))
    setCorrection(null)
    setValidated(null)
    setSelection(null)
    setShowRecord(null)
    setError(null)
    setNotice(null)
    setSource('live')
  }

  /** 把一次批改结果记入练习记录。 */
  function commit(
    exerciseId: string,
    judged: Correction,
    checked: ValidatedCorrection,
    from: Source,
    attemptLevel: PolishLevel,
    submitted: string,
  ): void {
    setCorrection(judged)
    setValidated(checked)
    setSource(from)
    setSelection(null)
    setShowRecord(null)
    setRecords((previous) => [
      ...previous,
      {
        id: `record-${previous.length + 1}`,
        exerciseId,
        attempt: previous.filter((r) => r.exerciseId === exerciseId).length + 1,
        level: attemptLevel,
        answer: submitted,
        correction: judged,
        validated: checked,
        source: from,
        createdAt: new Date(),
      },
    ])
  }

  /** 用真实 AI 批改。 */
  async function submitLive(): Promise<void> {
    if (!activeCase || answer.trim().length === 0 || judging) return
    const exercise = activeCase.exercise
    setJudging(true)
    setError(null)
    setNotice(null)

    const outcome = await requestJudgment({
      source: exercise.source,
      answer,
      direction: exercise.direction,
      genre: exercise.genre,
      level,
      referenceTranslation: exercise.referenceTranslation,
    })

    setJudging(false)

    if (!outcome.ok) {
      setError({ kind: outcome.kind, message: outcome.message })
      // 密钥缺失或无效时，提示可以先用内置示例看效果
      if (outcome.kind === 'missing-key' || outcome.kind === 'unauthorized' || outcome.kind === 'insufficient-balance') {
        setNotice(isDemoAnswer ? '这道题的作答正好是内置示例，你可以直接查看内置示例批改。' : null)
      }
      return
    }

    if (outcome.attempts > 1) {
      setNotice(`AI 第 ${outcome.attempts} 次返回才通过校验，本次结果已自动修正。`)
    }
    if (outcome.repaired.length > 0) {
      setNotice(
        `有 ${outcome.repaired.length} 处批注因位置与译文对不上而没有标出——位置校验拦住了它们，避免标到错的地方。`,
      )
    }
    commit(exercise.id, outcome.correction, outcome.validated, 'live', level, answer)
  }

  /** 直接用内置示例的批改结果，用于没有密钥时先看效果。 */
  function submitFixture(): void {
    if (!activeCase || !isDemoAnswer || judging) return
    const exercise = activeCase.exercise
    const fixture = fixtureCorrectionFor(exercise.id, answer)
    const checked = validateCorrection(fixture.errors, fixture.highlights, answer)
    setError(null)
    setNotice('这是内置示例的批改结果，不是 AI 现场批改的。')
    commit(exercise.id, fixture, checked, 'fixture', level, answer)
  }

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <h1>英语翻译练习站</h1>
          <span className="tagline">外研社·国才杯 笔译赛项 · 逐处批注练习</span>
        </div>
        {shownSource === 'fixture' && <div className="mock-banner">当前显示的是内置示例批改，不是 AI 现场批改的</div>}
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
                <button type="button" className="btn btn-ghost" onClick={() => setShowRecord(null)}>
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
                  onChange={(event) => {
                    setAnswer(event.target.value)
                    // 作答一旦改动，之前的结果就不再对应这段文字
                    setCorrection(null)
                    setValidated(null)
                    setSelection(null)
                    setError(null)
                    setNotice(null)
                  }}
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void submitLive()}
                    disabled={answer.trim().length === 0 || judging}
                  >
                    {judging ? '批改中…' : '提交批改'}
                  </button>
                </div>

                {judging && (
                  <p className="hint judging">
                    正在批改。长句通常需要十几秒，若第一次返回没能通过位置校验会自动重试，最慢可能要一分钟。
                  </p>
                )}

                {error && (
                  <div className="error-block">
                    <strong>批改未完成：</strong>
                    {error.message}
                    {isDemoAnswer && (
                      <button type="button" className="btn btn-ghost" onClick={submitFixture}>
                        查看内置示例批改
                      </button>
                    )}
                  </div>
                )}

                {notice && !error && <p className="hint notice">{notice}</p>}
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
