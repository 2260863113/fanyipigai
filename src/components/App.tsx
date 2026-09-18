import { useMemo, useState, type JSX } from 'react'
import { MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
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
import { requestJudgment, type JudgeSectionInput } from '../domain/client'
import { splitSections, type Section } from '../domain/sections'
import type { JudgeFailureKind } from '../domain/ai'
import { CorrectionPanel } from './CorrectionPanel'
import { DetailPanel, type SelectionData } from './DetailPanel'
import { RecordsView, type RecordView } from './RecordsView'
import type { Selection } from './AnnotationText'

type Tab = Mode | 'records'
type Source = 'live' | 'fixture'

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES

function casesOfMode(mode: Mode): typeof ALL_CASES {
  return ALL_CASES.filter((item) => item.exercise.mode === mode)
}

interface Draft {
  correction: Correction
  validated: ValidatedCorrection
  level: PolishLevel
  source: Source
  sectionCount: number
}

export function App(): JSX.Element {
  const firstCase = ALL_CASES[0]
  if (!firstCase) throw new Error('题库为空')

  const [tab, setTab] = useState<Tab>(firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(firstCase.exercise.id)

  /** 逐段作答：每一段自己一份文字 */
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [sectionIndex, setSectionIndex] = useState(0)
  const [level, setLevel] = useState<PolishLevel>('polish')

  const [result, setResult] = useState<Draft | null>(null)
  const [judging, setJudging] = useState(false)
  const [error, setError] = useState<JudgeError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>([])
  const [openRecord, setOpenRecord] = useState<RecordView | null>(null)

  const activeCase = ALL_CASES.find((item) => item.exercise.id === exerciseId) ?? firstCase
  const exercise: Exercise = activeCase.exercise
  const mode = exercise.mode

  /** 原文按段落切分；单段题只有一个元素，因此下面所有逻辑对四类题型通用 */
  const sourceSections: Section[] = useMemo(() => splitSections(exercise.source), [exercise.source])
  const multiSection = sourceSections.length > 1
  const currentSection = sourceSections[sectionIndex] ?? sourceSections[0]
  const currentAnswer = drafts[sectionIndex] ?? ''
  const filledSections = sourceSections.filter((_, index) => (drafts[index] ?? '').trim().length > 0).length
  const allFilled = filledSections === sourceSections.length

  const selectionData: SelectionData = useMemo(() => {
    const errors = new Map(result?.validated.errors.map((entry) => [entry.error.id, entry]) ?? [])
    const highlights = new Map(result?.validated.highlights.map((entry) => [entry.highlight.id, entry.highlight]) ?? [])
    return { errors, highlights }
  }, [result])

  const caseRecords = records.filter((record) => record.exerciseId === exercise.id)
  const isFixtureAnswer = useMemo(() => {
    const trimmed = currentAnswer.trim()
    if (!trimmed) return false
    return ALL_CASES.some((item) => item.sampleAnswer.trim() === trimmed)
  }, [currentAnswer])

  function resetTo(next: (typeof ALL_CASES)[number]): void {
    setExerciseId(next.exercise.id)
    setDrafts({})
    setSectionIndex(0)
    setResult(null)
    setSelection(null)
    setOpenRecord(null)
    setError(null)
    setNotice(null)
  }

  function selectTab(nextTab: Tab): void {
    setTab(nextTab)
    setOpenRecord(null)
    if (nextTab === 'records') return
    const next = casesOfMode(nextTab)[0]
    if (next) resetTo(next)
  }

  function selectExercise(id: string): void {
    const next = ALL_CASES.find((item) => item.exercise.id === id)
    if (next) resetTo(next)
  }

  function updateAnswer(value: string): void {
    setDrafts((previous) => ({ ...previous, [sectionIndex]: value }))
    setError(null)
    setNotice(null)
    // 改动作答后，之前的结果不再对应这段文字
    setResult(null)
    setSelection(null)
  }

  /** 把逐段作答整理成接口需要的形状（每段带它在全文中的起点）。 */
  function buildAnswerSections(): JudgeSectionInput[] {
    const parts = sourceSections.map((_, index) => drafts[index] ?? '')
    let cursor = 0
    return sourceSections.map((_, index) => {
      const start = cursor
      const text = parts[index] ?? ''
      cursor = start + text.length + 2 // 段与段之间按两个换行分隔
      return { start, text }
    })
  }

  function commit(
    judging_: Draft,
    submittedSections: JudgeSectionInput[],
    attemptLevel: PolishLevel,
  ): void {
    setResult(judging_)
    setSelection(null)
    setOpenRecord(null)
    setRecords((previous) => [
      ...previous,
      {
        id: `record-${previous.length + 1}`,
        exerciseId: exercise.id,
        mode,
        direction: exercise.direction,
        topic: exercise.topic,
        attempt: previous.filter((r) => r.exerciseId === exercise.id).length + 1,
        level: attemptLevel,
        answer: submittedSections.map((section) => section.text).join('\n\n'),
        correction: judging_.correction,
        validated: judging_.validated,
        source: judging_.source,
        createdAt: new Date(),
      },
    ])
  }

  async function submitLive(): Promise<void> {
    if (judging || !allFilled) return
    setJudging(true)
    setError(null)
    setNotice(null)

    const answerSections = buildAnswerSections()
    const outcome = await requestJudgment({
      source: exercise.source,
      referenceTranslation: exercise.referenceTranslation,
      direction: exercise.direction,
      genre: exercise.genre,
      level,
      sourceSections: sourceSections.map((section) => ({ start: section.start, text: section.text })),
      answerSections,
    })

    setJudging(false)

    if (!outcome.ok) {
      setError({ kind: outcome.kind, message: outcome.message })
      return
    }

    if (outcome.attempts > 1) setNotice('AI 有几次返回没通过位置校验，已自动重试并修正。')
    if (outcome.repaired.length > 0) {
      setNotice(`有 ${outcome.repaired.length} 处批注因位置与译文对不上而未标出——位置校验拦住了它们。`)
    }
    commit(
      { correction: outcome.correction, validated: outcome.validated, level, source: 'live', sectionCount: outcome.sectionCount },
      answerSections,
      level,
    )
  }

  /** 离线演示：用内置示例的批改结果，不调 API。 */
  function submitFixture(): void {
    if (judging) return
    const fixture = fixtureCorrectionFor(exercise.id, currentAnswer)
    if (!fixture) {
      setError({ kind: 'bad-request', message: '当前作答不是内置示例，无法使用示例批改。' })
      return
    }
    const checked = validateCorrection(fixture.errors, fixture.highlights, currentAnswer)
    setError(null)
    setNotice('这是内置示例的批改结果，不是 AI 现场批改的。')
    commit(
      { correction: fixture, validated: checked, level, source: 'fixture', sectionCount: 1 },
      [{ start: 0, text: currentAnswer }],
      level,
    )
  }

  const shown = openRecord
    ? {
        correction: openRecord.correction,
        validated: openRecord.validated,
        answer: openRecord.answer,
        level: openRecord.level,
        attempt: openRecord.attempt,
        sectionCount: 1,
        source: openRecord.source,
      }
    : result
      ? {
          correction: result.correction,
          validated: result.validated,
          answer: buildAnswerSections()
            .map((section) => section.text)
            .join('\n\n'),
          level: result.level,
          attempt: caseRecords.length,
          sectionCount: result.sectionCount,
          source: result.source,
        }
      : null

  const inMode = tab === 'records' ? [] : casesOfMode(tab)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <h1>英语翻译练习站</h1>
          <span className="tagline">外研社·国才杯 笔译赛项</span>
        </div>

        <nav className="mode-tabs" aria-label="题型与记录">
          {MODE_TABS.map((item) => (
            <button
              key={item.mode}
              type="button"
              className={item.mode === tab ? 'mode-tab mode-tab-active' : 'mode-tab'}
              onClick={() => selectTab(item.mode)}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tab !== 'records' && (
          <div className="topbar-right">
            {shown?.source === 'fixture' && <span className="chip chip-warn">内置示例批改</span>}
            <span className="chip">{DIRECTION_LABEL[exercise.direction]}</span>
            <span className="chip">{GENRE_LABEL[exercise.genre]}</span>
            <span className="chip">{exercise.topic}</span>
          </div>
        )}
      </header>

      {tab === 'records' ? (
        <RecordsView
          records={records}
          openRecord={openRecord}
          onOpen={setOpenRecord}
          onSelect={setSelection}
          selection={selection}
        />
      ) : (
        <>
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

          <main className="split">
            <section className="screen screen-left">
              <header className="screen-head">
                <h2>原文</h2>
                <div className="head-meta">
                  {multiSection && <span className="chip">第 {sectionIndex + 1} / {sourceSections.length} 段</span>}
                  <span className="chip">官方建议 {exercise.suggestedMinutes} 分钟</span>
                </div>
              </header>
              <div className="screen-body">
                <p className={mode === 'term' ? 'source-text source-term' : 'source-text'}>
                  {multiSection ? (currentSection?.text ?? exercise.source) : exercise.source}
                </p>
                <details className="reference" open={!multiSection}>
                  <summary>参考译文（随题固定，可折叠）</summary>
                  <p>{exercise.referenceTranslation}</p>
                </details>
              </div>
            </section>

            <section className="screen screen-right">
              <header className="screen-head">
                <h2>我的译文</h2>
                <div className="head-meta">
                  {shown && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        // 回到作答状态：清掉结果，输入框重新出现（文字还在 drafts 里）
                        setResult(null)
                        setOpenRecord(null)
                        setSelection(null)
                      }}
                    >
                      返回修改
                    </button>
                  )}
                  {!shown && (
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
                        disabled={!allFilled || judging}
                        title={allFilled ? undefined : '请先写完所有段落'}
                      >
                        {judging ? '批改中…' : multiSection ? `提交全篇（${filledSections}/${sourceSections.length} 段已写）` : '提交批改'}
                      </button>
                    </>
                  )}
                </div>
              </header>

              <div className="screen-body">
                {judging && (
                  <p className="hint judging">
                    正在批改{multiSection ? `（${sourceSections.length} 段并行发出）` : ''}。长段通常十几秒；
                    若返回未通过位置校验会自动重试。
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

                {!shown && (
                  <textarea
                    className="answer-input answer-input-fill"
                    value={currentAnswer}
                    onChange={(event) => updateAnswer(event.target.value)}
                    placeholder={
                      multiSection
                        ? `在第 ${sectionIndex + 1} 段写下你的译文……写完后点「下一段」`
                        : '在这里写下你的译文……'
                    }
                    spellCheck={false}
                  />
                )}

                {/* 分段导航放在原文下方、批改结果上方 */}
                {multiSection && !shown && (
                  <div className="section-nav">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}
                      disabled={sectionIndex === 0}
                    >
                      ← 上一段
                    </button>
                    <span className="hint">
                      第 {sectionIndex + 1} / {sourceSections.length} 段 · 已写 {filledSections} 段
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSectionIndex((index) => Math.min(sourceSections.length - 1, index + 1))}
                      disabled={sectionIndex >= sourceSections.length - 1}
                    >
                      下一段 →
                    </button>
                  </div>
                )}
              </div>

              {shown && (
                <>
                  <CorrectionPanel
                    correction={shown.correction}
                    validated={shown.validated}
                    answer={shown.answer}
                    level={shown.level}
                    attempt={shown.attempt || caseRecords.length}
                    sectionCount={shown.sectionCount}
                    onSelect={setSelection}
                  />
                  <DetailPanel selection={selection} data={selectionData} onClose={() => setSelection(null)} />
                </>
              )}
            </section>
          </main>
        </>
      )}

      <footer className="app-foot">
        <span>颜色约定：红 = 硬性错误（术语、漏译、语法、标点），橙 = 表达问题，绿 = 表达优秀。</span>
      </footer>
    </div>
  )
}
