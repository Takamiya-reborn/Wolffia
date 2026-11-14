#!/bin/sh
# 构建、打包产物并整理到 release/ 目录
# 用法: ./scripts/release.sh <版本号> [--skip-build]
#   版本号为必填参数,脚本会把它写入 pyproject.toml 与 wolffia-ui/package.json
#   例如 ./scripts/release.sh 0.1.7 --skip-build
set -e

# 以脚本所在位置定位仓库根目录,与调用时的 cwd 无关
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version=""
skip_build=0
for arg in "$@"; do
	case "$arg" in
		--skip-build) skip_build=1 ;;
		-*) echo "未知参数: $arg" >&2; exit 1 ;;
		*) version="$arg" ;;
	esac
done

[ -n "$version" ] || { echo "缺少版本号参数,用法: ./scripts/release.sh <版本号> [--skip-build]" >&2; exit 1; }
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || {
	echo "版本号格式不合法: $version(期望形如 0.1.7)" >&2
	exit 1
}

# 发布脚本是版本的生产者:写入 pyproject.toml
sed -i "s/^version = \"[^\"]*\"/version = \"$version\"/" pyproject.toml

# 同步 wolffia-ui/package.json 与 package-lock.json
(cd "$root/wolffia-ui" && npm version "$version" --no-git-tag-version --allow-same-version)

tag="v$version"
echo "版本: $tag"

if [ "$skip_build" -eq 0 ]; then
	# Electron 线打 NSIS 安装包;build:electron 内含 UI 构建,产物同时供 Python 打包使用
	(
		cd "$root/wolffia-ui"
		npm install
		npm run build:electron
		npm run build:portable
	)

	# 打包细节全部在各打包脚本内,这里只负责调用
	powershell -NoProfile -ExecutionPolicy Bypass -File "$root/nuitka-standalone.ps1"
	powershell -NoProfile -ExecutionPolicy Bypass -File "$root/nuitka-onefile.ps1"
	powershell -NoProfile -ExecutionPolicy Bypass -File "$root/pyinstaller-onefile.ps1"
	powershell -NoProfile -ExecutionPolicy Bypass -File "$root/pyinstaller-onedir.ps1"
fi

# release 目录:每次发布清空重建
rm -rf release
mkdir -p release

[ -f nuitka/onefile/wolffia.exe ] || { echo "找不到 nuitka/onefile/wolffia.exe" >&2; exit 1; }
cp nuitka/onefile/wolffia.exe "release/Wolffia_${tag}_nuitka_onefile.exe"

[ -f dist/wolffia.exe ] || { echo "找不到 dist/wolffia.exe" >&2; exit 1; }
cp dist/wolffia.exe "release/Wolffia_${tag}_pyi_onefile.exe"

[ -d nuitka/standalone/main.dist ] || { echo "找不到 nuitka/standalone/main.dist" >&2; exit 1; }
(cd nuitka/standalone/main.dist && zip -qr "$root/release/Wolffia_${tag}_nuitka_standalone.zip" .)

[ -d dist/wolffia ] || { echo "找不到 dist/wolffia" >&2; exit 1; }
(cd dist/wolffia && zip -qr "$root/release/Wolffia_${tag}_pyi_onedir.zip" .)

[ -f "wolffia-ui/dist-electron/Wolffia-${version}-electron-setup.exe" ] || { echo "找不到 wolffia-ui/dist-electron/Wolffia-${version}-electron-setup.exe" >&2; exit 1; }
cp "wolffia-ui/dist-electron/Wolffia-${version}-electron-setup.exe" "release/Wolffia_${tag}_electron_setup.exe"

[ -f "wolffia-ui/dist-electron/Wolffia-${version}-portable.exe" ] || { echo "找不到 wolffia-ui/dist-electron/Wolffia-${version}-portable.exe" >&2; exit 1; }
cp "wolffia-ui/dist-electron/Wolffia-${version}-portable.exe" "release/Wolffia_${tag}_electron_portable.exe"

echo "已生成:"
ls -lh release
