/**
 * 右上栏：我的译文。
 *
 * 这一栏在**逐页批改**下有两种形态，由 `editing` 决定：
 *   - 在写（`editing`）：可编辑的输入框 + 修改风格档位 + 提交按钮 + 翻页导航；
 *   - 在看结果：**带批注的**作答——勾了底色的词、上方的小字、插入标记、调序弧线
 *     直接长在译文上；点任意一处勾画会在那一行下面浮出气泡，右下角同时只显示这一处的完整解释。
 *
 * ## 为什么"看结果"是只读的，要按「返回编辑」才能改
 *
 * 批过一次的页再改字，批注的位置就全对不上了（批注是按**提交当时**那段文字算出来的）。
 * 因此批过的页先只读，由用户明确说一句"我要改这一页"（`onUnlock`）才放开：
 * 那一刻结果作废、草稿留着，改完自己按「提交批改」。
 *
 * 那颗按钮与「提交批改」是**同一颗**（用户第 2 条要求）：批改之后它原地改名叫「返回编辑」，
 * 点下去回到可写状态，名字随即变回「提交批改」——不再像早先那样"这颗消失、那颗冒出来"。
 *
 * ## 交出去之后也一样只读
 *
 * 一页交了、结果还没回来时（`pageState === 'judging'`）同样只读：
 * 那一刻改字，回来的批注画的就不是屏幕上这一段了。但**翻页不拦**——
 * 用户可以先去下一页接着译，这一页批完会在右下角通知他（见 JudgeDoneToast）。
 *
 * ## 屏幕上是结果时，那颗按钮一律写「返回编辑」（用户第 2／3／4／6 条）
 *
 * 两种来路：刚批出来的这一页，以及从「批改记录」里翻出来看的那一次（哪怕这一页正放开着写）。
 * 那一刻**没有可点的「提交批改」**——否则用户可能看着旧记录、按下的却是提交草稿。
 * 点「返回编辑」= 离开历史视图（如果正在看历史）+ 回到作答框。
 * 原来那颗「回到作答」按钮因此删掉了（用户第 6 条）。
 *
 * 「哪一页批过没有」不在这个组件里判断：它由 App 按 session.pages 推出来，
 * 这里只按 `pageState` / `editing` 渲染。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { AnnotationText, type Selection } from './AnnotationText'
import { AnswerViewSwitch } from './AnswerViewSwitch'
import { CompareView } from './CompareView'
import { RefineView } from './RefineView'
import { GradeHistoryPicker, type GradeHistoryEntry } from './GradeHistoryPicker'
import { LEVEL_LABEL, type PolishLevel } from '../domain/types'
import type { AnnotatedLayout } from '../domain/layout'
import type { CompareLine } from '../domain/compare'
import type { RefineResult } from '../domain/refine'
import type { ValidatedCorrection } from '../domain/validate'
import type { ViewSettings } from './settings'

/** 正在展示的那一份批改（来自本次提交，或来自练习记录里的某一条）。 */
export interface ShownCorrection {
  correction: import('../domain/types').Correction
  validated: ValidatedCorrection
  answer: string
  level: PolishLevel
  attempt: number
  sectionCount: number
  raw: string
  /**
   * 翻译方向。左下角的算分需要它——漏译/多译的轻重按译文的字数判（见 domain/severity.ts），
   * 因此"红还是橙"这件事不再只由分类决定，算分必须拿到方向。
   */
  direction: import('../domain/types').Direction
  /**
   * 这一份批改的**判分来源**（`live` AI 现场批改 / `fixture` 内置示例 / `local` 程序本地判分）。
   *
   * 第 13 轮加它，是为了把「内置示例批改」那句提醒**从顶栏搬到结果栏**：
   * 顶栏那一枚已按用户要求整枚删掉（术语判分当时借用了 `fixture`，于是每次术语批改都冒出来），
   * 现在只有**真的是示例**时才在这里说一句。
   */
  source: import('../domain/types').JudgeSource
  /**
   * 大改档专有：整篇逐句重写 + 逐句解释 + AI 给的总体分数。
   * **有它就走大改那条渲染路径**（只给对照、不画勾画、分数显示 AI 总评）。
   */
  refine?: RefineResult
}

/**
 * 当前这一页在逐页批改里的状态。**按钮文案与翻页行为都由它推出来**，
 * 因此它的名称要与 reducer 里那几个动作对得上（见 session.ts）。
 *
 * ⚠️ 四档里**没有**"已修改 · 待提交"那一档了：翻页不再自动提交（用户要求），
 * 于是"改过没有"不再改变任何行为——放开过的页就是在写，写完自己按「提交批改」。
 */
