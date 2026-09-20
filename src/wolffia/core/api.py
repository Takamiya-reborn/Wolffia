import os
import sys
import base64
import ctypes
import webview
import subprocess
from pathlib import Path
from ctypes import wintypes


class ApplicationMutex:
    """应用级单例互斥锁"""

    def __init__(self, name):
        self._handle = None
        if sys.platform != "win32":
            return

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = (
            wintypes.LPVOID,
            wintypes.BOOL,
            wintypes.LPCWSTR,
        )
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL

        self._kernel32 = kernel32
        self._handle = kernel32.CreateMutexW(None, False, name)
        if not self._handle:
            raise ctypes.WinError(ctypes.get_last_error())

        if ctypes.get_last_error() == 183:  # _ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(self._handle)
            self._handle = None

    @property
    def acquired(self):
        return sys.platform != "win32" or self._handle is not None

    def release(self):
        if self._handle is not None:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


import ctypes
import time
from ctypes import wintypes


def bring_existing_window_to_top(window_title):
    """唤醒已有窗口到最前，并解决 UI 空白及任务栏闪烁问题"""
    if sys.platform != "win32":
        return

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.FindWindowW.restype = ctypes.c_void_p
    user32.IsIconic.argtypes = (ctypes.c_void_p,)
    user32.IsIconic.restype = wintypes.BOOL
    user32.GetClientRect.argtypes = (ctypes.c_void_p, ctypes.POINTER(wintypes.RECT))
    user32.ShowWindowAsync.argtypes = (ctypes.c_void_p, ctypes.c_int)
    user32.ShowWindowAsync.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = (ctypes.c_void_p,)
    user32.PostMessageW.argtypes = (
        ctypes.c_void_p,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    )
    user32.PostMessageW.restype = wintypes.BOOL
    user32.BringWindowToTop.argtypes = (ctypes.c_void_p,)

    hwnd = user32.FindWindowW(None, window_title)
    if not hwnd:
        return
    user32.GetForegroundWindow.restype = ctypes.c_void_p
    fg_hwnd = user32.GetForegroundWindow()
    user32.GetWindowThreadProcessId.argtypes = (
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.DWORD),
    )
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None)
    current_tid = ctypes.windll.kernel32.GetCurrentThreadId()

    attached = False
    if fg_tid != current_tid:
        user32.AttachThreadInput.argtypes = (
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.BOOL,
        )
        user32.AttachThreadInput.restype = wintypes.BOOL
        attached = bool(user32.AttachThreadInput(current_tid, fg_tid, True))

    SW_RESTORE = 9
    WM_SIZE = 0x0005
    SIZE_RESTORED = 0

    try:
        if user32.IsIconic(hwnd):
            user32.ShowWindowAsync(hwnd, SW_RESTORE)
            time.sleep(0.1)

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        rect = wintypes.RECT()
        user32.GetClientRect(hwnd, ctypes.byref(rect))
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        if width > 0 and height > 0:
            lparam = (height << 16) | (width & 0xFFFF)
            user32.PostMessageW(hwnd, WM_SIZE, SIZE_RESTORED, lparam)

    finally:
        if attached:
            user32.AttachThreadInput(current_tid, fg_tid, False)


# 仅尝试从这些格式提取内嵌专辑图（wav 兼容性差且几乎不携带封面，跳过）
_ALBUM_ART_SUFFIXES = {".mp3", ".flac", ".m4a"}


def _sniff_image_mime(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def extract_album_art(song_path):
    """提取内嵌专辑图并返回 data URI，无图或解析失败返回 None"""
    if song_path.suffix.lower() not in _ALBUM_ART_SUFFIXES:
        return None

    from tinytag import TinyTag

    try:
        image = TinyTag.get(song_path, image=True).images.any
    except Exception:
        return None
    if not image or not image.data:
        return None

    mime = _sniff_image_mime(image.data) or image.mime_type
    if not mime:
        return None
    encoded = base64.b64encode(image.data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


class PlayerApi:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._music_root = None
        self._art_cache = {}
        self._initialized = True

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
        subprocess.Popen(["explorer.exe", "/select,", os.fspath(song_path)])
        return True

    def get_album_art(self, relative_path):
        song_path = self._song_path(relative_path)
        if not song_path or not song_path.is_file():
            return None

        if relative_path not in self._art_cache:
            # 简单 LRU：超过 16 条时淘汰最早写入的一项
            if len(self._art_cache) >= 16:
                self._art_cache.pop(next(iter(self._art_cache)))
            self._art_cache[relative_path] = extract_album_art(song_path)
        return self._art_cache[relative_path]

    def show_properties(self, relative_path):
        song_path = self._song_path(relative_path)
        if not song_path or not song_path.is_file():
            return False
        return bool(
            ctypes.windll.shell32.SHObjectProperties(
                None, 2, os.fspath(song_path), None
            )
        )
