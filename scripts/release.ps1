# 构建、打包产物并整理到 release/ 目录
# 用法: .\scripts\release.ps1 <版本号> [-SkipBuild]
#   版本号为必填参数,脚本会把它写入 pyproject.toml 与 wolffia-ui/package.json
#   例如 .\scripts\release.ps1 0.1.7 -SkipBuild
param(
	[Parameter(Mandatory = $true, Position = 0)][string]$Version,
	[switch]$SkipBuild
)
$ErrorActionPreference = "Stop"

# 以脚本所在位置定位仓库根目录,与调用时的 cwd 无关
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if ($Version -notmatch '^\d+\.\d+\.\d+(-[\w.]+)?$') { throw "版本号格式不合法: $Version(期望形如 0.1.7)" }

# 发布脚本是版本的生产者:写入 pyproject.toml(无 BOM UTF-8)
$pyprojectPath = "$root/pyproject.toml"
$pyproject = [System.IO.File]::ReadAllText($pyprojectPath)
$pyproject = $pyproject -replace '(?m)^version\s*=\s*"[^"]*"', "version = `"$Version`""
[System.IO.File]::WriteAllText($pyprojectPath, $pyproject, [System.Text.UTF8Encoding]::new($false))

# 同步 wolffia-ui/package.json 与 package-lock.json
Push-Location "$root/wolffia-ui"
npm version $Version --no-git-tag-version --allow-same-version
if ($LASTEXITCODE -ne 0) { throw "npm version 失败" }
Pop-Location

$version = $Version
$tag = "v$version"
Write-Host "版本: $tag"

if (!$SkipBuild) {
	# Electron 线打 NSIS 安装包;build:electron 内含 UI 构建,产物同时供 Python 打包使用
	Push-Location "$root/wolffia-ui"
	npm install
	if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
	npm run build:electron
	if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }
	npm run build:portable
	if ($LASTEXITCODE -ne 0) { throw "electron portable 打包失败" }
	Pop-Location

	& "$root/nuitka-standalone.ps1"
	if ($LASTEXITCODE -ne 0) { throw "nuitka-standalone 失败" }
	& "$root/nuitka-onefile.ps1"
	if ($LASTEXITCODE -ne 0) { throw "nuitka-onefile 失败" }
	& "$root/pyinstaller-onefile.ps1"
	if ($LASTEXITCODE -ne 0) { throw "pyinstaller-onefile 失败" }
	& "$root/pyinstaller-onedir.ps1"
	if ($LASTEXITCODE -ne 0) { throw "pyinstaller-onedir 失败" }
}

# release 目录:每次发布清空重建
$releaseDir = "release"
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Force $releaseDir | Out-Null

# nuitka onefile
$src = "nuitka/onefile/wolffia.exe"
if (!(Test-Path $src)) { throw "找不到 $src" }
Copy-Item $src "$releaseDir/Wolffia_${tag}_nuitka_onefile.exe"

# pyinstaller onefile
$src = "dist/wolffia.exe"
if (!(Test-Path $src)) { throw "找不到 $src" }
Copy-Item $src "$releaseDir/Wolffia_${tag}_pyi_onefile.exe"

# nuitka onedir -> zip
$src = "nuitka/standalone/main.dist"
if (!(Test-Path $src)) { throw "找不到 $src" }
Compress-Archive -Path "$src/*" -DestinationPath "$releaseDir/Wolffia_${tag}_nuitka_standalone.zip"

# pyinstaller onedir -> zip
$src = "dist/wolffia"
if (!(Test-Path $src)) { throw "找不到 $src" }
Compress-Archive -Path "$src/*" -DestinationPath "$releaseDir/Wolffia_${tag}_pyi_onedir.zip"

# electron NSIS 安装包
$src = "wolffia-ui/dist-electron/Wolffia-${version}-electron-setup.exe"
if (!(Test-Path $src)) { throw "找不到 $src" }
[System.IO.File]::Copy((Resolve-Path $src), "$root/$releaseDir/Wolffia_${tag}_electron_setup.exe", $true)

# electron 便携版
$src = "wolffia-ui/dist-electron/Wolffia-${version}-portable.exe"
if (!(Test-Path $src)) { throw "找不到 $src" }
[System.IO.File]::Copy((Resolve-Path $src), "$root/$releaseDir/Wolffia_${tag}_electron_portable.exe", $true)

Write-Host "已生成:"
Get-ChildItem $releaseDir