export type PageState =
  /** 还没批过（可能已经写了字，也可能还是空的） */
  | 'pending'
  /** 已经交出去、正在批（只读：这一刻再改字，批注就全对不上了） */
  | 'judging'
  /** 批过了，结果就是这一段文字（只读，点「返回编辑」可改） */
  | 'graded'
  /** 批过之后被「返回编辑」放开，正在改 */
  | 'editing'

export function AnswerPane({
  shown,
  layout,
  selection,
  settings,
  level,
  judgingThisPage,
  busyElsewhere,
  error,
  notice,
  isFixtureAnswer,
  editing,
  fromHistory,
  pageState,
  multiSection,
  sectionIndex,
  currentAnswer,
  gradeHistory,
  viewingRecordId,
  onSelect,
  onSettingsChange,
  onUnlock,
  onViewAttempt,
  onDeleteRecord,
  onLevelChange,
  onSubmit,
  onSubmitFixture,
  onAnswerChange,
  favorite,
  onToggleFavorite,
  sentenceFavorite,
}: {
  shown: ShownCorrection | null
  layout: AnnotatedLayout
  selection: Selection | null
  settings: ViewSettings
  level: PolishLevel
  /** **这一页**正在批（进度条、只读、按钮文案都由它决定） */
  judgingThisPage: boolean
  /**
   * 别处正在批（同一页之外的另一页、或另一道题）。
   *
   * 用户要求"批改过程中不能提交"，而批改现在允许翻页，
   * 因此"正在批"不再等于"就在当前这一页"——两条判断必须分开，
   * 否则翻到下一页之后提交按钮又是亮的，能连着发出第二次请求。
   */
  busyElsewhere: boolean
  /** 批改失败的信息（含"能不能看内置示例"的判断依据） */
  error: { message: string } | null
  notice: string | null
  /** 当前作答恰好等于某道内置示例，才给「查看内置示例批改」 */
  isFixtureAnswer: boolean
  /** 现在是不是在写这一页（否则就是在看这一页的批改结果） */
  editing: boolean
  /** 正在看的是**批改记录下拉里选中的那一次**（不是当前这一页的结果） */
  fromHistory: boolean
  pageState: PageState
  multiSection: boolean
  sectionIndex: number
  currentAnswer: string
  /** 这一页的全部批改（最新在前），填「批改记录」下拉 */
  gradeHistory: readonly GradeHistoryEntry[]
  /** 下拉里正在看的那一条；null 表示正在写 */
  viewingRecordId: string | null
  onSelect: (selection: Selection | null) => void
  onSettingsChange: (patch: Partial<ViewSettings>) => void
  /** 「返回编辑」：作废这一页的结果，放开重写 */
  onUnlock: () => void
  /** 下拉里选了某一次：把右栏切成那一次的结果（只读，不动正在写的文字） */
  onViewAttempt: (id: string) => void
  /** 下拉里点叉号：删掉那一次批改（练习记录里同步消失，第 11 条） */
  onDeleteRecord: (id: string) => void
  onLevelChange: (level: PolishLevel) => void
  onSubmit: () => void
  onSubmitFixture: () => void
  onAnswerChange: (value: string) => void
  /** 小卡片里的「收藏」；不传就不显示那颗按钮（记录页不传） */
  favorite?: boolean
  onToggleFavorite?: () => void
  /**
   * 大改档的**逐句收藏**（第 17 条第 5 条）：传给 `RefineView`，每句原文后面多一颗「收藏」。
   * 不传就没有那颗按钮（精修档、以及别处单独用这个组件时）。
   */
  sentenceFavorite?: {
    favorited: (line: CompareLine) => boolean
    onToggle: (line: CompareLine) => void
  }
}): JSX.Element {
  const hasAnswer = currentAnswer.trim().length > 0
  /**
   * 右栏现在显示的是**结果**（而不是作答框）。两种来路：
   *   - 这一页批过、且没被「返回编辑」放开（`!editing`）；
   *   - 用户从「批改记录」下拉里选了历史里的某一次（`fromHistory`）——
   *     这时即使这一页正放开着写，也要让位给"看一眼那一次"。
   */
  const showResult = shown !== null && (!editing || fromHistory)
  /** 这是一份**大改档**的结果：只给对照、不逐处批改 */
  const refine = shown?.refine
  /** 这一页已经交出去、结果还没回来：作答框只读，免得批注画在对不上的文字上 */
  const frozen = pageState === 'judging'
  /**
   * **屏幕上是结果**（而不是作答框）——看下面那颗按钮的两种名字。
   *
   * 两种来路都算：
   *   - 这一页批过、没被「返回编辑」放开（`!editing`）；
   *   - 用户从「批改记录」下拉里翻出某一次来看（`fromHistory`）——**即使这一页正放开着写**。
   *
   * ⚠️ 第二种是用户报的那个不一致（第 3／4／6 条）：这一页按过「返回编辑」进到编辑态之后，
   * 再从下拉里翻出一条旧记录看，屏幕上显示的是**那份结果**，而按钮却写着「提交批改」——
   * 那一刻按下去等于把手里这段草稿交出去，而看到的却是别人（旧记录）的结果，
   * 正是"批改后的视图下不该能点提交批改"这件事。现在只要屏幕上是结果，按钮就写「返回编辑」，
   * 点它就离开历史视图回到作答框。
   */
  const showingResult = !frozen && shown !== null && (fromHistory || !editing)
  const showAnswerControls = editing || frozen || showingResult
  /** 提交按钮按不下去的两种原因（文案与悬停说明分开写） */
  const blocked = judgingThisPage || busyElsewhere
  const submitTitle = judgingThisPage
    ? '这一页已经交去批改了，结果出来会通知你'
    : busyElsewhere
      ? '正在批改另一页，等这一页批完再提交（一次只批一页）'
      : hasAnswer
        ? undefined
        : '先在这一页写下你的译文'

  return (
    <section className="pane pane-answer">
      <header className="pane-head">
        <h2>我的译文</h2>
        <div className="head-meta">
          {/*
            大改档没得选：改写遍布每一句，勾画只会糊成一片（用户要求"大改只能看对照"）。
            按用户选的做法，开关**保留但禁用**并注明原因，而不是藏起来（藏起来会让人以为设置丢了）。
          */}
          {showResult && <AnswerViewSwitch view={settings.answerView} onChange={onSettingsChange} locked={refine !== undefined} />}
          {/*
            「批改记录」下拉：这一页之前每一次批改都在里面，选哪一次就显示哪一次的结果。
            它取代了原来那颗「查看上次批改」按钮与「已改过 · 待提交」提示芯片
            （用户明确要求：去掉提示、改成下拉）——旧按钮只在"一个字都没改"时才出现，
            而这条记录是落盘的，改过字也照样能回看。
            每一条右边还有一颗叉号可以删掉它（第 11 条），练习记录里同步消失。

            ⚠️ 早先它只在 `editing` 时出现，那是自动提交年代的写法：那会儿批完就自动翻页，
            人很少停在"已批改"这一档上。现在批完就停在这一页（只读看结果），
            要是下拉藏着，用户想回看前几次还得先按「返回编辑」——纯属绕路。
            因此改成"这一页有历史就给"，与只读与否无关。
          */}
          {gradeHistory.length > 0 && (
            <GradeHistoryPicker
              history={gradeHistory}
              viewingId={viewingRecordId}
              onView={onViewAttempt}
              onDelete={onDeleteRecord}
            />
          )}
          {/*
            内置示例批改的提醒**搬到结果栏里**了（第 13 轮，用户拍板）。

            早先它在顶栏右上角是一枚常驻的警告芯片，而术语题的本地判分当时借用了
            `fixture` 这个来源，于是**每次术语批改之后它都会冒出来**——用户的要求
            （"去掉右上角内置示例批改标志"）说的就是这一枚。现在顶栏那一枚整个删掉了，
            提醒只在这里出现，而且只在**真的拿内置示例当批改结果**时出现
            （术语判分有了自己的来源 `local`，不再借用示例身份，见 types.ts 的 JudgeSource）。
          */}
          {shown?.source === 'fixture' && (
            <span className="chip chip-warn" title="这是内置示例的批改结果，不是 AI 现场批改的">
              示例批改
            </span>
          )}
          {showAnswerControls && (
            <>
              <div className="level-switch" role="group" aria-label="修改风格">
                {(Object.keys(LEVEL_LABEL) as PolishLevel[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === level ? 'level-btn level-btn-active' : 'level-btn'}
                    onClick={() => onLevelChange(key)}
                    title={LEVEL_LABEL[key]}
                  >
                    {LEVEL_LABEL[key].split('（')[0]}
                  </button>
                ))}
              </div>
              {/*
                同一颗按钮、两个名字（用户第 2／3／4／6 条）：
                **只要屏幕上是结果**（不管是刚批出来的、还是从「批改记录」里翻出来看的那一次），
                它一律写「返回编辑」——点下去就回到可写状态（顺带离开历史视图），名字随即变回「提交批改」。
                "批改后的视图下不该能点提交批改"就是靠这一条保证的：那一档根本不画提交按钮。
              */}
              {showingResult ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onUnlock}
                  title="回到这一页的作答框；改完自己按「提交批改」才会再批一次"
                >
                  返回编辑
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSubmit}
                  disabled={!hasAnswer || blocked}
                  title={submitTitle}
                >
                  {judgingThisPage ? '批改中…' : '提交批改'}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/*
        批改进度条：正好在「我的译文」标题栏下方、作答框上方（用户指定）。
        只在**这一页**批改中时显示——翻到别的页时它不跟着跑
        （那一页的进度不在这条线上，右下角那条通知才是它的出口）。
      */}
      {judgingThisPage && <JudgingProgress />}

      <div className="pane-body">
        {error && (
          <div className="error-block">
            <strong>批改未完成：</strong>
            {error.message}
            {isFixtureAnswer && (
              <button type="button" className="btn btn-ghost" onClick={onSubmitFixture}>
                查看内置示例批改
              </button>
            )}
          </div>
        )}

        {notice && !error && <p className="hint notice">{notice}</p>}

        {showResult && shown ? (
          refine ? (
            /* 大改档：只有一种看法——逐句「原译 / 改后」+ 每句的解释；每句原文后面那颗「收藏」由这里传下去 */
            <RefineView refine={refine} {...(sentenceFavorite ? { favorite: sentenceFavorite } : null)} />
          ) : settings.answerView === 'compare' ? (
            /*
             * 对照视图**不受行距设置影响**（用户要求"对照视图还是保持以前那样一句对一句"）。
             * 它本来就不画勾画、不画方框，行距只是它自己那份排版的事——
             * 因此这里刻意**不传** lineHeight，让它就用样式表里的默认值。
             */
            <CompareView validated={shown.validated} answer={shown.answer} selection={selection} onSelect={onSelect} />
          ) : (
            <AnnotationText
              layout={layout}
              answer={shown.answer}
              validated={shown.validated}
              selection={selection}
              /* 行距就是设置里那个值（1–3），批改视图与对照视图共用同一个口径 */
              lineHeightBase={settings.lineHeight}
              showFixBoxes={settings.showFixBoxes}
              onSelect={onSelect}
              {...(onToggleFavorite ? { onToggleFavorite, favorited: favorite === true } : null)}
            />
          )
        ) : (
          <textarea
            className="answer-input answer-input-fill"
            value={currentAnswer}
            onChange={(event) => onAnswerChange(event.target.value)}
            /* 已经交出去了就只读：这一刻再改字，回来的批注就画在对不上的文字上了 */
            readOnly={frozen}
            placeholder={
              multiSection
                ? `在第 ${sectionIndex + 1} 页写下你的译文……写完点「提交批改」，再翻到下一页接着译`
                : '在这里写下你的译文……'
            }
            spellCheck={false}
          />
        )}

        {/*
          翻页导航**不在这里**——它挪到了左边「原文」那一栏（用户要求）。
          理由：翻页是为了换一段原文，人的眼睛在原文上；而这一栏是作答/结果，
          导航摆在这里会和「提交批改」挤在一起。
        */}
      </div>
    </section>
  )
}

