import os
import sys
import webview
from pathlib import Path
from wolffia.core.api import PlayerApi

MIN_WINDOW_WIDTH = 700
MIN_WINDOW_HEIGHT = 500


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
    def __init__(self):
        html_path = get_asset_path("index.html")
        self.html_url = Path(html_path).resolve().as_uri()

    def start(self):
        api = PlayerApi()
        window = webview.create_window(
            "Wolffia",
            url=self.html_url,
            width=900,
            height=650,
            background_color="#121212",
            js_api=api,
            min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        )
        webview.start()
