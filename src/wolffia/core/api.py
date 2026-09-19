import ctypes
import os
import subprocess
from pathlib import Path

import webview


class PlayerApi:
    def __init__(self):
        self._music_root = None

    def _window(self):
        return webview.windows[0]

    def _song_path(self, relative_path):
        if not self._music_root or not isinstance(relative_path, str):
            return None

        root = Path(self._music_root).resolve()
        song_path = (root / relative_path).resolve()
        try:
            song_path.relative_to(root)
        except ValueError:
            return None
        return song_path

    def select_folder(self):
        import socket
        import threading

        from wolffia.core.scanner import scan_folder
        from wolffia.core.server import start_static_server

        window = self._window()
        folders = window.create_file_dialog(webview.FileDialog.FOLDER)
        folder = folders[0] if folders else None
        if not folder:
            return None

        self._music_root = Path(folder).resolve()
        songs = scan_folder(folder)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]

        server_thread = threading.Thread(
            target=start_static_server, args=(folder, port), daemon=True
        )
        server_thread.start()
        return {"songs": songs, "port": port}

    def open_in_explorer(self, relative_path):
        song_path = self._song_path(relative_path)
        if not song_path or not song_path.is_file():
            return False

        subprocess.Popen(["explorer.exe", f"/select,{os.fspath(song_path)}"])
        return True

    def show_properties(self, relative_path):
        song_path = self._song_path(relative_path)
        if not song_path or not song_path.is_file():
            return False
        return bool(
            ctypes.windll.shell32.SHObjectProperties(
                None, 2, os.fspath(song_path), None
            )
        )
