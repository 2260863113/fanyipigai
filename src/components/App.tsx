import { useMemo, useReducer, useRef, useState, type JSX } from 'react'
import { MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import {
  DIRECTION_LABEL,
  GENRE_LABEL,
  type Exercise,
  type Direction,
  type Genre,
  type Mode,
  type PolishLevel,
} from '../domain/types'
import { validateCorrection } from '../domain/validate'
import { buildLayout, type AnnotatedLayout } from '../domain/layout'
import { toAiShape } from '../domain/parse'
import { requestGeneration, requestJudgment, type JudgeSectionInput } from '../domain/client'
import { splitSections, type Section } from '../domain/sections'
import { variantsFor } from '../domain/variants'
import { GENERATION_TOPICS, type GeneratedExercise } from '../domain/generate'
import type { JudgeFailureKind } from '../domain/ai'
import { useSplitDrag } from './split-drag'
import { useSettings } from './settings'
import { RecordsView, type RecordView } from './RecordsView'
import { exerciseOf, loadCustom, saveCustom, type CustomExercise } from '../domain/custom'
import {
  clearFavorites,
  loadFavorites,
  removeFavorite,
  toggleFavorite,
  type Favorite,
} from '../domain/favorites'
import { FavoritesView } from './FavoritesView'
import { favoriteFor } from './annotation-summary'
import type { Selection } from './AnnotationText'
import { INITIAL_SESSIONS, sessionOf, sessionReducer, type JudgeDraft } from './session'
import { SettingsModal } from './SettingsModal'
import { PasteModal } from './PasteModal'
import { GenerateModal } from './GenerateModal'
import { SourcePane } from './SourcePane'
import { AnswerPane } from './AnswerPane'
import { ScorePane } from './ScorePane'
import { NotesPane } from './NotesPane'
import { TopBar } from './TopBar'
import { ArticleBar } from './ArticleBar'
import { ArticlePickerModal } from './ArticlePickerModal'
import { TermRows } from './TermRows'
import { articleById, ARTICLE_EXCERPTS, articlesOf } from '../domain/articles'
import { exerciseOfArticle } from '../domain/article-exercise'
import { exerciseOfTerms, correctionFromVerdicts, judgeTerms, termExerciseId, termsForExerciseId } from '../domain/term-exercise'
import { loadSelection, saveSelection, type ArticleSelection } from './article-selection'
import { loadRecords, saveRecords } from './records-store'

type Tab = Mode | 'records' | 'custom' | 'favorites'

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES
/** 文章库的第一篇：启动时的落点（文章栏由文章库供题，见 ADR 0007） */
const FIRST_ARTICLE = ARTICLE_EXCERPTS[0]
const EMPTY_GENERATED: GeneratedExercise[] = []
const EMPTY_LAYOUT: AnnotatedLayout = { segments: [], reorderGroups: [], rejectedIds: [], droppedCount: 0 }

function casesOfMode(mode: Tab): typeof ALL_CASES {
  if (mode === 'records' || mode === 'custom' || mode === 'favorites') return []
  return ALL_CASES.filter((item) => item.exercise.mode === mode)
}

export function App(): JSX.Element {
  const firstCase = ALL_CASES[0]
  if (!firstCase) throw new Error('题库为空')

  /**
   * 启动时落在「文章」栏 —— 而文章栏现在由**文章库**供题，
   * 因此默认题号取文章库的第一篇，而不是内置题库的 article-001。
   * 文章库为空（理论上不会，抓取脚本有断言守着）时退回内置题库，保证界面照样能开。
   */
  const startup = FIRST_ARTICLE
  const [tab, setTab] = useState<Tab>(startup ? 'article' : firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(startup ? startup.id : firstCase.exercise.id)

  /**
   * 每一道题各自的会话状态（作答、结果、看哪一面、用第几份原文、AI 生成的题池）。
   *
   * 为什么用一个 reducer 而不是原先那六个按题号索引的 useState：
   * "切换题目/换原文该清哪些东西"原先在三处各手写了一遍，且三份清单并不一致——
   * 漏一项就是 bug，没有任何机制守着。现在它由 action 命名表达，写在 session.ts 里一处。
   */
  const [sessions, dispatchSession] = useReducer(sessionReducer, INITIAL_SESSIONS)
  /** 四栏边界：默认按内容自动平衡，用户拖过之后按他定的比例 */
  const splitRef = useRef<HTMLElement | null>(null)
  const { split, style: splitStyle, beginDrag, resetSplit } = useSplitDrag(splitRef)
  /** 界面偏好：行距、是否显示填补的文字、译文看哪种视图（存 localStorage） */
  const { settings, update: updateSettings } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [records, setRecords] = useState<RecordView[]>(() => loadRecords())
  const [openRecord, setOpenRecord] = useState<RecordView | null>(null)

  /** 自己贴的那一篇（存在浏览器里，只留最新一篇）；贴题弹窗的开关与草稿 */
  const [custom, setCustom] = useState<CustomExercise | null>(() => loadCustom())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  /** 收藏（存在浏览器里；做题时点卡片下方的「收藏」，在顶栏的「收藏」里看） */
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites())

  /**
   * 文章库的「领域 × 方向」选择（存在浏览器里，每次打开回到上次那一格）。
   * 只进「文章」栏；段落/句子/术语栏仍然用内置题库（见 ADR 0007）。
   */
  const [articleSelection, setArticleSelection] = useState<ArticleSelection>(() => loadSelection())
  const [articlePickerOpen, setArticlePickerOpen] = useState(false)

  const activeCase = ALL_CASES.find((item) => item.exercise.id === exerciseId) ?? firstCase
  /** 当前在做的是不是自己贴的那一篇 */
  const customExercise = useMemo(() => (custom ? exerciseOf(custom) : null), [custom])
  const isCustom = customExercise !== null && customExercise.id === exerciseId
  /** 当前在做的是不是文章库里的一篇 */
  const activeArticle = useMemo(() => articleById(exerciseId), [exerciseId])
  /**
   * 当前是不是**术语库**里的一组术语。
   * 术语题不走文章库那套问答：它一次给五条术语，批改完全本地（见 term-exercise.ts）。
   */
  const activeTerms = useMemo(() => termsForExerciseId(exerciseId), [exerciseId])
  const isTermExercise = activeTerms.length > 0
  const exercise: Exercise =
    isCustom && customExercise
      ? customExercise
      : activeArticle
        ? exerciseOfArticle(activeArticle)
        : isTermExercise
          ? exerciseOfTerms(exerciseId, activeTerms)
          : activeCase.exercise
  const mode = exercise.mode
  /** 这道题自己的会话状态（作答、结果、看哪一面、第几份原文、AI 生成的题池） */
  const session = sessionOf(sessions, exercise.id)
  const { drafts, sectionIndex, result, view } = session
  // 两个恒定的引用：直接写 `?? []` / `?? 0` 会每帧新建，让下面的 useMemo 失效
  const generatedOptions = session.generated.length > 0 ? session.generated : EMPTY_GENERATED

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
  const variantIndex = session.variantIndex
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
    clearTransientUi()
  }

  /** 这些是"一次性"的界面状态，切题目/换原文时一律清掉（per-exercise 的数据不在此列）。 */
  function clearTransientUi(): void {
    setSelection(null)
    setOpenRecord(null)
    setError(null)
    setNotice(null)
  }

  /** 换一换：换成下一份原文。只清掉这道题的作答与结果（原文变了，旧作答不再对应）。 */
  function rotateSource(): void {
    if (sourceOptions.length < 2) return
    const nextIndex = (safeVariantIndex + 1) % sourceOptions.length
    // 清作答、清结果、view 回 'result' 都在 reducer 里一处做完，这里不再手写清单
    dispatchSession({ type: 'sourceRotated', exerciseId: exercise.id, variantIndex: nextIndex })
    setSelection(null)
    setError(null)
    setNotice(`已换成第 ${nextIndex + 1} 篇原文，这道题的作答已清空。`)
  }

  /**
   * 用一篇刚生成出来的题：
   * 存进这道题的池子（以后「换一换」还能翻回来），并立刻切到它，
   * 同时清掉这道题旧的作答与结果——原文变了，旧作答不再对应。
   */
  function applyGeneratedExercise(generated: GeneratedExercise): void {
    // 位置 0 是题目本身的原文，接着是手写备选，生成出来的排在最后
    const nextIndex = 1 + variantsFor(exercise.id).length + session.generated.length
    dispatchSession({
      type: 'generatedApplied',
      exerciseId: exercise.id,
      generated,
      variantIndex: nextIndex,
    })
    setSelection(null)
    setError(null)
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
    if (nextTab === 'favorites') return
    if (nextTab === 'custom') {
      // 贴过就直接切到那一篇；没贴过就把贴题弹窗打开
      if (customExercise) selectExercise(customExercise.id)
      else openPaste()
      return
    }
    /*
     * 术语栏由**术语库**供题（不是内置题库）：进去就落到上次那个领域的第 1 组。
     * 领域跟着文章栏选的那个走——术语与文章是同一套主题域，没必要让人选两次。
     */
    if (nextTab === 'term') {
      selectExercise(termExerciseId(articleSelection.domain, 1))
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
    // 写入作答、作废旧结果、view 回 'result' 都在 reducer 里一处做完
    dispatchSession({ type: 'answerChanged', exerciseId: exercise.id, text: value })
    setError(null)
    setNotice(null)
    setSelection(null)
  }

  function setSection(nextIndex: number): void {
    dispatchSession({ type: 'sectionChanged', exerciseId: exercise.id, sectionIndex: nextIndex })
  }

  /**
   * 写到指定的"行"。术语题用它——一题五条术语，每条各写各的，
   * 复用 drafts 的 `段号 → 文字` 结构（第几行就是第几段），因此
   * 切栏目、切题目都不会丢，与其它题型的作答同一套保障。
   */
  function updateAnswerAt(row: number, value: string): void {
    dispatchSession({ type: 'answerAtChanged', exerciseId: exercise.id, row, text: value })
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
    judging_: JudgeDraft,
    submittedSections: JudgeSectionInput[],
    attemptLevel: PolishLevel,
  ): void {
    dispatchSession({ type: 'resultCommitted', exerciseId: exercise.id, draft: judging_ })
    setSelection(null)
    setOpenRecord(null)
    setRecords((previous) => {
      /*
       * 编号与"第几次"都不能用 previous.length 推：
       *   1. 记录会被上限裁剪（旧的先丢），长度不再等于历史次数 → 编号会重复、
       *      而 key 重复会让 React 复用错节点；
       *   2. "第几次作答"更不能用"现有条数 + 1"，否则丢过旧记录之后次数会倒退。
       * 因此改成时间戳编号 + 按该题已存记录里的最大次序号加一。
       */
      const attempts = previous.filter((item) => item.exerciseId === exercise.id).map((item) => item.attempt)
      const nextAttempt = (attempts.length > 0 ? Math.max(...attempts) : 0) + 1
      const now = new Date()
      const next: RecordView[] = [
        ...previous,
        {
          id: `record-${now.getTime()}-${nextAttempt}`,
          exerciseId: exercise.id,
          mode,
          direction: exercise.direction,
          topic: exercise.topic,
          attempt: nextAttempt,
          level: attemptLevel,
          answer: submittedSections.map((section) => section.text).join('\n\n'),
          correction: judging_.correction,
          validated: judging_.validated,
          source: judging_.source,
          raw: judging_.raw,
          createdAt: now,
        },
      ]
      // 存下来的是**实际落盘的**那份：写不下时会丢最旧的，界面必须跟着一致
      return saveRecords(next)
    })
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

  /**
   * 术语题的逐条判分结果。
   *
   * 由本地算出来，不进 result：术语判分是**纯函数**（对照标准译法），
   * 没有"AI 返回了什么"可存，也不需要重试与失败分类。因此这里按
   * 「有没有已提交的结果」当作"这一组是否已判过"，逐条现算即可——
   * 既省一份状态，也不会出现"存下来的判分与标准译法不一致"。
   */
  const termVerdicts = useMemo(() => {
    if (!isTermExercise) return null
    if (!result && view !== 'result') return null
    if (!result) return null
    return judgeTerms(activeTerms, activeTerms.map((_, index) => drafts[index] ?? ''))
  }, [isTermExercise, result, view, activeTerms, drafts])

  /**
   * 术语题提交：**本地判分，不调 AI**。
   *
   * 术语有唯一正确译法（官方固定表述），交给模型判会有两个坏处：
   * 同一份答案两次可能不同、用户无法自己核对分数怎么来的。
   * 因此这里直接对照 domain/terms.ts 里的标准译法判，结果映射成
   * Correction + ValidatedCorrection 的形状，好让评分、练习记录、收藏原样复用。
   */
  function submitTerms(): void {
    if (!isTermExercise) return
    const verdicts = judgeTerms(activeTerms, activeTerms.map((_, index) => drafts[index] ?? ''))
    const { correction, validated } = correctionFromVerdicts(verdicts)
    const wrong = verdicts.filter((verdict) => !verdict.correct).length
    commit(
      {
        correction,
        validated,
        level,
        // 判分来源标成 fixture：它不是 AI 现场批改的，界面不该说"这是 AI 批的"
        source: 'fixture',
        sectionCount: 1,
        raw: JSON.stringify(
          verdicts.map((verdict) => ({
            zh: verdict.term.zh,
            yours: verdict.answer,
            standard: verdict.term.en,
            correct: verdict.correct,
          })),
          null,
          2,
        ),
      },
      [{ start: 0, text: activeTerms.map((_, index) => drafts[index] ?? '').join('\n') }],
      level,
    )
    setNotice(
      wrong === 0
        ? `全部 ${verdicts.length} 条都译对了。`
        : `这一组 ${verdicts.length} 条，错 ${wrong} 条——标准译法见右下角逐条说明。`,
    )
  }

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

  /**
   * 当前选中那一处的**收藏**内容（没选中、或选中项已经不在结果里时是 null）。
   * 有了它，右下角那颗「收藏」才知道该存什么；上下文（哪道题、什么方向、什么话题）只有这里知道。
   */
  const practiceFavorite =
    shownValidated && shownAnswer !== undefined
      ? favoriteFor({
          selection,
          validated: shownValidated,
          answer: shownAnswer,
          context: {
            exerciseId: exercise.id,
            mode,
            direction: exercise.direction,
            topic: currentTopic,
          },
        })
      : null

  return (
    <div className="app">
      <TopBar
        tab={tab}
        onSelectTab={selectTab}
        onOpenSettings={() => setSettingsOpen(true)}
        meta={
          tab === 'records' || tab === 'favorites' ? null : (
            <>
              {shown?.source === 'fixture' && <span className="chip chip-warn">内置示例批改</span>}
              <span className="chip">{DIRECTION_LABEL[exercise.direction]}</span>
              <span className="chip">{GENRE_LABEL[currentGenre]}</span>
              <span className="chip">{currentTopic}</span>
            </>
          )
        }
      />

      {tab === 'favorites' ? (
        <FavoritesView
          favorites={favorites}
          onRemove={(id) => setFavorites((previous) => removeFavorite(previous, id))}
          onClear={() => setFavorites(clearFavorites())}
        />
      ) : tab === 'records' ? (
        <RecordsView
          records={records}
          openRecord={openRecord}
          onOpen={setOpenRecord}
          onSelect={toggleSelection}
          selection={selection}
          settings={settings}
          favorites={favorites}
          onToggleFavorite={(favorite) => setFavorites((previous) => toggleFavorite(previous, favorite))}
        />
      ) : (
        <>
          {/*
            文章库那一行只在「文章」栏出现：领域与方向是**文章库**的组织方式，
            段落/句子/术语栏仍然用内置题库，摆一个点了没用的下拉反而更乱。
          */}
          {tab === 'article' && (
            <ArticleBar
              selection={articleSelection}
              onChange={(next) => {
                setArticleSelection(next)
                saveSelection(next)
                // 换格子时自动落到那一格的第一篇，免得停在上一个领域的那篇上让人以为没生效
                const first = articlesOf(next.domain, next.direction)[0]
                if (first) selectExercise(first.id)
                // 用户点领域是为了挑文章，所以顺手把选文章的弹窗打开（方向切换不打开）
                if (next.domain !== articleSelection.domain) setArticlePickerOpen(true)
              }}
              onPickArticle={() => setArticlePickerOpen(true)}
            />
          )}

          <main className={`split${split ? ' split-manual' : ''}`} ref={splitRef} style={splitStyle}>
            <div className="split-row split-row-top">
            <SourcePane
              exercise={exercise}
              mode={mode}
              isCustom={isCustom}
              sourceOptionsCount={sourceOptions.length}
              multiSection={multiSection}
              sourceSectionCount={sourceSections.length}
              sectionIndex={sectionIndex}
              currentSection={currentSection}
              currentSource={currentSource}
              currentReference={currentReference}
              onRepaste={openPaste}
              onRotate={rotateSource}
              onOpenGenerator={openGenerator}
            />

            <div
              className="splitter splitter-v"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整左右宽度；双击恢复自动"
              onPointerDown={(event) => beginDrag('v', event)}
              onDoubleClick={resetSplit}
            />

            {/*
              术语题走**另一条渲染路径**：它一次给五条术语、逐条作答、由程序本地对照判分
              （见 term-exercise.ts）。它没有"整段作答文本"，因此不画勾画，
              也不需要视图切换、修改档位、提交全篇这些为整篇译文准备的东西。
              与其它题型刻意分开渲染，而不是往 AnswerPane 里塞一堆 if——
              那会让两个本来不同的交互在一个组件里互相牵制。
            */}
            {termVerdicts !== null || isTermExercise ? (
              <section className="pane pane-answer">
                <header className="pane-head">
                  <h2>我的译文</h2>
                  <div className="head-meta">
                    <span className="chip">术语翻译 · {activeTerms.length} 条</span>
                    <span className="chip" title="术语有唯一正确译法，因此由程序对照标准译法判分，不交给 AI">
                      本地判分
                    </span>
                  </div>
                </header>
                <div className="pane-body">
                  {notice && <p className="hint notice">{notice}</p>}
                  <TermRows
                    terms={activeTerms}
                    answers={activeTerms.map((_, index) => drafts[index] ?? '')}
                    verdicts={termVerdicts}
                    disabled={termVerdicts !== null}
                    onChange={(row, value) => updateAnswerAt(row, value)}
                    onSubmit={submitTerms}
                    onReset={() => {
                      // 重新作答：把这一组的结果作废（清空判分），作答本身**留着**让人改
                      dispatchSession({ type: 'resultCleared', exerciseId: exercise.id })
                      setNotice(null)
                      setSelection(null)
                    }}
                  />
                </div>
              </section>
            ) : (
            <AnswerPane
              shown={shown}
              layout={answerLayout}
              selection={selection}
              settings={settings}
              level={level}
              judging={judging}
              error={error}
              notice={notice}
              isFixtureAnswer={isFixtureAnswer}
              canReturnToResult={canReturnToResult}
              multiSection={multiSection}
              sectionIndex={sectionIndex}
              sectionCount={sourceSections.length}
              filledSections={filledSections}
              currentAnswer={currentAnswer}
              onSelect={toggleSelection}
              onSettingsChange={updateSettings}
              onBackToAnswer={() => {
                // 回到作答状态：**结果留着**，输入框重新出现（文字还在 drafts 里）。
                // 只要没改字，右上角就多一个「查看上次批改」能点回来
                dispatchSession({ type: 'viewChanged', exerciseId: exercise.id, view: 'answer' })
                setOpenRecord(null)
                setSelection(null)
              }}
              onViewLastResult={() =>
                dispatchSession({ type: 'viewChanged', exerciseId: exercise.id, view: 'result' })
              }
              onLevelChange={setLevel}
              onSubmit={() => void submitLive()}
              onSubmitFixture={submitFixture}
              onAnswerChange={updateAnswer}
              onSectionChange={setSection}
            />
            )}

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
            <ScorePane shown={shown} />

            <div
              className="splitter splitter-v"
              role="separator"
              aria-orientation="vertical"
              title="拖动调整左右宽度；双击恢复自动"
              onPointerDown={(event) => beginDrag('v', event)}
              onDoubleClick={resetSplit}
            />

            <NotesPane
              shown={shown}
              selection={selection}
              onSelect={setSelection}
              favorite={practiceFavorite}
              favorited={practiceFavorite !== null && favorites.some((item) => item.id === practiceFavorite.id)}
              onToggleFavorite={() => {
                if (practiceFavorite) {
                  setFavorites((previous) => toggleFavorite(previous, practiceFavorite))
                }
              }}
            />
            </div>
          </main>
        </>
      )}

      {/* 设置：行距、是否显示填补的文字、译文默认视图。纯界面偏好，存在浏览器里 */}
      {settingsOpen && (
        <SettingsModal settings={settings} update={updateSettings} onClose={() => setSettingsOpen(false)} />
      )}

      {/* 选文章：点领域那一行的「选择文章」打开，以卡片罗列该「领域 × 方向」下的文章 */}
      {articlePickerOpen && (
        <ArticlePickerModal
          domain={articleSelection.domain}
          direction={articleSelection.direction}
          activeArticleId={activeArticle ? activeArticle.id : null}
          onSwitchDirection={(direction) => {
            const next = { ...articleSelection, direction }
            setArticleSelection(next)
            saveSelection(next)
            const first = articlesOf(next.domain, next.direction)[0]
            if (first) selectExercise(first.id)
          }}
          onPick={(article) => {
            selectExercise(article.id)
            setArticlePickerOpen(false)
          }}
          onClose={() => setArticlePickerOpen(false)}
        />
      )}

      {/*
        贴题：把自己找来的原文贴进来就能练，不用等我们出题。
        只贴原文——方向按有没有汉字自动判断，题型按段落数/句数自动判断，参考译文留空。
      */}
      {pasteOpen && (
        <PasteModal
          text={pasteText}
          error={pasteError}
          onChange={(text) => {
            setPasteText(text)
            setPasteError(null)
          }}
          onCancel={() => setPasteOpen(false)}
          onApply={applyPaste}
        />
      )}

      {/*
        AI 出题：选领域（也可自己输入）+ 文体 + 方向，现出一篇同规格的题。
        生成结果按题目留存，之后「换一换」还能翻回来接着练。
      */}
      {genOpen && (
        <GenerateModal
          direction={genDirection}
          genre={genGenre}
          topic={genTopic}
          busy={genBusy}
          error={genError}
          mode={mode}
          onDirectionChange={setGenDirection}
          onGenreChange={setGenGenre}
          onTopicChange={setGenTopic}
          onClose={() => setGenOpen(false)}
          onGenerate={() => void runGenerate()}
        />
      )}
      <footer className="app-foot">
        <span>颜色约定：红 = 硬性错误（术语、漏译、语法、标点），橙 = 表达问题，绿 = 表达优秀。</span>
      </footer>
    </div>
  )
}