/** 翻页导航中间那句状态说明。四档各一句话，让人一眼知道这一页走到哪一步了。 */
export const PAGE_STATE_HINT: Record<PageState, string> = {
  pending: '待批改',
  judging: '批改中…（可以先翻到下一页接着译）',
  graded: '已批改（只读，点「返回编辑」可改）',
  editing: '编辑中（改完按「提交批改」）',
}

/**
 * 「下一页」点下去会发生什么。
 *
 * ⚠️ 从第三版起，这个问题的答案变得很简单：**只是翻页**。
 * 用户明确要求"点击下一页或者上一页，不触发提交批改，而是保留当前页面输入缓存，
 * 后面返回时可以继续作答"——因此不再有"这一页会先交去批改"这种说法，
 * 早先那四句按 `edited`/`modified` 分开写的话也一并作废（那两档已经不存在了）。
 *
 * 留下的这几句只说**用户心里那个疑问**：这一页写了还没交，翻走会不会丢？
 */
export function nextPageHint(options: {
  hasAnswer: boolean
  pageState: PageState
}): string {
  if (options.pageState === 'judging') return '翻到下一页（这一页正在批改，批完会在右下角通知你）'
  if (options.pageState === 'graded') return '翻到下一页（这一页已批过，不会重新提交）'
  if (!options.hasAnswer) return '翻到下一页（这一页还没写）'
  if (options.pageState === 'editing') return '翻到下一页（草稿会留着，回来接着写）'
  return '翻到下一页（这一页还没提交，草稿会留着）'
}

