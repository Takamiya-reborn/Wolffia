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

- 选择本地音乐文件夹并生成播放列表
- 支持 `MP3`、`FLAC`、`WAV` 和 `M4A`
- 查找与音频同名的 `.lrc` 或 `.vtt` 歌词文件
- 解析 LRC 时间标签并高亮当前歌词
- 播放结束后自动播放下一首
- 使用本机 HTTP Range 服务读取音频，适合大文件播放
- 可打包为无控制台窗口的单个 Windows `.exe`

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

## 项目结构

```text
wolffia/
├── main.py                         # PyInstaller 使用的程序入口
├── pyproject.toml                  # Python 项目元数据、依赖和 wolffia 命令
├── wolffia.spec                    # PyInstaller 打包配置
├── wolffia-ui/                     # 前端源码项目
│   ├── package.json                # npm 脚本和前端开发依赖
│   ├── vite.config.js              # Vite 配置，构建到 src/wolffia/ui
│   └── src/
│       ├── main.js                 # 播放列表、音频播放和歌词逻辑
│       └── style.css               # 播放器样式
└── src/wolffia/                    # Python 应用包
	├── __init__.py                 # 创建 PlayerWindow 并启动应用
	├── core/
	│   ├── scanner.py              # 扫描音频和同名歌词文件
	│   ├── server.py               # 本地静态文件和 Range HTTP 服务
	│   └── ui.py                   # pywebview 窗口、文件夹选择和 API
	└── ui/                         # 前端构建产物，打包时嵌入应用
		├── index.html
		└── assets/
```

运行流程如下：Python 启动 `pywebview` 窗口并加载 `src/wolffia/ui/index.html`；用户选择音乐目录后，Python 扫描第一层文件并在 `127.0.0.1` 的动态端口启动本地服务；前端通过该服务加载音频和歌词。

## 环境要求

- Windows 桌面环境
- Python `>= 3.13`
- [uv](https://docs.astral.sh/uv/)
- Node.js 和 npm（仅在修改或重新构建前端时需要）

## 开发运行

### 1. 安装 Python 依赖

在项目根目录执行：

```powershell
uv sync
```

### 2. 构建前端

前端构建产物必须先生成到 Python 包的 UI 目录：

```powershell
cd wolffia-ui
npm install
npm run build
cd ..
```

开发调试时也可以单独启动 Vite：

```powershell
cd wolffia-ui
npm run dev
```

当前桌面程序默认加载构建后的本地 HTML，不会自动连接 Vite 开发服务器。

### 3. 启动播放器

回到项目根目录执行：

```powershell
uv run wolffia
```

启动后双击播放区域，选择包含音乐文件的目录即可。播放器不会上传音乐文件，音频和歌词只通过本机回环地址提供给桌面窗口。

## 构建 Windows 程序

如果前端源码有改动，先完成前端构建，然后在项目根目录执行：

```powershell
uv run python -m PyInstaller wolffia.spec
```

`wolffia.spec` 会将 `src/wolffia/ui/` 作为数据目录嵌入程序，并生成无控制台窗口的可执行文件。构建结果位于：

```text
dist/wolffia.exe
```

也可以直接使用命令行配置打包：

```powershell
uv run python -m PyInstaller --onefile --noconsole --name wolffia --add-data "src\wolffia\ui;ui" main.py
```

## 部署与使用

本项目是 Windows 本地桌面应用，不需要部署到服务器，也不需要数据库或外部服务。最简单的分发方式是：

1. 在 Windows 环境完成依赖安装、前端构建和 PyInstaller 打包。
2. 双击运行程序，并选择目标电脑上的音乐目录。

目标电脑通常不需要安装 Python、Node.js 或 uv，因为依赖已经由 PyInstaller 打包进 `.exe`。程序运行时会在 `127.0.0.1` 上随机选择空闲端口，仅供当前桌面窗口访问。

## 歌词格式

歌词文件需要与音频文件位于同一目录，并使用相同的文件名主体：

```text
音乐目录/
├── 夜曲.mp3
├── 夜曲.lrc
├── 晴天.flac
└── 晴天.vtt
```

当前歌词解析逻辑使用 LRC 时间标签格式，例如：

```text
[00:12.50]第一句歌词
[00:17.80]第二句歌词
```