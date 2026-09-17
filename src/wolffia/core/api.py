import webview


class PlayerApi:
    def _window(self):
        return webview.windows[0]

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

        songs = scan_folder(folder)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]

        server_thread = threading.Thread(
            target=start_static_server, args=(folder, port), daemon=True
        )
        server_thread.start()
        return {"songs": songs, "port": port}
