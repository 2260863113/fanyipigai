/**
 * 留言板：谁都能看，发帖与回复要登录。
 *
 * 复用自「地图记忆」的 `ui/boardPanel.ts`（列表带预览回复、点开看全部、只能删自己的），
 * 界面按 React 重写。
 *
 * ⚠️ 读**不需要登录**：没登录的人也该看得见大家在说什么，否则这个板子对新人是隐形的。
 * 只有写入（发帖、回复、删除）才要求登录——拦在服务端，界面只是提前把话说清楚。
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { MAX_POST_LEN, MAX_REPLY_LEN, boardApi, type BoardPost, type BoardReply } from './auth/api'
import { initialOf, relativeTime } from './auth/format'
import { useAuth } from './auth/store'

export function BoardView({ onRequireLogin }: { onRequireLogin: () => void }): JSX.Element {
  const auth = useAuth()
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState<Record<number, BoardReply[]>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await boardApi.list()
      setPosts(res.posts)
      setExpanded({})
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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

  function submitPost(event: FormEvent): void {
    event.preventDefault()
    if (!auth.session) {
      onRequireLogin()
      return
    }
    const content = draft.trim()
    if (!content) return
    void run(async () => {
      const res = await boardApi.createPost(auth.session?.token ?? '', content)
      setPosts((previous) => [res.post, ...previous])
      setDraft('')
    })
  }

  function submitReply(event: FormEvent, postId: number): void {
    event.preventDefault()
    if (!auth.session) {
      onRequireLogin()
      return
    }
    const content = (replyDrafts[postId] ?? '').trim()
    if (!content) return
    void run(async () => {
      await boardApi.createReply(auth.session?.token ?? '', postId, content)
      setReplyDrafts((previous) => ({ ...previous, [postId]: '' }))
      // 回完直接展开，让用户看到自己刚写的那条
      const res = await boardApi.replies(postId)
      setExpanded((previous) => ({ ...previous, [postId]: res.replies }))
      const list = await boardApi.list()
      setPosts(list.posts)
    })
  }

  function openAll(post: BoardPost): void {
    void run(async () => {
      const res = await boardApi.replies(post.id)
      setExpanded((previous) => ({ ...previous, [post.id]: res.replies }))
    })
  }

  const me = auth.user?.username

  return (
    <section className="panel-page">
      <h2 className="panel-title">留言板</h2>
      <p className="panel-lead">
        练下来的心得、题目问题、对站点的建议都可以写在这里。任何人都能看；
        {auth.session ? '发帖与回复已经可用。' : '登录之后才能发帖与回复。'}
      </p>

      <form className="board-compose" onSubmit={submitPost}>
        <textarea
          value={draft}
          maxLength={MAX_POST_LEN}
          rows={3}
          placeholder={auth.session ? '写点什么…' : '登录之后就能在这里发帖'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="board-compose-foot">
          <span className="board-count">
            {Array.from(draft).length} / {MAX_POST_LEN}
          </span>
          {auth.session ? (
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
              发帖
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onRequireLogin}>
              登录后发帖
            </button>
          )}
        </div>
      </form>

      {error ? <p className="auth-error">{error}</p> : null}
      {loading ? <p className="panel-lead">正在读留言…</p> : null}
      {!loading && posts.length === 0 ? <p className="panel-lead">还没有人留言，你可以是第一个。</p> : null}

      <ul className="board-list">
        {posts.map((post) => {
          const replies = expanded[post.id] ?? post.replies
          return (
            <li key={post.id} className="board-post">
              <div className="board-head">
                <span className="board-avatar">
                  {post.avatar ? <img src={post.avatar} alt="" /> : initialOf(post.username)}
                </span>
                <span className="board-user">{post.username}</span>
                <span className="board-time">{relativeTime(post.createdAt)}</span>
                {me === post.username ? (
                  <button
                    type="button"
                    className="board-delete"
                    onClick={() =>
                      void run(async () => {
                        await boardApi.deletePost(auth.session?.token ?? '', post.id)
                        setPosts((previous) => previous.filter((item) => item.id !== post.id))
                      })
                    }
                  >
                    删除
                  </button>
                ) : null}
              </div>

              <p className="board-content">{post.content}</p>

              {replies.length > 0 ? (
                <ul className="board-replies">
                  {replies.map((reply) => (
                    <li key={reply.id} className="board-reply">
                      <span className="board-avatar board-avatar-small">
                        {reply.avatar ? <img src={reply.avatar} alt="" /> : initialOf(reply.username)}
                      </span>
                      <span className="board-user">{reply.username}</span>
                      <span className="board-content-inline">{reply.content}</span>
                      <span className="board-time">{relativeTime(reply.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {post.replyCount > post.replies.length && !expanded[post.id] ? (
                <button type="button" className="board-more" onClick={() => openAll(post)}>
                  查看全部 {post.replyCount} 条回复
                </button>
              ) : null}

              <form className="board-reply-form" onSubmit={(event) => submitReply(event, post.id)}>
                <input
                  type="text"
                  value={replyDrafts[post.id] ?? ''}
                  maxLength={MAX_REPLY_LEN}
                  placeholder={auth.session ? '回复…' : '登录之后才能回复'}
                  onChange={(event) => setReplyDrafts((previous) => ({ ...previous, [post.id]: event.target.value }))}
                />
                {auth.session ? (
                  <button type="submit" className="btn btn-ghost" disabled={busy || !(replyDrafts[post.id] ?? '').trim()}>
                    回复
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={onRequireLogin}>
                    登录
                  </button>
                )}
              </form>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
