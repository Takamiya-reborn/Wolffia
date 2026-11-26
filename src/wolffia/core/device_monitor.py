"""WASAPI 音频输出设备监控（IMMNotificationClient，纯 ctypes COM 实现）。

耳机断电断连后系统会把声音切到默认输出（常为外放），音量突然变大会
惊扰人，需要检测设备变化并通知前端暂停。监控必须放原生侧：WebView2 的
file:// 页面拿不到设备授权，JS 的 enumerateDevices 只返回匿名列表
（每类设备一个空 deviceId 条目），devicechange 事件对比不出设备集合变化。

覆盖四类端点通知：设备添加/移除/状态变化、默认输出设备切换（仅
eConsole/eMultimedia 角色， communications 角色随通话应用变化不触发）。
通知常成串到达（蓝牙断开同时伴随默认切换 + 设备移除），去抖合并成一次
快照对比，快照包含活跃渲染端点 id 集合与默认设备 id。
"""

import ctypes
import threading
import traceback
from ctypes import POINTER, WINFUNCTYPE, c_long, c_void_p, wintypes

_CLSID_MMDeviceEnumerator = "{BCDE0395-E52F-467C-8E3D-C4579291692E}"
_IID_IMMDeviceEnumerator = "{A95664D2-9614-4F35-A746-DE8DB63617E6}"

_E_RENDER = 0
_E_CONSOLE = 0
_E_MULTIMEDIA = 1
_DEVICE_STATE_ACTIVE = 0x1
_CLSCTX_ALL = 23
_COINIT_MULTITHREADED = 0x0
_RPC_E_CHANGED_MODE = 0x80010106

_ole32 = ctypes.WinDLL("ole32", use_last_error=True)


class _GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]


_ole32.CLSIDFromString.argtypes = (wintypes.LPCWSTR, POINTER(_GUID))
_ole32.CLSIDFromString.restype = c_long
_ole32.CoCreateInstance.argtypes = (
    POINTER(_GUID),
    c_void_p,
    wintypes.DWORD,
    POINTER(_GUID),
    POINTER(c_void_p),
)
_ole32.CoCreateInstance.restype = c_long
_ole32.CoInitializeEx.argtypes = (c_void_p, wintypes.DWORD)
_ole32.CoInitializeEx.restype = c_long
_ole32.CoTaskMemFree.argtypes = (c_void_p,)


def _guid(text):
    result = _GUID()
    _ole32.CLSIDFromString(text, ctypes.byref(result))
    return result


# —— 函数指针原型（第一个参数均为 COM this 指针）——
_HRESULT = c_long

_PROTO_QI = WINFUNCTYPE(_HRESULT, c_void_p, c_void_p, c_void_p)
_PROTO_REF = WINFUNCTYPE(wintypes.ULONG, c_void_p)
_PROTO_ENUM_ENDPOINTS = WINFUNCTYPE(
    _HRESULT, c_void_p, wintypes.DWORD, wintypes.DWORD, POINTER(c_void_p)
)
_PROTO_GET_DEFAULT = WINFUNCTYPE(
    _HRESULT, c_void_p, wintypes.DWORD, wintypes.DWORD, POINTER(c_void_p)
)
_PROTO_GET_DEVICE = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.LPCWSTR, POINTER(c_void_p))
_PROTO_REGISTER = WINFUNCTYPE(_HRESULT, c_void_p, c_void_p)
_PROTO_ACTIVATE = WINFUNCTYPE(
    _HRESULT, c_void_p, c_void_p, wintypes.DWORD, c_void_p, POINTER(c_void_p)
)
_PROTO_OPEN_STORE = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.DWORD, POINTER(c_void_p))
_PROTO_GET_ID = WINFUNCTYPE(_HRESULT, c_void_p, POINTER(c_void_p))
_PROTO_GET_STATE = WINFUNCTYPE(_HRESULT, c_void_p, POINTER(wintypes.DWORD))
_PROTO_GET_COUNT = WINFUNCTYPE(_HRESULT, c_void_p, POINTER(wintypes.UINT))
_PROTO_GET_ITEM = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.UINT, POINTER(c_void_p))

# IMMNotificationClient 回调；LPCWSTR 参数由 ctypes 转成 str
_PROTO_ON_STATE_CHANGED = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.LPCWSTR, wintypes.DWORD)
_PROTO_ON_DEVICE = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.LPCWSTR)
_PROTO_ON_DEFAULT = WINFUNCTYPE(
    _HRESULT, c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.LPCWSTR
)
_PROTO_ON_PROPERTY = WINFUNCTYPE(_HRESULT, c_void_p, wintypes.LPCWSTR, c_void_p)


