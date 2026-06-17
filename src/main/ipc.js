'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const { exportLog, openFolder } = require('./logwriter');
const { defaultOutputDir } = require('./paths');

/** Register all IPC handlers used by the renderer through the preload bridge. */
function registerIpc() {
  // Export logs to a generated folder (+ info.json + zip).
  ipcMain.handle('log:export', async (_evt, payload) => {
    try {
      return await exportLog(payload);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Open a folder in the OS file manager.
  ipcMain.handle('log:openFolder', async (_evt, targetPath) => {
    try {
      return openFolder(targetPath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Native folder picker for the "Output Root" field.
  ipcMain.handle('dialog:pickFolder', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  // Newest file in the user's Downloads folder (covers browser and Teams downloads).
  ipcMain.handle('download:latest', async () => {
    try {
      const dir = app.getPath('downloads');
      const skip = /\.(crdownload|part|partial|tmp|download|opdownload)$/i;
      let best = null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || skip.test(entry.name)) continue;
        let score = 0;
        try {
          const st = fs.statSync(path.join(dir, entry.name));
          score = Math.max(st.birthtimeMs || 0, st.mtimeMs || 0);
        } catch (e) {
          continue;
        }
        if (!best || score > best.score) best = { name: entry.name, score };
      }
      if (!best) return { ok: false, error: 'No files in Downloads' };
      return { ok: true, name: best.name, dir };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Default LOG output folder (root for the LOG Analysis view).
  ipcMain.handle('fs:logRoot', async () => {
    try {
      const dir = defaultOutputDir();
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, path: dir };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // List a directory (one level) for the file tree.
  ipcMain.handle('fs:list', async (_evt, dirPath) => {
    try {
      const p = String(dirPath || '');
      if (!p) return { ok: false, error: 'No path' };
      const st = fs.statSync(p);
      if (!st.isDirectory()) return { ok: false, error: 'Not a directory' };
      const entries = fs.readdirSync(p, { withFileTypes: true }).map((e) => {
        const full = path.join(p, e.name);
        let isDir = e.isDirectory();
        let size = 0;
        let mtime = 0;
        try {
          const s = fs.statSync(full);
          isDir = s.isDirectory();
          size = s.size;
          mtime = s.mtimeMs;
        } catch (err2) {
          /* ignore entries we cannot stat */
        }
        return { name: e.name, path: full, isDir, size, mtime, ext: path.extname(e.name).slice(1).toLowerCase() };
      });
      return { ok: true, path: p, entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Read a text file for the viewer (capped, with binary detection).
  ipcMain.handle('fs:readText', async (_evt, filePath) => {
    try {
      const p = String(filePath || '');
      const st = fs.statSync(p);
      if (!st.isFile()) return { ok: false, error: 'Not a file' };
      const MAX = 5 * 1024 * 1024;
      const len = Math.min(st.size, MAX);
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(len);
        if (len > 0) fs.readSync(fd, buf, 0, len, 0);
        const probe = buf.subarray(0, Math.min(len, 8192));
        if (probe.includes(0)) return { ok: false, binary: true, error: 'Binary file', size: st.size };
        return { ok: true, path: p, name: path.basename(p), size: st.size, content: buf.toString('utf8'), truncated: st.size > MAX };
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Load an i18n bundle from disk (avoids fetch on the file:// renderer).
  ipcMain.handle('i18n:load', async (_evt, lang) => {
    try {
      const safe = String(lang || 'en').replace(/[^a-z-]/gi, '');
      const file = path.join(__dirname, '..', 'renderer', 'i18n', `${safe}.json`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return {};
    }
  });
}

module.exports = { registerIpc };
