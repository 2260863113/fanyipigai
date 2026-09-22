/**
 * 「批改记录」下拉：**这一页之前每一次批改**都在这里，选哪一次就显示哪一次的结果。
 *
 * ## 为什么要有它
 *
 * 用户的要求（原话）："批改完成后，用户重新返回编辑，右侧标题栏部分去掉'已提交'的提示，
 * 而是添加'批改记录'的下拉栏，用户可以选择之前第几次的批改记录，点击后，显示当时的批改记录。"
 *
 * 原先那一栏只有一个「查看上次批改」按钮，而且**只在"一个字都没改"时才出现**——
 * 用户改过一个字，就再也看不到上一版批的是哪儿了。现在改成下拉：
 * 每一次提交都会在练习记录里留下一条（见 records-store），下拉把它们全列出来，
 * 因此"改成什么样才更好"这件事有了来路可查。
 *
 * ## 记录从哪来
 *
 * 读**练习记录**（`translation-practice.records.v2`），不是会话里的临时状态。理由有两条：
 *   1. 「返回编辑」会把这一页的结果从会话里挪走（那是"放开重写"的语义），
 *      而记录是**落盘的存档**，不受这件事影响；
 *   2. 刷新之后会话就没了，而"想看一眼上次批改"恰恰最常发生在刷新之后。
 * 代价是练习记录有条数上限（整站 100 条，满了丢最旧的），很久以前那几次会被挤掉。
 *
 * ## 与旧按钮的关系
 *
 * 「查看上次批改」按钮与那个「已改过 · 待提交」提示芯片**都删掉了**（用户明确要求）：
 * 它们是同一件事的旧入口，留着只会让人在两个地方找。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { LEVEL_LABEL, type PolishLevel } from '../domain/types'

/** 下拉里的一条：这一页历史上的一次批改。 */
export interface GradeHistoryEntry {
  /** 练习记录里的 id */
  id: string
  /** 这一页的第几次批改（1 起，与练习记录页那个跨页累加的「第几次作答」不是一回事） */
  ordinal: number
  createdAt: Date
  level: PolishLevel
  /** 这一次的总分；**大改档是 null**（那一档不打分，见 ADR 0020） */
  score: number | null
  /** 这一次是不是大改档：列表上要标出来，否则两种分数看起来是一回事 */
  refined: boolean
}

function timeLabel(date: Date): string {
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function GradeHistoryPicker({
  history,
  viewingId,
  onView,
  onBackToWriting,
  onDelete,
}: {
  /** 这一页的全部批改，**最新的在前** */
  history: readonly GradeHistoryEntry[]
  /** 正在看的那一条；null 表示正在写 */
  viewingId: string | null
  onView: (id: string) => void
  onBackToWriting: () => void
  /** 删掉某一条（练习记录里同步消失；连带的事由 App 处理，见 records-store 的 removeRecord） */
  onDelete: (id: string) => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  /** 正在问"确定删这一条吗"的那一条；null = 没在问 */
  const [confirming, setConfirming] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // 点外面或按 Esc 就收起（与文章栏、句子栏那几个下拉同一套做法）
  useEffect(() => {
    if (!open) return
    const onDocumentClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      setOpen(false)
      // "确定删吗"这句问话只属于打开着的这一次：收起下拉就当作没问过
      setConfirming(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        setConfirming(null)
      }
    }
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (history.length === 0) return null
  const viewing = viewingId ? history.find((entry) => entry.id === viewingId) : undefined

  return (
    <>
      <div className="domain-select" ref={ref}>
        <button
          type="button"
          className="domain-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="这一页之前每一次的批改都在这里；选哪一次就显示哪一次的结果"
        >
          <span className="domain-trigger-label">批改记录</span>
          <span className="domain-trigger-value">
            {viewing ? `第 ${viewing.ordinal} 次 · ${timeLabel(viewing.createdAt)}` : `共 ${history.length} 次`}
          </span>
          <span className="domain-trigger-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <ul className="domain-menu" role="listbox" aria-label="批改记录">
            {history.map((entry) => (
              <li key={entry.id} className="history-row">
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.id === viewingId}
                  className={entry.id === viewingId ? 'domain-item domain-item-active' : 'domain-item'}
                  onClick={() => {
                    onView(entry.id)
                    setOpen(false)
                  }}
                >
                  第 {entry.ordinal} 次 · {timeLabel(entry.createdAt)} · {entry.score === null ? '不打分' : `${entry.score} 分`}
                  {entry.refined && <span className="record-refine">大改</span>}
                  {entry.level === 'refine' && !entry.refined && (
                    <span className="record-refine">{LEVEL_LABEL[entry.level].split('（')[0]}</span>
                  )}
                </button>
                {/*
                  删掉这一次（用户第 11 条要求）。**先问一句再删**：
                  记录一删就是真的没了（练习记录里那条同时消失），误点无法挽回。
                  问话就地展开在这一行里，不弹窗——下拉本来就是"轻动作"，
                  为它盖一层弹窗会把"我就想删掉这一条"变成一件大事。
                */}
                {confirming === entry.id ? (
                  <span className="history-confirm">
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger"
                      onClick={() => {
                        onDelete(entry.id)
                        setConfirming(null)
                      }}
                      title="删掉这一次批改；练习记录里那一条也会一起消失"
                    >
                      删除
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="history-delete"
                    onClick={() => setConfirming(entry.id)}
                    aria-label={`删除第 ${entry.ordinal} 次批改`}
                    title="删掉这一次批改（练习记录里同步消失）"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* 正在看历史时才给「回到作答」：它是"离开历史视图"的唯一入口，不能藏在菜单里 */}
      {viewing && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBackToWriting}
          title="回到这一页的作答框（历史只是看一眼，不会改动你正在写的文字）"
        >
          回到作答
        </button>
      )}
    </>
  )
}
