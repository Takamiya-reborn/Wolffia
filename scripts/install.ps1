# 安装前后端依赖
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

uv sync
Push-Location ./wolffia-ui
npm install
npm run build
Pop-Location
