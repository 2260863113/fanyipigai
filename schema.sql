-- 账号、会话、留言板与访问日志的 D1 表结构。
--
-- 来源：这套结构复用自「地图记忆」（D:\Desktop\地图记忆\schema.sql），去掉它那里的
--       leaderboard（那是它的拼图/无尽榜）与 announcements（公告）两张表，
--       以及 users 里的 hometown（地图站填的是"家乡"，对这个站没有意义）。
--
-- 密码方案（照搬，别改）：**浏览器端算 PBKDF2-SHA-256**（120000 次迭代、随机 16 字节 salt），
-- 明文密码从不发到服务端，库里只存 salt 与哈希结果。理由见 ADR 0028。
--
-- 会话：token 明文只发给浏览器，库里只存它的 SHA-256 摘要——库被看到也拿不到能用的 token。

-- 账号表
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_salt       TEXT    NOT NULL,              -- base64(16B)
  password_hash       TEXT    NOT NULL,              -- base64(32B)
  password_iterations INTEGER NOT NULL DEFAULT 120000,
  avatar              TEXT,                          -- JSON 或 NULL {dataUrl,name,size,type}（dataUrl≤40KB 文本）
  is_admin            INTEGER NOT NULL DEFAULT 0,    -- 1 = 管理员（没有自助入口，用 SQL 指定，见 README）
  created_at          INTEGER NOT NULL,              -- epoch ms
  updated_at          INTEGER NOT NULL
);

-- 会话表：token 明文只发给前端，库中只存 SHA-256 摘要
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 留言板：帖子（登录后可发，≤200 字）
CREATE TABLE IF NOT EXISTS board_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_posts_created ON board_posts(created_at DESC);

-- 留言板：回复（针对某帖，≤100 字；删帖级联删回复）
CREATE TABLE IF NOT EXISTS board_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_replies_post ON board_replies(post_id, created_at);

-- 访问日志：每次打开站点一条（不含 IP），user_id 为 NULL 表示游客
CREATE TABLE IF NOT EXISTS access_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,                               -- NULL = 游客
  ua         TEXT,                                  -- User-Agent
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at DESC);

-- ⚠️ 建完之后**没有**管理员：`is_admin` 没有自助入口（注册接口一律写 0）。
-- 指定第一个管理员：
--   npx wrangler d1 execute fanyipigai-db --remote \
--     --command "UPDATE users SET is_admin = 1 WHERE username = '你的用户名'"
