#!/bin/sh
# 启动 Electron 开发环境:后台 Vite 开发服务器 + Electron 窗口,退出时自动清理
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# VS Code 会给终端注入 ELECTRON_RUN_AS_NODE,导致 electron 以纯 Node 启动而非桌面应用
unset ELECTRON_RUN_AS_NODE

if [ ! -d wolffia-ui/node_modules ]; then
    (cd wolffia-ui && npm install)
fi

# --strictPort:5173 被占用时直接失败,而不是漂移端口导致 Electron 连错地址
(cd wolffia-ui && npm run dev -- --strictPort) &
vite_pid=$!

# 等待 Vite 就绪(最多 60 秒)
i=0
while [ $i -lt 120 ]; do
    if curl -s -o /dev/null -m 2 http://localhost:5173; then
        break
    fi
    sleep 0.5
    i=$((i + 1))
done
if [ $i -ge 120 ]; then
    kill $vite_pid 2>/dev/null
    echo "Vite 开发服务器 60 秒内未就绪,请检查 5173 端口占用" >&2
    exit 1
fi

(cd wolffia-ui && npm run electron:dev)

# 连子进程(node/vite)一起清理,防止孤儿进程常驻
kill $vite_pid 2>/dev/null
taskkill //PID $vite_pid //T //F 2>/dev/null
