# Electron NSIS 安装包打包脚本
# 用法: .\electron-nsis.ps1
# 产物: wolffia-ui/dist-electron/Wolffia_<版本>-electron-setup.exe
$ErrorActionPreference = "Stop"

# 脚本位于仓库根目录,与调用时的 cwd 无关
$root = $PSScriptRoot
Set-Location "$root/wolffia-ui"

# pyproject.toml 是版本源,打包前同步到 package.json(artifactName 引用该版本)
$version = (Select-String -Path "$root/pyproject.toml" -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
npm pkg set "version=$version"

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

# 打包脚本(含 UI 构建),镜像走 .npmrc 与 package.json 的项目级配置
npm run build:electron
if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }

Write-Host "产物: wolffia-ui/dist-electron/Wolffia_$version-electron-setup.exe"
