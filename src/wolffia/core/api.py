import base64
import ctypes
import io
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from ctypes import wintypes

import webview

# 仅处理常见内嵌封面格式
_ALBUM_ART_SUFFIXES = {".mp3", ".flac", ".m4a"}

# 内嵌封面降采样的目标边长：歌词背景是两层大半径 blur，专辑图模式全屏展示，
# 边长 1024 足够覆盖窗口尺寸；一些 FLAC 内嵌 3000px+ 的封面，
# 解码位图可达数十 MB，全尺寸塞给 webview（base64 字符串 + 解码位图 × 模糊层）
# 是播放器最大的内存波动来源
_ALBUM_ART_MAX_EDGE = 1024
_ALBUM_ART_JPEG_QUALITY = 85

# 全屏切换用：切换过程中临时关闭窗口重绘，隐藏"先恢复还原边界再改变
# 窗口状态"的中间画面，视觉上一步到位
_WM_SETREDRAW = 0x000B
# RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_FRAME | RDW_UPDATENOW
_RDW_REDRAW_ALL = 0x0585


def _set_window_redraw(hwnd, enabled):
    user32 = ctypes.windll.user32
    user32.SendMessageW(hwnd, _WM_SETREDRAW, 1 if enabled else 0, 0)
    if enabled:
        user32.RedrawWindow(hwnd, None, None, _RDW_REDRAW_ALL)


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


