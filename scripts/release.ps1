# 构建、打包产物并发布 GitHub Release(需先安装 gh 并 gh auth login)
# 用法: .\scripts\release.ps1 [-DryRun] [-SkipBuild]  # DryRun 不发布, SkipBuild 跳过构建
# 发布说明写在根目录 release-notes.md,存在则用作 release notes,否则自动生成
param(
	[switch]$DryRun,
	[switch]$SkipBuild,
	[string]$NotesFile = "release-notes.md"
)
$ErrorActionPreference = "Stop"

# 以脚本所在位置定位仓库根目录,与调用时的 cwd 无关
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$version = (Select-String -Path pyproject.toml -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
$tag = "v$version"
Write-Host "版本: $tag"

if (!$SkipBuild) {
	& "$root/nuitka-standalone.ps1"
	if ($LASTEXITCODE -ne 0) { throw "nuitka-standalone 失败" }
	& "$root/nuitka-onefile.ps1"
	if ($LASTEXITCODE -ne 0) { throw "nuitka-onefile 失败" }
	uv run pyinstaller wolffia-onefile.spec --noconfirm
	if ($LASTEXITCODE -ne 0) { throw "pyinstaller-onefile 失败" }
	uv run pyinstaller wolffia-onedir.spec --noconfirm
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

Write-Host "已生成:"
Get-ChildItem $releaseDir

if ($DryRun) { return }

if (Test-Path $NotesFile) {
	gh release create $tag (Get-ChildItem $releaseDir | ForEach-Object { $_.FullName }) --notes-file $NotesFile
} else {
	gh release create $tag (Get-ChildItem $releaseDir | ForEach-Object { $_.FullName }) --generate-notes
}
Write-Host "Release $tag 已发布: https://github.com/Takamiya-reborn/Wolffia/releases/tag/$tag"
