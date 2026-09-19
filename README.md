<div align="center">

# Wolffia

**Windows 平台的自用极简本地音乐播放器**

选择音乐目录，播放本地音频，显示同步歌词。

</div>

![Windows](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.13%2B-3776AB?logo=python&logoColor=white)
![Vite](https://img.shields.io/badge/Frontend-Vite-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?logo=opensourceinitiative&logoColor=white)

Wolffia 面向个人本地音乐库，重点是打开即用：选择音乐文件夹后生成播放列表，在桌面窗口中播放音频和显示歌词。它起因于 Windows 播放器的歌词显示不够顺手，以及 MPC-BE 播放纯音频时没有视频轨，导致字幕文件无法加载，所以做了一个更轻量、功能更针对自己的播放器。

## 功能

- 选择本地音乐文件夹并递归生成可展开的播放列表
- 子目录默认折叠，展开时懒加载其中的音频文件
- 使用 Windows 风格的自然名称排序，支持数字序号和符号名称
- 支持 `MP3`、`FLAC`、`WAV` 和 `M4A`
- 在音频所在目录查找同名的 `.lrc` 或 `.vtt` 歌词文件
- 解析 LRC 时间标签或 Cue 时间轴并高亮当前歌词
- 提供三种播放方式
- 使用本机 HTTP Range 服务读取音频，适合大文件播放
- 可打包单个 Windows `.exe`，免安装
- 如果担心程序经常读写磁盘Temp消耗磁盘寿命，就使用onedir打包后的

## 快捷键

- `空格`：开始/暂停播放
- `M`：静音
- `←`/`→`：快进/快退 5s
- `↑`/`↓`：音量 +5%/-5%
- 鼠标滚轮调节音量

## 技术栈

### 桌面与后端

| 技术                                                                                                   | 用途                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------- |
| ![Python](https://img.shields.io/badge/Python-3.13%2B-3776AB?logo=python&logoColor=white)              | 应用主程序和本地服务             |
| ![pywebview](https://img.shields.io/badge/pywebview-Desktop-5A29E4?logo=webcomponents&logoColor=white) | 创建桌面窗口并加载播放器页面     |
| ![uv](https://img.shields.io/badge/uv-Tooling-DE5FE9?logo=astral&logoColor=white)                      | 管理 Python 环境、依赖和项目命令 |

### 前端

| 技术                                                                                                     | 用途                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| ![Vite](https://img.shields.io/badge/Vite-Vanilla-646CFF?logo=vite&logoColor=white)                      | 前端项目脚手架、开发服务器和生产构建      |
| ![JavaScript](https://img.shields.io/badge/JavaScript-Web%20API-F7DF1E?logo=javascript&logoColor=111111) | 播放列表、音频播放和歌词逻辑              |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&logoColor=white)   | 样式工具链，通过 `@tailwindcss/vite` 接入 |

前端不是传统意义上的“纯原生项目”，而是使用 **Vite 的 Vanilla 模板**搭建；业务逻辑主要通过原生 JavaScript 和 Web API 实现，没有引入 React、Vue 等前端框架。

### 构建

| 技术                                                                                                  | 用途                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![PyInstaller](https://img.shields.io/badge/PyInstaller-Packaging-3D3D3D?logo=python&logoColor=white) | 将 Python 程序、前端静态文件和运行时依赖打包为 Windows 可执行文件 |
| ![Nuitka](https://img.shields.io/badge/Nuitka-Compiler-4B8BBE?logo=python&logoColor=white)            | 将 Python 程序编译并打包为 Windows 可执行文件                     |

## 项目结构

```text
wolffia/
├── main.py                         # PyInstaller 使用的程序入口
├── pyproject.toml                  # Python 项目元数据、依赖和 wolffia 命令
├── wolffia-onedir.spec             # PyInstaller 目录模式配置
├── wolffia-onefile.spec            # PyInstaller 单文件模式配置
├── nuitka-onedir.ps1               # Nuitka 目录模式打包脚本
├── nuitka-onefile.ps1              # Nuitka 单文件模式打包脚本
├── wolffia-ui/                     # 前端源码项目
│   ├── package.json                # npm 脚本和前端开发依赖
│   ├── vite.config.js              # Vite 配置，构建到 src/wolffia/ui
│   └── src/
│       ├── main.js                 # 播放列表、音频播放和歌词逻辑
│       └── style.css               # 播放器样式
└── src/wolffia/                    # Python 应用包
	├── __init__.py                 # 创建 PlayerWindow 并启动应用
	├── core/
	│   ├── scanner.py              # 递归扫描音频并查找同目录歌词
	│   ├── server.py               # 本地静态文件和 Range HTTP 服务
	│   |── ui.py                   # pywebview 窗口、文件夹选择和 API
	|   └── ...
	└── ui/                         # 前端构建产物，打包时嵌入应用
		├── index.html
		└── assets/
```

运行流程如下：Python 启动 `pywebview` 窗口并加载 `src/wolffia/ui/index.html`；用户选择音乐目录后，Python 递归扫描音频并按相对路径生成目录树，在每个音频所在目录查找同名歌词文件，然后在 `127.0.0.1` 的动态端口启动本地服务；前端默认折叠目录，并在用户展开时懒加载子节点，通过该服务加载音频和歌词。

## 环境要求

- Windows 桌面环境
- [Python](https://www.python.org/) `>= 3.13`
- [uv](https://docs.astral.sh/uv/)
- [Node.js](https://nodejs.org/) 和 npm（仅在修改或重新构建前端时需要）
- C/C++ 编译器（Nuitka需要将python转换成C/C++，然后编译）
  > 注：如果没有，首次打包会自行下载C/C++编译器

## 开发运行

### 1. 安装前后端依赖

根目录脚本安装依赖：

Windows PowerShell：

```powershell
.\install.ps1
```

Linux Bash：

```bash
./install.sh
```

也可以手动安装 Python 依赖：

在项目根目录执行：

```
uv sync
```

在前端目录安装 node 依赖:

```
cd wolffia-ui
npm i
```

### 2. 构建前端

如果没有使用安装脚本，或者前端源码发生了改动，需要重新生成 Python 包中的前端构建产物：

```powershell
cd wolffia-ui
npm run build
cd ..
```

前端单独启动：

```powershell
cd wolffia-ui
npm run dev
```

当前桌面程序默认加载构建后的本地 HTML，不会自动连接 Vite 开发服务器。

### 3. 启动播放器

启动脚本：

Windows PowerShell：

```powershell
.\run.ps1 [build]
```

Linux Bash 环境：

```bash
./run.sh [build]
```

添加 `build` 参数时，脚本会先重新构建前端，再启动播放器。

也可以使用命令行启动

```powershell
uv run wolffia
```

启动后双击播放区域，选择包含音乐文件的目录即可。播放器不会上传音乐文件，音频和歌词只通过本机回环地址提供给桌面窗口。

## 构建 Windows 程序

如果前端源码有改动，先完成前端构建，然后在项目根目录选择一种打包方式。

### 使用 PyInstaller

目录模式：

```powershell
uv run python -m PyInstaller wolffia-onedir.spec
```

单文件模式：

```powershell
uv run python -m PyInstaller wolffia-onefile.spec
```

两个 spec 文件都会将 `src/wolffia/ui/` 作为数据目录嵌入程序，并生成无控制台窗口的 `wolffia.exe`。目录模式会生成程序目录及其依赖文件，单文件模式会生成独立的可执行文件，构建结果位于 `dist/` 目录。

也可以直接使用命令行配置打包单文件版本：

```powershell
uv run python -m PyInstaller --onefile --noconsole --name wolffia --add-data "src\wolffia\ui;ui" main.py
```

### 使用 Nuitka

目录模式：

```powershell
.\nuitka-onedir.ps1
```

单文件模式：

```powershell
.\nuitka-onefile.ps1
```

两个脚本都会使用 Nuitka 编译 Python 程序，将 `src/wolffia/ui/` 作为 `ui` 数据目录嵌入，并关闭控制台窗口。目录模式的构建结果位于 `nuitka/onedir/`，单文件模式的构建结果位于 `nuitka/onefile/`。

## 部署与使用

本项目是 Windows 本地桌面应用，不需要部署到服务器，也不需要数据库或外部服务。最简单的分发方式是：

1. 在 Windows 环境完成依赖安装、前端构建和 PyInstaller 或 Nuitka 打包。
2. 双击运行程序，并选择目标电脑上的音乐目录。

目标电脑通常不需要安装 Python、Node.js 或 uv，因为依赖已经由 PyInstaller 打包进 `.exe`。程序运行时会在 `127.0.0.1` 上随机选择空闲端口，仅供当前桌面窗口访问。

## 歌词格式

歌词文件需要与音频文件位于同一目录，并使用相同的文件名主体：

```text
音乐目录/
├── 夜曲.mp3
├── 夜曲.lrc
├── 晴天.flac
└── 晴天.flac.vtt
```

播放器支持 LRC 和 WebVTT（`.vtt`）歌词格式。LRC 使用去掉音频扩展名后的文件名，
WebVTT 使用完整音频文件名再追加 `.vtt`。例如，LRC 使用以下时间标签：

```text
[00:12.50]第一句歌词
[00:17.80]第二句歌词
```

WebVTT 使用标准 cue 时间轴：

```text
WEBVTT

00:00:12.500 --> 00:00:17.800
第一句歌词
```
