#!/bin/bash
# Keep Vite in the foreground; only browser readiness runs in a helper.
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

url='http://localhost:5173/'
startup_log="$(mktemp "${TMPDIR:-/tmp}/construction-tracker-frontend.XXXXXX")" || fail "无法创建临时启动日志。"
opener_pid=''
cleanup() {
  if [[ -n "$opener_pid" ]]; then
    kill "$opener_pid" 2>/dev/null || true
    wait "$opener_pid" 2>/dev/null || true
  fi
  rm -f -- "$startup_log"
}
trap cleanup EXIT
trap 'exit 130' INT

open_when_ready() {
  local attempt
  for ((attempt = 0; attempt < 120; attempt++)); do
    # Vite prints its URL only after successfully listening. Checking this
    # avoids opening a different service when the strict port is occupied.
    if grep -Fq "$url" "$startup_log" &&
      curl --noproxy '*' --silent --fail --max-time 1 "$url" >/dev/null 2>&1; then
      printf '\n前端已就绪：%s\n' "$url"
      if ! /usr/bin/open -a "Google Chrome" "$url" 2>/dev/null; then
        printf '无法自动打开 Google Chrome，请手动访问：%s\n' "$url"
      fi
      return
    fi
    sleep 0.25
  done
  printf '\n尚未确认首页就绪，未打开浏览器。请检查 Vite 输出；就绪后可访问：%s\n' "$url" >&2
}

printf '正在启动前端；5173 端口被占用时会报错。按 Ctrl+C 停止。\n'
open_when_ready &
opener_pid=$!
npm run dev -- --host localhost --port 5173 --strictPort --clearScreen false 2>&1 | tee "$startup_log"
status=$?
if [[ "$status" -eq 130 ]]; then
  printf '\n前端服务器已停止。\n'
elif [[ "$status" -ne 0 ]]; then
  printf '\n前端启动或运行失败（退出码 %s）。请检查上方错误；不会自动安装依赖或切换端口。\n' "$status" >&2
fi
exit "$status"
