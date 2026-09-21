import { useMemo, useReducer, useRef, useState, type JSX } from 'react'
import { MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import {
  DIRECTION_LABEL,
  GENRE_LABEL,
  type Exercise,
  type Direction,
  type Genre,
  type PolishLevel,
} from '../domain/types'
import { validateCorrection } from '../domain/validate'
import { buildLayout, type AnnotatedLayout } from '../domain/layout'
import { toAiShape } from '../domain/parse'
import { requestGeneration, requestJudgment, type JudgeSectionInput } from '../domain/client'
import { paginateArticle, type ArticlePage } from '../domain/sections'
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
import { AnswerPane, PAGE_STATE_HINT, nextPageHint, type PageState } from './AnswerPane'
import { AnswerViewSwitch } from './AnswerViewSwitch'
import { CompareView } from './CompareView'
import { ScorePane } from './ScorePane'
import { NotesPane } from './NotesPane'
import { TopBar } from './TopBar'
import { ArticleBar } from './ArticleBar'
import { ArticlePickerModal } from './ArticlePickerModal'
import { TermRows, TermResults } from './TermRows'
import { DomainBar } from './DomainBar'
import {
  exerciseOfSentence,
  parseSentenceExerciseId,
  sentenceExerciseId,
  sentenceForExerciseId,
} from '../domain/sentence-exercise'
import { articleById, ARTICLES, articlesOf } from '../domain/articles'
import { exerciseOfArticle } from '../domain/article-exercise'
import {
  answeredTermCount,
  correctionFromVerdicts,
  exerciseOfTerms,
  judgeTerms,
  termAnswerText,
  termExerciseId,
  termsForExerciseId,
} from '../domain/term-exercise'
import { loadSelection, saveSelection, type ArticleSelection } from './article-selection'
import {
  clearGraded,
  firstUngraded,
  gradedCount,
  isCompleted,
  loadProgress,
  markGraded,
  orderForPicker,
  type ProgressMap,
} from './article-progress'
import { exerciseSourceOf, pageCountOf } from '../domain/exercise-source'
import { loadRecords, saveRecords } from './records-store'
import { loadLastView, saveLastView, type ExerciseOrigin, type ViewTab } from './last-view'

type Tab = ViewTab

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES
/** 文章库的那几篇随代码进仓库（见 ADR 0010）；这里只在"文章库整个空了"时兜底 */
const FIRST_ARTICLE = ARTICLES[0]
const EMPTY_GENERATED: GeneratedExercise[] = []
const EMPTY_LAYOUT: AnnotatedLayout = { segments: [], reorderGroups: [], rejectedIds: [], droppedCount: 0 }

/** 「上一次在某一栏看的是哪道题」——切回来要回到它（见 selectTab 的注释）。 */
interface LastInTab {
  id: string
  origin: ExerciseOrigin
}

/**
 * 把"记下来的那道题"按**来源**确认一遍，确实还在就返回题号，否则 null。
 *
 * 光有题号不够（见 last-view.ts）：文章栏的题号可能是文章库、内置题库、AI 现出的，
 * 也可能是自己贴的，四者共用同一个编号空间。不确认就会出现
 * "落在一道已经不存在的题上"——那比换一篇更糟：界面会空着。
 */
function resolveStoredExercise(id: string, origin: ExerciseOrigin, customId: string | null): string | null {
  if (origin === 'article-bank') return articleById(id) ? id : null
  if (origin === 'custom') return customId === id ? id : null
  if (origin === 'builtin') return ALL_CASES.some((item) => item.exercise.id === id) ? id : null
  // 句子题与术语题由数据表现算，题号本身就能确认（解析不出来就等于不存在）
  if (origin === 'sentence') return exerciseSourceOf(id)?.mode === 'sentence' ? id : null
  if (origin === 'term') return exerciseSourceOf(id)?.mode === 'term' ? id : null
  return null
}

export function App(): JSX.Element {
  const firstCase = ALL_CASES[0]
  if (!firstCase) throw new Error('题库为空')

  /**
   * 启动落点（用户要求：「个性化记忆，下一次落到上一次关掉时的界面」）。
   *
   * 顺序是：
   *   1. **上次关掉时的那一栏、那一道题、那一页**（`last-view.ts`）——
   *      按来源确认那道题还在，取不回来就当没记过；
   *   2. 那一道如果是**整篇练完并批改过的文章题**，按老规矩**不主动打开它**
   *      （用户之前明确要求过：练完的还留在下拉里、也还能点开，只是不再自动落在它上面），
   *      改而落到同一格里第一篇没练完的；
   *   3. 都没有就退回"上次选的那一格 + 英译中"的第一篇；
   *   4. 文章库整个为空时退回内置题库，保证界面照样能开。
   *
   * 第 2 条里那句"文章题"是必须的：句子题、术语题提交一次也会在进度里留下记录，
   * 但对它们来说没有"整篇练完"这回事，不该被这条规矩拦在外面。
   *
   * ⚠️ 落点里的 `sectionIndex` 是 `number | null`，null 表示**没记住页号**。
   * 这一位不能省：兜底那条路（"同一格里第一篇没练完的"）给出的是**哪一篇**，
   * 没说"第几页"；把它当成"记住的第 0 页"会盖掉"从没批完的那一段继续"这条老规矩
   * （实测过：进度里已批 3 页，打开却回到第 1 页）。
   */
  const startupProgress = loadProgress()
  const startup = (() => {
    const view = loadLastView()
    if (view && view.tab !== 'records' && view.tab !== 'favorites') {
      const id = resolveStoredExercise(view.exerciseId, view.origin, loadCustom()?.id ?? null)
      const isFinishedArticle = id !== null && exerciseSourceOf(id)?.mode === 'article' && isCompleted(startupProgress, id, pageCountOf(id))
      if (id && !isFinishedArticle) return { tab: view.tab, exerciseId: id, sectionIndex: view.sectionIndex }
    }
    const remembered = loadSelection()
    const inSlot = articlesOf(remembered.domain, remembered.direction)
    const unfinished = inSlot.find((item) => !isCompleted(startupProgress, item.id, pageCountOf(item.id)))
    const article = unfinished ?? inSlot[0] ?? FIRST_ARTICLE
    return article ? { tab: 'article' as Tab, exerciseId: article.id, sectionIndex: null } : null
  })()
  const [tab, setTab] = useState<Tab>(startup ? startup.tab : firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(startup ? startup.exerciseId : firstCase.exercise.id)

  /**
   * 文章进度（哪几页已经批过）——存在浏览器里，刷新之后还在。
   *
   * 用途就是用户要求的那两条："下次打开从没批完的那一段继续"、
   * "练完的文章不主动显示、换一换留到最后"。初始值直接来自 localStorage
   * （启动落点上面已经读过一次，这里再读一次保持它是一份正常的 state）。
   */
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress())

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
  /**
   * 原文栏看的是原文还是「对照」，纯界面状态（不落盘）。
   * 默认关：用户打开一道题的默认视线是原文本身，译文要自己按出来。
   */
  const [compareSource, setCompareSource] = useState(false)

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
  /*
   * 把"当前这一篇所属的格子"同步进文章选择里（只在真的对不上时写一次）。
   *
   * 用途：文章栏那两个下拉必须显示**当前这一篇**所在的领域与方向。
   * 进入文章题的入口有好几个（方向切换、选文章弹窗、从练习记录跳回来、启动落点……），
   * 与其在每个入口各对齐一遍、漏一个就显示错格子，不如在这里统一对齐。
   * 只在不等时写，因此不会来回触发；写的是 localStorage，不影响渲染结果。
   *
   * 注意这里**只同步领域与方向**："上次看到哪一篇、第几页"由 last-view.ts 管，
   * 它对句子栏、术语栏同样成立，不该塞进这个只管文章栏下拉的文件里。
   */
  if (
    activeArticle &&
    (articleSelection.domain !== activeArticle.domain || articleSelection.direction !== activeArticle.direction)
  ) {
    const next: ArticleSelection = { domain: activeArticle.domain, direction: activeArticle.direction }
    setArticleSelection(next)
    saveSelection(next)
  }
  /**
   * 当前是不是**术语库**里的一组术语。
   * 术语题不走文章库那套问答：它一次给五条术语，批改完全本地（见 term-exercise.ts）。
   */
  const activeTerms = useMemo(() => termsForExerciseId(exerciseId), [exerciseId])
  const isTermExercise = activeTerms.length > 0
  /**
   * 当前是不是**句子库**里的一道句子题（从该领域文章里切出来的单句）。
   */
  const activeSentence = useMemo(() => sentenceForExerciseId(exerciseId), [exerciseId])
  const exercise: Exercise =
    isCustom && customExercise
      ? customExercise
      : activeArticle
        ? exerciseOfArticle(activeArticle)
        : isTermExercise
          ? exerciseOfTerms(exerciseId, activeTerms)
          : activeSentence
            ? exerciseOfSentence(exerciseId, activeSentence)
            : activeCase.exercise
  const mode = exercise.mode
  /**
   * 每一栏"上一次看的是哪道题"。
   *
   * 为什么用 ref 而不是 state：它记的是"离开时的样子"，只给下一次切栏读，
   * 不参与渲染；而切栏那一刻读到的必须是**最新**的一份——写进 state 会晚一帧，
   * 用户"切走→立刻切回"时就会读到空值。这里在**每次渲染时**顺手记下当前这一栏，
   * 与渲染同步、不触发重渲染。
   */
  const lastInTabRef = useRef<Partial<Record<Tab, LastInTab>>>({})
  const origin: ExerciseOrigin = isCustom
    ? 'custom'
    : activeArticle
      ? 'article-bank'
      : activeSentence
        ? 'sentence'
        : isTermExercise
          ? 'term'
          : 'builtin'
  lastInTabRef.current[tab] = { id: exercise.id, origin }

  /**
   * 把"记住的那道文章题"解析回一个现在确实存在的题号；取不回来就返回 null（退回内置第一道）。
   *
   * 四种来源分别确认：文章库、自己贴的、AI 现出的（在本题的池子里）、内置题库。
   * 不确认就会出现"切回来落在一道已经不存在的题上"——那比换一篇更糟：界面会空着。
   */
  function resolveRememberedArticle(remembered: LastInTab | undefined): string | null {
    if (!remembered) return null
    if (remembered.origin === 'article-bank') return articleById(remembered.id) ? remembered.id : null
    if (remembered.origin === 'custom') return customExercise?.id === remembered.id ? remembered.id : null
    if (remembered.origin === 'builtin') {
      return ALL_CASES.some((item) => item.exercise.id === remembered.id) ? remembered.id : null
    }
    return null
  }
  /**
   * 这道题自己的会话状态（作答、结果、看哪一面、第几份原文、AI 生成的题池）。
   *
   * ⚠️ 这里多传了一个"从第几页接着做"：用户要求「翻译了某几段、且已经批改，
   * 下次打开网站就**从没有翻译完成的那一段继续**」。页数由原文现算（与练习页同一套分页），
   * 页号则来自落盘的进度；会话一旦真的建起来（用户动手了），页号就归它自己管，
   * 这个初始值不再起作用——所以它只影响"刚打开的那一眼"。
   *
   * 两个来源，**记住的那一页优先**：
   *   1. 上次关掉网页时停在哪一页（用户要求"下一次落到上一次关掉时的界面"）；
   *   2. 没有记住时退回"第一个还没批过的页"（用户要求"从没有翻译完成的那一段继续"）。
   * 页号一律夹在有效范围内：题库换了、页数变了之后，旧页号不该把人送到一篇空白上。
   */
  const totalPages = Math.max(1, pageCountOf(exercise.id))
  const rememberedPage = startup && startup.exerciseId === exercise.id ? startup.sectionIndex : null
  const resumeIndex = Math.min(
    rememberedPage ?? firstUngraded(progress, exercise.id, totalPages),
    totalPages - 1,
  )
  const session = sessionOf(sessions, exercise.id, resumeIndex)
  const { drafts, sectionIndex, pages, unlocked, openResults } = session

  /*
   * 记下"现在停在哪"（栏 + 题 + 来源 + 页），下次打开落回这里。
   *
   * 为什么写在渲染里而不是每个入口各记一遍：切栏、换题、翻页、从记录跳回来……
   * 入口有七八个，逐个补记漏一个就前功尽弃（`lastInTabRef` 上已经踩过一次）。
   * 内容没变时 `saveLastView` 一个字都不写（见 last-view.ts 的比对），因此这里不贵。
   *
   * 「记录」与「收藏」两栏不记：那是去"看别的东西"，不是练习位置——
   * 用户从记录页关掉网页，下次该回到他当时练的那道题，而不是回到记录页。
   */
  if (tab !== 'records' && tab !== 'favorites') {
    saveLastView({ tab, exerciseId: exercise.id, origin, sectionIndex })
  }
  /*
   * 当前这一页的批改结果；没批过就是 undefined。
   *
   * 这里刻意**没有**一个"当前看哪一面"的状态：看结果是看这一页的结果，
   * 结果一没（还没提交 / 被「返回编辑」作废）就必然是在写。两份状态迟早会打架。
   */
  const pageResult = pages[sectionIndex]
  /** 这一页是不是被「返回编辑」放开来改过（据此决定翻页时**绝不**自动提交） */
  const pageUnlocked = unlocked.includes(sectionIndex)
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

  /**
   * 原文按**页**切分——一页 = 一个自然段（不足 50 单位的自然段与相邻段合并）。
   *
   * 用户要求「把每个文章进行分段，文章模式下，一段一段的出」，规则本身在
   * domain/sections.ts 的 paginateArticle 里，这里只是用它。
   *
   * 单段题（句子/段落/术语/自己贴的短题）本来就只有一段，于是原样得到一页 ✓。
   * 参考译文一起传进去：分页顺手把每一页的**逐段译文对**也算好了，
   * 原文栏的「对照」直接拿它铺"一段原文、一段译文"。
   */
  const sourceSections: ArticlePage[] = useMemo(
    () => paginateArticle(currentSource, currentReference, exercise.direction),
    [currentSource, currentReference, exercise.direction],
  )
  const multiSection = sourceSections.length > 1
  const currentSection = sourceSections[sectionIndex] ?? sourceSections[0]
  const currentAnswer = drafts[sectionIndex] ?? ''
  /** 这一页逐段配好的原文/译文对（「对照」用它；没有参考译文时是空的） */
  const currentPairs = currentSection?.pairs ?? []

  /*
   * 这一页在"逐页批改"里的四档。按钮文案与翻页行为全由它推出来，
   * 不再由"全篇写完了没有"决定——"一整篇非写完不可"这条约束已随逐页批改取消。
   *
   * 判据（顺序有意义，见下面注释）：
   *   1. 被「返回编辑」放开过、而且**一个字都还没改** → `edited`：
   *      界面在写，但那份批改还暂存着，可以点「查看上次批改」回去；翻页时照旧自动提交；
   *   2. 被放开过、而且**已经改过字** → `modified`：批注已经对不上，绝不自动提交，
   *      只能自己按「提交批改（手动）」；
   *   3. 有结果、没被放开过 → `graded`，只读；
   *   4. 其余 → `pending`（还没批过）。
   *
   * ⚠️ 第 1 条必须排在"看有没有结果"前面：放开这一页时结果被挪进了暂存区（`openResults`），
   * 只看 `pages` 会把它当成没批过的页，于是既要用户手动提交、又不给「查看上次批改」。
   */
  const stashedResult = openResults[sectionIndex]
  const pageState: PageState = pageUnlocked
    ? stashedResult !== undefined && stashedResult.answer === currentAnswer
      ? 'edited'
      : 'modified'
    : pageResult
      ? 'graded'
      : 'pending'
  /**
   * 现在是不是在写这一页（而不是在看这一页的批改结果）。
   * 批过的页要**先按「返回编辑」**才能写——见 pageUnlocked。
   */
  const editing = pageState !== 'graded'
  /**
   * 已批页数。**以落盘的进度为准**：刷新之后会话里的结果没了，但"这一篇批过哪几页"还在，
   * 只数会话里的 pages 会显示成 0，而用户明明已经批了三四页。
   */
  const gradedPages = gradedCount(progress, exercise.id, sourceSections.length)
  /**
   * 「返回编辑」之后还能不能点回那份批改（用户要求"退回修改后仍然可以返回到批改界面"）。
   *
   * 条件里那条"草稿与提交时一字不差"是**安全阀**，不是多余的：
   * 批注的位置是按**提交当时**那段文字算出来的，草稿一旦改过，它就不是被批的那一段了——
   * 那时光把旧批注画上去，用户会看到"划在别的字上的红线"。
   * 一个字都没改时回去看，画面与刚才完全一致，等于白送一次"再瞄一眼"。
   */
  const canReturnToResult =
    pageUnlocked && openResults[sectionIndex] !== undefined && (openResults[sectionIndex]?.answer ?? '') === currentAnswer


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

  /**
   * 换一换：文章栏换成**下一篇**，其余题型换成下一份原文。
   *
   * 文章栏的"下一篇"走的是与「选择文章」弹窗**同一个顺序函数**（没练完的在前、
   * 练完的排到最后），因此两处的"下一篇"是同一个概念：
   * 用户要的是"以后『换一换』留到最后"——不能把人送回已经做完了的那一篇。
   *
   * 换文章**不清空任何东西**：每篇的作答与结果各自留着（切回来还是离开时的样子），
   * 这一点与"切题目"完全一致；只有"换同一道题的原文"（下面那条路）才清作答。
   */
  function rotateSource(): void {
    if (activeArticle) {
      const slot = articlesOf(activeArticle.domain, activeArticle.direction)
      const ordered = orderForPicker(slot, progress, (item) => pageCountOf(item.id))
      if (ordered.length < 2) return
      const at = ordered.findIndex((item) => item.id === activeArticle.id)
      const next = ordered[(at + 1) % ordered.length]
      if (!next || next.id === activeArticle.id) return
      selectExercise(next.id)
      setNotice(`换到下一篇：${next.title}（已练完的排在最后）`)
      return
    }
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

  /**
   * 切到某个题型栏。
   *
   * ## 切走再切回来，回到的是**离开时那一篇**
   *
   * 用户报过"切一下导航栏，回来发现之前的批改内容清除了"。查下来会话状态其实一直在
   * （reducer 里留着那一篇每一页的批改），**是题目被换掉了**：
   * 文章栏由**文章库**供题（`art-<领域>-<n>`，这一篇 8 页），而内置题库里也有两道文章题
   * （`article-001/002`，4 段）。原先切回「文章」栏一律落到"该栏的第一道内置题"，
   * 于是用户从文章库第 5 页切去「术语」再切回来，看到的是**另一篇 4 段的文章**、第 1 页、什么都没写。
   * 术语栏与句子栏是同一个毛病（切回来被弹回"该领域第 1 组 / 第 1 句"）。
   *
   * 现在按栏记住"上一次在这一栏看的是哪道题"，切回来就回到它——包括题目来源是
   * 文章库、句子库、术语库、自己贴的题，还是内置题库。
   *
   * ## 记的是"题目来源"，不是"题号"
   *
   * 只记一个题号是不够的：文章栏的题号可能是 `art-...`（文章库）、`article-001`（内置）、
   * 也可能是 AI 现出的 `gen-...`。因此记 `{id, origin}` 两样，取回来时按来源重新解析，
   * 免得"题号撞车"（比如某个来源被清掉之后，同一个 id 落到另一来源上）。
   */
  function selectTab(nextTab: Tab): void {
    setTab(nextTab)
    setOpenRecord(null)
    if (nextTab === 'records') return
    if (nextTab === 'favorites') return
    if (nextTab === 'custom') {
      // 贴过就回到那一篇；没贴过就把贴题弹窗打开
      if (customExercise) selectExercise(customExercise.id)
      else openPaste()
      return
    }
    /*
     * 术语栏与句子栏都由数据表供题（术语库 / 文章库切句），
     * 领域跟着文章栏选的那个走——术语、句子与文章是同一套主题域，没必要让人选两次。
     * 但**离开时是哪一组/哪一句，回来还是它**（见上面"切走再切回来"那段）。
     */
    const remembered = lastInTabRef.current[nextTab]
    if (nextTab === 'term') {
      const id = remembered?.origin === 'term' ? remembered.id : termExerciseId(articleSelection.domain, 1)
      if (id !== exerciseId) selectExercise(id)
      return
    }
    if (nextTab === 'sentence') {
      const id = remembered?.origin === 'sentence' ? remembered.id : sentenceExerciseId(articleSelection.domain, 1)
      if (id !== exerciseId) selectExercise(id)
      return
    }
    /*
     * 文章栏：回到离开时那一篇。它可能来自文章库、内置题库、AI 出题或自己贴的题，
     * 因此按**来源**判断能不能取回来，取不回来（例如文章库那一篇已不在数据里）才退回内置的第一道。
     */
    const articleCandidate = resolveRememberedArticle(remembered)
    if (articleCandidate) {
      if (articleCandidate !== exerciseId) selectExercise(articleCandidate)
      return
    }
    const next = ALL_CASES.find((item) => item.exercise.mode === nextTab)
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
    /*
     * 只把文字写进草稿：**不动**已提交的结果，也不动页号。
     * 能写字就说明这一页要么还没批过、要么已经被「返回编辑」放开了（结果在那一刻就作废了），
     * 因此不存在"草稿与结果对不上"的情况——见 session.ts 里 answerChanged 的说明。
     */
    dispatchSession({ type: 'answerChanged', exerciseId: exercise.id, text: value })
    setError(null)
    setNotice(null)
    setSelection(null)
  }

  /** 直接切到某一页（不自动提交）。自动提交那条路在 goToSection 里。 */
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

  /**
   * 把某一页的作答整理成接口需要的形状。
   *
   * ⚠️ **起点必须是 0，不能填"这一页在整篇里的位置"。**
   *
   * 服务端会把这一页的批注按 `start` 平移之后再返回（`mergeSectionCorrections`），
   * 而界面是拿**这一页的文字**去画勾画的（`pageResult.answer`）。
   * 早先这里填的是"前面每一页的长度 + 2"的累加值，于是第 2 页以后的批注
   * 整体被推出了这一页的范围——勾画一处都画不出来，而分数、清单照样显示，
   * 界面上完全看不出哪里不对。用 `scripts/probe-section-offset.mjs` 实测确认过：
   * 同一份作答 start=0 时报 17–30，start=50 就报 67–80。
   *
   * 逐页提交一次只发这一页，服务端重建出来的那段文字**就是这一页**，
   * 因此 0 才是这一段真正的起点。
   */
  function answerSectionOf(sectionIndex: number): JudgeSectionInput {
    return { start: 0, text: drafts[sectionIndex] ?? '' }
  }

  /**
   * 原文里**这一页**那一段，形状与 answerSectionOf 一致。
   *
   * ⚠️ 必须与"这一次批的是什么"严格对应：接口的校验要求
   * `answerSections.length === sourceSections.length`（两边一一对应）。
   * 逐页批改一次只批一页，因此这里也只发这一页——早先发的是**整篇的原文分段**
   * （N 段）配上**一页的作答**（1 段），长度对不上，服务端直接 400
   * "请求缺少必要字段或字段取值不合法"，一页都批不了。
   *
   * 这里的 `start` 只是"这一页在整篇里的位置"，服务端只校验形状、不用它算位置
   * （真正决定批注坐标的是 answerSections，见 answerSectionOf 的说明）。
   */
  function sourceSectionOf(sectionIndex: number): JudgeSectionInput {
    const section = sourceSections[sectionIndex]
    return { start: section?.start ?? 0, text: section?.text ?? '' }
  }

  /**
   * 一次批改的收尾：落进 session（按页存）、写进练习记录、清掉一次性的界面状态。
   *
   * ⚠️ `target` 必须由调用方在**发起请求之前**取好并传进来。
   * 这个函数在 `await` 之后才跑，而那时 App 可能已经因为用户翻页/切题而重渲染过：
   * 直接读外层的 `exercise.id` / `session.sectionIndex` 会把结果记到**别人头上**——
   * 批改要十几秒，而这十几秒里用户完全可能已翻到下一页或切去别的题。
   */
  function commit(
    target: { exerciseId: string; sectionIndex: number; topic: string; direction: Direction },
    judging_: JudgeDraft,
    pageAnswer: string,
    attemptLevel: PolishLevel,
  ): void {
    dispatchSession({
      type: 'pageGraded',
      exerciseId: target.exerciseId,
      sectionIndex: target.sectionIndex,
      draft: judging_,
      answer: pageAnswer,
    })
    /*
     * 落一份"这一页批完了"到浏览器里（见 article-progress.ts）。
     * 会话状态刷新就没，而"下次打开从没批完的那一段继续""练完的不主动显示"
     * 都要求这件事记得住，因此提交成功就往这里记一笔。
     */
    setProgress((previous) => markGraded(previous, target.exerciseId, target.sectionIndex))
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
      const attempts = previous.filter((item) => item.exerciseId === target.exerciseId).map((item) => item.attempt)
      const nextAttempt = (attempts.length > 0 ? Math.max(...attempts) : 0) + 1
      const now = new Date()
      const next: RecordView[] = [
        ...previous,
        {
          id: `record-${now.getTime()}-${nextAttempt}`,
          exerciseId: target.exerciseId,
          mode,
          direction: target.direction,
          topic: target.topic,
          attempt: nextAttempt,
          sectionIndex: target.sectionIndex,
          level: attemptLevel,
          answer: pageAnswer,
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

  /**
   * 提交**某一页**去批改。
   *
   * `sectionIndex` 由调用方给：翻页时的自动提交要在"切页之前"把旧页交出去，
   * 因此不能读"当前页号"——那一刻它可能已经被改掉了。
   * 返回是否真的批成了，翻页那条路径据此决定要不要继续切（没批成就留在原地，别把内容弄丢）。
   */
  async function submitPage(sectionIndex: number): Promise<boolean> {
    if (judging) return false
    const pageAnswer = drafts[sectionIndex] ?? ''
    if (pageAnswer.trim().length === 0) return false

    // 发起之前先把"这一次批的是谁"钉下来（见 commit 的注释）
    const target = {
      exerciseId: exercise.id,
      sectionIndex,
      topic: exercise.topic,
      direction: exercise.direction,
    }
    setJudging(true)
    setError(null)
    setNotice(null)

    const answerSections = [answerSectionOf(sectionIndex)]
    /*
     * ⚠️ `source` 只发**当前这一页**的原文，不是整篇。
     *
     * 用户明确要求："交给 ai 时，文章只截取当前段落，不要把整篇原文章都截取进去了"。
     * 逐页批改本来就是"一页一页译、一页一页交"，把整篇原文发过去只有坏处：
     *   - 提示词里一整篇原文 + 一段作答，模型容易去评别的段落（甚至按整篇找 oldText）；
     *   - 白花输入 token（长文章一篇几千词，一次批改按整篇计费）；
     *   - 与"这一次只批这一页"这件事在语义上就不一致。
     * 单页题（句子/段落/术语）本来就只有一段，这一行对它没有影响。
     */
    const sourceForJudge = sourceSectionOf(sectionIndex).text || currentSource
    const outcome = await requestJudgment({
      source: sourceForJudge,
      direction: exercise.direction,
      genre: exercise.genre,
      level,
      sourceSections: [sourceSectionOf(sectionIndex)],
      answerSections,
    })

    setJudging(false)

    if (!outcome.ok) {
      setError({ kind: outcome.kind, message: outcome.message })
      return false
    }

    if (outcome.attempts > 1) setNotice('AI 有几次返回没通过位置校验，已自动重试并修正。')
    if (outcome.repaired.length > 0) {
      setNotice(`有 ${outcome.repaired.length} 处批注因位置与译文对不上而未标出——位置校验拦住了它们。`)
    }
    commit(
      target,
      {
        correction: outcome.correction,
        validated: outcome.validated,
        level,
        source: 'live',
        sectionCount: outcome.sectionCount,
        raw: outcome.raw,
      },
      pageAnswer,
      level,
    )
    return true
  }

  /**
   * 翻到另一页。
   *
   * 用户要求的规矩（逐页批改的核心）：
   *   - 离开一页时，**刚写完、还没批过**的那一页自动交出去批；
   *   - 已经批过的页翻回去看结果，**不重新提交**（批改要十几秒、还可能给出不一样的结果）；
   *   - 批过之后又被「返回编辑」放开改过的页，**绝不自动提交**——
   *     用户还没改完，替他交一次等于偷偷花掉一次调用。改完自己按「提交批改」。
   *
   * 自动提交没成功（模型返回不合格、网络断了）时**停在原地**：
   * 这时切走，用户会以为那一页已经交过了。
   */
  async function goToSection(nextIndex: number): Promise<void> {
    if (nextIndex === sectionIndex) return
    if (judging) return
    const withinRange = nextIndex >= 0 && nextIndex < sourceSections.length
    if (!withinRange) return

    if (pageState === 'pending' && currentAnswer.trim().length > 0) {
      const ok = await submitPage(sectionIndex)
      if (!ok) return
    }
    setSection(nextIndex)
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
      { exerciseId: exercise.id, sectionIndex, topic: exercise.topic, direction: exercise.direction },
      {
        correction: fixture,
        validated: checked,
        level,
        source: 'fixture',
        sectionCount: 1,
        // 内置示例没有"模型原始文本"这回事，就按 AI 的字段形状把它还原出来
        raw: JSON.stringify(toAiShape(fixture), null, 2),
      },
      currentAnswer,
      level,
    )
  }

  /**
   * 右上栏、右下栏、左下栏要显示的那一份批改。
   *
   * 两种来源：练习记录里点开的那一条，或**当前这一页**刚批出来的结果。
   * 后者的译文取 `pageResult.answer`（提交当时的那段文字），**不是** drafts：
   * 用户改过一个字之后批注的位置就全对不上了，所以显示的必须是被批的那一版。
   */
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
    : pageResult && !editing
      ? {
          correction: pageResult.draft.correction,
          validated: pageResult.draft.validated,
          answer: pageResult.answer,
          level: pageResult.draft.level,
          attempt: caseRecords.length,
          sectionCount: pageResult.draft.sectionCount,
          source: pageResult.draft.source,
          raw: pageResult.draft.raw,
        }
      : null

  /**
   * 术语题的逐条判分结果。
   *
   * 由本地算出来，不进 result：术语判分是**纯函数**（对照标准译法），
   * 没有"AI 返回了什么"可存，也不需要重试与失败分类。因此这里按
   * 「有没有已提交的结果」当作"这一组是否已判过"，逐条现算即可——
   * 既省一份状态，也不会出现"存下来的判分与标准译法不一致"。
   */
  /*
   * 五条答案与"整段作答文字"。
   *
   * 术语题在界面上是五个独立的框，但**下游一律按一段文字办事**——
   * 练习记录存 answer、收藏要"这一处所在的整句"、对照视图要切句。
   * 因此这里算一次、两处共用（判分与提交都用它），免得两处的拼法悄悄不一致。
   */
  const termAnswers = useMemo(
    () => activeTerms.map((_, index) => drafts[index] ?? ''),
    [activeTerms, drafts],
  )
  const termAnswer = useMemo(() => termAnswerText(termAnswers), [termAnswers])
  /** 写满五条才让提交（按钮禁用 + 悬停说明，替代原先那句"已写 0 / 5 条"的提示） */
  const allTermsAnswered = activeTerms.length > 0 && answeredTermCount(termAnswers) === activeTerms.length

  const termVerdicts = useMemo(() => {
    if (!isTermExercise) return null
    if (!pageResult) return null
    return judgeTerms(activeTerms, termAnswers)
  }, [isTermExercise, pageResult, activeTerms, termAnswers])

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
    const answers = termAnswers
    const verdicts = judgeTerms(activeTerms, answers)
    const { correction, validated } = correctionFromVerdicts(verdicts)
    const wrong = verdicts.filter((verdict) => !verdict.correct).length
    // 术语题没有分页，它的"一页"就是这五条，合起来当作被批的那段文字（与练习记录、收藏一致）
    const pageAnswer = termAnswer
    commit(
      { exerciseId: exercise.id, sectionIndex, topic: exercise.topic, direction: exercise.direction },
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
      pageAnswer,
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
            // 收藏要记住"当时在第几页"，收藏页才能显示那一段的原文（而不是整篇）
            sectionIndex,
          },
        })
      : null

  return (
    <div className="app" data-exercise-id={exercise.id}>
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
          onSettingsChange={updateSettings}
          favorites={favorites}
          onToggleFavorite={(favorite) => setFavorites((previous) => toggleFavorite(previous, favorite))}
        />
      ) : (
        <>
          {/*
            文章栏：领域下拉 · 选择文章 · 方向切换（见 ArticleBar）。
            句子栏只用领域（见 DomainBar）；术语栏由术语库供题、不需要这一行控件。
          */}
          {tab === 'article' && (
            <ArticleBar
              selection={articleSelection}
              onChange={(next) => {
                /*
                 * 换领域或换方向时自动落到那一格的第一篇，免得停在上一个格子那篇上让人以为没生效。
                 * 落点只存在这一格的选择里（领域 + 方向），"上次看的是哪一篇"由 last-view.ts 记，
                 * 因此切过去之后自然会记住这一篇。
                 */
                setArticleSelection(next)
                saveSelection(next)
                const first = articlesOf(next.domain, next.direction)[0]
                if (first) selectExercise(first.id)
                // 用户点领域是为了挑文章，所以顺手把选文章的弹窗打开（方向切换不打开）
                if (next.domain !== articleSelection.domain) setArticlePickerOpen(true)
              }}
            />
          )}

          {/*
            句子栏只要**领域**：题目从该领域的文章里自动切句（见 sentence-exercise.ts）。
            刻意不给"选文章"与"方向"——用户的要求就是句子题只能选领域；
            方向由句子本身是中文还是英文决定，不需要人来选。
            「换一句」也不在这一行：它挪到了「原文」标题栏右侧（与文章栏的「选择文章」同一个位置）。
          */}
          {tab === 'sentence' && (
            <DomainBar
              domain={articleSelection.domain}
              onChange={(domain) => {
                const next = { ...articleSelection, domain }
                setArticleSelection(next)
                saveSelection(next)
                // 换领域后换一道该领域的句子题，免得停在上个领域的那句上让人以为没生效
                selectExercise(sentenceExerciseId(domain, 1))
              }}
            />
          )}

          <main className={`split${split ? ' split-manual' : ''}`} ref={splitRef} style={splitStyle}>
            <div className="split-row split-row-top">
            <SourcePane
              exercise={exercise}
              mode={mode}
              isCustom={isCustom}
              sourceOptionsCount={
                activeArticle
                  ? articlesOf(activeArticle.domain, activeArticle.direction).length
                  : sourceOptions.length
              }
              {...(activeArticle
                ? {
                    rotateTitle:
                      '换到下一篇（这一格里已练完的排到最后）；换文章不会丢掉别的篇目上已经写的内容',
                  }
                : null)}
              multiSection={multiSection}
              sourceSectionCount={sourceSections.length}
              sectionIndex={sectionIndex}
              gradedPages={gradedPages}
              pageStateHint={PAGE_STATE_HINT[pageState]}
              nextHint={nextPageHint({ hasAnswer: currentAnswer.trim().length > 0, pageState })}
              judging={judging}
              currentSection={currentSection}
              currentSource={currentSource}
              currentPairs={currentPairs}
              compare={compareSource}
              onToggleCompare={setCompareSource}
              onSectionChange={(next) => void goToSection(next)}
              {...(isTermExercise ? { terms: activeTerms } : null)}
              {...(tab === 'article' ? { onPickArticle: () => setArticlePickerOpen(true) } : null)}
              {...(tab === 'sentence'
                ? {
                    onNextSentence: () => {
                      // 「换一句」：序号加一，在该领域的句子里往下走
                      const parsed = parseSentenceExerciseId(exercise.id)
                      const base = parsed?.domain === articleSelection.domain ? parsed.index : 1
                      selectExercise(sentenceExerciseId(articleSelection.domain, base + 1))
                    },
                  }
                : null)}
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
              （见 term-exercise.ts）。它没有"整段作答文本"，因此不画整段勾画，
              判完也不切成"一页一页"——五条就是一道题。
              与其它题型刻意分开渲染，而不是往 AnswerPane 里塞一堆 if——
              那会让两个本来不同的交互在一个组件里互相牵制。

              标题栏里的按钮位置与文章模式**对齐**（用户要求）：提交批改在最右，
              判完之后换成「重新作答」，左边是视图切换。
            */}
            {isTermExercise ? (
              <section className="pane pane-answer">
                <header className="pane-head">
                  <h2>我的译文</h2>
                  <div className="head-meta">
                    <span className="chip">术语翻译 · {activeTerms.length} 条</span>
                    <span className="chip" title="术语有唯一正确译法，因此由程序对照标准译法判分，不交给 AI">
                      本地判分
                    </span>
                    {termVerdicts === null ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={submitTerms}
                        disabled={!allTermsAnswered}
                        title={allTermsAnswered ? undefined : '请先把五条都写上'}
                      >
                        提交批改
                      </button>
                    ) : (
                      <>
                        {/* 判完之后也能切视图（用户要求：术语提交后，像文章模式一样对比、批注） */}
                        {shown && <AnswerViewSwitch view={settings.answerView} onChange={updateSettings} />}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            // 重新作答：作废这一组的结果，作答本身**留着**让人改
                            // （与逐页批改里的「返回编辑」同一个动作）
                            dispatchSession({ type: 'pageUnlocked', exerciseId: exercise.id })
                            setProgress((previous) => clearGraded(previous, exercise.id, sectionIndex))
                            setNotice(null)
                            setSelection(null)
                          }}
                        >
                          重新作答
                        </button>
                      </>
                    )}
                  </div>
                </header>
                <div className="pane-body">
                  {notice && <p className="hint notice">{notice}</p>}
                  {termVerdicts === null ? (
                    <TermRows
                      terms={activeTerms}
                      answers={termAnswers}
                      disabled={false}
                      onChange={(row, value) => updateAnswerAt(row, value)}
                    />
                  ) : settings.answerView === 'compare' && shown ? (
                    /* 对照视图：一行"你写的"、一行"标准译法"，与文章模式同一套排版 */
                    <CompareView
                      validated={shown.validated}
                      answer={shown.answer}
                      selection={selection}
                      onSelect={toggleSelection}
                    />
                  ) : (
                    /* 批改视图：五条各一行，译错的划掉并给出标准译法 */
                    <TermResults
                      verdicts={termVerdicts}
                      selectedId={selection?.id ?? null}
                      onSelect={toggleSelection}
                    />
                  )}
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
              editing={editing}
              pageState={pageState}
              multiSection={multiSection}
              sectionIndex={sectionIndex}
              currentAnswer={currentAnswer}
              onSelect={toggleSelection}
              onSettingsChange={updateSettings}
              onUnlock={() => {
                // 「返回编辑」：把这一页的结果挪进暂存区、放开这一页重写（文字还在 drafts 里）。
                // 放开之后这一页**不再自动提交**，改完自己按「提交批改」。
                // 不弹提示语：按钮文案与页面状态已经把这件事说清楚了（用户明确要去掉这类废话）。
                dispatchSession({ type: 'pageUnlocked', exerciseId: exercise.id })
                // 这一页的结果作废了，进度里也要撤掉——否则下次打开会跳过它
                setProgress((previous) => clearGraded(previous, exercise.id, sectionIndex))
                setOpenRecord(null)
                setSelection(null)
                setNotice(null)
              }}
              canReturnToResult={canReturnToResult}
              onReturnToResult={() => {
                /*
                 * 点回刚才那份批改：**不重新提交**，只是把这一页收回只读、把结果重新显示出来。
                 * 能点到这里就说明草稿一个字都没改，因此显示的批注与草稿仍然对得上。
                 *
                 * 不再弹提示语（用户明确说那句是废话）：画面本身已经变成"带批注的批改"，
                 * 而右上角那颗「返回编辑」就摆在那里，用法一目了然。
                 */
                dispatchSession({ type: 'pageResultRestored', exerciseId: exercise.id })
                setSelection(null)
                setNotice(null)
              }}
              onLevelChange={setLevel}
              onSubmit={() => void submitPage(sectionIndex)}
              onSubmitFixture={submitFixture}
              onAnswerChange={updateAnswer}
              {...(practiceFavorite
                ? {
                    favorite: favorites.some((item) => item.id === practiceFavorite.id),
                    onToggleFavorite: () =>
                      setFavorites((previous) => toggleFavorite(previous, practiceFavorite)),
                  }
                : null)}
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
          progress={progress}
          onSwitchDirection={(direction) => {
            const next: ArticleSelection = { domain: articleSelection.domain, direction }
            setArticleSelection(next)
            saveSelection(next)
            const first = articlesOf(next.domain, direction)[0]
            if (first) selectExercise(first.id)
          }}
          onPick={(article) => {
            // 选了哪一篇就切过去；"上次看的是哪一篇、第几页"由 last-view.ts 记，不在这里存
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
