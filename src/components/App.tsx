import { useMemo, useRef, useState, type JSX } from 'react'
import { MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import {
  DIRECTION_LABEL,
  GENRE_LABEL,
  KIND_LABEL,
  LEVEL_LABEL,
  MODE_TABS,
  UNIT_LABEL,
  type Correction,
  type Exercise,
  type Direction,
  type Genre,
  type Mode,
  type PolishLevel,
} from '../domain/types'
import { validateCorrection, type ValidatedCorrection } from '../domain/validate'
import { buildLayout, type AnnotatedLayout } from '../domain/layout'
import { toAiShape } from '../domain/parse'
import { AnnotationText } from './AnnotationText'
import { requestGeneration, requestJudgment, type JudgeSectionInput } from '../domain/client'
import { splitSections, type Section } from '../domain/sections'
import { variantsFor } from '../domain/variants'
import { GENERATION_TOPICS, LENGTH_RULE, type GeneratedExercise } from '../domain/generate'
import type { JudgeFailureKind } from '../domain/ai'
import { ScoreSummary } from './ScoreSummary'
import { DetailPanel } from './DetailPanel'
import { useSplitDrag } from './split-drag'
import { CompareView } from './CompareView'
import { LINE_HEIGHT_RANGE, useSettings } from './settings'
import { RawResponseButton } from './RawResponseButton'
import { RecordsView, type RecordView } from './RecordsView'
import { exerciseOf, loadCustom, saveCustom, type CustomExercise } from '../domain/custom'
import type { Selection } from './AnnotationText'

type Tab = Mode | 'records' | 'custom'
type Source = 'live' | 'fixture'

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES
const EMPTY_GENERATED: GeneratedExercise[] = []
const EMPTY_LAYOUT: AnnotatedLayout = { segments: [], reorderGroups: [], rejectedIds: [], droppedCount: 0 }

function casesOfMode(mode: Tab): typeof ALL_CASES {
  if (mode === 'records' || mode === 'custom') return []
  return ALL_CASES.filter((item) => item.exercise.mode === mode)
}

interface Draft {
  correction: Correction
  validated: ValidatedCorrection
  level: PolishLevel
  source: Source
  sectionCount: number
  /** AI 原样返回的完整文本；界面上的「查看 AI 完整返回内容」用它 */
  raw: string
}

export function App(): JSX.Element {
  const firstCase = ALL_CASES[0]
  if (!firstCase) throw new Error('题库为空')

  const [tab, setTab] = useState<Tab>(firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(firstCase.exercise.id)

  /**
   * 逐段作答：每一段自己一份文字。
   *
   * 按**题目编号**分别保存：切换题型或题目时不清空，
   * 切回来还能看到刚才写到一半的内容与已经出来的批改结果。
   */
  const [draftsByExercise, setDraftsByExercise] = useState<Record<string, Record<number, string>>>({})
  const [sectionByExercise, setSectionByExercise] = useState<Record<string, number>>({})
  const [resultByExercise, setResultByExercise] = useState<Record<string, Draft>>({})
  /**
   * 每道题当前看的是哪一面：'answer' 作答框 / 'result' 上次的批改结果。
   *
   * 点「返回修改」只切到作答框，**结果仍然留着**——只要没改一个字就能点回去看，
   * 不用重新提交一次（重新提交要花十几秒，还可能因为模型波动给出不一样的结果）。
   * 一旦真的改了作答，结果就作废（见 updateAnswer）。
   */
  const [viewByExercise, setViewByExercise] = useState<Record<string, 'answer' | 'result'>>({})
  /** 四栏边界：默认按内容自动平衡，用户拖过之后按他定的比例 */
  const splitRef = useRef<HTMLElement | null>(null)
  const { split, style: splitStyle, beginDrag, resetSplit } = useSplitDrag(splitRef)
  /** 界面偏好：行距、是否显示填补的文字、译文看哪种视图（存 localStorage） */
  const { settings, update: updateSettings } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [variantByExercise, setVariantByExercise] = useState<Record<string, number>>({})
  /** AI 现出的题：按题目留存，之后「换一换」还能翻回来 */
  const [generatedByExercise, setGeneratedByExercise] = useState<Record<string, GeneratedExercise[]>>({})
  const [genOpen, setGenOpen] = useState(false)
  const [genTopic, setGenTopic] = useState(GENERATION_TOPICS[0] ?? '')
  const [genGenre, setGenGenre] = useState<Genre>(firstCase.exercise.genre)
  const [genDirection, setGenDirection] = useState<Direction>(firstCase.exercise.direction)
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [level, setLevel] = useState<PolishLevel>('polish')

  const [judging, setJudging] = useState(false)
  const [error, setError] = useState<JudgeError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>([])
  const [openRecord, setOpenRecord] = useState<RecordView | null>(null)

  /** 自己贴的那一篇（存在浏览器里，只留最新一篇）；贴题弹窗的开关与草稿 */
  const [custom, setCustom] = useState<CustomExercise | null>(() => loadCustom())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  const activeCase = ALL_CASES.find((item) => item.exercise.id === exerciseId) ?? firstCase
  /** 当前在做的是不是自己贴的那一篇 */
  const customExercise = useMemo(() => (custom ? exerciseOf(custom) : null), [custom])
  const isCustom = customExercise !== null && customExercise.id === exerciseId
  const exercise: Exercise = isCustom && customExercise ? customExercise : activeCase.exercise
  const mode = exercise.mode
  // 恒定的空数组：直接写 `?? []` 会每帧新建一个引用，让下面的 useMemo 失效
  const generatedOptions = generatedByExercise[exercise.id] ?? EMPTY_GENERATED

  /**
   * 交替使用的原文。
   * 第 0 份是题目本身的原文，之后的来自 variants.ts 的备选；
   * 「换一换」按位轮换，换的是原文，题目编号与题型不变。
   */
  const sourceOptions = useMemo(
    () => [
      { source: exercise.source, referenceTranslation: exercise.referenceTranslation, topic: exercise.topic, genre: exercise.genre },
      ...variantsFor(exercise.id).map((variant) => ({ ...variant, topic: exercise.topic, genre: exercise.genre })),
      ...generatedOptions.map((generated) => ({
        source: generated.source,
        referenceTranslation: generated.referenceTranslation,
        topic: generated.topic,
        genre: generated.genre,
      })),
    ],
    [exercise, generatedOptions],
  )
  const variantIndex = variantByExercise[exercise.id] ?? 0
  const safeVariantIndex = variantIndex < sourceOptions.length ? variantIndex : 0
  const current = sourceOptions[safeVariantIndex] ?? sourceOptions[0]
  const currentSource = current?.source ?? exercise.source
  const currentReference = current?.referenceTranslation ?? exercise.referenceTranslation
  // AI 出的题可能换了领域与文体，顶栏要如实显示当前这一篇
  const currentTopic = current?.topic ?? exercise.topic
  const currentGenre = current?.genre ?? exercise.genre

  /** 原文按段落切分；单段题只有一个元素，因此下面所有逻辑对四类题型通用 */
  const sourceSections: Section[] = useMemo(() => splitSections(currentSource), [currentSource])
  const multiSection = sourceSections.length > 1
  const drafts = draftsByExercise[exercise.id] ?? {}
  const sectionIndex = sectionByExercise[exercise.id] ?? 0
  const result = resultByExercise[exercise.id] ?? null
  const view = viewByExercise[exercise.id] ?? 'result'
  const currentSection = sourceSections[sectionIndex] ?? sourceSections[0]
  const currentAnswer = drafts[sectionIndex] ?? ''
  const filledSections = sourceSections.filter((_, index) => (drafts[index] ?? '').trim().length > 0).length
  const allFilled = filledSections === sourceSections.length

  const caseRecords = records.filter((record) => record.exerciseId === exercise.id)

  const isFixtureAnswer = useMemo(() => {
    const trimmed = currentAnswer.trim()
    if (!trimmed) return false
    return ALL_CASES.some((item) => item.sampleAnswer.trim() === trimmed)
  }, [currentAnswer])

  /**
   * 选中一处批注；再点同一处就取消。
   *
   * 译文上的勾画、右下栏、练习记录页三处都走这一个入口，
   * 因此"点哪里看哪里"的行为在整站是一致的。
   */
  function toggleSelection(next: Selection | null): void {
    setSelection((previous) =>
      next && previous && previous.kind === next.kind && previous.id === next.id ? null : next,
    )
  }

  /**
   * 切到某道题。
   * **不清空任何东西**：每道题的作答、批改结果、分段位置都各自留着，
   * 切回来还是离开时的样子。清空的只有"提示与错误"这类一次性的界面状态。
   */
  function selectExercise(id: string): void {
    setExerciseId(id)
    setSelection(null)
    setOpenRecord(null)
    setError(null)
    setNotice(null)
  }

  /** 换一换：换成下一份原文。只清掉这道题的作答与结果（原文变了，旧作答不再对应）。 */
  function rotateSource(): void {
    if (sourceOptions.length < 2) return
    const nextIndex = (safeVariantIndex + 1) % sourceOptions.length
    setVariantByExercise((previous) => ({ ...previous, [exercise.id]: nextIndex }))
    setDraftsByExercise((previous) => ({ ...previous, [exercise.id]: {} }))
    setSectionByExercise((previous) => ({ ...previous, [exercise.id]: 0 }))
    setResultByExercise((previous) => {
      const next = { ...previous }
      delete next[exercise.id]
      return next
    })
    setSelection(null)
    setError(null)
    setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'result' }))
    setNotice(`已换成第 ${nextIndex + 1} 篇原文，这道题的作答已清空。`)
  }

  /**
   * 用一篇刚生成出来的题：
   * 存进这道题的池子（以后「换一换」还能翻回来），并立刻切到它，
   * 同时清掉这道题旧的作答与结果——原文变了，旧作答不再对应。
   */
  function applyGeneratedExercise(generated: GeneratedExercise): void {
    const pool = generatedByExercise[exercise.id] ?? []
    // 位置 0 是题目本身的原文，接着是手写备选，生成出来的排在最后
    const nextIndex = 1 + variantsFor(exercise.id).length + pool.length

    setGeneratedByExercise((previous) => ({
      ...previous,
      [exercise.id]: [...(previous[exercise.id] ?? []), generated],
    }))
    setVariantByExercise((previous) => ({ ...previous, [exercise.id]: nextIndex }))
    setDraftsByExercise((previous) => ({ ...previous, [exercise.id]: {} }))
    setSectionByExercise((previous) => ({ ...previous, [exercise.id]: 0 }))
    setResultByExercise((previous) => {
      const next = { ...previous }
      delete next[exercise.id]
      return next
    })
    setSelection(null)
    setError(null)
    setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'result' }))
  }

  function openGenerator(): void {
    setGenTopic(GENERATION_TOPICS[0] ?? '')
    setGenGenre(exercise.genre)
    setGenDirection(exercise.direction)
    setGenError(null)
    setGenOpen(true)
  }

  async function runGenerate(): Promise<void> {
    const topic = genTopic.trim()
    if (genBusy || !topic) return
    setGenBusy(true)
    setGenError(null)

    const outcome = await requestGeneration({ direction: genDirection, genre: genGenre, topic, mode })
    setGenBusy(false)

    if (!outcome.ok) {
      setGenError(outcome.message)
      return
    }
    applyGeneratedExercise(outcome.exercise)
    setGenOpen(false)
    setNotice(
      `AI 已出一篇新题（${outcome.exercise.topic} · ${GENRE_LABEL[outcome.exercise.genre]}），已留存，` +
        `点「换一换」随时能翻回来。`,
    )
  }

  function selectTab(nextTab: Tab): void {
    setTab(nextTab)
    setOpenRecord(null)
    if (nextTab === 'records') return
    if (nextTab === 'custom') {
      // 贴过就直接切到那一篇；没贴过就把贴题弹窗打开
      if (customExercise) selectExercise(customExercise.id)
      else openPaste()
      return
    }
    // 切题型只换"当前在看哪道题"，不清空任何一道题的作答与结果
    const next = casesOfMode(nextTab)[0]
    if (next) selectExercise(next.exercise.id)
  }

  /** 打开贴题弹窗：把当前那一篇的原文放进去，方便改一改再练。 */
  function openPaste(): void {
    setPasteText(custom?.source ?? '')
    setPasteError(null)
    setPasteOpen(true)
  }

  /** 贴进去了：存下来（只留这一篇）并立刻切过去。 */
  function applyPaste(): void {
    const text = pasteText.trim()
    if (text.length < 2) {
      setPasteError('请先把原文贴进来（至少几个字）')
      return
    }
    const saved = saveCustom(text)
    setCustom(saved)
    setTab('custom')
    selectExercise(saved.id)
    setPasteOpen(false)
  }

  function updateAnswer(value: string): void {
    setDraftsByExercise((previous) => ({
      ...previous,
      [exercise.id]: { ...(previous[exercise.id] ?? {}), [sectionIndex]: value },
    }))
    setError(null)
    setNotice(null)
    // 改动作答后，之前的结果不再对应这段文字
    setResultByExercise((previous) => {
      const next = { ...previous }
      delete next[exercise.id]
      return next
    })
    setSelection(null)
    setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'result' }))
  }

  function setSection(nextIndex: number): void {
    setSectionByExercise((previous) => ({ ...previous, [exercise.id]: nextIndex }))
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
    setResultByExercise((previous) => ({ ...previous, [exercise.id]: judging_ }))
    setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'result' }))
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
        raw: judging_.raw,
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
      source: currentSource,
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
      {
        correction: outcome.correction,
        validated: outcome.validated,
        level,
        source: 'live',
        sectionCount: outcome.sectionCount,
        raw: outcome.raw,
      },
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
      {
        correction: fixture,
        validated: checked,
        level,
        source: 'fixture',
        sectionCount: 1,
        // 内置示例没有"模型原始文本"这回事，就按 AI 的字段形状把它还原出来
        raw: JSON.stringify(toAiShape(fixture), null, 2),
      },
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
        raw: openRecord.raw,
      }
    : result && view === 'result'
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
          raw: result.raw,
        }
      : null

  /** 有上一次的结果、且当前停在作答框上（点了「返回修改」但还没改字） */
  const canReturnToResult = Boolean(result) && view === 'answer'

  const inMode = tab === 'records' ? [] : casesOfMode(tab)

  /**
   * 右上角要显示的带批注的作答。
   * 位置早已由校验结果给出（validated 里带 span），这里只是把它排版成片段序列。
   */
  /*
   * 排版结果只在"结果真的换了"时重建。
   * 注意依赖不能写成 [shown]：shown 是每次渲染都新建的对象字面量，
   * 那样每渲染一次都会重建 layout，底下依赖它的测量层（弧线、填补方框）
   * 就会跟着反复重算、甚至和"申请空白"互相打架（实际踩过）。
   */
  const shownValidated = shown?.validated
  const shownAnswer = shown?.answer
  const answerLayout = useMemo(
    () => (shownValidated && shownAnswer !== undefined ? buildLayout(shownValidated, shownAnswer) : EMPTY_LAYOUT),
    [shownValidated, shownAnswer],
  )

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

        <div className="topbar-right">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSettingsOpen(true)}
            title="行距、填补的文字、译文视图"
          >
            设置
          </button>
        </div>

        {tab !== 'records' && (
          <div className="topbar-right">
            {shown?.source === 'fixture' && <span className="chip chip-warn">内置示例批改</span>}
            <span className="chip">{DIRECTION_LABEL[exercise.direction]}</span>
            <span className="chip">{GENRE_LABEL[currentGenre]}</span>
            <span className="chip">{currentTopic}</span>
          </div>
        )}
      </header>

      {tab === 'records' ? (
        <RecordsView
          records={records}
          openRecord={openRecord}
          onOpen={setOpenRecord}
          onSelect={toggleSelection}
          selection={selection}
          settings={settings}
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

          <main className={`split${split ? ' split-manual' : ''}`} ref={splitRef} style={splitStyle}>
            <div className="split-row split-row-top">
            <section className="pane pane-source">
              <header className="pane-head">
                <h2>原文</h2>
                <div className="head-meta">
                  {/*
                    自己贴的那一篇没有备选、也不该让 AI 换掉（换掉就不是他自己贴的那篇了），
                    这里只留一个「重新贴一篇」。
                  */}
                  {isCustom ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={openPaste}
                      title="换一篇自己贴的原文；贴新的会覆盖上一篇（练习记录仍留着）"
                    >
                      重新贴一篇
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={rotateSource}
                        disabled={sourceOptions.length < 2}
                        title={
                          sourceOptions.length < 2
                            ? '这道题暂时只有一篇原文；点右边的「AI 出题」可以现出一篇'
                            : '换一篇同话题、同文体的原文继续练'
                        }
                      >
                        换一换
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={openGenerator}
                        title="按领域让 AI 现出一篇同规格的题；生成后会留存，可用「换一换」翻回来"
                      >
                        AI 出题
                      </button>
                    </>
                  )}
                  {multiSection && (
                    <span className="chip">
                      第 {sectionIndex + 1} / {sourceSections.length} 段
                    </span>
                  )}
                  {isCustom ? (
                    <span className="chip" title="题型是按原文自己判的：多个自然段按文章题、两句以上按段落题、很短又没标点按术语题，其余按句子题">
                      自动判定 · {KIND_LABEL[exercise.mode]}
                    </span>
                  ) : (
                    <span className="chip">官方建议 {exercise.suggestedMinutes} 分钟</span>
                  )}
                </div>
              </header>
              <div className="pane-body">
                <p className={mode === 'term' ? 'source-text source-term' : 'source-text'}>
                  {multiSection ? (currentSection?.text ?? currentSource) : currentSource}
                </p>
                {/* 自己贴的题没有参考译文，那一栏就别摆个空壳子 */}
                {currentReference ? (
                  <details className="reference">
                    <summary>参考译文（随题固定，可折叠）</summary>
                    <p>{currentReference}</p>
                  </details>
                ) : null}
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

            <section className="pane pane-answer">
              <header className="pane-head">
                <h2>我的译文</h2>
                <div className="head-meta">
                  {shown && (
                    <div className="view-switch" role="group" aria-label="译文视图">
                      <button
                        type="button"
                        className={settings.answerView === 'correct' ? 'view-btn view-btn-active' : 'view-btn'}
                        onClick={() => updateSettings({ answerView: 'correct' })}
                        title="在译文上勾画：划线、方框、调序弧线"
                      >
                        批改视图
                      </button>
                      <button
                        type="button"
                        className={settings.answerView === 'compare' ? 'view-btn view-btn-active' : 'view-btn'}
                        onClick={() => updateSettings({ answerView: 'compare' })}
                        title="一句一句对照：每句下方给出修改后的完整那句，不划线不填补"
                      >
                        对照视图
                      </button>
                    </div>
                  )}
                  {shown && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        // 回到作答状态：**结果留着**，输入框重新出现（文字还在 drafts 里）。
                        // 只要没改字，右上角就多一个「查看上次批改」能点回来
                        setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'answer' }))
                        setOpenRecord(null)
                        setSelection(null)
                      }}
                    >
                      返回修改
                    </button>
                  )}
                  {!shown && canReturnToResult && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setViewByExercise((previous) => ({ ...previous, [exercise.id]: 'result' }))}
                      title="回到上一次的批改结果（不重新提交，也不消耗 API）"
                    >
                      查看上次批改
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

              <div className="pane-body">
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

                {/*
                  提交前：可编辑的输入框。
                  提交后：同一栏换成**带批注的**作答——勾了底色的词、上方的小字、
                  插入标记、调序弧线都直接长在你的译文上。
                  点任意一处勾画，会在那一行下面浮出气泡（简要说明），
                  右下角同时只显示这一处的完整解释。
                */}
                {shown ? (
                  settings.answerView === 'compare' ? (
                    <CompareView
                      validated={shown.validated}
                      answer={shown.answer}
                      selection={selection}
                      onSelect={toggleSelection}
                    />
                  ) : (
                    <AnnotationText
                      layout={answerLayout}
                      answer={shown.answer}
                      validated={shown.validated}
                      selection={selection}
                      lineHeightBase={settings.lineHeight}
                      showFixBoxes={settings.showFixBoxes}
                      onSelect={toggleSelection}
                    />
                  )
                ) : (
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
                      onClick={() => setSection(Math.max(0, sectionIndex - 1))}
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
                      onClick={() => setSection(Math.min(sourceSections.length - 1, sectionIndex + 1))}
                      disabled={sectionIndex >= sourceSections.length - 1}
                    >
                      下一段 →
                    </button>
                  </div>
                )}
              </div>
            </section>

            </div>

            <div
              className="splitter splitter-h"
              role="separator"
              aria-orientation="horizontal"
              title="拖动调整上下高度；双击恢复自动"
              onPointerDown={(event) => beginDrag('h', event)}
              onDoubleClick={resetSplit}
            />

            <div className="split-row split-row-bottom">
            <section className="pane pane-score">
              <header className="pane-head">
                <h2>总体评分</h2>
              </header>
              <div className="pane-body">
                {shown ? (
                  <ScoreSummary
                    correction={shown.correction}
                    validated={shown.validated}
                    answer={shown.answer}
                    level={shown.level}
                    attempt={shown.attempt || caseRecords.length}
                    sectionCount={shown.sectionCount}
                  />
                ) : (
                  <p className="hint">提交批改后，这里会显示分数与错误归类。</p>
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

            <section className="pane pane-notes">
              <header className="pane-head">
                <h2>批注详情</h2>
                <div className="head-meta">
                  {shown && (
                    <span className="chip">
                      共 {shown.validated.errors.length} 处错误
                      {shown.validated.highlights.length > 0 && ` · ${shown.validated.highlights.length} 处优秀`}
                    </span>
                  )}
                  {shown && <RawResponseButton raw={shown.raw} />}
                </div>
              </header>
              <div className="pane-body">
                {shown ? (
                  <DetailPanel
                    selection={selection}
                    validated={shown.validated}
                    answer={shown.answer}
                    onClose={() => setSelection(null)}
                    embedded
                  />
                ) : (
                  <p className="hint">提交批改后，点译文上的任意一处勾画，这里显示那一处的说明。</p>
                )}
              </div>
            </section>
            </div>
          </main>
        </>
      )}

      {/* 设置：行距、是否显示填补的文字、译文默认视图。纯界面偏好，存在浏览器里 */}
      {settingsOpen && (
        <div className="raw-modal-backdrop" onClick={() => setSettingsOpen(false)} role="presentation">
          <div
            className="raw-modal gen-modal"
            role="dialog"
            aria-modal="true"
            aria-label="设置"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="raw-modal-head">
              <span>设置</span>
              <span className="raw-modal-note">只影响显示，不影响批改结果；存在这台浏览器上</span>
              <button type="button" className="raw-modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>

            <div className="gen-body">
              <p className="gen-label">正文行距（{settings.lineHeight.toFixed(1)}）</p>
              <input
                className="gen-range"
                type="range"
                min={LINE_HEIGHT_RANGE.min}
                max={LINE_HEIGHT_RANGE.max}
                step={LINE_HEIGHT_RANGE.step}
                value={settings.lineHeight}
                onChange={(event) => updateSettings({ lineHeight: Number(event.target.value) })}
              />
              <p className="hint">行距越大，勾画上方的方框越不容易跟上一行挤在一起。</p>

              <p className="gen-label">译文视图</p>
              <div className="gen-chips">
                <button
                  type="button"
                  className={settings.answerView === 'correct' ? 'gen-chip gen-chip-active' : 'gen-chip'}
                  onClick={() => updateSettings({ answerView: 'correct' })}
                >
                  批改视图（在译文上勾画）
                </button>
                <button
                  type="button"
                  className={settings.answerView === 'compare' ? 'gen-chip gen-chip-active' : 'gen-chip'}
                  onClick={() => updateSettings({ answerView: 'compare' })}
                >
                  对照视图（一句一句对照）
                </button>
              </div>

              <p className="gen-label">填补的文字</p>
              <label className="gen-check">
                <input
                  type="checkbox"
                  checked={settings.showFixBoxes}
                  onChange={(event) => updateSettings({ showFixBoxes: event.target.checked })}
                />
                显示填补的正确写法（关掉后只留荧光笔底色与调序弧线）
              </label>
            </div>

            <footer className="gen-foot">
              <button type="button" className="btn btn-primary" onClick={() => setSettingsOpen(false)}>
                完成
              </button>
            </footer>
          </div>
        </div>
      )}

      {/*
        贴题：把自己找来的原文贴进来就能练，不用等我们出题。
        只贴原文——方向按有没有汉字自动判断，题型按段落数/句数自动判断，参考译文留空。
      */}
      {pasteOpen && (
        <div className="raw-modal-backdrop" onClick={() => setPasteOpen(false)} role="presentation">
          <div
            className="raw-modal gen-modal"
            role="dialog"
            aria-modal="true"
            aria-label="贴一篇自己的题"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="raw-modal-head">
              <span>贴一篇自己的题</span>
              <span className="raw-modal-note">只贴原文就行；存在这台浏览器上，只留最新一篇</span>
              <button type="button" className="raw-modal-close" onClick={() => setPasteOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>

            <div className="gen-body">
              <p className="gen-label">原文</p>
              <textarea
                className="answer-input gen-textarea"
                value={pasteText}
                placeholder="把要翻译的原文整段贴在这里（中英都行；有空行就会按文章题分段处理）"
                onChange={(event) => {
                  setPasteText(event.target.value)
                  setPasteError(null)
                }}
              />
              <p className="hint">
                方向与题型是自动判的：有汉字就按中译英，多个自然段按文章题（逐段作答）、
                两句以上按段落题、很短又没有标点按术语题，其余按句子题。
                篇长要求（英译汉 250–350 词那套）对自己贴的题不适用，多短都能练。
              </p>
              {pasteError && <p className="error-text">{pasteError}</p>}
            </div>

            <footer className="gen-foot">
              <button type="button" className="btn" onClick={() => setPasteOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={applyPaste} disabled={pasteText.trim().length < 2}>
                开始练习
              </button>
            </footer>
          </div>
        </div>
      )}

      {/*
        AI 出题：选领域（也可自己输入）+ 文体 + 方向，现出一篇同规格的题。
        生成结果按题目留存，之后「换一换」还能翻回来接着练。
      */}
      {genOpen && (
        <div className="raw-modal-backdrop" onClick={() => !genBusy && setGenOpen(false)} role="presentation">
          <div
            className="raw-modal gen-modal"
            role="dialog"
            aria-modal="true"
            aria-label="AI 出题"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="raw-modal-head">
              <span>AI 出题</span>
              <span className="raw-modal-note">生成后会留存，可用「换一换」翻回来</span>
              <button
                type="button"
                className="raw-modal-close"
                onClick={() => setGenOpen(false)}
                disabled={genBusy}
                aria-label="关闭"
              >
                ×
              </button>
            </header>

            <div className="gen-body">
              <p className="gen-label">方向</p>
              <div className="gen-chips">
                {(Object.keys(DIRECTION_LABEL) as Direction[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === genDirection ? 'gen-chip gen-chip-active' : 'gen-chip'}
                    onClick={() => setGenDirection(key)}
                    disabled={genBusy}
                  >
                    {DIRECTION_LABEL[key]}
                  </button>
                ))}
              </div>

              <p className="gen-label">文体</p>
              <div className="gen-chips">
                {(Object.keys(GENRE_LABEL) as Genre[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === genGenre ? 'gen-chip gen-chip-active' : 'gen-chip'}
                    onClick={() => setGenGenre(key)}
                    disabled={genBusy}
                  >
                    {GENRE_LABEL[key]}
                  </button>
                ))}
              </div>

              <p className="gen-label">领域</p>
              <div className="gen-chips">
                {GENERATION_TOPICS.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className={topic === genTopic ? 'gen-chip gen-chip-active' : 'gen-chip'}
                    onClick={() => setGenTopic(topic)}
                    disabled={genBusy}
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <input
                className="gen-input"
                value={genTopic}
                onChange={(event) => setGenTopic(event.target.value)}
                placeholder="也可以自己输入领域，例如：低碳转型"
                disabled={genBusy}
                spellCheck={false}
              />

              <p className="hint">
                篇幅要求：{LENGTH_RULE[genDirection].min}-{LENGTH_RULE[genDirection].max}{' '}
                {LENGTH_RULE[genDirection].unit}（程序会硬校验，不达标会自动退回重写）。
                {mode === 'article'
                  ? '文章题直接用全文。'
                  : `当前是${UNIT_LABEL[mode]}题，会从全文里截取对应大小。`}
              </p>
              {genError && <p className="hint gen-error">{genError}</p>}
            </div>

            <footer className="gen-foot">
              <button type="button" className="btn" onClick={() => setGenOpen(false)} disabled={genBusy}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runGenerate()}
                disabled={genBusy || genTopic.trim().length === 0}
              >
                {genBusy ? '正在出题…（通常十几秒）' : '生成题目'}
              </button>
            </footer>
          </div>
        </div>
      )}
      <footer className="app-foot">
        <span>颜色约定：红 = 硬性错误（术语、漏译、语法、标点），橙 = 表达问题，绿 = 表达优秀。</span>
      </footer>
    </div>
  )
}
