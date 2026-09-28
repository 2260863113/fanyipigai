/**
 * 账号那一组控件：登录后是一颗「头像 + 用户名」按钮加它自己的下拉栏，没登录时是一颗「登录 / 注册」。
 *
 * ## 为什么把它单拎出来
 *
 * 它原先**只长在顶栏里**（`TopBar.tsx`）。第 18 轮加手机端时，顶栏那一整排在手机上要收进
 * 侧边栏，而侧边栏里照样得有账号入口——**同一组控件的第二份**。
 * 逐字抄一遍是这类"同构但各抄一份"的代码最容易分家的地方（改一处漏一处只是时间问题），
 * 因此整个搬到这里：菜单的开合状态、点别处/按 Esc 收起、退出登录后自动收起，
 * 全都在这一个组件里，两处调用方（顶栏与侧边栏）只管传"点某一项时做什么"。
 *
 * ## 类名与结构一个字都没改
 *
 * 桌面端的验收脚本逐条盯着这几个类名：`.user-center`（触发器要能 `click()`、
 * 要带 `aria-expanded`）、`.user-menu button`（菜单项的文案与顺序）、
 * `.account-button`（没登录时那一颗要能按文案找到）、`.user-center-wrap`（点外面收起的判据）。
 * 因此搬过来时**DOM 逐字照抄**，只是从 `TopBar` 的 JSX 里挪进了这个函数。
 *
 * ## 菜单怎么关（三条都照「地图记忆」那边的手法）
 *
 * 点菜单项、点页面别处、按 Esc。少了"点别处"与 Esc 的话，
 * 菜单会一直挂在屏幕上挡住下面那颗「设置」按钮（实测过）。
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { PublicUser } from './auth/api'
import { initialOf } from './auth/format'
import { ADMIN_TABS, type AdminTab } from './admin-tabs'

export function AccountControl({
  user,
  isAdmin,
  /** 当前打开的账号页面（个人中心那一屏要亮起来）；null 表示在别处 */
  panel,
  onOpenAuth,
  onSelectPanel,
  onChangePassword,
  onOpenAdminView,
  onLogout,
}: {
  user: PublicUser | null
  isAdmin: boolean
  /** 这里只用到 `'profile'` 这一档：其它档不会让账号按钮亮 */
  panel: string | null
  onOpenAuth: () => void
  onSelectPanel: (panel: 'board' | 'profile' | 'admin') => void
  onChangePassword: () => void
  onOpenAdminView: (view: AdminTab) => void
  onLogout: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  /* 点别处、按 Esc 都收起来；菜单开着的时候才挂监听（不然每次点界面都要跑一遍） */
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  /* 退出登录之后菜单不该还开着——那时下拉栏里已经没有一项能点了 */
  useEffect(() => {
    if (!user) setMenuOpen(false)
  }, [user])

  /** 点菜单里的一项：先收起菜单，再办事（办事会切页面，菜单留着会跟着漂过去） */
  const pick = (work: () => void) => (): void => {
    setMenuOpen(false)
    work()
  }

  if (!user) {
    return (
      <button type="button" className="btn btn-primary account-button" onClick={onOpenAuth} title="登录或注册后才能提交批改">
        登录 / 注册
      </button>
    )
  }

  return (
    <div className="user-center-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-ghost account-button user-center${panel === 'profile' ? ' account-button-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        title="个人中心、修改密码与管理入口"
      >
        <span className="account-avatar">
          {user.avatar ? <img src={user.avatar.dataUrl} alt="" /> : initialOf(user.username)}
        </span>
        <span className="account-name">{user.username}</span>
        <span className="account-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {menuOpen && (
        <div className="user-menu" role="menu" aria-label="账号菜单">
          <button type="button" role="menuitem" onClick={pick(() => onSelectPanel('profile'))}>
            个人中心
          </button>
          <button type="button" role="menuitem" onClick={pick(onChangePassword)}>
            修改密码
          </button>
          {/*
            三项管理入口只给管理员看（与顶栏那颗被撤掉的「管理」同一个判据）。
            ⚠️ 界面上的判断只是"不给看"：真正的权限在服务端的 `requireAdmin`（见 guard.ts）。
          */}
          {isAdmin &&
            ADMIN_TABS.map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={pick(() => onOpenAdminView(item.id))}>
                {item.label}
              </button>
            ))}
          <button type="button" role="menuitem" className="user-menu-danger" onClick={pick(onLogout)}>
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
