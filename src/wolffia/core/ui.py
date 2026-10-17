import os
import sys
from pathlib import Path

import webview

from wolffia.core.api import ApplicationMutex, PlayerApi, bring_existing_window_to_top

_MUTEX_NAME = "Local\\Wolffia.Application.SingleInstance"
_WINDOW_TITLE = "Wolffia"
MIN_WINDOW_WIDTH = 640
MIN_WINDOW_HEIGHT = 480

# WebView2 启动参数：压缩引擎常驻开销。
# 单页面播放器用不到的引擎特性全部关闭：
# - BackForwardCache：前进后退缓存会在内存里保留页面快照
# - AudioServiceOutOfProcess：音频服务并回浏览器进程，少一个常驻进程
# - Translate/背景联网/组件更新：本地工具无需任何后台网络活动
# - renderer-process-limit：限制渲染进程数量
# 用户已自行设置该环境变量时不覆盖
_BROWSER_ARGUMENTS = (
    "--renderer-process-limit=1 "
    "--disable-features=BackForwardCache,AudioServiceOutOfProcess,Translate "
    "--disable-background-networking "
    "--disable-component-update "
    "--disable-default-apps"
)


def _apply_browser_arguments():
    if os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"):
        return
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = _BROWSER_ARGUMENTS


def get_asset_path(filename):
    if getattr(sys, "frozen", False) or "__compiled__" in globals():
        roots = [
            Path(getattr(sys, "_MEIPASS", "")),
            Path(sys.executable).resolve().parent,
            Path(__file__).resolve().parents[1],
            Path(__file__).resolve().parents[2],
        ]
    else:
        roots = [Path(__file__).resolve().parents[1]]

    for root in roots:
        asset_path = root / "ui" / filename
        if asset_path.is_file():
            return os.fspath(asset_path)

    return os.fspath(roots[0] / "ui" / filename)


class PlayerWindow:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        html_path = get_asset_path("index.html")
        self.html_url = Path(html_path).resolve().as_uri()
        self._started = False
        self._application_mutex = None
        self._initialized = True

    def start(self):
        if self._started:
            return

        mutex = ApplicationMutex(_MUTEX_NAME)
        if not mutex.acquired:
            # 没拿到锁，唤醒已有窗口后直接退出
            bring_existing_window_to_top(_WINDOW_TITLE)
            return

        self._application_mutex = mutex
        api = PlayerApi()
        _apply_browser_arguments()
        try:
            webview.create_window(
                _WINDOW_TITLE,
                url=self.html_url,
                width=1280,
                height=720,
                background_color="#121212",
                js_api=api,
                min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
            )
            self._started = True
            webview.start()
        finally:
            api.close_static_server()
            mutex.release()
            self._application_mutex = None
