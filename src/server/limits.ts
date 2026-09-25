/**
 * 全站共享的业务常量（单一事实源，供各 API 与前端复用）。
 *
 * 复用自「地图记忆」的 `functions/_lib/limits.ts`，去掉那边公告与家乡相关的三项。
 * 每一条都标注了前端的对应实现——**两处必须一起改**，否则会出现
 * "界面允许输入、提交却被拒"这种最难解释的失败。
 */

/** 留言板帖子长度上限（与 `src/components/board/BoardView.tsx` 的 maxLength 一致） */
export const MAX_POST_LEN = 200

/** 留言板回复长度上限（同上） */
export const MAX_REPLY_LEN = 100

/** 头像 dataUrl 长度上限（约 20KB 原始图片经前端压缩后的 base64 膨胀上限） */
export const MAX_AVATAR_SIZE = 20 * 1024

/** 头像 dataUrl **文本**长度上限（只信客户端自报的 size 会让超大文本绕过限制入库） */
export const MAX_AVATAR_DATAURL_LEN = 40 * 1024

/** 用户名长度上限（与 `src/server/validate.ts` 的 cleanUsername、前端 cleanUsername 一致） */
export const MAX_USERNAME_LEN = 24

/** 公告标题/正文长度上限（与 `AdminView.tsx` 的 maxLength 一致） */
export const MAX_ANNOUNCEMENT_TITLE = 60
export const MAX_ANNOUNCEMENT_CONTENT = 2000

/** 密码长度下限（与前端 `validPassword` 一致；上限只管住荒谬输入） */
export const MIN_PASSWORD_LEN = 6
export const MAX_PASSWORD_LEN = 128
