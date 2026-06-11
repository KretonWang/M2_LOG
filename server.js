/**
 * M2 LOG Tool - 後端伺服器
 * 提供：實驗 LOG (UEFI / SAM) 收集、自動建立目錄並寫入檔案、開啟檔案總管。
 *
 * 只綁定 127.0.0.1 (localhost)，不對外網路開放。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

// 是否為 pkg 打包後的 EXE。打包後 __dirname 會指向唯讀的 snapshot 虛擬檔案系統，
// 不能拿來當輸出目錄，必須改用 EXE 實際所在的資料夾。
const isPackaged = typeof process.pkg !== 'undefined';
const appDir = isPackaged ? path.dirname(process.execPath) : __dirname;

// 預設輸出根目錄（開發模式：專案底下；EXE：執行檔同層的 LOG_OUTPUT/）
const DEFAULT_OUTPUT_DIR = path.join(appDir, 'LOG_OUTPUT');

app.use(express.json({ limit: '50mb' }));
// 靜態檔案仍從 __dirname/public 讀取——pkg 會把 public/ 以 assets 形式打包進 snapshot。
app.use(express.static(path.join(__dirname, 'public')));

// 記錄最後一次輸出的資料夾，讓「開啟檔案總管」可直接定位
let lastExportPath = null;

/** 實驗名稱是否為英文（字母 / 數字 / 空白 / _ / -，且至少含一個字母） */
function isEnglishName(name) {
  if (!name || typeof name !== 'string') return false;
  const s = name.trim();
  return /^[A-Za-z0-9 _-]+$/.test(s) && /[A-Za-z]/.test(s);
}

/** 由實驗名稱產生 10 碼英文縮寫（大寫）。多字取字首縮寫，不足則補字母，再不足補 X。 */
function abbreviate(name, len = 10) {
  const letters = String(name || '')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
  if (!letters) return 'EXPERIMENT'.slice(0, len);
  const words = letters.split(/\s+/);
  let abbr;
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join('');
    abbr = initials.length >= len ? initials : initials + words.map((w) => w.slice(1)).join('');
  } else {
    abbr = words[0];
  }
  abbr = abbr.toUpperCase().replace(/[^A-Z]/g, '');
  return abbr.length >= len ? abbr.slice(0, len) : abbr.padEnd(len, 'X');
}

/** 產生 YYYYMMDD 日期碼 */
function dateStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** 產生 HHmm 四碼時間 */
function timeStamp4(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 若資料夾已存在則加上 -2 / -3 ... 避免覆蓋 */
function uniqueDir(baseDir, folderName) {
  let dir = path.join(baseDir, folderName);
  let i = 2;
  while (fs.existsSync(dir)) {
    dir = path.join(baseDir, `${folderName}-${i}`);
    i += 1;
  }
  return dir;
}

/** 組出要崁在 LOG 最上面的資訊區塊 */
function buildHeader(meta, logType) {
  const rows = [
    ['Experiment', meta.experimentName],
    ['Date', meta.date],
    ['Tester', meta.tester],
    ['Test Case', meta.testCase],
  ];
  (meta.customFields || []).forEach((f) => {
    if (f && (f.label || f.value)) rows.push([f.label || '(field)', f.value || '']);
  });
  if (meta.notes && String(meta.notes).trim()) rows.push(['Notes', meta.notes]);
  rows.push(['Log Type', logType]);
  rows.push(['Created', meta.createdAt]);

  const width = rows.reduce((m, [k]) => Math.max(m, k.length), 0);
  const line = '='.repeat(60);
  const body = rows
    .map(([k, v]) => `  ${k.padEnd(width)} : ${String(v == null ? '' : v).replace(/\r?\n/g, ' ')}`)
    .join('\r\n');
  return [line, '  EXPERIMENT LOG', line, body, line, '', ''].join('\r\n');
}

/**
 * 用系統檔案管理員開啟指定路徑。
 * 使用 execFile + 參數陣列（不經過 shell），避免路徑被當成命令注入。
 */
function openInExplorer(targetPath) {
  // explorer.exe 開啟成功時也可能回傳非 0 exit code，這裡忽略錯誤即可。
  const ignore = () => {};
  if (process.platform === 'win32') {
    execFile('explorer.exe', [targetPath], ignore);
  } else if (process.platform === 'darwin') {
    execFile('open', [targetPath], ignore);
  } else {
    execFile('xdg-open', [targetPath], ignore);
  }
}

/** 把指定檔案清單壓成一個 zip。entries = [{ abs, name }]，回傳 Promise<zipPath> */
function createZip(zipPath, entries) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });

    archive.pipe(output);
    entries.forEach((e) => archive.file(e.abs, { name: e.name }));
    archive.finalize();
  });
}

