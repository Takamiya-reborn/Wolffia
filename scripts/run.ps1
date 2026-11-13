# 启动播放器,可选先构建前端
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if ($args[0] -eq "build") {
    Push-Location ./wolffia-ui
    npm run build
    Pop-Location
}
uv run wolffia
