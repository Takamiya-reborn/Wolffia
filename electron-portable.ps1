# Electron 便携版打包脚本(单文件免安装 exe)
# 用法: .\electron-portable.ps1
# 产物: wolffia-ui/dist-electron/Wolffia-portable.exe
$ErrorActionPreference = "Stop"

# 脚本位于仓库根目录,与调用时的 cwd 无关
$root = $PSScriptRoot
Set-Location "$root/wolffia-ui"

# pyproject.toml 是版本源,打包前同步到 package.json(artifactName 引用该版本)
$version = (Select-String -Path "$root/pyproject.toml" -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
npm pkg set "version=$version"

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

# electron-builder 不清理输出目录,残留旧版本产物会越积越乱,打包前整体清空
Remove-Item "$root/wolffia-ui/dist-electron" -Recurse -Force -ErrorAction SilentlyContinue

# 打包脚本(含 UI 构建),镜像走 .npmrc 与 package.json 的项目级配置
npm run build:portable
if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }

Write-Host "产物: wolffia-ui/dist-electron/Wolffia-portable.exe"
