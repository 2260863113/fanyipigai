/**
 * 术语栏的**范围控件**：标题栏里那颗按钮 → **下拉栏（五大板块）** → 点一个板块**弹出窗口选分组**
 * → 点某一组看到它的中英对照平表 → 「确定」切过去并落到这一组的第一页。
 *
 * ## 为什么从"两屏弹窗"改成"下拉 + 弹窗"（第 14 条）
 *
 * 用户的原话：「把现有『范围』控件改成**下拉栏**，里面是**五大板块**：国内机关名称、
 * 国际机关名称、当代术语、必背核心术语、必背用典。点某个板块后**弹出窗口**，
 * 让用户在这个板块里**选分组**（例如「第一组（1-50）」）」。
 *
 * 于是形状变成三层，每一层回答一个问题：
 *   1. **下拉栏**回答"练哪个板块"——它现在是**五个**（早先是两张卡片），
 *      而且与文章栏的「领域」下拉长得一样、位置也一样（都在原文标题栏、紧挨「原文」）；
 *      每一行后面写着"多少条 · 几组"（`terms.ts` 与 `groupsOfScope` 现算，不写死）；
 *   2. **弹窗第一屏**回答"练这一板块里的哪一组"——每张分组卡片写清"第几条到第几条 · 共几页 · 正在练"；
 *   3. **弹窗第二屏**是这个分组的**中英对照平表**（就是答案表）+「确定」「返回」。
 *
 * ⚠️ 第二屏那张表**照旧是答案表**（用户拍板"中英文都列出来"，并且练习中点「范围」也能
 * 重新打开它当参考资料用）——只是现在按**分组**列，一组 20 行（当代术语那一组是 50 行），
 * 不再是一整个板块的 83 行。这一步是有意的取舍：用户是先选组、再看题，
 * 那么他这一眼想看的正是那一组的题。
 *
 * ⚠️ 界面上凡是提到"每组几条"的地方都要说**这个板块自己的数**（`perGroupOfScope`）：
 * 当代术语是 50、其余四个板块是 20（口径见 term-scopes.ts 的文件头）。
 * 写成全局常量的话，用户会在当代术语那一屏看到"每组 20 条"而卡片里明明是 50 行。
 *
 * ## 没有材料的板块怎么画（降级路径，当前五个板块都有材料）
 *
 * 用户点名要求：材料没到位时要**优雅地显示「暂无分组」**，不崩、也不假装有内容。
 * 五个板块现在都有材料，因此那条路径在今天是走不到的——但它**必须留着**：
 * 下一个板块（不管是谁加的）一定是"先有位置、后有材料"。
 * 判据是 `hasTermData`（见 domain/terms.ts），行为是：
 * 那一行**照旧列在下拉里**（看得见才知道有这一栏、才知道在等人补材料），
 * 但**点不动**（`disabled`）并挂一句「暂无分组」。
 * 为什么不干脆藏起来：藏掉的话用户既不知道有这个板块，也不知道是自己点错了还是界面坏了——
 * 而"有这一栏、只是还没有材料"本身是个明确的信息。同理，点不动也不是"假装有内容"：
 * 那一行写的就是"暂无分组"，没有条数、没有页数，也不会推出一个空弹窗。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import { Modal } from './Modal'
import { TERMS_PER_PAGE, groupsOfScope, hasTermData, termPageCount, termsOfScope, type TermGroup } from '../domain/terms'
import { TERM_SCOPES, labelOfScope, perGroupOfScope, type TermScope } from '../domain/term-scopes'

/** 一个板块在下拉里的那点说明：有多少条、共几页、几组。 */
function factsOf(scope: TermScope): { count: number; pages: number; groups: number } {
  return { count: termsOfScope(scope).length, pages: termPageCount(scope), groups: groupsOfScope(scope).length }
}

