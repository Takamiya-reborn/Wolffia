import os
import sys
import webview
from pathlib import Path
from wolffia.core.api import PlayerApi, ApplicationMutex, bring_existing_window_to_top

MIN_WINDOW_WIDTH = 640
MIN_WINDOW_HEIGHT = 480
_MUTEX_NAME = "Local\\Wolffia.Application.SingleInstance"
_WINDOW_TITLE = "Wolffia"


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
