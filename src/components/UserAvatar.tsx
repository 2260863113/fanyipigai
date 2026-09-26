/**
 * 用户头像（留言板、用户管理、顶栏都用它）。
 *
 * 样式与类名**照搬「地图记忆」**的 `.user-avatar`（`src/styles-map-memory.css`）：
 * 圆形、24px（`.mini` 是 20px）、有头像就铺底图、没有就用用户名首字顶着。
 * 那边它是 `src/ui/avatar.ts` 里的一个拼 HTML 的函数，这边是一个组件——
 * 三处（留言板帖子、回复、用户管理）都要画同一张头像，各写一遍必然有一处忘了兜底。
 *
 * ⚠️ 没有头像时**不画空圈**：`.default-avatar` 给一块浅灰底 + 首字，
 * 与"这个人设过头像但图没加载出来"在看感上要能分开（后者是一片灰）。
 * ⚠️ 头像是 `dataUrl`（服务端只回 dataUrl，见 `functions/api/board` 的 `avatarOf`）：
 * 上传时已经压到 20KB 以内，因此这里可以直接铺成 `background-image`，不需要 <img>。
 */

import type { JSX } from 'react'
import { initialOf } from './auth/format'

export function UserAvatar({
  username,
  avatar,
  /** 20px 的小号（留言板、列表里用） */
  mini = false,
}: {
  username: string
  /** 头像的 dataUrl；没有就是 null（画首字） */
  avatar?: string | null
  mini?: boolean
}): JSX.Element {
  const classes = ['user-avatar']
  if (mini) classes.push('mini')
  if (!avatar) classes.push('default-avatar')
  return (
    <span
      className={classes.join(' ')}
      style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
      /* 头像是装饰：名字就在旁边写着，念屏不必再念一遍（因此整块 aria-hidden） */
      aria-hidden="true"
      title={username}
    >
      {avatar ? '' : initialOf(username)}
    </span>
  )
}
