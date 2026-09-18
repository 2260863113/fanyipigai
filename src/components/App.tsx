import { useMemo, useState, type JSX } from 'react'
import { DEMO_ANSWER_TAIL, MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import {
  DIRECTION_LABEL,
  GENRE_LABEL,
  LEVEL_LABEL,
  MODE_TABS,
  type Correction,
  type Exercise,
  type Mode,
  type PolishLevel,
} from '../domain/types'
import { validateCorrection, type ValidatedCorrection } from '../domain/validate'
import { requestJudgment } from '../domain/client'
import type { JudgeFailureKind } from '../domain/ai'
import { ExerciseList, type RecordView } from './ExerciseList'
import { CorrectionPanel } from './CorrectionPanel'
import { DetailPanel, type SelectionData } from './DetailPanel'
import type { Selection } from './AnnotationText'

/** 右半屏当前显示什么：写译文、还是看批改结果。 */
type Stage = 'compose' | 'review'
type Source = 'live' | 'fixture'

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES

function casesOfMode(mode: Mode): typeof ALL_CASES {
  return ALL_CASES.filter((item) => item.exercise.mode === mode)
}

function hydrate(sample: string): string {
  return sample + DEMO_ANSWER_TAIL
}

export function App(): JSX.Element {
  const firstCase = ALL_CASES[0]
  if (!firstCase) throw new Error('题库为空')

  const [mode, setMode] = useState<Mode>(firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(firstCase.exercise.id)
  const [answer, setAnswer] = useState(() => hydrate(firstCase.sampleAnswer))
  const [level, setLevel] = useState<PolishLevel>('polish')

  const [stage, setStage] = useState<Stage>('compose')
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [validated, setValidated] = useState<ValidatedCorrection | null>(null)
  const [source, setSource] = useState<Source>('live')
  const [judging, setJudging] = useState(false)
  const [error, setError] = useState<JudgeError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>([])
  const [showRecord, setShowRecord] = useState<RecordView | null>(null)

  const activeCase = ALL_CASES.find((item) => item.exercise.id === exerciseId) ?? firstCase
  const exercise: Exercise = activeCase.exercise

  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(validated?.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(validated?.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [])
    return { errors, highlights }
  }, [validated])

  const caseRecords = records.filter((record) => record.exerciseId === exercise.id)
  const isFixtureAnswer = answer === activeCase.sampleAnswer + DEMO_ANSWER_TAIL

  /** 重置到"写译文"状态。切换题目或模式时调用。 */
  function resetTo(next: (typeof ALL_CASES)[number]): void {
    setExerciseId(next.exercise.id)
    setAnswer(hydrate(next.sampleAnswer))
    setStage('compose')
    setCorrection(null)
    setValidated(null)
    setSelection(null)
    setShowRecord(null)
    setError(null)
    setNotice(null)
    setSource('live')
  }

  function selectMode(nextMode: Mode): void {
    setMode(nextMode)
    const inMode = casesOfMode(nextMode)
    const next = inMode[0]
    if (next) resetTo(next)
  }

  function selectExercise(id: string): void {
    const next = ALL_CASES.find((item) => item.exercise.id === id)
    if (next) resetTo(next)
  }

  function commit(
    exerciseIdToStore: string,
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
    setStage('review')
    setRecords((previous) => [
      ...previous,
      {
        id: `record-${previous.length + 1}`,
        exerciseId: exerciseIdToStore,
        attempt: previous.filter((r) => r.exerciseId === exerciseIdToStore).length + 1,
        level: attemptLevel,
        answer: submitted,
        correction: judged,
        validated: checked,
        source: from,
        createdAt: new Date(),
      },
    ])
  }

  async function submitLive(): Promise<void> {
    if (answer.trim().length === 0 || judging) return
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
      if (isFixtureAnswer) setNotice('这道题当前是内置示例作答，可以直接查看内置示例批改。')
      return
    }

    if (outcome.attempts > 1) setNotice(`AI 第 ${outcome.attempts} 次返回才通过校验，本次结果已自动修正。`)
    if (outcome.repaired.length > 0) {
      setNotice(`有 ${outcome.repaired.length} 处批注因位置与译文对不上而未标出——位置校验拦住了它们。`)
    }
    setMode(exercise.mode)
    commit(exercise.id, outcome.correction, outcome.validated, 'live', level, answer)
  }

  function submitFixture(): void {
    if (!isFixtureAnswer || judging) return
    const fixture = fixtureCorrectionFor(exercise.id, answer)
    const checked = validateCorrection(fixture.errors, fixture.highlights, answer)
    setError(null)
    setNotice('这是内置示例的批改结果，不是 AI 现场批改的。')
    setMode(exercise.mode)
    commit(exercise.id, fixture, checked, 'fixture', level, answer)
  }

  function backToCompose(): void {
    setStage('compose')
    setShowRecord(null)
    setSelection(null)
  }

  const shownAnswer = showRecord ? showRecord.answer : answer
  const shownCorrection = showRecord ? showRecord.correction : correction
  const shownValidated = showRecord ? showRecord.validated : validated
  const shownSource: Source = showRecord ? showRecord.source : source
  const inMode = casesOfMode(mode)

  return (
    <div className="app">
      {/* ── 顶部导航：模式切换 ───────────────────────── */}
      <header className="topbar">
        <div className="topbar-brand">
          <h1>英语翻译练习站</h1>
          <span className="tagline">外研社·国才杯 笔译赛项</span>
        </div>

        <nav className="mode-tabs" aria-label="题型">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.mode}
              type="button"
              className={tab.mode === mode ? 'mode-tab mode-tab-active' : 'mode-tab'}
              onClick={() => selectMode(tab.mode)}
              title={tab.hint}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          {shownSource === 'fixture' && <span className="chip chip-warn">内置示例批改</span>}
          <span className="chip">{DIRECTION_LABEL[exercise.direction]}</span>
          <span className="chip">{GENRE_LABEL[exercise.genre]}</span>
          <span className="chip">{exercise.topic}</span>
        </div>
      </header>

      {/* ── 当前模式的题目切换 ───────────────────────── */}
      {inMode.length > 1 && (
        <nav className="case-strip" aria-label="题目">
          <span className="strip-label">题目</span>
          {inMode.map((item) => (
            <button
              key={item.exercise.id}
              type="button"
              className={item.exercise.id === exercise.id ? 'case-tab case-tab-active' : 'case-tab'}
              onClick={() => selectExercise(item.exercise.id)}
            >
              <span className="case-tab-title">
                {DIRECTION_LABEL[item.exercise.direction]} · {item.exercise.topic}
              </span>
            </button>
          ))}
        </nav>
      )}

      {/* ── 左右两屏 ─────────────────────────────────── */}
      <main className="split">
        <section className="screen screen-left">
          <header className="screen-head">
            <h2>原文</h2>
            <div className="head-meta">
              <span className="chip">
                {exercise.mode === 'term' ? '术语' : `${exercise.source.length} 字符`}
              </span>
              <span className="chip">官方建议 {exercise.suggestedMinutes} 分钟</span>
            </div>
          </header>
          <div className="screen-body">
            <p className={exercise.mode === 'term' ? 'source-text source-term' : 'source-text'}>{exercise.source}</p>
            <details className="reference">
              <summary>参考译文（随题固定，可折叠）</summary>
              <p>{exercise.referenceTranslation}</p>
            </details>
            <aside className="records-inline">
              <ExerciseList exercise={exercise} records={caseRecords} onOpenRecord={setShowRecord} compact />
            </aside>
          </div>
        </section>

        <section className="screen screen-right">
          <header className="screen-head">
            <h2>{stage === 'compose' ? '我的译文' : '批改结果'}</h2>
            <div className="head-meta">
              {stage === 'review' && (
                <button type="button" className="btn btn-ghost" onClick={backToCompose}>
                  返回修改
                </button>
              )}
              {stage === 'compose' && (
                <>
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
                </>
              )}
            </div>
          </header>

          <div className="screen-body">
            {judging && (
              <p className="hint judging">
                正在批改。长句通常十几秒，段落与文章可能需要一分钟；若返回未通过位置校验会自动重试。
              </p>
            )}

            {error && (
              <div className="error-block">
                <strong>批改未完成：</strong>
                {error.message}
                {isFixtureAnswer && (
                  <button type="button" className="btn btn-ghost" onClick={submitFixture}>
                    查看内置示例批改
                  </button>
                )}
              </div>
            )}

            {notice && !error && <p className="hint notice">{notice}</p>}

            {stage === 'compose' ? (
              <textarea
                className="answer-input answer-input-fill"
                value={answer}
                onChange={(event) => {
                  setAnswer(event.target.value)
                  setError(null)
                  setNotice(null)
                }}
                placeholder="在这里写下你的译文，然后点右上角「提交批改」……"
                spellCheck={false}
              />
            ) : shownCorrection && shownValidated ? (
              <CorrectionPanel
                correction={shownCorrection}
                validated={shownValidated}
                answer={shownAnswer}
                level={showRecord ? showRecord.level : level}
                attempt={showRecord ? showRecord.attempt : caseRecords.length}
                onSelect={setSelection}
                embedded
              />
            ) : (
              <p className="hint">还没有批改结果。</p>
            )}
          </div>

          {stage === 'review' && <DetailPanel selection={selection} data={selectionData} onClose={() => setSelection(null)} />}
        </section>
      </main>

      <footer className="app-foot">
        <span>颜色约定：红 = 语法错误与严重表达不当，橙 = 表达生硬别扭，绿 = 表达优秀。</span>
      </footer>
    </div>
  )
}
