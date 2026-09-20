# 目录模式打包
uv run python -m nuitka `
	--standalone `
	--windows-console-mode=disable `
	--lto=yes `
	--python-flag=-OO `
	--include-data-dir="src/wolffia/ui=ui" `
	--output-filename="wolffia.exe" `
	--output-dir="nuitka/onedir" `
	--assume-yes-for-downloads `
	main.py