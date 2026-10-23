#!/bin/bash
# Start the local frontend and stop it after the page disconnects.
set -uo pipefail

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
cd "$project_dir/frontend" || fail "找不到 frontend/ 目录。"

# Finder's Terminal session may not have Homebrew on PATH.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || fail "未找到 Node.js，请先安装并配置 PATH。"
node --version >/dev/null 2>&1 || fail "Node.js 无法运行，请检查本机安装。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm，请先配置本机环境。"
npm --version >/dev/null 2>&1 || fail "npm 无法运行，请检查本机安装。"
if [[ ! -d node_modules || ! -x node_modules/.bin/vite ]]; then
  fail "前端依赖尚未就绪。请先在 frontend/ 中手动运行 npm ci，再重新启动；本脚本不会安装依赖。"
fi
command -v lsof >/dev/null 2>&1 || fail "未找到 lsof，无法检查端口占用和监测页面连接。"

port=5173
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "端口 5173 已被占用，请先停止占用该端口的服务。"
fi
url="http://localhost:$port/"
startup_log="$(mktemp "${TMPDIR:-/tmp}/construction-tracker-vite.XXXXXX")" || fail "无法创建临时启动日志。"
server_pid=''
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f -- "$startup_log"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '正在启动前端，使用端口 %s；按 Ctrl+C 也可停止。\n' "$port"
./node_modules/.bin/vite --host localhost --port "$port" --strictPort --clearScreen false >"$startup_log" 2>&1 &
server_pid=$!
ready=0
for ((attempt = 0; attempt < 120; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$startup_log" >&2
    fail "Vite 启动失败，请检查上方错误。"
  fi
  # Match this Vite process's startup output before probing the address.
  if grep -Fq "$url" "$startup_log" &&
    curl --noproxy '*' --silent --fail --max-time 1 "$url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
[[ "$ready" -eq 1 ]] || { cat "$startup_log" >&2; fail "前端未能在 30 秒内就绪。"; }
printf '前端已就绪：%s\n' "$url"
if ! /usr/bin/open -a "Google Chrome" "$url" 2>/dev/null; then
  printf '无法自动打开 Google Chrome，请手动访问：%s\n' "$url"
fi
printf '关闭所有使用本次地址的页面后，服务器将自动停止；按 Ctrl+C 可立即停止。\n'

# Vite holds a development WebSocket while a page is open. Give reloads and
# brief reconnects time to recover before considering the page closed.
seen_page=0
idle_seconds=0
while kill -0 "$server_pid" 2>/dev/null; do
  if lsof -nP -a -p "$server_pid" -iTCP:"$port" -sTCP:ESTABLISHED >/dev/null 2>&1; then
    seen_page=1
    idle_seconds=0
  elif [[ "$seen_page" -eq 1 ]]; then
    ((idle_seconds += 1))
    if [[ "$idle_seconds" -ge 5 ]]; then
      printf '页面已关闭，正在停止本次前端服务：%s\n' "$url"
      exit 0
    fi
  fi
  sleep 1
done
cat "$startup_log" >&2
fail "Vite 意外退出，请检查上方错误。"
