#!/bin/sh
# 安装前后端依赖
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

uv sync
(cd ./wolffia-ui && npm install && npm run build)
