# 目录模式打包
uv run python -m nuitka `
	--standalone `
	--windows-console-mode=disable `
	--lto=yes `
	--python-flag=-OO `
	--include-data-dir="src/wolffia/ui=ui" `
	--output-filename="wolffia.exe" `
	--output-dir="nuitka/standalone" `
	--assume-yes-for-downloads `
	main.py