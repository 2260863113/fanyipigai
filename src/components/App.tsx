import { useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react'
import { MOCK_CASES, fixtureCorrectionFor } from '../domain/mock'
import { scoreCorrection } from '../domain/scoring'
import { GradeHistoryPicker, type GradeHistoryEntry } from './GradeHistoryPicker'
import {
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
import { requestGeneration, requestJudgment, requestRefine, type JudgeSectionInput } from '../domain/client'
import { PAGE_RULE, paginateArticle, type ArticlePage } from '../domain/sections'
import { variantsFor } from '../domain/variants'
import { GENERATION_TOPICS, type GeneratedExercise } from '../domain/generate'
import type { JudgeFailureKind } from '../domain/ai'
import { useSplitDrag } from './split-drag'
import { resolveTheme, useSettings } from './settings'
import { RecordsView, type RecordView } from './RecordsView'
import { exerciseOf, loadCustom, newCustom, openCustom, saveCustomSource, type CustomExercise } from '../domain/custom'
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
import { GenerateModal } from './GenerateModal'
import { SourcePane } from './SourcePane'
import { AnswerPane, PAGE_STATE_HINT, nextPageHint, type PageState } from './AnswerPane'
import { AnswerViewSwitch } from './AnswerViewSwitch'
import { CompareView } from './CompareView'
import { ScorePane } from './ScorePane'
import { NotesPane } from './NotesPane'
import { TopBar } from './TopBar'
import { ArticlePickerModal } from './ArticlePickerModal'
import { TermRows, TermResults } from './TermRows'
import {
  exerciseOfSentence,
  parseSentenceExerciseId,
  sentenceExerciseId,
  sentenceForExerciseId,
} from '../domain/sentence-exercise'
import { articleById, ARTICLES, articlesOf, TOPIC_DOMAINS } from '../domain/articles'
import { exerciseOfArticle } from '../domain/article-exercise'
import {
  answeredTermCount,
  correctionFromVerdicts,
  exerciseOfTerms,
  judgeTerms,
  parseTermExerciseId,
  sanitizeTermRow,
  splitTermAnswers,
  termAnswerText,
  termExerciseId,
  termPageComplete,
  termsForPageOfExercise,
} from '../domain/term-exercise'
import { TERM_SCOPES, labelOfScope, type TermScope } from '../domain/term-scopes'
import { groupOfPage, hasTermData, type TermGroup } from '../domain/terms'
import {
  countLegacyTermFavorites,
  countLegacyTermRecords,
  dropLegacyTermFavorites,
  dropLegacyTermRecords,
} from './legacy-term-cleanup'
import { loadSelection, saveSelection, type ArticleSelection } from './article-selection'
import {
  clearGraded,
  firstUngraded,
  isCompleted,
  loadProgress,
  markGraded,
  orderForPicker,
  type ProgressMap,
} from './article-progress'
import { exerciseSourceOf, pageCountOf } from '../domain/exercise-source'
import { loadRecords, removeRecord, saveRecords } from './records-store'
import { loadLastView, saveLastView, type ExerciseOrigin, type ViewTab } from './last-view'
import { JudgeWaitingModal } from './JudgeWaitingModal'
import { JudgeDoneToast } from './JudgeDoneToast'
import { dropPageStates, loadPageStates, readPageState, writePageState, type PageStateMap } from './page-state'
import { checkSubmit } from '../domain/submit-gate'
import { reportVisit } from './auth/api'
import { AuthModal } from './auth/AuthModal'
import { authStore, useAuth } from './auth/store'
import { BoardView } from './BoardView'
import { ProfileView } from './ProfileView'
import { AdminView } from './AdminView'
import type { NavPanel } from './TopBar'

type Tab = ViewTab

/** 吐司停留多久自己消失（够读两行字，又不至于赖着不走）。 */
const TOAST_MS = 6000

interface JudgeError {
  kind: JudgeFailureKind | 'bad-request'
  message: string
}

const ALL_CASES = MOCK_CASES
/** 文章库的那几篇随代码进仓库（见 ADR 0010）；这里只在"文章库整个空了"时兜底 */
const FIRST_ARTICLE = ARTICLES[0]
const EMPTY_GENERATED: GeneratedExercise[] = []
const EMPTY_LAYOUT: AnnotatedLayout = { segments: [], reorderGroups: [], rejectedIds: [], droppedCount: 0 }

/**
 * 把一条**落盘的练习记录**还原成会话里那份"批改结果"。
 *
 * 两个地方要用它、而且必须是同一份：刷新之后把记录接回会话（`restoredPages`）、
 * 以及删掉一条记录后把屏幕上的结果换成剩下最新的那一条（`deleteRecord`）。
 * 各写一遍的话，两处迟早会在"大改档要带上 refine、sectionCount 恒为 1"这类细节上分家。
 */
function judgeDraftOf(record: RecordView): JudgeDraft {
  return {
    correction: record.correction,
    validated: record.validated,
    level: record.level,
    source: record.source,
    // 逐页批改之后一条记录就是"一页"，因此这里恒为 1（它只是给界面看的说明）
    sectionCount: 1,
    raw: record.raw,
    ...(record.refine ? { refine: record.refine } : null),
  }
}

/** 「上一次在某一栏看的是哪道题」——切回来要回到它（见 selectTab 的注释）。 */
interface LastInTab {
  id: string
  origin: ExerciseOrigin
}

/**
 * 正在批改的**那一页**。
 *
 * 用户要求"批改过程中，用户可以手动切换页数，继续翻译（但是批改过程中不能提交）"，
 * 于是"正在批改"再也不能是一个布尔量：批改允许翻页，翻走之后
 * "全局在批"与"这一页在批"就不是同一件事了。分成两件事之后：
 *   - 进度条与只读只认**这一页在批**（翻到别的页就不该看到那条线）；
 *   - 提交按钮两样都要认（一次只允许一页在批，这是用户明确的要求）。
 *
 * 题号必须钉在这里：批改要十几秒到一分钟，回来时用户可能已经翻页、换题甚至切栏，
 * 靠"当前在哪一页"去认领结果必然错位（这条在 commit 的注释里踩过一次）。
 */
interface JudgingTarget {
  exerciseId: string
  sectionIndex: number
}

/**
 * 右下角那条"批改完成"通知要记的东西。
 *
 * 除了页号还要记**题号与题型**：通知的意义就在于"人可能已经不在那一页了"，
 * 而他可能去了同一篇的另一页，也可能切到了术语栏。点通知要能一路跳回去，
 * 因此它得自带"回哪儿"的全部信息——光记一个页号，跳回去只能落在当前这道题上。
 */
interface JudgeDoneNotice {
  exerciseId: string
  mode: Mode
  sectionIndex: number
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

/**
 * 术语栏的落点：**没练完的那个板块优先**（用户拍板照文章栏的规矩：
 * "整篇练完的文章不再被主动打开"——术语板块同理）。
 *
 * ⚠️ 只数**有材料的**板块（第 14 条）：范围表现在有五个，后三个（当代术语／必背核心术语／
 * 必背用典）的材料还在整理，它们连一页都没有。把空板块算进来的话，打开术语栏会落到
 * 一个空白的板块上（"还没练完"对它永远成立，因为它永远一页都没有）。
 *
 * 所有有材料的板块都练完了，才回到 `preferred`（上次那一个）——那与文章栏"整格都练完就回第一篇"
 * 是同一个兜底。术语现在只有两个板块有材料，因此"换到另一个"这件事比文章栏更明显：
 * 国内 9 页练完之后，下次打开术语栏会直接落在国际机关名称上。
 */
function unfinishedTermExercise(
  progress: ProgressMap,
  direction: Direction,
  preferred?: string,
): string {
  const ids = TERM_SCOPES.filter((scope) => hasTermData(scope.id)).map((scope) =>
    termExerciseId(scope.id, direction),
  )
  const unfinished = ids.find((id) => !isCompleted(progress, id, pageCountOf(id)))
  if (unfinished) return unfinished
  if (preferred && ids.includes(preferred)) return preferred
  return ids[0] ?? termExerciseId('cn-org', direction)
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
      const stored = id ? exerciseSourceOf(id) : null
      /*
       * "整篇练完的不主动打开"这条规矩**对术语范围同样成立**（用户第 13 轮拍板：
       * 术语栏也照文章栏那样记进度）。文章题落到同一格里下一篇，术语题落到另一个范围。
       */
      const finished = id !== null && (stored?.mode === 'article' || stored?.mode === 'term') &&
        isCompleted(startupProgress, id, pageCountOf(id))
      if (id && !finished) return { tab: view.tab, exerciseId: id, sectionIndex: view.sectionIndex }
      const parsedTerm = id ? parseTermExerciseId(id) : null
      if (id && parsedTerm) {
        return {
          tab: 'term' as Tab,
          exerciseId: unfinishedTermExercise(startupProgress, parsedTerm.direction, id),
          sectionIndex: null,
        }
      }
    }
    const remembered = loadSelection()
    const inSlot = articlesOf(remembered.domain, remembered.direction)
    const unfinished = inSlot.find((item) => !isCompleted(startupProgress, item.id, pageCountOf(item.id)))
    const article = unfinished ?? inSlot[0] ?? FIRST_ARTICLE
    return article ? { tab: 'article' as Tab, exerciseId: article.id, sectionIndex: null } : null
  })()
  const [tab, setTab] = useState<Tab>(startup ? startup.tab : firstCase.exercise.mode)
  const [exerciseId, setExerciseId] = useState(startup ? startup.exerciseId : firstCase.exercise.id)

  /*
   * 账号那一组页面（留言板 / 个人中心 / 管理）**单独一个状态，不进 `tab`**。
   *
   * 理由是 last-view 那条规矩（见它的文件头）：`tab` 会被当作"练习位置"记下来，
   * 而这三个页面是"去看别的东西"——用户从留言板关掉网页，下次该回到他当时练的那道题。
   * 这与「记录页与收藏页不记」是同一条理由，因此用同一个做法（另开一个状态）。
   */
  const [panel, setPanel] = useState<NavPanel | null>(null)
  /** 登录 / 注册弹窗；`authReason` 是"为什么现在要你登录"，被提交门拦下时才有 */
  const [authOpen, setAuthOpen] = useState(false)
  const [authReason, setAuthReason] = useState<string | null>(null)
  const auth = useAuth()

  /*
   * 打开站点做两件事：校验本地会话（401 就清掉，网络错误先留着）、
   * 上报一次访问（谁看过这个站，只记登录名与 UA，不记 IP）。
   *
   * 这里直接读 `authStore` 而不是 `auth`：后者每次渲染都是个新对象，
   * 放进依赖数组会让这个 effect 每渲染一次跑一遍。
   */
  useEffect(() => {
    void authStore.restore()
    reportVisit(authStore.getSnapshot()?.token ?? null)
  }, [])

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
  /** 四栏边界：默认按内容自动平衡，用户拖过之后按他定的比例（位置落盘，见 split-drag.ts） */
  const splitRef = useRef<HTMLElement | null>(null)
  const { split, style: splitStyle, beginDrag, resetSplit } = useSplitDrag('practice', splitRef)
  /** 界面偏好：行距、是否显示填补的文字、译文看哪种视图、明暗主题（存 localStorage） */
  const { settings, update: updateSettings } = useSettings()
  /**
   * 明暗主题（第 9 条）：现在**实际生效**的那一套写到 `<html data-theme="…">`，
   * 样式表里的两份配色靠它切换（见 styles.css 的 `:root[data-theme='dark']`）。
   *
   * 默认跟随系统，所以系统从浅变深时也要跟着变——但只在用户**没有手动选过**
   * （`theme === 'system'`）时才听系统的：手动切过之后，"我按过了"比系统设置硬
   * （见 settings.ts 的 resolveTheme）。
   */
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    // 老浏览器只有 addListener：有 addEventListener 就先用它，没有就退回旧的（不然系统变色时不跟）
    if (typeof query.addEventListener === 'function') {
      const onChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches)
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    const onLegacyChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches)
    query.addListener(onLegacyChange)
    return () => query.removeListener(onLegacyChange)
  }, [])
  const theme = resolveTheme(settings.theme, systemPrefersDark)
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genTopic, setGenTopic] = useState(GENERATION_TOPICS[0] ?? '')
  const [genGenre, setGenGenre] = useState<Genre>(firstCase.exercise.genre)
  const [genDirection, setGenDirection] = useState<Direction>(firstCase.exercise.direction)
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [level, setLevel] = useState<PolishLevel>('polish')
  /**
   * 每一页的界面状态：**草稿、是不是在编辑、正在看第几次批改**（第 10 条）。
   *
   * 原先它是三个各自为政的东西：草稿在会话内存里、`unlocked` 在会话内存里、
   * "正在看第几次"是一个**单数**的 `viewingGradeId`（翻页就清）。
   * 现在三样按「题 + 页」存进浏览器（见 page-state.ts），于是：
   *   - 翻到别的页再翻回来，看到的仍是**那一次**（不再是每次都回到最新一次）；
   *   - 刷新、重开浏览器之后，写到一半的草稿还在、编辑态还在。
   *
   * 它与 `openRecord`（练习记录页里点开的那一条）刻意分开：那个是"去记录页回看"，
   * 这个是"在这一页就地看一眼之前批成什么样"，两者互不干扰。
   */
  const [pageStates, setPageStates] = useState<PageStateMap>(() => loadPageStates())

  const [judgingTarget, setJudgingTarget] = useState<JudgingTarget | null>(null)
  const [error, setError] = useState<JudgeError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 吐司：**"一句话说完就消失"的提示**（第 3 条要用它说清"为什么没交出去"）。
   *
   * 与右下角那条「批改完成通知」（JudgeDoneToast）是两回事：那条是"另一页的事跑来找人"，
   * 要留着等人点；这条只是"刚才那一下为什么没生效"，看一眼就够，因此几秒后自己消失。
   * 带一个自增 id 是为了让**同一句话连说两次也重新计时**（否则第二次像没反应）。
   */
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  /** 吐司几秒后自己消失；同一句话再说一次也会重新计时（靠 id 变化触发重新订阅） */
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  /** 说一句"刚才那一下为什么没生效"。id 逐个往上加，连说两次也会重新计时。 */
  function showToast(message: string): void {
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, message }))
  }

  /**
   * 打开登录 / 注册弹窗。`reason` 会显示在弹窗最上面——被提交门拦下来时必须说清楚
   * "为什么现在要你登录"，否则用户会以为提交按钮坏了。
   */
  function openAuth(reason?: string): void {
    setAuthReason(reason ?? null)
    setAuthOpen(true)
  }
  const [selection, setSelection] = useState<Selection | null>(null)
  const [records, setRecords] = useState<RecordView[]>(() => loadRecords())
  const [openRecord, setOpenRecord] = useState<RecordView | null>(null)
  /**
   * 「已交去批改」那个等待弹窗要不要弹（用户指定：提交后弹窗，两个按钮
   * 「停留此页」「进入下一页」）。
   *
   * 只在**后面还有一页**时弹：最后一页与单页题（句子/段落/术语/自己贴的短题）
   * 都没有"下一页"可去，弹出来只有一颗按钮能按，那不是提示，是打扰。
   * 它只是个提示，收起与否都不影响批改——请求早发出去了。
   */
  const [waitingPrompt, setWaitingPrompt] = useState(false)
  /**
   * 右下角的批改完成通知（用户指定）。同时只可能有一条：
   * 一次只批一页（见 judgingTarget），因此不需要队列。
   */
  const [judgeDone, setJudgeDone] = useState<JudgeDoneNotice | null>(null)

  /**
   * 自己贴的那一篇（存在浏览器里，只留最新一篇）。
   *
   * ⚠️ 第 13 轮起**没有贴题弹窗了**（用户要求："一进去不弹出窗口要求输入，
   * 而是将原文也变成输入栏"）：`custom.source` 就是原文栏那个输入框里的字，
   * 边写边存（见 updateCustomSource）。因此这里也没有 pasteOpen/pasteText 那几个 state。
   */
  const [custom, setCustom] = useState<CustomExercise | null>(() => loadCustom())

  /** 收藏（存在浏览器里；做题时点卡片下方的「收藏」，在顶栏的「收藏」里看） */
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites())

  /**
   * **换代之前那些术语记录与收藏的一次性清理**（第 13 轮，用户拍板）。
   *
   * 术语题号从 `term-v2-<领域>-<第几组>` 换成 `term-v3-<范围>-<方向>`，而记录与收藏都
   * **不存题干**（靠题号回查），于是旧术语记录变成一批点开没内容的条目。用户的答复是
   * "删掉我之前留下的术语记录，未来我留下的术语记录不会被自动删掉"。
   *
   * 判据是**旧代次前缀**（`isLegacyTermExerciseId`），因此新代次的记录在结构上不可能
   * 被它命中——"以后永不再删"是判据保证的，不靠"只跑一次"这种约定。
   * 下面那个 ref 只是别让 StrictMode 的双调用把同一件事做两遍（清两遍也是幂等的）。
   */
  const legacyCleaned = useRef(false)
  useEffect(() => {
    if (legacyCleaned.current) return
    legacyCleaned.current = true
    const droppedRecords = countLegacyTermRecords(records)
    const droppedFavorites = countLegacyTermFavorites(favorites)
    if (droppedRecords === 0 && droppedFavorites === 0) return
    if (droppedRecords > 0) setRecords((previous) => saveRecords(dropLegacyTermRecords(previous)))
    if (droppedFavorites > 0) setFavorites((previous) => dropLegacyTermFavorites(previous))
    showToast(
      `已清理换代之前留下的术语${droppedRecords > 0 ? `记录 ${droppedRecords} 条` : ''}${
        droppedRecords > 0 && droppedFavorites > 0 ? '、' : ''
      }${droppedFavorites > 0 ? `收藏 ${droppedFavorites} 条` : ''}（新版术语的记录不会再被自动删除）`,
    )
    // 依赖故意留空：只在挂载时清一遍。清完之后它一条都挑不出来，因此不会漏掉什么。
  }, [])

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
   * 当前这道题是不是**术语范围**里的一道。
   *
   * ⚠️ 判据是**题号**（`term-v3-<范围>-<方向>`），不是"取到了几条术语"——
   * 术语题现在一个范围有很多页，落在越界的页上一条都取不到，
   * 用"条数 > 0"会把术语题误判成内置题（界面突然换一套，且报错）。
   */
  const termParsed = useMemo(() => parseTermExerciseId(exerciseId), [exerciseId])
  const isTermExercise = termParsed !== null
  /** 术语栏这两个控件的当前取值，直接从题号里读出来（不另存一份 state，免得两份打架） */
  const termScope: TermScope = termParsed?.scope ?? 'cn-org'
  const termDirection: Direction = termParsed?.direction ?? 'zh-to-en'
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
          ? exerciseOfTerms(exerciseId)
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
  const { drafts, sectionIndex, pages, unlocked } = session

  /**
   * 当前这一页的术语（**末页可能不满十条**——用户拍板缺的行留空、不可填也不计分）。
   *
   * 它必须等 `sectionIndex` 出来之后才算：这一页是哪几条由页号决定。
   */
  const activeTerms = useMemo(
    () => (isTermExercise ? termsForPageOfExercise(exerciseId, sectionIndex) : []),
    [isTermExercise, exerciseId, sectionIndex],
  )
  /**
   * 术语栏那枚「参考译文」开关（第 14 条第 5 条）：开着就在原文栏右对齐列出这一页每一条的标准译法。
   *
   * 为什么不落进设置（`settings`）：设置存的是"做题姿势"（行距、默认视图、是否显示填补文字），
   * 而这是一个"此刻抬头看一眼答案"的动作——用户下次打开不该发现答案还摊在原文旁边。
   * 切页、切板块也不清它：同一道题里连着看几页答案，是这个开关的正常用法。
   */
  const [termReference, setTermReference] = useState(false)

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
  /** 这一页是不是被「返回编辑」放开来改过（放开之后可写，见 pageUnlocked 的说明） */
  const pageUnlocked = unlocked.includes(sectionIndex)
  /**
   * 有没有批改正在跑，以及**跑的是不是这一页**。
   *
   * 两个问题必须分开问（见 JudgingTarget 的注释）：批改允许翻页，
   * 因此"全局在批"与"这一页在批"从用户能翻页那一刻起就分家了。
   * `busyElsewhere` 是两者的差——提交按钮要同时看住"这一页在批"（进度条、只读）
   * 与"别处占着这次调用"（一次只许批一页）。
   */
  const judging = judgingTarget !== null
  const judgingThisPage =
    judgingTarget !== null && judgingTarget.exerciseId === exercise.id && judgingTarget.sectionIndex === sectionIndex
  const busyElsewhere = judging && !judgingThisPage
  /**
   * 把**落盘的练习记录**接回会话（每页取最新的一条）。
   *
   * 会话只在内存里：刷新一下、或者页面被热更新重载一下，整份会话就没了——
   * 而练习记录是落盘的。不接回来的话，刚刚还显示着批改的段落会变成一张空作答框，
   * 左边的进度却还说"已批 N 页"（用户报过："回到当前段落，批改页面回退到编辑界面"）。
   *
   * 只在**这道题还没有会话**时接（下面那个 effect 里的守卫），
   * 因此它不会把用户刚作废掉的结果复活，也不会盖掉正在写的草稿（reducer 里另有两道守卫）。
   */
  const restoredPages = useMemo(() => {
    const newest = new Map<number, RecordView>()
    for (const record of records) {
      if (record.exerciseId !== exercise.id) continue
      const seen = newest.get(record.sectionIndex)
      if (!seen || record.createdAt.getTime() >= seen.createdAt.getTime()) {
        newest.set(record.sectionIndex, record)
      }
    }
    /*
     * ⚠️ **当时处于编辑态（按过「返回编辑」）的那一页不接**（用户第 10 条的追问）：
     * 他的答复是"刷新之后旧结果不算了，自己去『批改记录』下拉栏里重新调出来"。
     *
     * 为什么必须显式排除：`pageState` 里"编辑态"优先于"有结果"，因此就算把结果接回来，
     * 屏幕上显示的也是作答框——但用户**一个字没改就翻走**时，releasedUnlock 会把编辑态收回，
     * 那份"已经不算了"的旧结果又冒出来了。要么让它在，要么让它不在，不能看运气。
     */
    const editingPages = new Set(
      Object.entries(pageStates)
        .filter(([key, value]) => key.startsWith(`${exercise.id}#`) && value.unlocked)
        .map(([key]) => Number(key.slice(key.indexOf('#') + 1))),
    )
    const restored = [...newest.values()]
      .filter((record) => !editingPages.has(record.sectionIndex))
      .map((record) => ({
        sectionIndex: record.sectionIndex,
        answer: record.answer,
        recordId: record.id,
        draft: judgeDraftOf(record),
      }))
    /*
     * 落盘的草稿（第 10 条）：每一页写到哪儿了，与上面那份"哪几页批过"是两回事。
     * 逐页都传，`sessionRestored` 里"会话已有就不动"，因此不会盖掉本次打开写的字。
     */
    const drafts = Object.entries(pageStates)
      .filter(([key]) => key.startsWith(`${exercise.id}#`))
      .map(([key, value]) => ({
        sectionIndex: Number(key.slice(key.indexOf('#') + 1)),
        text: value.draft,
      }))
    return { restored, drafts }
  }, [records, exercise.id, pageStates])

  useEffect(() => {
    // 这道题本次打开里已经动过了（有会话）→ 记录只当参考，不再往会话里塞
    if (sessions.byExercise[exercise.id]) return
    if (restoredPages.restored.length === 0 && restoredPages.drafts.length === 0) return
    dispatchSession({
      type: 'sessionRestored',
      exerciseId: exercise.id,
      restored: restoredPages.restored,
      drafts: restoredPages.drafts,
      // 起始页号：接回记录/草稿会顺手把会话建起来，页号必须在这里给对（见该 action 的说明）
      sectionIndex: resumeIndex,
    })
  }, [exercise.id, sessions.byExercise, restoredPages, resumeIndex])

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
  /*
   * 当前这一篇的话题。AI 出的题可能换了领域与文体，因此它未必等于 exercise.topic。
   *
   * ⚠️ 第 9 条之后顶栏不再显示"方向 / 文体 / 话题"三枚标签，因此 **currentGenre 没有去处了**：
   * 它唯一的用途就是那枚标签。话题（currentTopic）还留着——练习记录与收藏要按它归档。
   */
  const currentTopic = current?.topic ?? exercise.topic

  /**
   * 原文按**页**切分——一页 = 一个自然段（不足 50 单位的自然段与相邻段合并）。
   *
   * 用户要求「把每个文章进行分段，文章模式下，一段一段的出」，规则本身在
   * domain/sections.ts 的 paginateArticle 里，这里只是用它。
   *
   * 单段题（句子/段落/术语/自己贴的短题）本来就只有一段，于是原样得到一页 ✓。
   * 参考译文一起传进去：分页顺手把每一页的**逐段译文对**也算好了，
   * 原文栏正文末尾那个可折叠的「参考译文」直接拿它拼出来。
   */
  const sourceSections: ArticlePage[] = useMemo(
    /*
     * 术语题传 0：它的页自己已经切好了（每页十条、页间空一行），
     * 而默认规则会把"不足 50 单位"的段并到下一页去——十个机关名的中文往往不到 50 字，
     * 一并就把两页搅成一页（详见 exercise-source.ts 的 pagesOf）。
     */
    () =>
      paginateArticle(
        currentSource,
        currentReference,
        exercise.direction,
        mode === 'term' ? 0 : PAGE_RULE.mergeBelow,
      ),
    [currentSource, currentReference, exercise.direction, mode],
  )
  const multiSection = sourceSections.length > 1
  const currentSection = sourceSections[sectionIndex] ?? sourceSections[0]
  const currentAnswer = drafts[sectionIndex] ?? ''
  /** 这一页逐段配好的原文/译文对（「对照」用它；没有参考译文时是空的） */
  const currentPairs = currentSection?.pairs ?? []

  /*
   * 这一页在"逐页批改"里的四档。按钮文案与翻页提示全由它推出来，
   * 不再由"全篇写完了没有"决定——"一整篇非写完不可"这条约束已随逐页批改取消。
   *
   * 判据（顺序有意义）：
   *   1. **这一页正在批** → `judging`：只读 + 进度条。它排在最前面，
   *      因为"交出去了"是当下最硬的事实：哪怕这一页之前批过、现在又被放开重交了一次，
   *      屏幕上也该显示"批改中"而不是旧结果；
   *   2. 被「返回编辑」放开过 → `editing`：可写；
   *   3. 有结果 → `graded`：只读，点「返回编辑」才放开；
   *   4. 其余 → `pending`（还没批过）。
   *
   * ⚠️ 第三版把原来的 `edited` / `modified` 两档合成了 `editing`：
   * 那两档只用来区分"改过没有"，而它们唯一的用处是决定**翻页要不要自动提交**——
   * 用户已经明确取消自动提交（"点击下一页或者上一页，不触发提交批改"），
   * 于是"改过没有"不再改变任何行为，留着只会让状态机看起来比实际复杂。
   */
  const pageState: PageState = judgingThisPage
    ? 'judging'
    : pageUnlocked
      ? 'editing'
      : pageResult
        ? 'graded'
        : 'pending'
  /**
   * 现在是不是在写这一页（而不是在看这一页的批改结果或等结果）。
   * 批过的页要**先按「返回编辑」**才能写——见 pageUnlocked。
   */
  const editing = pageState === 'pending' || pageState === 'editing'
  /*
   * ⚠️ 这里原先还算一份「已批 N 页」给原文标题栏那枚芯片用。
   * 第 7 条把那枚芯片删掉了，因此这个数字不再需要——但**进度本身照旧在用**
   * （见 article-progress.ts：决定"从没批完的那一段继续"与「选择文章」里的「已完成」标记），
   * 所以 `progress` 这个 state 一个字都没动。
   */
  /**
   * 「返回编辑」之后不再有"点回刚才那份批改"的按钮（用户要求去掉）。
   * 回看那一次靠「批改记录」下拉——它读的是**落盘的练习记录**，
   * 因此不必再关心"草稿改没改过"这回事：记录里存着那一次提交时的原文与作答，
   * 批注画的就是那一段文字，永远不会对不上。
   */

  const caseRecords = records.filter((record) => record.exerciseId === exercise.id)

  /**
   * 这一页在练习记录里的全部批改（**最新在前**），供「批改记录」下拉使用。
   *
   * `ordinal` 是"这一页的第几次批改"（1 起），与练习记录页里那个"第几次作答"
   * （按题目数、跨页累加）刻意不同：下拉是"这一页的历史"，用页内序号才不会让人以为漏了几次。
   */
  const gradeHistory: GradeHistoryEntry[] = useMemo(() => {
    const mine = records
      .filter((record) => record.exerciseId === exercise.id && record.sectionIndex === sectionIndex)
      .map((record, index) => ({
        id: record.id,
        ordinal: index + 1,
        createdAt: record.createdAt,
        level: record.level,
        /*
         * ⚠️ 大改档**没有分数**（ADR 0020）：`null` 表示"这一档不打分"，
         * 而不是"分数是 0"——界面据此显示"不打分"，不显示数字。
         */
        score: record.refine ? null : scoreCorrection(record.correction, record.answer, record.direction).total,
        refined: record.refine !== undefined,
      }))
    return mine.reverse()
  }, [records, exercise.id, sectionIndex])

  /**
   * 这一页正在看哪一次批改（第 10 条）。
   *
   * 它现在**按「题 + 页」存在浏览器里**（见 page-state.ts）：翻到别的页再翻回来，
   * 看到的仍是那一次——不再是"每次翻回来都回到最新一次"。
   * 早先它是一个单数 state，翻页时被清成 null（那正是本条要修的问题）。
   */
  const viewingGradeId = readPageState(pageStates, exercise.id, sectionIndex)?.viewingGradeId ?? null

  /**
   * 下拉里选中的那一条记录；没选、或者它已经不属于"当前这道题 + 当前这一页"时是 null。
   *
   * 过滤这两条不是可选的：这条 id 跨切栏、跨刷新都留着，因此它随时可能指向别人家的记录
   * （换了题目、记录被上限裁掉、被手动删掉）。按题号与页号滤一遍，
   * 它就只可能是"这一页的某一次批改"，留着一个对不上的 id 也显示不出错东西——
   * 用户要的"没得选了就退回最新一次"也就自动成立了。
   */
  const viewingGrade = useMemo(
    () =>
      viewingGradeId
        ? (records.find(
            (record) =>
              record.id === viewingGradeId &&
              record.exerciseId === exercise.id &&
              record.sectionIndex === sectionIndex,
          ) ?? null)
        : null,
    [records, viewingGradeId, exercise.id, sectionIndex],
  )

  /**
   * 记下"某一页正在看第几次"。
   *
   * ⚠️ 收的是**目标页**的题号与页号，不是当前这一页：批改要十几秒，
   * 回来那一刻人可能已经翻到别的页上了，`commit` 必须能把"看最新这一次"
   * 记到**它自己那一页**头上（见 commit 的注释）。
   */
  function setViewingGrade(targetExerciseId: string, targetSectionIndex: number, id: string | null): void {
    setPageStates((previous) =>
      writePageState(previous, targetExerciseId, targetSectionIndex, { viewingGradeId: id }),
    )
  }

  /**
   * 把**当前这一页**的草稿与"在编辑"落到浏览器里（第 10 条）。
   *
   * 写在渲染之后（effect）而不是每个输入框的 onChange 里：能写字的入口只有两处，
   * 但**草稿的来源有三处**（用户打字、返回编辑、刷新后接回来），逐个入口补记漏一个就前功尽弃
   * （`lastInTabRef` 上已经踩过一次这个坑）。内容没变时 `writePageState` 一个字都不写，
   * 因此每敲一个字跑一次并不贵。
   */
  useEffect(() => {
    setPageStates((previous) =>
      writePageState(previous, exercise.id, sectionIndex, { draft: currentAnswer, unlocked: pageUnlocked }),
    )
  }, [exercise.id, sectionIndex, currentAnswer, pageUnlocked])

  /**
   * 每篇文章的**最高分**（第 12 条：选文章的卡片上显示"最高分 N 分"，没得分就写 0 分）。
   *
   * 三条口径，都是被现实逼出来的：
   *   1. 分数**不是存下来的**——精修档每次都是按错误列表现算（见 domain/scoring.ts），
   *      因此只能在这里算一遍；
   *   2. **只算精修**：大改档不打分（用户拍板"分数打分只有精修部分有"），
   *      于是两种分数不再有"含义不同却混在一起比大小"的问题；
   *   3. 按**题号**取最大值：一篇文章有好几页，卡片刻度是"这一篇练到过的最好水平"。
   */
  const maxScoreByArticle = useMemo(() => {
    const best: Record<string, number> = {}
    for (const record of records) {
      if (record.refine) continue
      const total = scoreCorrection(record.correction, record.answer, record.direction).total
      const seen = best[record.exerciseId]
      if (seen === undefined || total > seen) best[record.exerciseId] = total
    }
    return best
  }, [records])

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
  /**
   * 切到某一道题；`atSection` 有值时**同时**落到那一页。
   *
   * 为什么要有第二个参数：术语栏的「确定」按用户拍板"一律落到第 1 页"，
   * 而落点是"会话里已经有的页号优先"（见上面的 resumeIndex）——光 setExerciseId 是弹不回的。
   * 这一条 `sectionChanged` 是**按新题号**下发的（reducer 按 `action.exerciseId` 找会话），
   * 因此新题的会话一建起来就停在那一页；若先 selectExercise 再 setSection(0)，
   * 那一下会打在**旧题**头上（setState 还没生效），等于白点。
   */
  function selectExercise(id: string, atSection?: number): void {
    setExerciseId(id)
    if (atSection !== undefined) {
      dispatchSession({ type: 'sectionChanged', exerciseId: id, sectionIndex: Math.max(0, atSection) })
    }
    clearTransientUi()
  }

  /** 这些是"一次性"的界面状态，切题目/换原文时一律清掉（per-exercise 的数据不在此列）。 */
  function clearTransientUi(): void {
    setSelection(null)
    setOpenRecord(null)
    setError(null)
    setNotice(null)
    /*
     * ⚠️ `viewingGradeId` 现在**按「题 + 页」落在浏览器里**（第 10 条，见 page-state.ts），
     * 因此这里一个字都不用动它。
     *
     * 这条记忆属于**那一页**，不属于"此刻这一屏"：早先它是个全局单数 state，
     * 切题/切栏就把它抹掉，用户从批改结果切去术语栏再切回来，屏幕上退回了作答框，
     * 看着就像批改结果被清空了——那正是他报上来的现象。
     * 现在它只会在三处失效：
     *   - 用户自己点了「回到作答」（清这一页的）；
     *   - 换原文（那道题全部页的状态一起丢掉，见 rotateSource）；
     *   - 解析不出来时自然落空（换了题目、记录被删掉或裁掉），
     *     解析那一处按"当前题目 + 当前页"过滤，所以留着一个对不上的 id 也不会显示错东西。
     */
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
    // 落盘的草稿与"看第几次"也要一起清：原文换了，那些字对应的已经不是这一篇了
    setPageStates((previous) => dropPageStates(previous, exercise.id))
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
    // 与「换一换」同一条道理：原文换了，落盘的草稿与"看第几次"都要一起清
    setPageStates((previous) => dropPageStates(previous, exercise.id))
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
    // 从账号页面切回练习栏：留言板/个人中心/管理都不是练习位置，切走就关掉
    setPanel(null)
    /*
     * 换栏也算"离开这一页"：按过「返回编辑」但一个字没改就去了别的栏，
     * 回来时该看到那份批改（与翻页同一条判据，见 session.ts 的 pageLeft）。
     * 点的是当前这一栏就不算离开（不然"点一下当前栏"会把你刚放开的编辑状态收掉）。
     */
    if (nextTab !== tab) dispatchSession({ type: 'pageLeft', exerciseId: exercise.id })
    setTab(nextTab)
    setOpenRecord(null)
    /*
     * ⚠️ 这里**不能**再清 `viewingGradeId`。
     *
     * 用户报过："批改界面下，切换导航栏后，回到文章模式时，不要恢复到批改前的空白状态，
     * 而是保留记忆，相当于切换之后切换回来，看到的东西不变。"
     * 早先这一行写着 setViewingGradeId(null)，理由是"历史视图是练习页的临时看法"——
     * 但那一行把"我正在看第 2 页的第 3 次批改"这条记忆也一起抹了：
     * 切走时屏幕上是那一次的结果，切回来变成作答框，看起来就像批改结果没了。
     *
     * 现在它归 `selectExercise` 的 clearTransientUi 管——**换题**才清（那一条记录属于上一道题），
     * 而切栏若落在同一道题上（文章栏切术语栏再切回来走的就是这条路）就一个字都不动。
     */
    if (nextTab === 'records') return
    if (nextTab === 'favorites') return
    if (nextTab === 'custom') {
      /*
       * 第 13 轮起**不再弹窗问原文**（用户要求："一进去不弹出窗口要求输入，
       * 而是将原文也变成输入栏"）：直接拿到那一篇（没写过就铸一个空白题号），
       * 用户在原文栏里边写边看，方向与题型由程序现判。
       */
      const mine = custom ?? openCustom()
      if (!custom) setCustom(mine)
      if (mine.id !== exerciseId) selectExercise(mine.id)
      return
    }
    /*
     * 术语栏与句子栏都由数据表供题（术语范围 / 文章库切句）。
     * **离开时是哪一道，回来还是它**；记着的题号解析不出来（换代了）就落回默认那一道。
     */
    const remembered = lastInTabRef.current[nextTab]
    if (nextTab === 'term') {
      const rememberedTerm = remembered?.origin === 'term' && parseTermExerciseId(remembered.id)
      /*
       * 没有记着"上次看的是哪个范围"时，落**没练完**的那个（与启动落点同一条规矩）。
       * 人自己点这一栏时不管进度——那是明确的动作，硬把他送到另一个范围才是怪事。
       */
      const id = rememberedTerm
        ? remembered.id
        : unfinishedTermExercise(progress, termDirection, exerciseId.startsWith('term-v3-') ? exerciseId : undefined)
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

  /**
   * 自定义栏的原文被改了（第 13 轮：原文就是一个输入框，不再有"贴一篇"的弹窗）。
   *
   * ## 为什么练过之后再改原文要**换一个题号**
   *
   * 练习记录与收藏都**不存题干**，只存题号——原文要靠题号回查（`customSources()`）。
   * 因此同一题号下把原文改掉，那些旧记录会**跟着换口**：它们显示的会是新原文，
   * 而当时考的明明是另一篇。对策就是这条：这一篇只要**已经练过**（有记录），
   * 改原文就当成一篇新题、铸一个新题号，旧记录仍指向当时那一篇。
   * 之后的每一次敲键都落在新题号上（它还没有记录），所以不会一个字换一个题号。
   *
   * 还没练过的一篇则一律就地改：正在写的草稿、页号、页状态都跟着题号走，
   * 换题号等于把它们丢掉。
   */
  function updateCustomSource(text: string): void {
    if (!custom) return
    const practiced = records.some((item) => item.exerciseId === custom.id)
    if (practiced) {
      const fresh = saveCustomSource(newCustom(), text)
      setCustom(fresh)
      selectExercise(fresh.id)
      return
    }
    setCustom(saveCustomSource(custom, text))
    setError(null)
    setNotice(null)
  }

  /**
   * 术语栏的两个控件：切「范围」（板块 + 分组）与切「方向」都只是**换一道题**
   * （题号 = `term-v3-<范围>-<方向>`），作答、记录、进度各按题号分开存。
   *
   * ⚠️ 第 14 条：**分组不进题号**（理由见 term-scopes.ts 的文件头——进题号就是换代，
   * 而用户手里那些 `term-v3-…` 记录会因此失去内容）。因此「确定」做的是两件事：
   * 换到那个板块，并**落到这一组的第一页**。点「确定」落在这一组第一页而不是"第一个没批过的页"，
   * 是有意的：用户刚点名要练这一组，把他送到别处才是怪事
   * （这条与旧版"切范围一律落到第 1 页"是同一条路，只是页号由组算出来）。
   */
  function pickTermGroup(scope: TermScope, group: TermGroup): void {
    selectExercise(termExerciseId(scope, termDirection), group.firstPage)
  }

  function pickTermDirection(direction: Direction): void {
    const id = termExerciseId(termScope, direction)
    if (id !== exerciseId) selectExercise(id)
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

  /**
   * 直接切到某一页。**翻页只是翻页**——不提交、不拦、什么都不问。
   *
   * 用户要求的原话：「点击下一页或者上一页，不触发提交批改，而是保留当前页面输入缓存，
   * 后面返回时可以继续作答」。草稿本来就按页存在 drafts 里（键就是页号），
   * 因此"保留缓存"这件事不需要额外做什么，**不做**自动提交就够了
   * （第三版之前这里由一个 async 的 goToSection 负责，它会先把没批过的页交出去）。
   */
  function setSection(nextIndex: number): void {
    /*
     * ⚠️ 这里**不再清**"正在看第几次"（第 10 条）。
     *
     * 它现在按「题 + 页」各记各的（见 page-state.ts），因此翻页时一个字都不用动：
     * 翻回来看到的仍是那一次。早先这一行写着 `setViewingGradeId(null)`，
     * 理由是"历史是这一页的"——可清掉的是**同一页**的记忆，于是每次翻回来都退回最新一次，
     * 那正是用户报上来的现象。
     */
    /*
     * 人自己翻到刚批完的那一页时，右下角那条通知就该消失——
     * 已经站在这一页上了还挂着"点这里去看"，是句废话。
     * 判断按"题号 + 页号"：通知可能属于另一篇（用户交了就走、去练别的了），那种不该被误撤。
     */
    setJudgeDone((previous) =>
      previous && previous.exerciseId === exercise.id && previous.sectionIndex === nextIndex ? null : previous,
    )
    dispatchSession({ type: 'sectionChanged', exerciseId: exercise.id, sectionIndex: nextIndex })
  }

  /**
   * 写术语题的**第几行**。
   *
   * 存储是"一页一段文字"（一行一条），因此这里把这一页的各条重新拼起来整段写回去——
   * 而不是往 `drafts[行号]` 里塞。⚠️ 早先正是塞进 `drafts[行号]`：`drafts` 是按**页号**
   * 索引的，两者撞在一起，于是落盘的那段文字被当成"第 1 行"读回来，
   * 各条译文全挤进第一个框（用户报的就是这个）。现在只有一个坑（第几页），行是现拆的。
   */
  function updateTermRow(row: number, value: string): void {
    const next = [...termAnswers]
    next[row] = sanitizeTermRow(value)
    updateAnswer(termAnswerText(next))
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
   *
   * ## `persist`：这一次判分要不要**留下练习记录**（第 14 条第 4 条）
   *
   * 用户的口径：术语题**没答完也能提交**，但**只有十条全部答完才产生练习记录**。
   * 也就是"提交与批改照做（该判分判分、该显示结果显示），**只有写练习记录这一步**
   * 按是否全答完决定"——因此拦住人的不是提交按钮，而是这里的 `setRecords`。
   *
   * ⚠️ **进度照记**（用户拍板，别改回去）：「哪几页批过」与"留不留练习记录"是两件事。
   * 这一页确实批过了、结果也正显示在屏幕上，界面就该把它标成已批改——
   * 不记的话用户会以为这次没交上，进条与"从没批完的那一页继续"也会指着同一页反复问。
   * 没答完只该影响**练习记录**（复盘用的那份存档），因此 `setProgress` **不在** `persist` 里。
   *
   * 为什么做成**显式参数**而不是在这里自己判"是不是术语题、答完没有"：这条口径的判据
   * 是一份纯函数（`termPageComplete`），调用方（`submitTerms`）手里正好有那一页的答案，
   * 而这里连"这是不是术语题"都不该知道——`commit` 是**所有题型共用**的收尾函数。
   * 缺省 `true`（文章题、句子题、内置示例走的都是原来的路，一个字都没变）。
   */
  function commit(
    target: { exerciseId: string; sectionIndex: number; topic: string; direction: Direction },
    judging_: JudgeDraft,
    pageAnswer: string,
    attemptLevel: PolishLevel,
    options?: { persist?: boolean },
  ): void {
    const persist = options?.persist ?? true
    /*
     * 这一次批改在练习记录里的 id **先算出来**（不再等到写记录那一刻）：
     * 会话里也要存同一个 id（见 PageResult.recordId），否则用户把这条记录删掉时，
     * 界面判断不出"屏幕上摆着的就是被删掉的那一份"。
     * 编号规则与下面那段注释一致：时间戳 + 该题已存记录里的最大次序号加一。
     */
    const attempts = records
      .filter((item) => item.exerciseId === target.exerciseId)
      .map((item) => item.attempt)
    const nextAttempt = (attempts.length > 0 ? Math.max(...attempts) : 0) + 1
    const now = new Date()
    const recordId = `record-${now.getTime()}-${nextAttempt}`

    dispatchSession({
      type: 'pageGraded',
      exerciseId: target.exerciseId,
      sectionIndex: target.sectionIndex,
      draft: judging_,
      answer: pageAnswer,
      recordId,
    })
    /*
     * 落一份"这一页批完了"到浏览器里（见 article-progress.ts）。
     * 会话状态刷新就没，而"下次打开从没批完的那一段继续""练完的不主动显示"
     * 都要求这件事记得住，因此提交成功就往这里记一笔。
     * ⚠️ **没答完的那一次也记**（用户拍板）：这一页确实批过了／结果也显示着，
     * 进度就该认它；"没答完"只影响下面的练习记录（见上面 `persist` 的说明）。
     */
    setProgress((previous) => markGraded(previous, target.exerciseId, target.sectionIndex))
    /*
     * 提交成功就把这一页重新收回只读（`pageLocked`）。
     *
     * 不这么做的话，「返回编辑」过的那一页就永远回不到"已批改"这一档：
     * 用户改完、按了「提交批改（手动）」，界面却仍旧停在作答框上、左边还写着"已修改 · 待提交"，
     * 而新结果明明已经存下来了。收回之后显示的就是刚批出来的那一份；想接着改再按「返回编辑」。
     * 没答完的那一次同样收回只读：屏幕上摆的是"这一页的判分结果"，
     * 想继续补写就按「返回编辑」（与批过一页再改是同一条路）。
     */
    dispatchSession({ type: 'pageLocked', exerciseId: target.exerciseId, sectionIndex: target.sectionIndex })
    setSelection(null)
    setOpenRecord(null)
    // 刚交完，画面就该显示这一次的结果；不再停在历史视图上（记在**它自己那一页**头上）
    setViewingGrade(target.exerciseId, target.sectionIndex, null)
    /*
     * 到这里只剩**练习记录**这一件事了。没答完的那一次到此为止：
     * 屏幕上摆着判分结果、进条也认了这一页，只是**不留存档**
     * （用户拍板的口径："没答完也能交，但只有十条全答完才产生练习记录"）。
     */
    if (!persist) return
    setRecords((previous) => {
      /*
       * 编号与"第几次"都不能用 previous.length 推：
       *   1. 记录会被上限裁剪（旧的先丢），长度不再等于历史次数 → 编号会重复、
       *      而 key 重复会让 React 复用错节点；
       *   2. "第几次作答"更不能用"现有条数 + 1"，否则丢过旧记录之后次数会倒退。
       * 因此改成时间戳编号 + 按该题已存记录里的最大次序号加一。
       */
      const next: RecordView[] = [
        ...previous,
        {
          id: recordId,
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
          // 大改档那一次也照实存下来：练习记录要能回看"当时怎么改的"
          ...(judging_.refine ? { refine: judging_.refine } : null),
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
   * 删掉一条批改记录（第 11 条）。
   *
   * 用户的原话："允许在批改记录的下拉栏中点击叉号删除记录，练习记录同步删除。"
   * 追问"连带怎么算"时他选了：**撤掉进度 + 当前视图退回最新一次 + 点叉号确认一次**；
   * 后来又补一句"练习记录页也加删除按钮"。两处入口因此走的是同一个函数（这一处）。
   *
   * 五件事按顺序做，一件都不能省：
   *   1. **删数据**——练习记录与「批改记录」下拉读的是同一份，删一处就是两处都消失；
   *   2. **正在看的那一条被删了** → 把"看第几次"清掉，界面自然退回最新一次
   *      （`viewingGrade` 按题号+页号滤，对不上的 id 显示不出错东西）；
   *   3. **屏幕上正摆着的就是这一份结果** → 换成剩下最新的那一条；
   *      一条都不剩就退回作答框（用户第一轮的原话："没有就回到作答"）；
   *   4. **这一页一条记录都不剩了** → 从"哪几页批过"里撤掉（第一轮拍板：删记录撤进度；
   *      这条与「返回编辑」不同——那个是"放开重写"，用户选了进度只增不减）；
   *   5. **记录页正打开着这一条** → 把详情关掉，不让人对着一条已经不存在的记录看。
   */
  function deleteRecord(record: RecordView): void {
    const remaining = records.filter(
      (item) =>
        item.id !== record.id &&
        item.exerciseId === record.exerciseId &&
        item.sectionIndex === record.sectionIndex,
    )
    setRecords((previous) => removeRecord(previous, record.id))

    if (readPageState(pageStates, record.exerciseId, record.sectionIndex)?.viewingGradeId === record.id) {
      setViewingGrade(record.exerciseId, record.sectionIndex, null)
    }

    const shown = sessions.byExercise[record.exerciseId]?.pages[record.sectionIndex]
    if (shown?.recordId === record.id) {
      const newest = remaining.reduce<RecordView | null>(
        (best, item) => (!best || item.createdAt.getTime() > best.createdAt.getTime() ? item : best),
        null,
      )
      if (newest) {
        dispatchSession({
          type: 'pageGraded',
          exerciseId: record.exerciseId,
          sectionIndex: record.sectionIndex,
          draft: judgeDraftOf(newest),
          answer: newest.answer,
          recordId: newest.id,
        })
      } else {
        dispatchSession({
          type: 'pageResultDropped',
          exerciseId: record.exerciseId,
          sectionIndex: record.sectionIndex,
        })
      }
    }

    if (remaining.length === 0) {
      setProgress((previous) => clearGraded(previous, record.exerciseId, record.sectionIndex))
    }
    if (openRecord?.id === record.id) setOpenRecord(null)
    // 删掉的记录不再拦"重复提交"（历史里已经没有它了，见 submit-gate.ts）
    setNotice(`已删掉那一次批改记录（练习记录里同步消失）${remaining.length === 0 ? '，这一页不再算"批过"' : ''}。`)
    setSelection(null)
  }

  /**
   * 提交**某一页**去批改。
   *
   * ⚠️ 第三版起它**只由用户按「提交批改」调到**：翻页不再自动提交（见 goToSection），
   * 因此这里不再需要"切页之前先把旧页交出去"那套时序，`sectionIndex` 就是当前这一页。
   * 仍然显式收一个页号而不是读 `sectionIndex`，是因为 `await` 之后的所有落账
   * 都必须靠发起前钉下来的 `target`（见 commit 的注释）——页号是那份账的一部分。
   *
   * 返回是否批成了。调用方（`onSubmit`）不看它，留着是因为"批没批成"这个事实
   * 对失败路径（错误提示、不进通知）有用，而且省得调用方去猜。
   */
  async function submitPage(sectionIndex: number): Promise<boolean> {
    /*
     * **一次只批一页**（用户要求：批改过程中不能提交）。
     *
     * 守卫认的是全局那一个 `judgingTarget`，不是"这一页在不在批"：
     * 批改期间允许翻页，所以这条请求完全可能是在第 3 页上发起、跑到第 4 页才回来；
     * 只看当前页的话，人在第 4 页就能再点一次，两次批改叠着跑。
     */
    if (judging) return false
    const pageAnswer = drafts[sectionIndex] ?? ''
    if (pageAnswer.trim().length === 0) return false

    /*
     * **提交前两道门**（第 3 条，判据写在 domain/submit-gate.ts）：
     * 篇幅要够（文章题/段落题至少 31 个单位，中文数汉字、英文数词），
     * 而且不能与这一段**之前任意一次**提交一字不差。
     *
     * 拦下来时**什么都不做**：不标记 judging、不弹等待窗、不发请求——
     * 只把原因用吐司说清楚（"还差多少"或"与哪一次重复"），
     * 用户改完还能直接再按一次。
     */
    /*
     * **登录门**（用户要求）：没登录就"提交失败"——不标记批改中、不发请求、不弹等待窗，
     * 只把登录/注册窗口打开，并写清为什么。
     *
     * 为什么放在篇幅与去重那两道门**之后**：那两道管的是"你写的这段本身行不行"，
     * 是用户当场就能改的事；而"还得先登录"要等他改完再面对。先报篇幅问题，少一次白弹窗。
     *
     * 服务端并不依赖这一条：`/api/judge` 前面有 `requireSession`（见 src/server/guard.ts），
     * 这里只是提前拦住，不让他白等一次失败。
     */
    if (!auth.user) {
      openAuth('提交批改需要先登录或注册。登录之后这段译文才会发去批改——密码不会明文离开这台设备。')
      return false
    }

    const verdict = checkSubmit({
      mode: exercise.mode,
      direction: exercise.direction,
      answer: pageAnswer,
      previousAnswers: records
        .filter((record) => record.exerciseId === exercise.id && record.sectionIndex === sectionIndex)
        .map((record) => record.answer),
    })
    if (!verdict.ok) {
      showToast(verdict.message)
      return false
    }

    // 发起之前先把"这一次批的是谁"钉下来（见 commit 的注释）
    const target = {
      exerciseId: exercise.id,
      sectionIndex,
      topic: exercise.topic,
      direction: exercise.direction,
    }
    setJudgingTarget({ exerciseId: target.exerciseId, sectionIndex: target.sectionIndex })
    setError(null)
    setNotice(null)
    /*
     * 等待提示：只在**后面还有一页**时弹（用户要求：批改大约需要一分钟，可进入下一页）。
     * 最后一页与单页题没有"下一页"可去，弹一个只有一个按钮的窗只是打扰。
     */
    if (multiSection && sectionIndex < sourceSections.length - 1) setWaitingPrompt(true)

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
    const request = {
      source: sourceForJudge,
      direction: exercise.direction,
      genre: exercise.genre,
      level,
      sourceSections: [sourceSectionOf(sectionIndex)],
      answerSections,
    }

    /*
     * 大改档走**另一条链路**：产物是"整篇逐句重写 + 逐句解释 + AI 总评"，
     * 不是逐处批注（见 domain/refine.ts）。请求形状完全一样，只是打到 /api/refine 上，
     * 因此逐页批改、分段校验、失败分类这些下游代码一行都不用改。
     */
    if (level === 'refine') {
      const refined = await requestRefine(request)
      clearJudging(target)
      if (!refined.ok) {
        setError({ kind: refined.kind, message: refined.message })
        return false
      }
      if (refined.attempts > 1) setNotice('AI 有几次返回没通过校验，已自动重试并修正。')
      commit(
        target,
        {
          // 大改不逐处批改：correction 是空壳，真正的内容在 refine 里
          correction: { errors: [], highlights: [] },
          validated: { errors: [], highlights: [], rejections: [] },
          refine: refined.refine,
          level,
          source: 'live',
          sectionCount: 1,
          raw: refined.raw,
        },
        pageAnswer,
        level,
      )
      announceGraded(target)
      return true
    }

    const outcome = await requestJudgment(request)

    clearJudging(target)

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
    announceGraded(target)
    return true
  }

  /**
   * 这一次批改跑完了（成功）：把"正在批"这件事收回来。
   *
   * ⚠️ 必须**按目标比对**再清，不能无条件 `setJudgingTarget(null)`：
   * 虽然同时只允许一页在批，但"清"这个动作在语义上属于**那一次提交**——
   * 写死成"清空当前值"，以后一旦放开并发（或加了重试），
   * 第二次提交的结果回来会把第一次的标记也顺手抹掉。
   */
  function clearJudging(target: { exerciseId: string; sectionIndex: number }): void {
    setJudgingTarget((previous) =>
      previous && previous.exerciseId === target.exerciseId && previous.sectionIndex === target.sectionIndex
        ? null
        : previous,
    )
  }

  /**
   * 批完了在右下角喊一声（用户要求：「当批改结果出来时，右下角弹出信息通知
   * 『第x页已经批改完成』，用户可以点击该通知直接路由到那个页面」）。
   *
   * 只在**多页题**上喊：单页题的结果当场就出现在同一屏上，没什么可"路由"的。
   * 通知里带着题号与题型（见 JudgeDoneNotice）——批改期间用户可能已经翻页、换题、切栏，
   * 不把这些一起记上，点通知就跳不回那一页。
   */
  function announceGraded(target: { exerciseId: string; sectionIndex: number }): void {
    if (!multiSection) return
    setJudgeDone({ exerciseId: target.exerciseId, mode, sectionIndex: target.sectionIndex })
  }

  /**
   * 点右下角那条通知：回到批完的那一页看结果。
   *
   * 三件事都要做，缺一件就落不到正确的位置上：
   *   1. 切栏（用户可能已经去了术语栏，而文章题在「文章」栏里）；
   *   2. 换题（他可能已经翻到别的文章上接着练了）；
   *   3. 翻到那一页。
   * 顺序也有讲究：`selectExercise` 会把一次性的界面状态清掉（含"正在看的历史"），
   * 因此页号必须在它之后写——先写页号会被后一步的清空连带影响（session 里的页号不清，
   * 但"看哪一次历史"会清，这里要的就是"看刚批出来的这一份"，正好一致）。
   */
  function openJudgeDone(): void {
    const done = judgeDone
    if (!done) return
    setTab(done.mode)
    selectExercise(done.exerciseId)
    dispatchSession({ type: 'sectionChanged', exerciseId: done.exerciseId, sectionIndex: done.sectionIndex })
    setJudgeDone(null)
  }

  /**
   * 翻到另一页。**只翻页**，不提交任何东西。
   *
   * ⚠️ 这条函数在第三版被**砍掉了绝大部分**，砍掉的那部分就是原来的自动提交：
   * 早先的规矩是"离开一页时，刚写完、还没批过的那一页自动交出去批"，理由是
   * "逐页批改就该一页一页往下推"。用户改主意了，原话：
   * 「点击下一页或者上一页，不触发提交批改，而是保留当前页面输入缓存，后面返回时可以继续作答」——
   * 于是现在**提交只能由一个动作触发**：用户自己按「提交批改」。
   *
   * 少掉的不只是几行代码，还有一整类难解释的情形：
   *   - "我翻页它为什么自己扣了一次钱"；
   *   - 批改十几秒里界面该锁成什么样；
   *   - 自动提交失败时"留在原地还是照翻"。
   * 现在这些都不存在了：批改在后台跑，页面随便翻（见 judgingTarget）。
   *
   * 保留的这一层只管两件事：页号在范围内、以及**真的换了页**（点同一页不做任何事，
   * 免得把"正在看的历史"这类一次性的界面状态白白清掉）。
   */
  function goToSection(nextIndex: number): void {
    if (nextIndex === sectionIndex) return
    if (nextIndex < 0 || nextIndex >= sourceSections.length) return
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
    const checked = validateCorrection(fixture.errors, fixture.highlights, currentAnswer, exercise.direction)
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
  const shown = viewingGrade
    ? {
        /* 正在看下拉里选中的那一次：显示的**不是**当前这一页的结果，而是那一次存档 */
        correction: viewingGrade.correction,
        validated: viewingGrade.validated,
        answer: viewingGrade.answer,
        level: viewingGrade.level,
        attempt: viewingGrade.attempt,
        sectionCount: 1,
        source: viewingGrade.source,
        raw: viewingGrade.raw,
        direction: viewingGrade.direction,
        ...(viewingGrade.refine ? { refine: viewingGrade.refine } : null),
      }
    : openRecord
      ? {
          correction: openRecord.correction,
          validated: openRecord.validated,
          answer: openRecord.answer,
          level: openRecord.level,
          attempt: openRecord.attempt,
          sectionCount: 1,
          source: openRecord.source,
          raw: openRecord.raw,
          direction: openRecord.direction,
          // 记录里若是大改档的那一次，回看时同样只能看对照
          ...(openRecord.refine ? { refine: openRecord.refine } : null),
        }
      : pageResult && pageState === 'graded'
        ? {
            correction: pageResult.draft.correction,
            validated: pageResult.draft.validated,
            answer: pageResult.answer,
            level: pageResult.draft.level,
            attempt: caseRecords.length,
            sectionCount: pageResult.draft.sectionCount,
            source: pageResult.draft.source,
            raw: pageResult.draft.raw,
            direction: exercise.direction,
            // 大改档：有它界面就走"只给对照"那条路径（见 AnswerPane 的 refine 分支）
            ...(pageResult.draft.refine ? { refine: pageResult.draft.refine } : null),
          }
        : null

  /**
   * 当前选中的那一处在**原文**里对应的位置与颜色（用户要求：点译文上某一处，
   * 左边原文栏里对应的那一处也标成同色；收起小卡片，标记就消失）。
   *
   * 位置来自 AI 给的 `sourceText`——解析时程序按文字把它定位到原文里，落在 `error.sourceAnchor` 上。
   * **AI 给不出就不标**：语法、表达一类问题常常指不出具体原文片段，那是正常情形，不是缺陷。
   * 大改档没有逐处批注，因此这里自然是空的。
   */
  const sourceMark = useMemo(() => {
    if (selection?.kind !== 'error' || !shown) return null
    const entry = shown.validated.errors.find((item) => item.error.id === selection.id)
    const anchor = entry?.error.sourceAnchor
    if (!entry || !anchor) return null
    return { start: anchor.start, end: anchor.end, color: entry.hard ? ('red' as const) : ('orange' as const) }
  }, [selection, shown])

  /**
   * 术语题的逐条判分结果。
   *
   * 由本地算出来，不进 result：术语判分是**纯函数**（对照官方译名），
   * 没有"AI 返回了什么"可存，也不需要重试与失败分类。因此这里按
   * 「这一页有没有已提交的结果」当作"这一页是否已判过"，逐条现算即可——
   * 既省一份状态，也不会出现"存下来的判分与官方译名不一致"。
   */
  /*
   * 这一页的各条答案与"整段作答文字"。
   *
   * 术语题在界面上是十个独立的框，但**下游一律按一段文字办事**——
   * 练习记录存 answer、收藏要"这一处所在的那一行"、对照视图要逐行对照。
   * 因此这里算一次、两处共用（判分与提交都用它），免得两处的拼法悄悄不一致。
   *
   * ⚠️ 两个方向都要经这里：**读**是把这一页的草稿按行拆开（`splitTermAnswers`），
   * **写**是拼回一整段（`updateTermRow`）。存储里只有"第几页"一个坑。
   */
  const termAnswers = useMemo(
    () => splitTermAnswers(drafts[sectionIndex] ?? '', activeTerms.length),
    [drafts, sectionIndex, activeTerms.length],
  )
  const termAnswer = useMemo(() => termAnswerText(termAnswers), [termAnswers])
  /**
   * 这一页的术语**是不是都写上了**。
   *
   * ⚠️ 它**不再**决定"能不能提交"（第 14 条第 4 条把那条门槛去掉了），只决定
   * "这一次判分**要不要留练习记录**"（见 `commit` 的 `persist`）。
   * 注意它**不管**进度——批过的页照旧进进度，那是用户后来拍板的一条（别合并这两件事）。
   * 末页不满十条时只数真实存在的那几条（缺的行既不可填也不计分）。
   */
  const allTermsAnswered = termPageComplete(activeTerms.length, termAnswers)

  const termVerdicts = useMemo(() => {
    if (!isTermExercise) return null
    if (!pageResult) return null
    return judgeTerms(activeTerms, termAnswers, termDirection)
  }, [isTermExercise, pageResult, activeTerms, termAnswers, termDirection])
  /**
   * 术语栏"屏幕上是这一页的判分结果吗"。
   *
   * 判据与文章模式**同一条**：直接用 `shown`（它已经把"正在编辑"那一档排除掉了，
   * 见上面 shown 的三条分支）。不能用 `termVerdicts !== null`——按过「返回编辑」但一个字
   * 还没改时，结果**还在** `pages` 里（那是有意的：改回去看、一个字没动就翻页，
   * 回来仍是批改界面），只看 verdicts 会把这一页重新画成结果、把输入框锁住。
   */
  const termShowingResult = isTermExercise && shown !== null

  /**
   * 术语题提交：**本地判分，不调 AI**。
   *
   * 术语有唯一正确译法（官方固定表述），交给模型判会有两个坏处：
   * 同一份答案两次可能不同、用户无法自己核对分数怎么来的。
   * 因此这里直接对照 domain/terms.ts 里的标准译法判，结果映射成
   * Correction + ValidatedCorrection 的形状，好让练习记录、收藏、对照视图原样复用。
   *
   * ## 没答完也能交，但**只有全答完才落库**（第 14 条第 4 条）
   *
   * 用户的口径："某一页 10 个里没答完也能提交（现在应该是不允许的）。但**只有 10 个全部答完
   * 才产生练习记录**——提交与批改照做（该判分判分、该显示结果显示），**落库那一步**
   * 按'是否全答完'决定"。追问里他还补了一句"**不要用『提交被拦下』来实现**"，因此：
   *   - 提交这一侧：按钮不再因为"没写满"而禁用（只在一页正在判的那一拍禁用），
   *     点下去照常判分、照常把结果显示出来；
   *   - 落库那一侧：`commit(..., { persist: allTermsAnswered })`——不满十条就**不写练习记录**。
   *     ⚠️ 只扣练习记录：进度照记（用户后来拍板），别顺手把它也扣掉（见 `commit` 的说明）。
   * 判据只有一份（`termPageComplete`），写在这里、由 commit 执行。
   */
  function submitTerms(): void {
    if (!isTermExercise) return
    const answers = termAnswers
    const verdicts = judgeTerms(activeTerms, answers, termDirection)
    const { correction, validated } = correctionFromVerdicts(verdicts)
    // 术语题的一页就是这几条，合起来当作被批的那段文字（与练习记录、收藏、对照视图一致）
    const pageAnswer = termAnswer
    /*
     * 术语判分是**纯函数**（对照官方译名），因此它没有"批改中"这一档：
     * 点下去同一拍就出结果，"结果"与"落库"在这里是同一段同步代码里的两件事。
     */
    const complete = allTermsAnswered
    commit(
      { exerciseId: exercise.id, sectionIndex, topic: exercise.topic, direction: exercise.direction },
      {
        correction,
        validated,
        level,
        /*
         * 判分来源标成 `local`（第 13 轮改的，用户拍板）。
         *
         * 早先这里写的是 `fixture`——那是"内置示例批改"的来源，于是顶栏那枚
         * 「内置示例批改」警告在**每次术语批改之后**都冒出来。用户要求删掉那枚警告，
         * 而术语判分本来也不是"示例"：它是程序按官方译名真判的。
         * 给它一个自己的来源之后，警告那枚芯片就只属于真正的离线示例。
         */
        source: 'local',
        sectionCount: 1,
        raw: JSON.stringify(
          verdicts.map((verdict) => ({
            zh: verdict.term.zh,
            yours: verdict.answer,
            standard: verdict.standard,
            correct: verdict.correct,
          })),
          null,
          2,
        ),
      },
      pageAnswer,
      level,
      // 第 14 条第 4 条：落库与否只看"这一页是不是十条都写了"
      { persist: complete },
    )
    /*
     * ⚠️ 术语模式**不再写结果栏那句话**（用户第 16 条点名去掉："这一页 10 条，错 9 条——
     * 官方译名就写在每一条右边。还有 8 条没写：这一次不留练习记录，写满了才有。"）。
     * 两点理由：① 判分结果已经**逐条写在那一行里**了（错的那个词划掉、正确写法写在它上方，
     * 没写的直接用红色补上），再概括一句"错几条、答案在哪"是重复的说明；
     * ② "没写满就不留记录"这条规矩用户在提交前就写着（那颗按钮的悬停提示），
     * 判完再喊一遍属于解释性文字。别的题型照旧用结果栏（它们的判分没有逐条落在那一行里）。
     */
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
   * ⚠️ 术语模式下右下栏整块不画（第 14 条第 6 条），因此那边没有「收藏」入口——
   * 这里照旧算它，是因为这一份值同时也给别处用（练习记录页），而且多算一次不花钱。
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
      {/*
        ⚠️ 顶栏右上角那枚「内置示例批改」**已按用户要求整枚删掉**（第 13 轮）。
        它早先有三个来源会点亮它，其中一个是错的：
          1. 真的按了「查看内置示例批改」——这是警告，该说；
          2. 术语题的本地判分**借用了 `fixture` 这个来源**，于是每次术语批改都冒出来——不该说；
          3. 离线演示——同 1。
        用户看到的就是第 2 种（术语栏每判一次都跳一下）。现在的分工是：
        术语判分有自己的来源 `local`（见 types.ts 的 JudgeSource），顶栏不再挂任何提醒，
        示例批改那句提醒搬进**结果栏**（见 AnswerPane 的那枚「示例批改」芯片）。
        删掉之后右上角最右边的就是「暗夜 · 设置」——`.topbar-right` 本来就是 `margin-left: auto`，
        因此不需要动布局。
      */}
      <TopBar
        tab={tab}
        panel={panel}
        user={auth.user}
        isAdmin={auth.isAdmin}
        onSelectTab={selectTab}
        onSelectPanel={setPanel}
        onOpenAuth={() => openAuth()}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleTheme={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
        theme={theme}
      />

      {/*
        账号那三页（留言板 / 个人中心 / 管理）外面包一层 `.panel-page`：**整页滚动容器**。
        里面那几个 `.board-container` / `.admin-container` / `.auth-card` 是**逐字搬自
        「地图记忆」**的结构与类名（用户要求这一批功能的 UI 完全仿造那个项目），
        它那边这些容器长在侧栏里、自己不需要滚动，因此这边补一层外壳（见 styles.css 的说明）。
      */}
      {panel === 'board' ? (
        <div className="panel-page">
          <BoardView onRequireLogin={() => openAuth('留言板要登录之后才能发帖与回复。')} />
        </div>
      ) : panel === 'profile' ? (
        <div className="panel-page">
          <ProfileView
            recordCount={records.length}
            onRequireLogin={() => openAuth()}
            onOpenAdmin={() => setPanel('admin')}
          />
        </div>
      ) : panel === 'admin' ? (
        <div className="panel-page">
          <AdminView />
        </div>
      ) : tab === 'favorites' ? (
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
          onDelete={deleteRecord}
        />
      ) : (
        <>
          {/*
            领域与方向这两颗控件**不再有自己的一行**（第 7 条）：它们挪进了原文标题栏，
            紧挨着「原文」三个字（见下面 SourcePane 的 `range` 参数与 DomainSelect.tsx）。
            文章栏方向可切；句子栏只给领域——句子题的方向由句子本身决定，不需要人来选。
          */}

          {/*
            版式：**大改档与术语栏各有一套**（第 4 条 / 第 14 条第 6 条）。
            用户对第 4 条的答复是："相当于分成左右两个部分，左边部分再分成上下两个部分，
            左上角为原文，左下角为总评，右边整个为批改界面。"
            实现上只加一个类（`.split-refine`），DOM 一个字都不动——
            样式表里把那两个 `.split-row` 设成 `display: contents`，
            它们里面的三块就直接参与外层网格的排布（见 styles.css 的说明）。
            精修档（批改视图）因此**一行都没改**——用户特意交代过"批改视图不受影响"。

            ⚠️ 第 14 条第 6 条：**术语模式去掉左下与右下那两栏**（总体评分 / 批注详情），
            腾出来的地方并给原文栏与译文栏——因此这里不是"藏起来"而是**整个不画**：
            少画一排的 DOM 与少画两条分隔条，语义上才是"这一模式下只有两栏"，
            也不会给可拖动的分隔条留一个拖不动的空位（`split-term` 那套样式因此只处理两栏）。
            别的题型一个字都不许动：那个 `{!isTermExercise && …}` 就是这条界线。
          */}
          <main
            className={`split${split ? ' split-manual' : ''}${shown?.refine ? ' split-refine' : ''}${
              isTermExercise ? ' split-term' : ''
            }`}
            ref={splitRef}
            style={splitStyle}
          >
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
              pageStateHint={PAGE_STATE_HINT[pageState]}
              nextHint={nextPageHint({ hasAnswer: currentAnswer.trim().length > 0, pageState })}
              currentSection={currentSection}
              currentSource={currentSource}
              currentPairs={currentPairs}
              sourceMark={sourceMark}
              onSectionChange={(next) => void goToSection(next)}
              /*
               * 「领域 × 方向」：文章栏两个都给，句子栏只给领域
               * （见 SourcePane 的 range 说明）。术语栏与"自己贴的题"不给——
               * 它们与领域无关，给一个点了没反应的控件比不给更糟。
               */
              {...(tab === 'article'
                ? {
                    range: {
                      selection: articleSelection,
                      withDirection: true,
                      onChange: (next: ArticleSelection) => {
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
                      },
                    },
                  }
                : null)}
              {...(tab === 'sentence'
                ? {
                    range: {
                      selection: articleSelection,
                      withDirection: false,
                      /*
                       * 句子栏只列**五个话题领域**（ADR 0029）：真题/样题是"卷子的来源"，
                       * 句子题是在文章正文里切句，那两个领域在这边没有对应题目。
                       * 由调用方在这里点名，而不是让控件去猜当前是什么题型——
                       * 一开始我按 `mode === 'sentence'` 猜，实测没命中（句子栏照样列出 7 项），
                       * 是浏览器验收里那条断言抓出来的。
                       */
                      domains: TOPIC_DOMAINS,
                      onChange: (next: ArticleSelection) => {
                        setArticleSelection(next)
                        saveSelection(next)
                        // 换领域后换一道该领域的句子题，免得停在上个领域的那句上让人以为没生效
                        selectExercise(sentenceExerciseId(next.domain, 1))
                      },
                    },
                  }
                : null)}
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
              onRotate={rotateSource}
              onOpenGenerator={openGenerator}
              {...(isTermExercise
                ? {
                    termRange: {
                      scope: termScope,
                      direction: termDirection,
                      // 弹窗里那枚「正在练」认的是**当前这一组**，因此要把页号一起给它
                      page: sectionIndex,
                      onPickGroup: pickTermGroup,
                      onPickDirection: pickTermDirection,
                    },
                    // 「参考译文」开关（第 14 条第 5 条）：只长在术语栏，位置在「原文」右边
                    termReference: { on: termReference, onToggle: () => setTermReference((on) => !on) },
                  }
                : null)}
              {...(isCustom && custom
                ? { editableSource: { value: custom.source, onChange: updateCustomSource } }
                : null)}
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
              术语题走**另一条渲染路径**：一页十条术语、逐条作答、由程序本地对照判分
              （见 term-exercise.ts）。它的批注语言与文章模式**同一套**（荧光底色、划线、
              「→ 官方译名」），但作答是十个框而不是一个整段文本框，
              因此刻意分开渲染，而不是往 AnswerPane 里塞一堆 if。

              ⚠️ 第 13 轮起它与文章模式**处处对齐**（用户要求"像文章模式一样一页一页翻"）：
              同一颗按钮两个名字（批改后写「返回编辑」）、批过的页只读、翻页不提交、
              左侧页脚同一个翻页控件。因此这里显示"输入框还是结果"也由**页状态**决定
              （`pageState`），不再由"这一页有没有结果"决定。
              ⚠️ 第 14 条第 6 条起它**不画**左下与右下那两栏（见那条 `{!isTermExercise && …}`），
              因此这里没有了"点一条看右下角卡片"那一路：判完的官方译名就写在每一条右边。
            */}
            {isTermExercise ? (
              <section className="pane pane-answer">
                <header className="pane-head">
                  <h2>我的译文</h2>
                  <div className="head-meta">
                    {gradeHistory.length > 0 && (
                      <GradeHistoryPicker
                        history={gradeHistory}
                        viewingId={viewingGrade?.id ?? null}
                        onView={(id) => {
                          const record = gradeHistory.find((entry) => entry.id === id)
                          setViewingGrade(exercise.id, sectionIndex, record?.id ?? null)
                          setSelection(null)
                          setNotice(null)
                        }}
                        onDelete={(id) => {
                          const record = records.find((item) => item.id === id)
                          if (record) deleteRecord(record)
                        }}
                      />
                    )}
                    {/*
                      这一页有几条由**这一页**算，不是整个板块：
                      末页只有三条时如实写"3 条"，用户才不会以为界面上丢了几个框。
                      ⚠️ 第 14 条起这一页属于**哪一组**也一起写出来：题号里没有组号
                      （见 term-scopes.ts 的文件头），而用户刚才是"点名选了某一组"才进来的，
                      屏幕上总得有一样东西对上他刚才那一下（不然"我选的第 3 组，现在这是哪儿"）。
                    */}
                    <span className="chip">
                      术语翻译 · {groupOfPage(termScope, sectionIndex)?.label ?? labelOfScope(termScope)} · 第{' '}
                      {sectionIndex + 1} 页 · {activeTerms.length} 条
                    </span>
                    <span className="chip" title="术语题按官方译名由程序本地对照判分，不交给 AI、不用等、不花钱">
                      本地判分
                    </span>
                    {termShowingResult ? (
                      <>
                        {/* 判完之后也能切视图（用户要求：术语提交后，像文章模式一样对比、批注） */}
                        {shown && <AnswerViewSwitch view={settings.answerView} onChange={updateSettings} />}
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            /*
                             * 「返回编辑」：与文章模式**同一颗按钮、同一个动作**。
                             *
                             * 只放开这一页（`pageUnlocked`），**不丢结果、不撤进度**——
                             * 结果什么时候作废由"用户真的改了一个字"决定（见 session.ts 的
                             * answerChanged 与 releasedUnlock）：改回去看、一个字没动就翻页，
                             * 回来看到的仍是那份批改。
                             *
                             * ⚠️ 早先这里是「重新作答」，走的是 `pageResultDropped` +
                             * `clearGraded`——那会**真的把结果丢掉、把进度撤掉**，
                             * 与用户第 13 条的原话（"用户应该点击返回编辑的按钮"）不是一回事，
                             * 也与文章模式两套语义。现在两处合成一套。
                             */
                            setViewingGrade(exercise.id, sectionIndex, null)
                            dispatchSession({ type: 'pageUnlocked', exerciseId: exercise.id })
                            setOpenRecord(null)
                            setSelection(null)
                            setNotice(null)
                          }}
                        >
                          返回编辑
                        </button>
                      </>
                    ) : (
                      /*
                       * ⚠️ 第 14 条第 4 条：**没答完也能提交**，因此这颗按钮**不再**因为
                       * "这一页没写满"而禁用——拦住用户这件事被整个去掉了（用户点名要求），
                       * 取而代之的是"没写满的那一次不落库"（见 submitTerms 与 commit 的说明）。
                       * 现在唯一禁用的场合是"这一页正在判"（术语判分是同步的，这一档其实一闪而过，
                       * 留着是为了与文章模式那颗按钮的形状一致）。
                       */
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={submitTerms}
                        disabled={judgingThisPage}
                        title={
                          allTermsAnswered
                            ? `这一页 ${activeTerms.length} 条都写上了：判完会留下一条练习记录`
                            : `没写满也能提交（还有 ${
                                activeTerms.length - answeredTermCount(termAnswers)
                              } 条空着）；但只有 ${activeTerms.length} 条都答完才会留下练习记录`
                        }
                      >
                        提交批改
                      </button>
                    )}
                  </div>
                </header>
                <div className="pane-body">
                  {notice && <p className="hint notice">{notice}</p>}
                  {termShowingResult && termVerdicts !== null ? (
                    settings.answerView === 'compare' && shown ? (
                      /* 对照视图：一行"你写的"、一行官方译名，与文章模式同一套排版 */
                      <CompareView
                        validated={shown.validated}
                        answer={shown.answer}
                        selection={selection}
                        onSelect={toggleSelection}
                      />
                    ) : (
                      /* 批改视图：一行一条，译错的划掉并给出官方译名 */
                      <TermResults
                        verdicts={termVerdicts}
                        selectedId={selection?.id ?? null}
                        onSelect={toggleSelection}
                      />
                    )
                  ) : (
                    <TermRows
                      terms={activeTerms}
                      answers={termAnswers}
                      /*
                        批过的页只读（与文章模式同一条规矩）：要改先按「返回编辑」——
                        批注是按提交当时那几条算出来的位置，改一个字就全对不上了。
                      */
                      disabled={!editing}
                      onChange={(row, value) => updateTermRow(row, value)}
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
              judgingThisPage={judgingThisPage}
              busyElsewhere={busyElsewhere}
              error={error}
              notice={notice}
              isFixtureAnswer={isFixtureAnswer}
              editing={editing}
              fromHistory={viewingGrade !== null}
              pageState={pageState}
              multiSection={multiSection}
              sectionIndex={sectionIndex}
              currentAnswer={currentAnswer}
              gradeHistory={gradeHistory}
              viewingRecordId={viewingGrade?.id ?? null}
              onSelect={toggleSelection}
              onSettingsChange={updateSettings}
              onUnlock={() => {
                /*
                 * 「返回编辑」：只要屏幕上是结果就按它（第 2／3／4／6 条）——
                 * 既包括"刚批出来的这一页"，也包括"从「批改记录」里翻出来看的那一次"。
                 *
                 * 因此这里要做两件事：
                 *   1. **离开历史视图**（清掉这一页"正在看第几次"）——否则屏幕会一边显示
                 *      那一次的结果、一边让你改字，两者对不上；
                 *   2. 放开这一页（文字还在 drafts 里）。
                 * 用户第 6 条把「回到作答」那颗按钮删了，出口就收在这一颗按钮上。
                 */
                setViewingGrade(exercise.id, sectionIndex, null)
                dispatchSession({ type: 'pageUnlocked', exerciseId: exercise.id })
                /*
                 * ⚠️ 这里**不再**把这一页从"哪几页批过"里撤掉（用户拍板：进度只增不减）。
                 *
                 * 早先这一行会调 clearGraded，理由是"结果作废了，进度里也该撤掉"。
                 * 用户看过之后选了另一条：**批过就算批过**——那条进度还管着
                 * 「选择文章」里的「已完成」标记与"整篇练完的排在最后"，撤掉会让标记闪来闪去。
                 * （删记录那条路不一样：那一次是真的没了，所以照样撤进度，见 deleteRecord。）
                 */
                setOpenRecord(null)
                setSelection(null)
                setNotice(null)
              }}
              onViewAttempt={(id) => {
                /*
                 * 「批改记录」下拉里选了某一次：右栏切成那一次的结果（只读）。
                 *
                 * 显示的是**那一次提交时的原文与作答**（记录里存着），因此批注画在对的文字上——
                 * 这也正是它比旧的「查看上次批改」强的地方：改了字之后照样能回看。
                 * 正在写的草稿一个字都不动。
                 */
                const record = gradeHistory.find((entry) => entry.id === id)
                setViewingGrade(exercise.id, sectionIndex, record?.id ?? null)
                setSelection(null)
                setNotice(null)
              }}
              onDeleteRecord={(id) => {
                const record = records.find((item) => item.id === id)
                if (record) deleteRecord(record)
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

            {/*
              ⚠️ 第 14 条第 6 条：**术语模式下这一整排不画**——横线、左下「总体评分」、
              竖线、右下「批注详情」全都不画。用户的原话："术语模式下不再画左下（分数/错误归类）
              与右下（批注详情）那两栏，把腾出来的空间分别并给题目区（原文栏）与答题区（译文栏）"。

              为什么是"不画"而不是"用样式藏起来"：藏起来的话，那一排 DOM 还在、
              两条分隔条也还在（上面那条横的能拖、拖完什么都不变），
              用户拖到一条"没有效果的分隔条"上只会以为界面坏了。
              术语题确实也不需要它们：译错的官方译名就写在每一条右边，
              分数与错误归类对"十条对错"没有更多信息（`/api/judge` 那套统计本来也不适用）。
              代价写在报告里：右下那条「收藏」入口跟着没了（它原先长在批注详情栏里）。
            */}
            {!isTermExercise && (
              <>
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
              </>
            )}
          </main>
        </>
      )}

      {/*
        提交之后的等待提示（用户指定：两个按钮「停留此页」「进入下一页」）。
        它只是个提示，收起与否都不影响批改——请求早发出去了；
        因此 `onStay` 与点空白处是同一件事，都只是把窗收起来。
      */}
      {waitingPrompt && (
        <JudgeWaitingModal
          onStay={() => setWaitingPrompt(false)}
          onNext={() => {
            setWaitingPrompt(false)
            // 走 goToSection 而不是 setSection：范围判断只写在一处
            goToSection(sectionIndex + 1)
          }}
        />
      )}

      {/*
        右下角的批改完成通知（用户指定）。点它跳到批完的那一页；
        也可以不管它自己翻页过去——翻到那一页时它自动消失（见 setSection）。
      */}
      {judgeDone && (
        <JudgeDoneToast
          pageNumber={judgeDone.sectionIndex + 1}
          onOpen={openJudgeDone}
          onDismiss={() => setJudgeDone(null)}
        />
      )}

      {/*
        吐司（第 3 条）：**提交被拦住**时把原因说清楚——"还差几个单位"或者
        "与之前哪一次一字不差"。位置在**底部居中**，与右下角那条"批改完成通知"分开：
        那条是等人点的，这条是看一眼就走的，摆在一起会让人以为它们是同一类东西。
        `key` 用自增 id：同一句话连说两次也会重新播放（不然第二次像没反应）。
      */}
      {toast && (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <span className="toast-text">{toast.message}</span>
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="关掉提示">
            ✕
          </button>
        </div>
      )}

      {/* 登录 / 注册：用户自己点顶栏进来，或者被提交门拦下来时自动弹出 */}
      <AuthModal
        open={authOpen}
        reason={authReason}
        onClose={() => {
          setAuthOpen(false)
          setAuthReason(null)
        }}
      />

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
          maxScores={maxScoreByArticle}
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
        贴题弹窗**整块删掉了**（第 13 轮，用户要求）：
        原文栏自己就是一个输入框，进自定义栏直接往里写——方向按有没有汉字自动判断、
        题型按段落数/句数自动判断、参考译文留空，这些都没变，变的是"不用先弹窗问一次"。
      */}

      {/*
        AI 出题：选领域（也可自己输入）+ 文体 + 方向，现出一篇同规格的题。
        生成结果按题目留存，之后「换一换」还能翻回来接着练。
        ⚠️ 术语栏没有这颗按钮（术语题只来自那几个板块，见 SourcePane 里的说明）。
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
