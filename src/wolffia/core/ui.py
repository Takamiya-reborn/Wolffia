import os
import sys
from pathlib import Path

import webview

from wolffia.core.api import PlayerApi

MIN_WINDOW_WIDTH = 700
MIN_WINDOW_HEIGHT = 500


# 新增：兼容打包环境的路径查找函数
def get_asset_path(filename):
    # 如果是被 PyInstaller 打包成 exe 运行的
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        base_dir = sys._MEIPASS
    # 否则是正常的开发环境
    else:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, "ui", filename)


class PlayerWindow:
    def __init__(self):
        html_path = get_asset_path("index.html")
        self.html_url = Path(html_path).resolve().as_uri()

    def start(self):
        api = PlayerApi()
        window = webview.create_window(
            "极简特化播放器",
            url=self.html_url,
            width=900,
            height=650,
            background_color="#121212",
            js_api=api,
            min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        )
        webview.start()


