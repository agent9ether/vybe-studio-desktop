import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleMediaProtocol, registerMediaScheme } from "./media";
import { registerIpc } from "./ipc";
import { flushDb } from "./db";
import { loadPlugins } from "./providers";
import { stopEngine } from "./engine";
import { maybeRunCapture } from "./dev-capture";

const here = path.dirname(fileURLToPath(import.meta.url));

// Optional override, e.g. for a portable install or isolated test data.
if (process.env.VYBE_USER_DATA) app.setPath("userData", process.env.VYBE_USER_DATA);

registerMediaScheme();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#16130f",
    title: "Vybe Studio",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  maybeRunCapture(win);

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if ((devUrl && url.startsWith(devUrl)) || url.startsWith("file://")) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(here, "../renderer/index.html"));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    handleMediaProtocol();
    registerIpc();
    loadPlugins();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  flushDb();
  void stopEngine();
});
