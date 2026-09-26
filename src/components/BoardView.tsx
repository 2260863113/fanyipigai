/**
 * 留言板：谁都能看，发帖与回复要登录。
 *
 * **结构、类名与文案照搬「地图记忆」的 `src/ui/boardPanel.ts`**（用户要求这一批功能
 * 的 UI 完全仿造那个项目），样式来自 `src/styles-map-memory.css`：
 * `.board-container / board-composer / board-composer-actions / board-login-hint /
 *  board-list / board-post / board-post-head / board-author / board-time / board-delete /
 *  board-content / board-replies / board-reply / board-reply-head / board-post-actions /
 *  board-reply-btn / board-reply-input / board-load-more / board-empty`，
 * 按钮用它那边的 `primary` / `ghost`。
 *
 * 与那边**不一样**的两处（都是这边的前置条件，不是随手改的）：
 *  1. 它的回复框是"点「回复」才展开"（`board-reply-input` 平时隐藏）。这边照做，展开状态放在 React state 里。
 *  2. 它的公告是另一个面板（`announcementPanel.ts`）。这边公告就排在留言板最上面，
 *     用它那套 `.announcement-*` 类名与结构。
 *
 * ⚠️ **每条留言前面加了头像**（用户第 17 条第 6 条：原文"留言板每条信息加上用户头像"）。
 * 头像本来就在接口里（`BoardPost.avatar` / `BoardReply.avatar` 一直是服务端 JOIN users 取出来的），
 * 只是一直没画——因此这一条是纯前端的事，接口与库表一个字没动。
 * 画法用 `<UserAvatar mini>`，与用户管理里那一批同一张脸（见 UserAvatar.tsx）。
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import {
  MAX_POST_LEN,
  MAX_REPLY_LEN,
  announcementApi,
  boardApi,
  type Announcement,
  type BoardPost,
  type BoardReply,
} from './auth/api'
import { relativeTime } from './auth/format'
import { useAuth } from './auth/store'
import { UserAvatar } from './UserAvatar'

export function BoardView({ onRequireLogin }: { onRequireLogin: () => void }): JSX.Element {
  const auth = useAuth()
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [replyOpen, setReplyOpen] = useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = useState<Record<number, BoardReply[]>>({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [boardRes, announceRes] = await Promise.all([boardApi.list(), announcementApi.list()])
      setPosts(boardRes.posts)
      setAnnouncements(announceRes.announcements)
      setExpanded({})
      setReplyOpen({})
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const token = auth.session?.token ?? ''

  function submitPost(event: FormEvent): void {
    event.preventDefault()
    if (!auth.session) {
      onRequireLogin()
      return
    }
    const content = draft.trim()
    if (!content) return
    void run(async () => {
      const res = await boardApi.createPost(token, content)
      setPosts((previous) => [res.post, ...previous])
      setDraft('')
    })
  }

  function submitReply(postId: number): void {
    if (!auth.session) {
      onRequireLogin()
      return
    }
    const content = (replyDrafts[postId] ?? '').trim()
    if (!content) return
    void run(async () => {
      await boardApi.createReply(token, postId, content)
      setReplyDrafts((previous) => ({ ...previous, [postId]: '' }))
      setReplyOpen((previous) => ({ ...previous, [postId]: false }))
      const [replies, list] = await Promise.all([boardApi.replies(postId), boardApi.list()])
      setExpanded((previous) => ({ ...previous, [postId]: replies.replies }))
      setPosts(list.posts)
    })
  }

  function expand(post: BoardPost): void {
    void run(async () => {
      const res = await boardApi.replies(post.id)
      setExpanded((previous) => ({ ...previous, [post.id]: res.replies }))
    })
  }

  return (
    <div className="board-container">
      <h2 className="board-heading">留言板</h2>

      {announcements.length > 0 ? (
        <div className="announcement-list">
          {announcements.map((item) => (
            <div key={item.id} className={`announcement-item${item.pinned ? ' pinned' : ''}`}>
              <div className="announcement-head">
                <span className="announcement-title">{item.title}</span>
                {item.pinned ? <span className="announcement-badge">置顶</span> : null}
                <span className="announcement-time">{relativeTime(item.createdAt)}</span>
              </div>
              <div className="announcement-body">{item.content}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="board-composer">
        <textarea
          value={draft}
          maxLength={MAX_POST_LEN}
          rows={3}
          placeholder="写点什么…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="board-composer-actions">
          <span className="board-count">
            {Array.from(draft).length}/{MAX_POST_LEN}
          </span>
          <button type="button" className="primary" disabled={busy || !draft.trim()} onClick={submitPost}>
            发表
          </button>
        </div>
      </div>
      {auth.session ? null : (
        <div className="board-login-hint">
          <button type="button" className="ghost" onClick={onRequireLogin}>
            登录后可以发言
          </button>
        </div>
      )}

      {error ? <p className="auth-message">{error}</p> : null}

      {loading ? <div className="board-empty">正在读…</div> : null}
      {!loading && failed ? <div className="board-empty">读不到留言，刷新再试</div> : null}
      {!loading && !failed && posts.length === 0 ? <div className="board-empty">还没有人留言</div> : null}

      {posts.length > 0 ? (
        <div className="board-list">
          {posts.map((post) => {
            const replies = expanded[post.id] ?? post.replies
            const hidden = post.replyCount - replies.length
            return (
              <div key={post.id} className="board-post">
                <div className="board-post-head">
                  <UserAvatar username={post.username} avatar={post.avatar} mini />
                  <span className="board-author">{post.username}</span>
                  <span className="board-time">{relativeTime(post.createdAt)}</span>
                  {auth.user?.username === post.username ? (
                    <button
                      type="button"
                      className="board-delete"
                      onClick={() =>
                        void run(async () => {
                          await boardApi.deletePost(token, post.id)
                          setPosts((previous) => previous.filter((item) => item.id !== post.id))
                        })
                      }
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                <div className="board-content">{post.content}</div>

                {replies.length > 0 ? (
                  <div className="board-replies">
                    {replies.map((reply) => (
                      <div key={reply.id} className="board-reply">
                        <div className="board-reply-head">
                          <UserAvatar username={reply.username} avatar={reply.avatar} mini />
                          <span className="board-author">{reply.username}</span>
                          <span className="board-time">{relativeTime(reply.createdAt)}</span>
                          {auth.user?.username === reply.username ? (
                            <button
                              type="button"
                              className="board-delete"
                              onClick={() =>
                                void run(async () => {
                                  await boardApi.deleteReply(token, reply.id)
                                  setExpanded((previous) => ({
                                    ...previous,
                                    [post.id]: (previous[post.id] ?? post.replies).filter((one) => one.id !== reply.id),
                                  }))
                                })
                              }
                            >
                              删除
                            </button>
                          ) : null}
                        </div>
                        <div className="board-content">{reply.content}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="board-post-actions">
                  {hidden > 0 && !expanded[post.id] ? (
                    <button type="button" className="board-expand" onClick={() => expand(post)}>
                      展开 {hidden} 条回复
                    </button>
                  ) : null}
                  {expanded[post.id] && post.replyCount > post.replies.length ? (
                    <button
                      type="button"
                      className="board-expand"
                      onClick={() => setExpanded((previous) => ({ ...previous, [post.id]: post.replies }))}
                    >
                      收起
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="board-reply-btn"
                    onClick={() => {
                      if (!auth.session) {
                        onRequireLogin()
                        return
                      }
                      setReplyOpen((previous) => ({ ...previous, [post.id]: !previous[post.id] }))
                    }}
                  >
                    回复
                  </button>
                </div>

                {replyOpen[post.id] ? (
                  <div className="board-reply-input">
                    <textarea
                      value={replyDrafts[post.id] ?? ''}
                      maxLength={MAX_REPLY_LEN}
                      rows={2}
                      placeholder="回复…"
                      onChange={(event) =>
                        setReplyDrafts((previous) => ({ ...previous, [post.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || !(replyDrafts[post.id] ?? '').trim()}
                      onClick={() => submitReply(post.id)}
                    >
                      回复
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
