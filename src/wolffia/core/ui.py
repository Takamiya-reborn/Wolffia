import webview
import tkinter as tk
from tkinter import filedialog
import os
from pathlib import Path
import socket
import sys
import threading
from wolffia.core.scanner import scan_folder
from wolffia.core.server import start_static_server


def select_folder():
    root = tk.Tk()
    root.withdraw()
    folder = filedialog.askdirectory(title="选择音乐文件夹")
    root.destroy()
    return folder


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
        window = webview.create_window(
            "极简特化播放器",
            url=self.html_url,
            width=900,
            height=650,
            background_color="#121212",
            js_api=PlayerApi(),
        )
        webview.start()


class PlayerApi:
    def select_folder(self):
        folder = select_folder()
        if not folder:
            return None

        songs = scan_folder(folder)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]

        server_thread = threading.Thread(
            target=start_static_server, args=(folder, port), daemon=True
        )
        server_thread.start()
        return {"songs": songs, "port": port}
