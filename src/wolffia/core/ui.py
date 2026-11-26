import os
import sys
import time
from pathlib import Path

import webview

from wolffia.core.api import ApplicationMutex, PlayerApi, bring_existing_window_to_top
from wolffia.core.device_monitor import DeviceChangeMonitor

_MUTEX_NAME = "Local\\Wolffia.Application.SingleInstance"
_WINDOW_TITLE = "Wolffia"
MIN_WINDOW_WIDTH = 640
MIN_WINDOW_HEIGHT = 480

_device_monitor = None

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


def _on_window_ready():
    _apply_title_bar_theme()
    _start_device_monitor()


def _apply_title_bar_theme():
    """安装自定义标题条与托盘：加高、界面配色、保留系统按钮。

    webview.start 的回调跑在线程池，WinForms 实例可能尚未创建，
    需要轮询等待；安装涉及窗体属性与 WndProc subclass，封送到 UI 线程"""
    from webview.platforms import winforms

    from wolffia.core import titlebar, tray

    for _ in range(100):
        instance = winforms.BrowserView.instances.get(webview.windows[0].uid)
        if instance is not None:
            break
        time.sleep(0.1)
    else:
        return

    def _install():
        titlebar.install(instance)
        tray.install(instance)

    try:
        instance.Invoke(winforms.Func[winforms.Type](_install))
    except Exception:
        # Invoke 内部异常会被 Mono 包装成 AggregateException 并触发
        # mscorlib 资源查找递归的 Assert 弹窗，这里拦截后打印
        import traceback

        traceback.print_exc()


def _notify_pause_on_device_change(window):
    try:
        window.evaluate_js(
            "window.__wolffiaPauseOnDeviceChange && window.__wolffiaPauseOnDeviceChange()"
        )
    except Exception:
        # 窗口销毁期间 evaluate_js 会抛错，退出流程中忽略
        pass


def _start_device_monitor():
    """音频设备变化（断连/新增/默认切换）且正在播放时让前端暂停。

    耳机断电断连后系统会把声音切到默认输出（常为外放），音量突然变大
    会惊扰人。监控必须放原生侧：WebView2 的 file:// 页面拿不到设备授权，
    JS 的 enumerateDevices 只返回匿名列表，devicechange 对比不出设备变化"""
    global _device_monitor
    window = webview.windows[0]
    monitor = DeviceChangeMonitor(
        lambda: _notify_pause_on_device_change(window)
    )
    monitor.start()
    _device_monitor = monitor


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
                background_color="#121712",
                js_api=api,
                min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
            )
            self._started = True
            webview.start(_on_window_ready)
        finally:
            api.close_static_server()
            if _device_monitor is not None:
                _device_monitor.stop()
            mutex.release()
            self._application_mutex = None
