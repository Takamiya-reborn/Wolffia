"""把原生标题栏染成界面同款深色。

DWMWA_USE_IMMERSIVE_DARK_MODE 决定按钮字形颜色，颜色属性 Win11 起支持，
设置失败（Win10）仅回退系统配色。WinForms 在 DPI 变化时会重建窗口句柄
（RecreateHandle），DWM 属性挂在旧句柄上会丢失，因此监听
HandleCreated/DpiChanged 重新应用。
"""

import ctypes
import traceback

_DWMAPI = ctypes.WinDLL("dwmapi")

_DWMWA_USE_IMMERSIVE_DARK_MODE = 20
_DWMWA_CAPTION_COLOR = 35
_DWMWA_TEXT_COLOR = 36
# COLORREF 为 0x00BBGGRR，与界面顶部渐变起点一致
# （wolffia-ui/src/styles/base.css），让标题栏无缝融入内容区
_CAPTION_COLORREF = 0x00141A14
# DWM 没有隐藏标题文字的属性，把文字颜色设成与 caption 底色相同即可
# "隐形"，窗口图标保留；窗口 Text 不动，任务栏名称与单实例按标题
# 查找不受影响
_TEXT_COLORREF = _CAPTION_COLORREF


def _apply_window_state(instance):

    hwnd = instance.Handle.ToInt32()
    for attr, value in (
        (_DWMWA_USE_IMMERSIVE_DARK_MODE, 1),
        (_DWMWA_CAPTION_COLOR, _CAPTION_COLORREF),
        (_DWMWA_TEXT_COLOR, _TEXT_COLORREF),
    ):
        _DWMAPI.DwmSetWindowAttribute(
            hwnd, attr, ctypes.byref(ctypes.c_int(value)), ctypes.sizeof(ctypes.c_int)
        )


def _on_window_state_dirty(sender, args):
    try:
        _apply_window_state(sender)
    except Exception:
        traceback.print_exc()


def install(instance):
    """在 UI 线程调用：给窗口设置标题栏配色"""

    _apply_window_state(instance)

    # EventHandler 引用必须挂在实例上，否则被 GC 回收后 .NET 侧触发
    # 事件会抛异常；.EventHandler 在 System 命名空间，WinForms 命名空间下没有
    from System import EventHandler

    try:
        handle_handler = EventHandler(_on_window_state_dirty)
        instance._wolffia_handle_created_handler = handle_handler
        instance.HandleCreated += handle_handler
    except Exception:
        traceback.print_exc()
    try:
        dpi_handler = EventHandler(_on_window_state_dirty)
        instance._wolffia_dpi_changed_handler = dpi_handler
        instance.DpiChanged += dpi_handler
    except Exception:
        traceback.print_exc()