// 輸出 LOG：建立目錄並寫入 UEFI / SAM
app.post('/api/export', async (req, res) => {
  try {
    const {
      experimentName = '',
      date = '',
      tester = '',
      testCase = '',
      notes = '',
      outputBase = '',
      customFields = [],
      uefiLog = '',
      samLog = '',
    } = req.body || {};

    // 實驗名稱必須是英文
    if (!isEnglishName(experimentName)) {
      return res
        .status(400)
        .json({ ok: false, error: '實驗名稱必須是英文 (Experiment name must be English)。' });
    }

    // 過濾自訂欄位（至少要有 label 或 value）
    const cleanCustom = Array.isArray(customFields)
      ? customFields
          .map((f) => ({ label: String(f.label || '').trim(), value: String(f.value || '').trim() }))
          .filter((f) => f.label || f.value)
      : [];

    const baseDir = outputBase && outputBase.trim() ? outputBase.trim() : DEFAULT_OUTPUT_DIR;
    // 資料夾名稱：YYYYMMDD_HHmm_<6碼英文縮寫>
    const now = new Date();
    const folderName = `${dateStamp(now)}_${timeStamp4(now)}_${abbreviate(experimentName)}`;
    const targetDir = uniqueDir(baseDir, folderName);

    fs.mkdirSync(targetDir, { recursive: true });

    const written = [];

    const meta = {
      experimentName,
      date,
      tester,
      testCase,
      notes,
      customFields: cleanCustom,
      createdAt: now.toISOString(),
    };

    // 機器可讀的 metadata
    const metaPath = path.join(targetDir, 'info.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    written.push(metaPath);

    // UEFI LOG（資訊區塊崁在最上面）
    if (uefiLog && uefiLog.trim()) {
      const uefiDir = path.join(targetDir, 'UEFI');
      fs.mkdirSync(uefiDir, { recursive: true });
      const p = path.join(uefiDir, 'UEFI.log');
      fs.writeFileSync(p, buildHeader(meta, 'UEFI') + uefiLog, 'utf8');
      written.push(p);
    }

    // SAM LOG（資訊區塊崁在最上面）
    if (samLog && samLog.trim()) {
      const samDir = path.join(targetDir, 'SAM');
      fs.mkdirSync(samDir, { recursive: true });
      const p = path.join(samDir, 'SAM.log');
      fs.writeFileSync(p, buildHeader(meta, 'SAM') + samLog, 'utf8');
      written.push(p);
    }

    // 在同目錄下產生一個完整壓縮 ZIP（內容 = 剛寫入的檔案）
    const zipName = `${path.basename(targetDir)}.zip`;
    const zipPath = path.join(targetDir, zipName);
    const zipEntries = written.map((abs) => ({
      abs,
      name: path.relative(targetDir, abs).split(path.sep).join('/'),
    }));
    await createZip(zipPath, zipEntries);
    written.push(zipPath);

    lastExportPath = targetDir;

    res.json({
      ok: true,
      targetDir,
      folderName: path.basename(targetDir),
      zip: zipPath,
      files: written,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 開啟檔案總管
app.post('/api/open-folder', (req, res) => {
  try {
    let target = req.body && req.body.path ? req.body.path : lastExportPath || DEFAULT_OUTPUT_DIR;

    // 若目標已不存在（例如被刪除），退回預設輸出目錄
    if (!fs.existsSync(target)) {
      fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
      target = DEFAULT_OUTPUT_DIR;
    }

    openInExplorer(target);
    res.json({ ok: true, path: target });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 確保預設輸出目錄存在
fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });

app.listen(PORT, HOST, () => {
  console.log('\n  ┌───────────────────────────────────────┐');
  console.log('  │   M2 LOG Tool 已啟動                    │');
  console.log(`  │   ➜  http://${HOST}:${PORT}              │`);
  console.log('  └───────────────────────────────────────┘\n');
});
