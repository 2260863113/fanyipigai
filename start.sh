#!/usr/bin/env bash
# 本地一键启动（macOS / Linux / Git Bash / WSL）
#
# 用法：
#   ./start.sh                 启动并打开浏览器
#   ./start.sh --no-browser    只启动服务
#   ./start.sh --port 5200     换端口

set -euo pipefail
cd "$(dirname "$0")"

PORT=5180
OPEN_BROWSER=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-browser) OPEN_BROWSER=0 ;;
    --port) PORT="${2:-5180}"; shift ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }
bad() { printf '    \033[31m%s\033[0m\n' "$1"; }

echo
bold "  英语翻译练习站 · 本地开发服务"
echo "  ------------------------------------"

# 1. Node
echo "==> 检查 Node.js"
if ! command -v node >/dev/null 2>&1; then
  bad "没有找到 Node.js。请先安装：https://nodejs.org/（选 LTS 版本）"
  exit 1
fi
ok "Node $(node -v)"

# 2. 依赖
echo "==> 检查依赖"
if [ ! -d node_modules ]; then
  warn "还没有安装依赖，正在执行 npm install（第一次会比较慢）…"
  npm install --no-fund --no-audit
fi
ok "依赖已就绪"

# 3. 密钥
echo "==> 检查密钥文件 .dev.vars"
API_KEY=""
if [ -f .dev.vars ]; then
  API_KEY="$(grep -E '^DEEPSEEK_API_KEY=' .dev.vars | head -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi
if [ -z "$API_KEY" ]; then
  [ -f .dev.vars ] || cp .dev.vars.example .dev.vars
  warn "还没有填入 DeepSeek API 密钥。请编辑：$(pwd)/.dev.vars"
  warn "把 DEEPSEEK_API_KEY= 后面补上你的密钥（形如 sk-xxxx），保存后重新运行本脚本。"
  warn "没有密钥也能启动，只是提交批改会提示密钥缺失；此时可点「查看内置示例批改」。"
else
  ok "已读到密钥"
fi

# 4. 端口
echo "==> 检查端口 $PORT"
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  warn "端口 $PORT 已被占用。可以改用：./start.sh --port 5200"
  exit 1
fi
ok "端口 $PORT 空闲"

# 5. 启动
URL="http://127.0.0.1:$PORT/"
echo
echo "==> 启动开发服务（$URL）"
echo "    按 Ctrl+C 停止。"

if [ "$OPEN_BROWSER" -eq 1 ]; then
  (
    for _ in $(seq 1 60); do
      if command -v curl >/dev/null 2>&1 && curl -sf -o /dev/null "$URL"; then
        if command -v open >/dev/null 2>&1; then open "$URL"
        elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
        fi
        break
      fi
      sleep 0.5
    done
  ) &
fi

npm run dev -- --port "$PORT"