def _sniff_image_mime(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def _downscale_album_art(data):
    """把内嵌封面降采样到目标边长内的 JPEG，减小 webview 侧的解码与内存开销。

    已经足够小或解码失败时返回 None（调用方回退到原始数据）。
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    try:
        with Image.open(io.BytesIO(data)) as img:
            if max(img.width, img.height) <= _ALBUM_ART_MAX_EDGE:
                return None
            img = img.convert("RGB")
            img.thumbnail((_ALBUM_ART_MAX_EDGE, _ALBUM_ART_MAX_EDGE))
            buffer = io.BytesIO()
            img.save(buffer, "JPEG", quality=_ALBUM_ART_JPEG_QUALITY)
            return buffer.getvalue()
    except Exception:
        # 封面数据异常时直接用原图，宁可内存多占也不丢封面
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

    data = _downscale_album_art(image.data) or image.data
    mime = _sniff_image_mime(data) or image.mime_type
    if not mime:
        return None
    encoded = base64.b64encode(data).decode("ascii")
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
        self._static_server = None
        self._static_server_thread = None
        self._initialized = True

    def _window(self):
        return webview.windows[0]

    def set_always_on_top(self, enabled):
        """切换窗口置顶显示。
        WinForms 窗体属性只能在 UI 线程上设置，而 JS API 调用跑在线程池，
        需自行封送（pywebview 内置的 set_on_top 未做 Invoke 封送，直接调用会崩溃）"""
        window = self._window()
        if window is None:
            return False

        if sys.platform == "win32":
            try:
                from webview.platforms import winforms

                instance = winforms.BrowserView.instances.get(window.uid)
                if instance is None:
                    return False

                def _set_topmost():
                    instance.TopMost = bool(enabled)

                instance.Invoke(winforms.Func[winforms.Type](_set_topmost))
            except Exception:
                # pywebview 内部结构变化时放弃置顶，不影响播放功能
                return False
        else:
            window.on_top = bool(enabled)
        return True

    def set_native_fullscreen(self, enabled):
        """切换原生窗口全屏。
        WebView2 的元素全屏只能铺满 WebView2 控件区域，标题栏与任务栏仍在，
        需同步把 WinForms 窗体切成无边框铺满屏幕。pywebview 内置的
        toggle_fullscreen 未做 Invoke 封送，与 set_on_top 一样直接调用会崩溃；
        且它在窗口最大化时保存的是最大化后的尺寸，退出全屏会丢失原始大小，
        因此这里自行实现切换逻辑"""
        window = self._window()
        if window is None:
            return False

        if sys.platform == "win32":
            try:
                from webview.platforms import winforms

                instance = winforms.BrowserView.instances.get(window.uid)
                if instance is None:
                    return False

                def _set_fullscreen():
                    # 页面事件可能重复到达，仅在状态不一致时切换，保持幂等
                    if getattr(instance, "_wolffia_fullscreen", False) == bool(enabled):
                        return

                    from System.Drawing import Rectangle

                    WinForms = winforms.WinForms
                    hwnd = instance.Handle.ToInt32()
                    if enabled:
                        # 还原状态下的边界；最大化时 Size/Location 是最大化后的
                        # 值，必须改用 RestoreBounds 才能回到原始大小
                        instance._wolffia_fullscreen = True
                        instance._wolffia_state = instance.WindowState
                        if instance._wolffia_state == WinForms.FormWindowState.Maximized:
                            bounds = instance.RestoreBounds
                        else:
                            bounds = instance.Bounds
                        instance._wolffia_bounds = (
                            bounds.X, bounds.Y, bounds.Width, bounds.Height,
                        )

                        _set_window_redraw(hwnd, False)
                        instance.FormBorderStyle = getattr(
                            WinForms.FormBorderStyle, "None"
                        )
                        instance.WindowState = WinForms.FormWindowState.Normal
                        instance.Bounds = WinForms.Screen.FromControl(instance).Bounds
                        _set_window_redraw(hwnd, True)
                        winforms.DwmSetWindowAttribute(hwnd, 33, 1)  # 去圆角
                        winforms.DwmSetWindowAttribute(hwnd, 34, 0xFFFFFFFE)  # 隐藏边框
                    else:
                        instance._wolffia_fullscreen = False
                        winforms.DwmSetWindowAttribute(hwnd, 33, 0)  # 恢复圆角
                        winforms.DwmSetWindowAttribute(hwnd, 34, 0xFFFFFFFF)  # 显示边框

                        _set_window_redraw(hwnd, False)
                        instance.FormBorderStyle = WinForms.FormBorderStyle.Sizable
                        instance.WindowState = WinForms.FormWindowState.Normal
                        # 必须先让窗体回到保存的还原边界再最大化：WinForms
                        # 内部记录的"最大化前边界"只在 Normal 状态下随 Bounds
                        # 更新，原生还原按钮用的就是这份记录
                        instance.Bounds = Rectangle(*instance._wolffia_bounds)
                        if instance._wolffia_state == WinForms.FormWindowState.Maximized:
                            instance.WindowState = WinForms.FormWindowState.Maximized
                        _set_window_redraw(hwnd, True)

                instance.Invoke(winforms.Func[winforms.Type](_set_fullscreen))
            except Exception:
                # pywebview 内部结构变化时放弃原生全屏，不影响 WebView 内全屏
                return False
        else:
            if window.fullscreen != bool(enabled):
                window.toggle_fullscreen()
        return True

    def _refocus_window(self):
        """文件对话框关闭后，键盘焦点会落在窗体而不是 WebView 上，
        页面快捷键因此失效，需要把焦点交还给 WebView 控件"""
        if sys.platform != "win32":
            return
        try:
            from webview.platforms import winforms

            window = self._window()
            instance = winforms.BrowserView.instances.get(window.uid)
            if instance is None:
                return

            def _focus():
                instance.Activate()
                instance.browser.webview.Focus()

            instance.Invoke(winforms.Func[winforms.Type](_focus))
        except Exception:
            # pywebview 内部结构变化时放弃修复，不影响选目录功能
            pass

    def _song_path(self, relative_path):
        if not self._music_root or not isinstance(relative_path, str):
            return None

        root = Path(self._music_root).resolve()
        song_path = (root / relative_path).resolve()
        # 防止相对路径越界
        try:
            song_path.relative_to(root)
        except ValueError:
            return None
        return song_path

    def select_folder(self):
        from wolffia.core.scanner import scan_folder
        from wolffia.core.server import create_static_server

        window = self._window()
        folders = window.create_file_dialog(webview.FileDialog.FOLDER)
        self._refocus_window()
        folder = folders[0] if folders else None
        if not folder:
            return None

        self.close_static_server()
        self._music_root = Path(folder).resolve()
        self._art_cache.clear()
        scan_result = scan_folder(folder)
        self._static_server = create_static_server(folder)
        self._static_server_thread = threading.Thread(
            target=self._static_server.serve_forever, daemon=True
        )
        self._static_server_thread.start()
        scan_result["port"] = self._static_server.server_address[1]
        # 目录名给侧栏标题显示，类似 VSCode 打开目录的效果
        scan_result["name"] = self._music_root.name
        scan_result["folder"] = str(self._music_root)
        return scan_result

    def get_lyrics(self, relative_path):
        from wolffia.core.scanner import load_lyrics

        if not self._music_root or not self._song_path(relative_path):
            return []
        return load_lyrics(self._music_root, relative_path)

    def close_static_server(self):
        server = self._static_server
        self._static_server = None
        self._static_server_thread = None
        if server is not None:
            server.shutdown()
            server.server_close()

    def open_in_explorer(self, relative_path):
        path = self._song_path(relative_path)
        if not path or not path.exists():
            return False
        subprocess.Popen(["explorer.exe", "/select,", os.fspath(path)])
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
        path = self._song_path(relative_path)
        if not path or not path.exists():
            return False
        return bool(
            ctypes.windll.shell32.SHObjectProperties(None, 2, os.fspath(path), None)
        )
