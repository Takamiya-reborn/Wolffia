const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const { createMediaServer } = require("./backend/mediaserver.cjs");
const { scanFolder } = require("./backend/scanner.cjs");
const { loadLyrics } = require("./backend/lyrics.cjs");
const { extractAlbumArt } = require("./backend/albumart.cjs");

const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;

let mainWindow = null;
let mediaServer = null;
let musicRoot = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Wolffia",
    // 首帧就绪后再显示,避免窗口先画出无样式/空白的页面
    show: false,
    backgroundColor: "#121712",
    // 无边框 + 页面内自绘标题栏(titlebar 区拖拽/窗口按钮走 window:* IPC)
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  // 状态回推给渲染层,驱动最大化/还原图标与全屏时隐藏标题栏
  const sendMaximized = () =>
    mainWindow?.webContents.send("window:maximized", mainWindow.isMaximized());
  mainWindow.on("maximize", sendMaximized);
  mainWindow.on("unmaximize", sendMaximized);
  mainWindow.on("enter-full-screen", () =>
    mainWindow?.webContents.send("window:fullscreen", true),
  );
  mainWindow.on("leave-full-screen", () =>
    mainWindow?.webContents.send("window:fullscreen", false),
  );
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  closeMediaServer();
});

function closeMediaServer() {
  const server = mediaServer;
  mediaServer = null;
  if (server) {
    server.close();
  }
}

ipcMain.handle("api:select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  const folder = result.canceled ? null : result.filePaths[0];
  if (!folder) {
    return null;
  }

  closeMediaServer();
  musicRoot = path.resolve(folder);
  const scanResult = scanFolder(musicRoot);
  mediaServer = await createMediaServer(musicRoot);
  // 目录名给侧栏标题显示，类似 VSCode 打开目录的效果
  return {
    ...scanResult,
    port: mediaServer.address().port,
    name: path.basename(musicRoot),
    folder: musicRoot,
  };
});

ipcMain.handle("api:get-lyrics", (_event, relativePath) => {
  if (!musicRoot) return [];
  return loadLyrics(musicRoot, relativePath);
});

ipcMain.handle("api:get-album-art", async (_event, relativePath) => {
  if (!musicRoot || typeof relativePath !== "string") return null;
  // 与 Python 版一致：越界检查后取绝对路径，失败返回 null
  const rel = path.relative(musicRoot, path.resolve(musicRoot, relativePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const songPath = path.join(musicRoot, rel);
  try {
    if (!fs.statSync(songPath).isFile()) return null;
  } catch {
    return null;
  }
  return extractAlbumArt(songPath);
});

ipcMain.handle("api:open-in-explorer", (_event, relativePath) => {
  if (!musicRoot || typeof relativePath !== "string") return false;
  const rel = path.relative(musicRoot, path.resolve(musicRoot, relativePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const songPath = path.join(musicRoot, rel);
  try {
    if (!fs.statSync(songPath).isFile()) return false;
  } catch {
    return false;
  }
  // 不用 shell.showItemInFolder:Electron 33+(Chromium 128)在 Windows 上
  // 不再可靠弹出资源管理器并选中文件,直接调 explorer /select 稳定
  require("child_process").spawn("explorer", ["/select,", songPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
  return true;
});

ipcMain.handle("api:show-properties", async (_event, relativePath) => {
  if (!musicRoot || typeof relativePath !== "string") return false;
  const rel = path.relative(musicRoot, path.resolve(musicRoot, relativePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const songPath = path.join(musicRoot, rel);
  try {
    if (!fs.statSync(songPath).isFile()) return false;
  } catch {
    return false;
  }
  // SHObjectProperties 的 Node 等价：Shell.Application 对文件 InvokeVerb("properties")
  const dir = path.dirname(songPath);
  const name = path.basename(songPath);
  const script = [
    "$n = (New-Object -ComObject Shell.Application).NameSpace('" +
      dir.replace(/'/g, "''") +
      "')",
    "if ($n) { $p = $n.ParseName('" +
      name.replace(/'/g, "''") +
      "'); if ($p) { $p.InvokeVerb('properties') } }",
  ].join("; ");
  const { spawn } = require("child_process");
  const child = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  return true;
});

ipcMain.handle("api:close-static-server", () => {
  closeMediaServer();
});

ipcMain.handle("window:set-always-on-top", (_event, enabled) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(Boolean(enabled));
    return true;
  }
  return false;
});

// 自绘标题栏的窗口控制
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("window:is-maximized", () => Boolean(mainWindow?.isMaximized()));

ipcMain.handle("window:set-fullscreen", (_event, enabled) => {
  if (mainWindow) {
    mainWindow.setFullScreen(Boolean(enabled));
    return true;
  }
  return false;
});
