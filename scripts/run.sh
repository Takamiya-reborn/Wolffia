#!/bin/sh
# 启动播放器,可选先构建前端
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ "$1" = "build" ]; then
    (cd ./wolffia-ui && npm run build)
fi
uv run wolffia
