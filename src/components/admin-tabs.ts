/**
 * 管理页的三个子视图（用户管理 / 日志管理 / 发布公告）。
 *
 * 为什么单独一个小模块：这三样的**编号与名字**现在有两个入口要用——
 * 管理页自己的那一排分段按钮，以及顶栏「个人中心」下拉栏里的三项
 * （用户第 17 条第 9 条：下拉里点「用户管理」要直接落到那一屏）。
 * 各写一份的话，下拉里点了「用户管理」而管理页高亮的是「日志管理」这种错位迟早会出现。
 *
 * ⚠️ 名字用**用户点名的那三个词**（"日志管理，用户管理，发布公告"）：
 * 早先这一屏叫「日志记录」，下拉栏里再叫「日志管理」就成了同一件事两个名字。
 */

export type AdminTab = 'users' | 'logs' | 'announcements'

/** 三个子视图（顺序即分段按钮的顺序）。 */
export const ADMIN_TABS: readonly { id: AdminTab; label: string }[] = [
  { id: 'users', label: '用户管理' },
  { id: 'logs', label: '日志管理' },
  { id: 'announcements', label: '发布公告' },
]

/** 管理页的默认落点（下拉里点「管理」以外的东西时也回这里）。 */
export const DEFAULT_ADMIN_TAB: AdminTab = 'users'

export function isAdminTab(value: unknown): value is AdminTab {
  return ADMIN_TABS.some((tab) => tab.id === value)
}