/**
 * 批改进度条的**台阶表**（用户给的节奏，第三版）。
 *
 * 用户原话（改过三轮，每一轮都把两个节点往后推、把步子改小）：
 *   - 第一版："不要平滑，就一下一下地向前瞬移（瞬移！），到 80% 大约 15 秒，到 98% 大约 30 秒"；
 *   - 第二版："跳动增加的距离可以调小一倍，80% 延长到 20 秒，98% 延长到 40 秒"；
 *   - 第三版（现在这版）："1 分钟时走到 80%，1 分 20 秒时走到 98%，步子走小一点、频率大一些"。
 *
 * 于是节奏变成：**每 1.5 秒跳 2 个百分点**，从 0 一路跳到 80%（正好 60 秒、40 跳）；
 * 之后每约 2.2 秒再跳 2 个点，到 98% 停住（正好 80 秒、再 9 跳）。
 * 采样间隔同时从 500ms 收紧到 250ms，否则"步子变小"这件事在屏幕上看不出来——
 * 一跳 2 个点时，半秒采一次会漏掉整整一格。
 *
 * 仍然写成一张算出来的表而不是公式：公式画出来是连续的斜线，而用户要的是"跳"，
 * 跳的节奏只能一个个列出来。每一格都远长于采样间隔，因此每一跳都稳稳停一下。
 *
 * ⚠️ 它估的是**时间，不是真进度**：批改接口只有"发出去"和"回来"两个时刻，
 * 中间没有任何可用于量进度的信号。因此刻意**不显示百分比数字**，
 * 只给一条细蓝线——它表达的是"还在忙"，不是一个可以信到个位的数字。
 * 实测单次批改约 10–35 秒，所以多数时候结果会在 80% 之前就回来（线随即消失）；
 * 这条节奏主要是为"慢的时候"准备的：**宁可慢一点爬，也不要十几秒冲到头再僵住**。
 */