export function TermScopeSelect({
  scope,
  page,
  onPick,
}: {
  /** 当前正在练的板块 */
  scope: TermScope
  /**
   * 当前这一页（0 基）。
   *
   * 为什么弹窗需要知道页号：分组卡片上那枚「正在练」标的是**你此刻站的那一组**——
   * 一道术语题是一个板块（9 页），分组只是它的入口，所以"现在在练哪一组"这件事
   * 只能由当前页号推出来（见 terms.ts 的 `groupOfPage`）。
   */
  page: number
  /** 选了某个板块里的某一组：调用方负责换题并**落到这一组的第一页** */
  onPick: (scope: TermScope, group: TermGroup) => void
}): JSX.Element {
  /** 下拉栏开着没有 */
  const [menuOpen, setMenuOpen] = useState(false)
  /** 弹窗正看哪个板块的分组列表；null 表示弹窗没开 */
  const [block, setBlock] = useState<TermScope | null>(null)
  /** 弹窗第二屏正在看哪一组（下标）；null 表示停在分组列表那一屏 */
  const [groupIndex, setGroupIndex] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // 点外面就收起下拉（与文章栏的「领域」下拉、批改记录下拉同一套做法）
  useEffect(() => {
    if (!menuOpen) return
    const onDocumentClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function closeAll(): void {
    setMenuOpen(false)
    setBlock(null)
    // 关掉时退回分组列表那一屏：下次点开总是从"这个板块有哪些组"开始，不会停在半路
    setGroupIndex(null)
  }

  const groups = block ? groupsOfScope(block) : []
  /** 这个板块**自己**的组大小（当代术语 50、其余 20）：界面上的"每组 N 条"必须说这个数 */
  const perGroup = block ? perGroupOfScope(block) : 0
  const group = block !== null && groupIndex !== null ? (groups[groupIndex] ?? null) : null
  const groupTerms = block && group ? termsOfScope(block).slice(group.from - 1, group.to) : []

  return (
    <div className="domain-select" ref={ref}>
      <button
        type="button"
        className="domain-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title={`选择术语板块；每个板块按自己的组大小出题（当代术语每 50 条一组、其余每 20 条一组），每页 ${TERMS_PER_PAGE} 条`}
      >
        <span className="domain-trigger-label">范围</span>
        <span className="domain-trigger-value">{labelOfScope(scope)}</span>
        <span className="domain-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {menuOpen && (
        <ul className="domain-menu" role="listbox" aria-label="术语板块">
          {TERM_SCOPES.map((item) => {
            const facts = factsOf(item.id)
            const available = hasTermData(item.id)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === scope}
                  className={item.id === scope ? 'domain-item domain-item-active' : 'domain-item'}
                  // 没有材料的板块点不动：它下面没有分组可选，点开只会是一个空弹窗
                  disabled={!available}
                  onClick={() => {
                    setMenuOpen(false)
                    setBlock(item.id)
                    setGroupIndex(null)
                  }}
                >
                  {item.label}
                  <span className="domain-item-note">
                    {available ? `${facts.count} 条 · ${facts.groups} 组` : '暂无分组'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 第一屏：这个板块有哪些分组（按这个板块自己的组大小切，见 perGroupOfScope） */}
      {block !== null && group === null && (
        <Modal
          title={labelOfScope(block)}
          note={`共 ${groups.length} 组 · 每组 ${perGroup} 条 · 每页 ${TERMS_PER_PAGE} 条`}
          onClose={closeAll}
          footer={
            <button type="button" className="btn" onClick={closeAll}>
              关闭
            </button>
          }
        >
          <ul className="scope-cards">
            {groups.map((item) => {
              /*
               * 「正在练」标在**你此刻站的那一组**上：题号里没有组号，只能按当前页号推。
               * ⚠️ 必须先认板块：点开的是"另一个板块"时，页号说的是**当前那道题**的第几页，
               * 拿它去标别人家的分组就会标错（"正在练"出现在一个你根本没在练的板块里）。
               */
              const current =
                block === scope && item.firstPage <= page && page < item.firstPage + item.pages
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    className={current ? 'scope-card scope-card-active' : 'scope-card'}
                    onClick={() => setGroupIndex(item.index)}
                    title="点开看这一组的全部条目（中英对照），再决定要不要开始练"
                    data-group-index={item.index}
                  >
                    <span className="scope-card-title">{item.label}</span>
                    <span className="scope-card-meta">
                      第 {item.from}–{item.to} 条 · 共 {item.count} 条 · {item.pages} 页（每页 {TERMS_PER_PAGE} 条）
                      {current && <span className="scope-card-now">正在练</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Modal>
      )}

      {/* 第二屏：这一组的中英对照平表（就是答案表）+ 确定 / 返回 */}
      {block !== null && group !== null && (
        <Modal
          title={group.label}
          note={`第 ${group.from}–${group.to} 条 · 共 ${group.count} 条 · ${group.pages} 页`}
          onClose={closeAll}
          footer={
            <>
              {/* 「返回」= 退回这个板块的分组列表（用户点名的两颗按钮之一） */}
              <button type="button" className="btn" onClick={() => setGroupIndex(null)}>
                返回
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onPick(block, group)
                  closeAll()
                }}
              >
                确定
              </button>
            </>
          }
        >
          <div className="scope-table-wrap" data-scope-table={block} data-group-index={group.index}>
            <table className="scope-table">
              <thead>
                <tr>
                  <th scope="col">中文名称</th>
                  <th scope="col">官方英文名称</th>
                </tr>
              </thead>
              <tbody>
                {groupTerms.map((term, index) => (
                  <tr key={`${term.zh}-${index}`}>
                    <td>{term.zh}</td>
                    <td>{term.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}
