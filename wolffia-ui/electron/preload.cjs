const { contextBridge, ipcRenderer } = require("electron");

// 让现有前端（window.pywebview.api.*）零改动地跑在 Electron 上：
// 后端能力转发主进程 IPC，窗口能力（置顶/全屏/文件夹对话框）由
// Electron 原生实现。方法名与 Python PlayerApi 保持一致。
contextBridge.exposeInMainWorld("pywebview", {
  api: {
    select_folder: async () => ipcRenderer.invoke("api:select-folder"),
    get_lyrics: (relativePath) =>
      ipcRenderer.invoke("api:get-lyrics", relativePath),
    get_album_art: (relativePath) =>
      ipcRenderer.invoke("api:get-album-art", relativePath),
    open_in_explorer: (relativePath) =>
      ipcRenderer.invoke("api:open-in-explorer", relativePath),
    show_properties: (relativePath) =>
      ipcRenderer.invoke("api:show-properties", relativePath),
    close_static_server: () => ipcRenderer.invoke("api:close-static-server"),
    set_always_on_top: (enabled) =>
      ipcRenderer.invoke("window:set-always-on-top", enabled),
    set_native_fullscreen: (enabled) =>
      ipcRenderer.invoke("window:set-fullscreen", enabled),
  },
});

// 自绘标题栏用的窗口控制(pywebview 下不存在,前端据此隐藏标题栏)
contextBridge.exposeInMainWorld("electronWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizeChange: (cb) => {
    const fn = (_event, maximized) => cb(maximized);
    ipcRenderer.on("window:maximized", fn);
    return () => ipcRenderer.removeListener("window:maximized", fn);
  },
  onFullscreenChange: (cb) => {
    const fn = (_event, fullscreen) => cb(fullscreen);
    ipcRenderer.on("window:fullscreen", fn);
    return () => ipcRenderer.removeListener("window:fullscreen", fn);
  },
});
