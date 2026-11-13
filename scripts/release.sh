#!/bin/sh
# 构建、打包产物并发布 GitHub Release(需先安装 gh 并 gh auth login)
# 用法: ./scripts/release.sh [--dry-run] [--skip-build]  # --dry-run 不发布, --skip-build 跳过构建
# 发布说明写在根目录 release-notes.md,存在则用作 release notes,否则自动生成
set -e

# 以脚本所在位置定位仓库根目录,与调用时的 cwd 无关
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

dry_run=0
skip_build=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) dry_run=1 ;;
		--skip-build) skip_build=1 ;;
		*) echo "未知参数: $arg" >&2; exit 1 ;;
	esac
done

version="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml | head -n 1)"
tag="v$version"
echo "版本: $tag"

if [ "$skip_build" -eq 0 ]; then
	uv run python -m nuitka \
		--standalone \
		--windows-console-mode=disable \
		--lto=yes \
		--python-flag=-OO \
		--include-data-dir="src/wolffia/ui=ui" \
		--output-filename="wolffia.exe" \
		--output-dir="nuitka/standalone" \
		--assume-yes-for-downloads \
		main.py
	uv run python -m nuitka \
		--onefile \
		--windows-console-mode=disable \
		--lto=yes \
		--python-flag=-OO \
		--include-data-dir="src/wolffia/ui=ui" \
		--output-filename="wolffia.exe" \
		--output-dir="nuitka/onefile" \
		--assume-yes-for-downloads \
		main.py
	uv run pyinstaller wolffia-onefile.spec --noconfirm
	uv run pyinstaller wolffia-onedir.spec --noconfirm
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

echo "已生成:"
ls -lh release

[ "$dry_run" -eq 1 ] && exit 0

if [ -f "$root/release-notes.md" ]; then
	gh release create "$tag" release/* --notes-file "$root/release-notes.md"
else
	gh release create "$tag" release/* --generate-notes
fi
echo "Release $tag 已发布: https://github.com/Takamiya-reborn/Wolffia/releases/tag/$tag"
