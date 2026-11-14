const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

const { createMediaServer } = require("./backend/mediaserver.cjs");
const { scanFolder } = require("./backend/scanner.cjs");
const { loadLyrics } = require("./backend/lyrics.cjs");
const { extractAlbumArt } = require("./backend/albumart.cjs");

const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;
// 与 pywebview 版的 DWM 标题栏配色（titlebar.py 0x00141A14）一致
const TITLEBAR_COLOR = "#141a14";

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
    backgroundColor: "#121712",
    autoHideMenuBar: true,
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      symbolColor: "#c9d1c9",
      height: 36,
    },
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
  return shell.showItemInFolder(songPath);
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
    "$n = (New-Object -ComObject Shell.Application).NameSpace('" + dir.replace(/'/g, "''") + "')",
    "if ($n) { $p = $n.ParseName('" + name.replace(/'/g, "''") + "'); if ($p) { $p.InvokeVerb('properties') } }",
  ].join("; ");
  const { spawn } = require("child_process");
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
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

ipcMain.handle("window:set-fullscreen", (_event, enabled) => {
  if (mainWindow) {
    mainWindow.setFullScreen(Boolean(enabled));
    return true;
  }
  return false;
});
