# 单文件打包
uv run python -m nuitka `
	--onefile `
	--windows-console-mode=disable `
	--lto=yes `
	--python-flag=-OO `
	--include-data-dir="src/wolffia/ui=ui" `
	--output-filename="wolffia.exe" `
	--output-dir="nuitka/onefile" `
	--assume-yes-for-downloads `
	main.py