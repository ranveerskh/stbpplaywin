const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const PORT = 3847;
let playerProcess;

const DEFAULT_RELEASE_REPOSITORY = "ranveerskh/stbpplaywin";
const configuredReleaseRepository = String(process.env.STB_PLAY_RELEASE_REPOSITORY || DEFAULT_RELEASE_REPOSITORY).trim();
const RELEASE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configuredReleaseRepository)
  ? configuredReleaseRepository
  : DEFAULT_RELEASE_REPOSITORY;

function isTrustedUpdateUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const [owner, repository] = RELEASE_REPOSITORY.split("/");
    const parts = parsed.pathname.split("/");
    const version = String(parts[5] || "").replace(/^v/i, "");
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "github.com" &&
      !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash &&
      parts.length === 7 && parts[1] === owner && parts[2] === repository &&
      parts[3] === "releases" && parts[4] === "download" && /^\d+\.\d+\.\d+$/.test(version) &&
      parts[6] === `Netplus-IPTV-Player-Setup-${version}.exe`;
  } catch { return false; }
}

function downloadInstaller(url, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many update redirects."));
    const request = https.get(url, { headers: { "User-Agent": "STB-PLAY-Updater" } }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url);
        if (nextUrl.protocol !== "https:") return reject(new Error("The update redirect was not secure."));
        return resolve(downloadInstaller(nextUrl.toString(), targetPath, redirectCount + 1));
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`Update download failed (${status}).`));
      }

      const partialPath = `${targetPath}.part`;
      const file = fs.createWriteStream(partialPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => {
        try {
          const stat = fs.statSync(partialPath);
          const signature = fs.readFileSync(partialPath, { encoding: null, flag: "r" }).subarray(0, 2).toString("ascii");
          if (stat.size < 1_000_000 || signature !== "MZ") {
            throw new Error("The downloaded installer is incomplete or invalid.");
          }
          fs.renameSync(partialPath, targetPath);
          resolve();
        } catch (error) {
          try { fs.unlinkSync(partialPath); } catch {}
          reject(error);
        }
      }));
      file.on("error", (error) => {
        file.destroy();
        try { fs.unlinkSync(partialPath); } catch {}
        reject(error);
      });
      response.on("error", (error) => {
        try { fs.unlinkSync(partialPath); } catch {}
        reject(error);
      });
    });
    request.setTimeout(120_000, () => request.destroy(new Error("Update download timed out.")));
    request.on("error", reject);
  });
}

ipcMain.handle("download-and-install-update", async (_event, rawUrl) => {
  const updateUrl = String(rawUrl || "").trim();
  if (!isTrustedUpdateUrl(updateUrl)) throw new Error("This update link is not a trusted STB PLAY installer link.");

  const installerPath = path.join(app.getPath("temp"), `stb-play-update-${Date.now()}.exe`);
  try {
    await downloadInstaller(updateUrl, installerPath);
    const installer = spawn(installerPath, [], { detached: true, windowsHide: false, stdio: "ignore" });
    installer.unref();
    setTimeout(() => app.quit(), 900);
    return { started: true };
  } catch (error) {
    try { fs.unlinkSync(installerPath); } catch {}
    try { fs.unlinkSync(`${installerPath}.part`); } catch {}
    throw error;
  }
});

function waitForPlayer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const check = () => {
      const request = http.get(`http://127.0.0.1:${PORT}/api/config`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) reject(new Error("The local player could not start."));
        else setTimeout(check, 250);
      });
      request.setTimeout(1_000, () => request.destroy());
    };
    check();
  });
}

async function openPlayer() {
  const playerRoot = app.isPackaged
    ? path.join(process.resourcesPath, "local-player")
    : path.join(__dirname, "..", "local-player");
  const configPath = path.join(app.getPath("userData"), "config.json");
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, "stb-play-desktop-v1.8.9.ico") : path.join(__dirname, "..", "build", "stb-play-desktop-v1.8.9.ico");
  playerProcess = spawn(process.execPath, [path.join(playerRoot, "server.cjs")], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NO_OPEN_BROWSER: "1",
      NETPLUS_CONFIG_PATH: configPath,
    },
    windowsHide: true,
    stdio: "ignore",
  });
  playerProcess.unref();
  await waitForPlayer();

  const window = new BrowserWindow({
    width: 1420,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: "#07101b",
    title: "STB PLAY",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  /* Make F11 behave like a normal desktop-app full-screen toggle. The
     renderer's Full button remains scoped to the current video. */
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  await window.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(openPlayer).catch((error) => {
  dialog.showErrorBox("STB PLAY", error.message);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => playerProcess?.kill());
