"""关闭到托盘：NotifyIcon 常驻系统托盘，关闭窗口改为隐藏，播放继续。

托盘菜单"退出"先置 _quitting 再关窗，FormClosing 据此放行真正退出；
单实例唤醒（FindWindowW + ShowWindowAsync SW_RESTORE）对隐藏窗口同样
生效，无需额外处理。托盘图标取自 exe 内嵌图标（打包脚本已配置）。
"""

import sys
import threading
import traceback

_quitting = False


def install(instance):
    """在 UI 线程调用：创建托盘图标并拦截窗口关闭"""
    try:
        _install(instance)
    except Exception:
        # 托盘失败不影响主功能，只丢日志
        traceback.print_exc()


def _install(instance):
    from System import EventHandler
    from System.Drawing import Icon
    from System.Windows.Forms import (
        ContextMenuStrip,
        FormClosingEventHandler,
        MouseButtons,
        MouseEventHandler,
        NotifyIcon,
        ToolStripMenuItem,
    )
    from webview.platforms import winforms

    WinForms = winforms.WinForms

    def show(_sender=None, _args=None):
        if instance.WindowState == WinForms.FormWindowState.Minimized:
            instance.WindowState = WinForms.FormWindowState.Normal
        instance.Show()
        instance.Activate()
        try:
            instance.browser.webview.Focus()
        except Exception:
            pass

    def quit(_sender, _args):
        global _quitting
        _quitting = True
        instance.Close()

    def click_player_control(control_id):
        from webview import windows

        # WebView2 evaluate_js waits synchronously for a UI-thread callback.
        # Keep it off the WinForms tray event thread to avoid deadlocking the UI.
        threading.Thread(
            target=windows[0].evaluate_js,
            args=(f'document.getElementById("{control_id}")?.click()',),
            daemon=True,
        ).start()

    def toggle_playback(_sender, _args):
        click_player_control("play-toggle")

    def toggle_mute(_sender, _args):
        click_player_control("mute-toggle")

    tray = NotifyIcon()
    tray.Icon = Icon.ExtractAssociatedIcon(sys.executable)
    tray.Text = "Wolffia"
    tray.Visible = True

    menu = ContextMenuStrip()
    show_item = ToolStripMenuItem("显示 Wolffia")
    from wolffia.core.api import PlayerApi

    is_playing, is_muted = PlayerApi()._tray_state
    play_item = ToolStripMenuItem("暂停" if is_playing else "播放")
    mute_item = ToolStripMenuItem("取消静音" if is_muted else "静音")
    quit_item = ToolStripMenuItem("退出")
    menu.Items.AddRange([show_item, play_item, mute_item, quit_item])
    tray.ContextMenuStrip = menu

    # Click 事件左右键都会触发,右键时 Activate 会抢走前台导致
    # ContextMenuStrip 立即失焦关闭(表现为要右击两次才出菜单),
    # 因此用 MouseClick 只响应左键;右键菜单由 ContextMenuStrip 属性自动处理
    def on_mouse_click(_sender, args):
        if args.Button == MouseButtons.Left:
            show()

    click_handler = MouseEventHandler(on_mouse_click)
    tray.MouseClick += click_handler

    def on_form_closing(_sender, args):
        if not _quitting:
            args.Cancel = True
            instance.Hide()

    # 事件处理器引用必须挂在实例上，否则被 GC 回收后 .NET 侧触发
    # 事件会抛异常（同 titlebar.py 的做法）
    closing_handler = FormClosingEventHandler(on_form_closing)
    show_handler = EventHandler(show)
    play_handler = EventHandler(toggle_playback)
    mute_handler = EventHandler(toggle_mute)
    quit_handler = EventHandler(quit)
    instance.FormClosing += closing_handler
    show_item.Click += show_handler
    play_item.Click += play_handler
    mute_item.Click += mute_handler
    quit_item.Click += quit_handler
    instance._wolffia_tray = tray
    instance._wolffia_tray_play_item = play_item
    instance._wolffia_tray_mute_item = mute_item
    instance._wolffia_tray_handlers = (
        click_handler,
        closing_handler,
        show_handler,
        play_handler,
        mute_handler,
        quit_handler,
    )