const JUDGING_STEPS: ReadonlyArray<{ at: number; percent: number }> = (() => {
  /** 到 80% 用多久、到 98% 再用多久（毫秒） */
  const TO_80 = 60_000
  const TO_98 = 20_000
  /** 一跳走几个百分点、跳几跳 */
  const STEP = 2
  const STEPS_TO_80 = 80 / STEP
  const STEPS_TO_98 = (98 - 80) / STEP

  const steps: Array<{ at: number; percent: number }> = [{ at: 0, percent: 0 }]
  for (let index = 1; index <= STEPS_TO_80; index += 1) {
    steps.push({ at: (TO_80 * index) / STEPS_TO_80, percent: index * STEP })
  }
  for (let index = 1; index <= STEPS_TO_98; index += 1) {
    steps.push({ at: TO_80 + (TO_98 * index) / STEPS_TO_98, percent: 80 + index * STEP })
  }
  return steps
})()

/**
 * 批改进度条。
 *
 * 三条行为（都是用户点名的）：
 *   1. 按台阶表**一格一格跳**上去（不要平滑滑动）；
 *   2. 1 分钟到 80% 之后**明显变慢**，1 分 20 秒到 98% 就**停住**不再动；
 *   3. 结果回来 → 组件随即卸载（提前返回也就是"立刻结束"）。
 */
function JudgingProgress(): JSX.Element {
  const [percent, setPercent] = useState(0)
  const startedAt = useRef<number>(Date.now())

  useEffect(() => {
    startedAt.current = Date.now()
    setPercent(0)
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      // 走到台阶表里"最后那个已经到点的格子"
      let next = 0
      for (const step of JUDGING_STEPS) {
        if (elapsed >= step.at) next = step.percent
      }
      setPercent(next)
    }, 250)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="judge-progress" role="progressbar" aria-label="批改进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="judge-progress-bar" style={{ width: `${percent}%` }} data-percent={percent} />
    </div>
  )
}
