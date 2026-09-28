/**
 * 「现在是不是手机端」——第 18 轮加手机端版式时用的一个判据。
 *
 * ## 为什么用 `matchMedia` 而不是量宽度
 *
 * 手机端那套版式**同时**落在两个地方：样式表里那一段 `@media (max-width: 600px)`
 * （见 styles.css 末尾），以及界面结构上（顶栏换成三条横线、总评栏与批注详情栏整个不画、
 * 原文标题栏那颗「选择」弹窗、底部那两行操作栏）。
 * 后几样不是样式能表达的——比如那两栏在手机上**根本不渲染**，
 * 而不是"画出来再用 CSS 藏起来"（藏起来的分隔条还拖得动，那才是真的坏，
 * 与 `.split-term` 那条注释里说的是同一个道理）。
 *
 * 因此 JS 这边必须知道同一个判据。这里**照抄样式表那条媒体查询的原话**
 * （`(max-width: 600px)`，一个字不差），两边靠这句字面相同的话对齐：
 * `matchMedia` 与 CSS 媒体查询在同一个浏览器里按同一套规则算，
 * 只要条件写的一样，就不会出现"CSS 以为是手机、JS 以为不是"的半截状态。
 *
 * ⚠️ 以后要改这个断点，**两处必须一起改**（样式表末尾那一段的注释里也写着这一条）。
 *
 * ## 服务端渲染与非浏览器环境
 *
 * `window.matchMedia` 不存在时（构建期、测试里的静态渲染）一律返回 `false`，
 * 也就是"按桌面端来"——桌面端是本项目所有既有验收脚本盯着的那一套，
 * 默认落在它上面最安全。
 */

import { useEffect, useState } from 'react'

/** 手机端断点。**必须与 styles.css 末尾那段媒体查询的条件一致**。 */
export const MOBILE_QUERY = '(max-width: 600px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches)
    /* 挂上来的时候先对齐一次：首帧那份初始值可能与当前宽度不一致（比如旋屏之后才挂载） */
    setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