class _EnumeratorVtable(ctypes.Structure):
    _fields_ = [
        ("QueryInterface", _PROTO_QI),
        ("AddRef", _PROTO_REF),
        ("Release", _PROTO_REF),
        ("EnumAudioEndpoints", _PROTO_ENUM_ENDPOINTS),
        ("GetDefaultAudioEndpoint", _PROTO_GET_DEFAULT),
        ("GetDevice", _PROTO_GET_DEVICE),
        ("RegisterEndpointNotificationCallback", _PROTO_REGISTER),
        ("UnregisterEndpointNotificationCallback", _PROTO_REGISTER),
    ]


class _DeviceVtable(ctypes.Structure):
    _fields_ = [
        ("QueryInterface", _PROTO_QI),
        ("AddRef", _PROTO_REF),
        ("Release", _PROTO_REF),
        ("Activate", _PROTO_ACTIVATE),
        ("OpenPropertyStore", _PROTO_OPEN_STORE),
        ("GetId", _PROTO_GET_ID),
        ("GetState", _PROTO_GET_STATE),
    ]


class _CollectionVtable(ctypes.Structure):
    _fields_ = [
        ("QueryInterface", _PROTO_QI),
        ("AddRef", _PROTO_REF),
        ("Release", _PROTO_REF),
        ("GetCount", _PROTO_GET_COUNT),
        ("Item", _PROTO_GET_ITEM),
    ]


class _ClientVtable(ctypes.Structure):
    _fields_ = [
        ("QueryInterface", _PROTO_QI),
        ("AddRef", _PROTO_REF),
        ("Release", _PROTO_REF),
        ("OnDeviceStateChanged", _PROTO_ON_STATE_CHANGED),
        ("OnDeviceAdded", _PROTO_ON_DEVICE),
        ("OnDeviceRemoved", _PROTO_ON_DEVICE),
        ("OnDefaultDeviceChanged", _PROTO_ON_DEFAULT),
        ("OnPropertyValueChanged", _PROTO_ON_PROPERTY),
    ]


class _ClientObject(ctypes.Structure):
    _fields_ = [("vtbl", POINTER(_ClientVtable)), ("ref", wintypes.ULONG)]


def _vtable(com_ptr, vtable_type):
    """取 COM 对象的 vtable 视图：首字段即指向方法表的指针"""
    return ctypes.cast(
        ctypes.cast(com_ptr, POINTER(c_void_p)).contents, POINTER(vtable_type)
    ).contents


def _release(com_ptr, vtable_type):
    _vtable(com_ptr, vtable_type).Release(com_ptr)


def _device_id(device_ptr):
    id_ptr = c_void_p()
    _vtable(device_ptr, _DeviceVtable).GetId(device_ptr, ctypes.byref(id_ptr))
    try:
        return ctypes.cast(id_ptr, wintypes.LPCWSTR).value or ""
    finally:
        _ole32.CoTaskMemFree(id_ptr)  # GetId 的字符串在 COM 堆上，需显式释放


def _create_enumerator():
    ptr = c_void_p()
    hr = _ole32.CoCreateInstance(
        ctypes.byref(_guid(_CLSID_MMDeviceEnumerator)),
        None,
        _CLSCTX_ALL,
        ctypes.byref(_guid(_IID_IMMDeviceEnumerator)),
        ctypes.byref(ptr),
    )
    if hr < 0:
        raise ctypes.WinError(hr & 0xFFFFFFFF)
    return ptr


def _active_render_ids(enumerator):
    """当前活跃的渲染端点 id 列表（排序后用于对比）"""
    collection = c_void_p()
    hr = _vtable(enumerator, _EnumeratorVtable).EnumAudioEndpoints(
        enumerator, _E_RENDER, _DEVICE_STATE_ACTIVE, ctypes.byref(collection)
    )
    if hr < 0:
        return []
    ids = []
    try:
        count = wintypes.UINT()
        _vtable(collection, _CollectionVtable).GetCount(collection, ctypes.byref(count))
        for index in range(count.value):
            device = c_void_p()
            _vtable(collection, _CollectionVtable).Item(
                collection, index, ctypes.byref(device)
            )
            try:
                ids.append(_device_id(device))
            finally:
                _release(device, _DeviceVtable)
    finally:
        _release(collection, _CollectionVtable)
    return sorted(ids)


