# PyInstaller 单文件模式打包脚本
# 用法: .\pyinstaller-onefile.ps1
# 产物: dist/wolffia.exe
uv run pyinstaller wolffia-onefile.spec --noconfirm