def _default_render_id(enumerator):
    device = c_void_p()
    hr = _vtable(enumerator, _EnumeratorVtable).GetDefaultAudioEndpoint(
        enumerator, _E_RENDER, _E_CONSOLE, ctypes.byref(device)
    )
    if hr < 0:
        return None
    try:
        return _device_id(device)
    finally:
        _release(device, _DeviceVtable)


# —— IMMNotificationClient 实现 ——
# MMDeviceEnumerator 只通过注册时传入的指针回调，QueryInterface 返回
# E_NOINTERFACE 即可；引用计数恒返回 1，对象由 Monitor 保活、进程退出回收

_CLIENTS = {}


def _cb_query_interface(_this, _riid, _ppv):
    return 0x80004002  # E_NOINTERFACE


def _cb_addref(_this):
    return 1


def _cb_release(_this):
    return 1


def _cb_state_changed(this, _device_id, _new_state):
    _notify_client(this)
    return 0


def _cb_device_added(this, _device_id):
    _notify_client(this)
    return 0


def _cb_device_removed(this, _device_id):
    _notify_client(this)
    return 0


def _cb_default_changed(this, flow, role, _device_id):
    if flow == _E_RENDER and role in (_E_CONSOLE, _E_MULTIMEDIA):
        _notify_client(this)
    return 0


def _cb_property_changed(_this, _device_id, _property_key):
    return 0


def _notify_client(this):
    on_event = _CLIENTS.get(this)
    if on_event is None:
        return
    try:
        on_event()
    except Exception:
        traceback.print_exc()


_CLIENT_VTABLE = _ClientVtable(
    _PROTO_QI(_cb_query_interface),
    _PROTO_REF(_cb_addref),
    _PROTO_REF(_cb_release),
    _PROTO_ON_STATE_CHANGED(_cb_state_changed),
    _PROTO_ON_DEVICE(_cb_device_added),
    _PROTO_ON_DEVICE(_cb_device_removed),
    _PROTO_ON_DEFAULT(_cb_default_changed),
    _PROTO_ON_PROPERTY(_cb_property_changed),
)


class DeviceChangeMonitor:
    """监听 WASAPI 端点通知，输出设备集合或默认设备变化时触发回调"""

    _DEBOUNCE_SECONDS = 0.25

    def __init__(self, on_change):
        self._on_change = on_change
        self._stop_event = threading.Event()
        self._thread = None
        self._debounce_lock = threading.Lock()
        self._debounce_timer = None
        self._enumerator = None
        self._client_obj = None
        self._last_snapshot = None

    def start(self):
        self._thread = threading.Thread(
            target=self._run, name="wolffia-device-monitor", daemon=True
        )
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def _run(self):
        hr = _ole32.CoInitializeEx(None, _COINIT_MULTITHREADED)
        # 线程已是 MTA 时同样可用
        if hr >= 0 or hr == _RPC_E_CHANGED_MODE:
            try:
                self._run_unchecked()
            except Exception:
                traceback.print_exc()
            finally:
                _ole32.CoUninitialize()

    def _run_unchecked(self):
        enumerator = _create_enumerator()
        self._enumerator = enumerator
        obj = _ClientObject()
        obj.vtbl = ctypes.pointer(_CLIENT_VTABLE)
        obj.ref = 1
        self._client_obj = obj  # COM 侧持有指针，Python 对象必须保活
        address = ctypes.addressof(obj)
        _CLIENTS[address] = self._schedule_check
        # 先取基线再注册，避免注册前积压的事件误报
        self._last_snapshot = self._snapshot()
        try:
            _vtable(enumerator, _EnumeratorVtable).RegisterEndpointNotificationCallback(
                enumerator, address
            )
            self._stop_event.wait()
        finally:
            try:
                _vtable(
                    enumerator, _EnumeratorVtable
                ).UnregisterEndpointNotificationCallback(enumerator, address)
            finally:
                _CLIENTS.pop(address, None)
                _release(enumerator, _EnumeratorVtable)

    def _schedule_check(self):
        # 通知线程只入队，快照对比合并到去抖计时器里做
        with self._debounce_lock:
            if self._debounce_timer is not None:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(
                self._DEBOUNCE_SECONDS, self._check
            )
            self._debounce_timer.daemon = True
            self._debounce_timer.start()

    def _check(self):
        with self._debounce_lock:
            self._debounce_timer = None
        try:
            snapshot = self._snapshot()
        except Exception:
            traceback.print_exc()
            return
        if snapshot != self._last_snapshot:
            self._last_snapshot = snapshot
            try:
                self._on_change()
            except Exception:
                traceback.print_exc()

    def _snapshot(self):
        enumerator = self._enumerator
        return tuple(_active_render_ids(enumerator)), _default_render_id(enumerator)
