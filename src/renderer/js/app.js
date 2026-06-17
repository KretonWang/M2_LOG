// M2 LOG Tool - renderer logic (talks to the main process via window.m2log)
const $ = (sel) => document.querySelector(sel);

const state = {
  lastExportPath: null,
};

/* ---------- Settings ---------- */
const ABBREV_KEY = 'm2log_abbrev_len';
const ABBREV_DEFAULT = 30;
const ABBREV_MIN = 1;
const ABBREV_MAX = 40;
function clampLen(n) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) return ABBREV_DEFAULT;
  return Math.min(ABBREV_MAX, Math.max(ABBREV_MIN, n));
}
let abbrevLen = clampLen(localStorage.getItem(ABBREV_KEY));

/* ---------- Dynamic LOG entries ---------- */
const LOGS_KEY = 'm2log_logs';
const LOG_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#facc15'];
let logs = [];
let activeLogId = null;

function uid() {
  return 'l' + Math.random().toString(36).slice(2, 9);
}

const formFields = [
  'experimentName',
  'date',
  'tester',
  'testCase',
  'notes',
  'outputBase',
];

const CUSTOM_KEY = 'm2log_custom';

/* ---------- i18n ---------- */
const LANG_KEY = 'm2log_lang';
let I18N = {};
let currentLang = localStorage.getItem(LANG_KEY) || 'zh';

function t(key, fallback) {
  if (I18N && I18N[key] != null) return I18N[key];
  return fallback != null ? fallback : key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'), el.textContent);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  // Dynamic widgets
  if (Array.isArray(logs) && logs.length) renderLogs();
  updateCounter();
  document.querySelectorAll('#customFields .custom-row').forEach((row) => {
    row.querySelector('.cf-label').setAttribute('placeholder', t('custom.label.ph'));
    row.querySelector('.cf-value').setAttribute('placeholder', t('custom.value.ph'));
    row.querySelector('.btn-grab').setAttribute('title', t('custom.grab.title'));
    row.querySelector('.btn-remove').setAttribute('title', t('custom.remove.title'));
  });
}

async function loadLang(lang) {
  try {
    const data = await window.m2log.loadI18n(lang);
    if (!data || typeof data !== 'object') throw new Error('i18n load failed');
    I18N = data;
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    const label = document.getElementById('langLabel');
    if (label) label.textContent = lang === 'zh' ? 'EN' : '中';
    applyI18n();
  } catch (e) {
    /* keep existing text on failure */
  }
}

/* ---------- Top-level feature tabs ---------- */
const featureTabs = document.querySelectorAll('.feature-tab');
featureTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    featureTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    document.querySelectorAll('.feature-view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    if (view === 'analysis') anaEnsureInit();
  });
});

/* ---------- Splitter (drag to resize left/right) ---------- */
const splitter = document.getElementById('splitter');
const layout = document.querySelector('.layout');
const LEFT_KEY = 'm2log_left_width';
const MIN_LEFT = 260;
const MIN_RIGHT = 360;

function applyLeftWidth(px) {
  // Keep at least MIN_RIGHT on the right and MIN_LEFT on the left.
  const max = Math.max(MIN_LEFT, layout.clientWidth - MIN_RIGHT - 8);
  const clamped = Math.min(Math.max(px, MIN_LEFT), max);
  layout.style.setProperty('--left-width', clamped + 'px');
  return clamped;
}

if (splitter && layout) {
  const saved = parseInt(localStorage.getItem(LEFT_KEY), 10);
  if (!Number.isNaN(saved)) applyLeftWidth(saved);

  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    applyLeftWidth(e.clientX - rect.left);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.classList.remove('col-resizing');
    const w = parseInt(getComputedStyle(layout).getPropertyValue('--left-width'), 10);
    if (!Number.isNaN(w)) localStorage.setItem(LEFT_KEY, String(w));
  };

  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    document.body.classList.add('col-resizing');
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Re-clamp width when the window resizes.
  window.addEventListener('resize', () => {
    const cur = parseInt(getComputedStyle(layout).getPropertyValue('--left-width'), 10);
    if (!Number.isNaN(cur)) applyLeftWidth(cur);
  });
}

/* ---------- Log entries (dynamic tabs / panes) ---------- */
function loadLogs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(LOGS_KEY) || 'null');
  } catch (e) {
    saved = null;
  }
  if (Array.isArray(saved) && saved.length) {
    logs = saved.map((l) => ({ id: uid(), type: String(l.type || ''), content: String(l.content || '') }));
  } else {
    logs = [
      { id: uid(), type: 'UEFI', content: '' },
      { id: uid(), type: 'SAM', content: '' },
    ];
  }
  activeLogId = logs[0].id;
  renderLogs();
}

function saveLogs() {
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs.map((l) => ({ type: l.type, content: l.content }))));
}

function setActive(id) {
  activeLogId = id;
  document.querySelectorAll('#logTabs .tab[data-id]').forEach((tab) => tab.classList.toggle('active', tab.dataset.id === id));
  document.querySelectorAll('#logBody .log-pane[data-id]').forEach((p) => p.classList.toggle('active', p.dataset.id === id));
  const pane = document.querySelector(`#logBody .log-pane[data-id="${id}"]`);
  if (pane) {
    const ta = pane.querySelector('.log-input');
    if (ta) ta.focus();
  }
  updateCounter();
}

function addLog() {
  const log = { id: uid(), type: `LOG${logs.length + 1}`, content: '' };
  logs.push(log);
  activeLogId = log.id;
  saveLogs();
  renderLogs();
  const pane = document.querySelector(`#logBody .log-pane[data-id="${log.id}"]`);
  if (pane) pane.querySelector('.log-type').focus();
}

function removeLog(id) {
  if (logs.length <= 1) {
    toast(t('toast.minLog', 'Keep at least one LOG'), 'error');
    return;
  }
  const idx = logs.findIndex((l) => l.id === id);
  logs = logs.filter((l) => l.id !== id);
  if (activeLogId === id) activeLogId = logs[Math.max(0, idx - 1)].id;
  saveLogs();
  renderLogs();
}

function renderLogs() {
  const tabsEl = $('#logTabs');
  const bodyEl = $('#logBody');
  if (!tabsEl || !bodyEl) return;
  tabsEl.innerHTML = '';
  bodyEl.innerHTML = '';

  logs.forEach((log, idx) => {
    // Tab
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab' + (log.id === activeLogId ? ' active' : '');
    tab.dataset.id = log.id;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = LOG_COLORS[idx % LOG_COLORS.length];
    dot.style.boxShadow = `0 0 8px ${LOG_COLORS[idx % LOG_COLORS.length]}`;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = log.type || 'LOG';
    tab.append(dot, nameSpan);
    tab.addEventListener('click', () => setActive(log.id));
    tabsEl.appendChild(tab);

    // Pane
    const pane = document.createElement('div');
    pane.className = 'log-pane' + (log.id === activeLogId ? ' active' : '');
    pane.dataset.id = log.id;

    const bar = document.createElement('div');
    bar.className = 'log-pane-bar';
    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.className = 'log-type';
    typeInput.value = log.type;
    typeInput.placeholder = t('log.type.ph');
    typeInput.addEventListener('input', () => {
      log.type = typeInput.value;
      nameSpan.textContent = log.type || 'LOG';
      saveLogs();
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-remove log-remove';
    rm.title = t('log.remove.title');
    rm.textContent = '\u00d7';
    rm.addEventListener('click', () => removeLog(log.id));
    bar.append(typeInput, rm);

    const ta = document.createElement('textarea');
    ta.className = 'log-input';
    ta.spellcheck = false;
    ta.placeholder = t('log.content.ph');
    ta.value = log.content;
    ta.addEventListener('input', () => {
      log.content = ta.value;
      updateCounter();
      saveLogs();
    });

    pane.append(bar, ta);
    bodyEl.appendChild(pane);
  });

  // "+" add button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tab tab-add';
  addBtn.title = t('log.add.title');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', addLog);
  tabsEl.appendChild(addBtn);

  updateCounter();
}

/* ---------- Counter ---------- */
function countText(text) {
  const chars = text.length;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  return { chars, lines };
}

function updateCounter() {
  const log = logs.find((l) => l.id === activeLogId);
  const { chars, lines } = countText(log ? log.content : '');
  $('#counter').textContent = t('counter.tpl', '{lines} 行 · {chars} 字元')
    .replace('{lines}', lines)
    .replace('{chars}', chars);
}

/* ---------- Form persistence ---------- */
function saveForm() {
  const data = {};
  formFields.forEach((f) => (data[f] = $(`#${f}`).value));
  localStorage.setItem('m2log_form', JSON.stringify(data));
}

function loadForm() {
  try {
    const data = JSON.parse(localStorage.getItem('m2log_form') || '{}');
    formFields.forEach((f) => {
      if (data[f] !== undefined) $(`#${f}`).value = data[f];
    });
  } catch (e) {
    /* ignore */
  }
}

formFields.forEach((f) => $(`#${f}`).addEventListener('input', saveForm));

/* ---------- Helpers ---------- */
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ---------- Experiment name -> folder preview ---------- */
function isEnglishName(name) {
  const s = String(name || '').trim();
  return /^[A-Za-z0-9 _-]+$/.test(s) && /[A-Za-z]/.test(s);
}

// Same folder abbreviation rule as the main process (utils.js).
function abbreviate(name, max = abbrevLen) {
  // Spaces / punctuation -> underscore, uppercase, collapse and trim underscores.
  let s = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (!s) return 'EXPERIMENT';
  // No padding: keep short names short; cap long names, trimming a trailing underscore.
  if (s.length > max) s = s.slice(0, max).replace(/_+$/g, '');
  return s;
}

function updateFolderPreview() {
  const name = $('#experimentName').value;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const abbr = name.trim() ? abbreviate(name) : 'ABBREVIATE';
  $('#folderPreview').textContent = `${date}_${time}_${abbr}`;
}

/* ---------- Custom fields ---------- */
function getCustomFields() {
  return Array.from(document.querySelectorAll('#customFields .custom-row')).map((row) => ({
    label: row.querySelector('.cf-label').value,
    value: row.querySelector('.cf-value').value,
  }));
}

function saveCustomFields() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(getCustomFields()));
}

function addCustomRow(label = '', value = '') {
  const row = document.createElement('div');
  row.className = 'custom-row';
  row.innerHTML = `
    <input class="cf-label" type="text" placeholder="${t('custom.label.ph')}" autocomplete="off" />
    <input class="cf-value" type="text" placeholder="${t('custom.value.ph')}" autocomplete="off" />
    <button type="button" class="btn-grab" title="${t('custom.grab.title')}">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </button>
    <button type="button" class="btn-remove" title="${t('custom.remove.title')}">&times;</button>
  `;
  row.querySelector('.cf-label').value = label;
  row.querySelector('.cf-value').value = value;
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', saveCustomFields));
  row.querySelector('.btn-grab').addEventListener('click', () => grabLatestDownload(row));
  row.querySelector('.btn-remove').addEventListener('click', () => {
    row.remove();
    saveCustomFields();
  });
  $('#customFields').appendChild(row);
}

/** Fill a custom-field value with the name of the most recently downloaded file. */
async function grabLatestDownload(row) {
  try {
    const r = await window.m2log.latestDownload();
    if (r && r.ok && r.name) {
      row.querySelector('.cf-value').value = r.name;
      saveCustomFields();
      toast(t('toast.grabOk') + r.name, 'success');
    } else {
      toast(t('toast.grabFail') + ((r && r.error) || ''), 'error');
    }
  } catch (e) {
    toast(t('toast.grabFail') + e.message, 'error');
  }
}

function loadCustomFields() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
  } catch (e) {
    /* ignore */
  }
  $('#customFields').innerHTML = '';
  if (saved.length === 0) {
    addCustomRow();
  } else {
    saved.forEach((f) => addCustomRow(f.label, f.value));
  }
}

/* ---------- Toast ---------- */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

/* ---------- Export ---------- */
async function doExport() {
  const payload = {};
  formFields.forEach((f) => (payload[f] = $(`#${f}`).value));
  payload.customFields = getCustomFields();
  payload.logs = logs.map((l) => ({ type: l.type, content: l.content }));
  payload.abbrevLen = abbrevLen;

  if (!payload.experimentName.trim()) {
    toast(t('toast.needName'), 'error');
    $('#experimentName').focus();
    return;
  }
  if (!isEnglishName(payload.experimentName)) {
    toast(t('toast.nameEnglish'), 'error');
    $('#experimentName').focus();
    return;
  }
  if (!logs.some((l) => (l.content || '').trim())) {
    toast(t('toast.needLog'), 'error');
    return;
  }

  const btn = $('#btnExport');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const data = await window.m2log.exportLog(payload);
    if (!data || !data.ok) throw new Error((data && data.error) || 'Export failed');

    state.lastExportPath = data.targetDir;
    showResult(data);
    toast(t('toast.exportOk'), 'success');
  } catch (err) {
    toast(t('toast.exportFail') + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function showResult(data) {
  const panel = $('#result');
  panel.classList.remove('hidden');
  const files = data.files.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  panel.innerHTML = `
    <div class="result-head">
      <span class="result-title">${t('result.title')}</span>
      <button class="btn btn-ghost btn-sm" id="btnOpenResult">${t('result.openFolder')}</button>
    </div>
    <div class="result-path">${escapeHtml(data.targetDir)}</div>
    <ul class="result-files">${files}</ul>
  `;
  $('#btnOpenResult').addEventListener('click', () => openFolder(data.targetDir));
}

/* ---------- Open folder ---------- */
async function openFolder(p) {
  try {
    const data = await window.m2log.openFolder(p || state.lastExportPath);
    if (!data || !data.ok) throw new Error((data && data.error) || 'Open failed');
    toast(t('toast.explorerOk'), 'info');
  } catch (err) {
    toast(t('toast.openFail') + err.message, 'error');
  }
}

/* ---------- Pick output folder (native dialog) ---------- */
async function pickOutputBase() {
  try {
    const r = await window.m2log.pickFolder();
    if (r && r.ok && r.path) {
      $('#outputBase').value = r.path;
      saveForm();
    }
  } catch (e) {
    /* ignore */
  }
}

/* ---------- Wire up ---------- */
$('#btnExport').addEventListener('click', doExport);
$('#btnOpenExplorer').addEventListener('click', () => openFolder(state.lastExportPath));
$('#btnBrowseBase').addEventListener('click', pickOutputBase);
$('#btnAddField').addEventListener('click', () => {
  addCustomRow();
  saveCustomFields();
});
$('#experimentName').addEventListener('input', updateFolderPreview);
$('#btnLang').addEventListener('click', () => {
  loadLang(currentLang === 'zh' ? 'en' : 'zh');
});
$('#btnClearLogs').addEventListener('click', () => {
  const log = logs.find((l) => l.id === activeLogId);
  if (!log) return;
  log.content = '';
  const ta = document.querySelector(`#logBody .log-pane[data-id="${log.id}"] .log-input`);
  if (ta) ta.value = '';
  updateCounter();
  saveLogs();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doExport();
  }
});

/* ---------- LOG Analysis ---------- */
const ANA_FOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ANA_FILE_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const ana = { root: '' };
let anaReady = false;

function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

async function anaEnsureInit() {
  if (anaReady) return;
  anaReady = true;
  const r = await window.m2log.logRoot();
  ana.root = r && r.ok && r.path ? r.path : '';
  await anaRenderTree();
}

async function anaRenderTree() {
  const treeEl = $('#anaTree');
  if (!treeEl) return;
  $('#anaPath').textContent = ana.root || '';
  treeEl.innerHTML = `<div class="ana-hint">${t('ana.loading')}</div>`;
  const res = await window.m2log.listDir(ana.root);
  treeEl.innerHTML = '';
  if (!res || !res.ok) {
    treeEl.innerHTML = `<div class="ana-empty">${escapeHtml((res && res.error) || t('ana.loadFail'))}</div>`;
    $('#anaCount').textContent = '';
    return;
  }
  if (!res.entries.length) {
    treeEl.innerHTML = `<div class="ana-empty">${t('ana.noFiles')}</div>`;
  } else {
    treeEl.appendChild(anaBuildLevel(res.entries, 0));
  }
  $('#anaCount').textContent = String(res.entries.length);
}

function anaSort(entries) {
  const dirs = entries.filter((e) => e.isDir).sort((a, b) => b.name.localeCompare(a.name));
  const files = entries.filter((e) => !e.isDir).sort((a, b) => a.name.localeCompare(b.name));
  return dirs.concat(files);
}

function anaBuildLevel(entries, depth) {
  const frag = document.createDocumentFragment();
  anaSort(entries).forEach((entry) => frag.appendChild(anaBuildNode(entry, depth)));
  return frag;
}

function anaBuildNode(entry, depth) {
  const row = document.createElement('div');
  row.className = 'ana-row ' + (entry.isDir ? 'is-dir' : 'is-file');
  row.style.paddingLeft = 8 + depth * 16 + 'px';
  const caret = document.createElement('span');
  caret.className = 'ana-caret';
  caret.textContent = entry.isDir ? '\u25B8' : '';
  const ic = document.createElement('span');
  ic.className = 'ana-ic';
  ic.innerHTML = entry.isDir ? ANA_FOLDER_SVG : ANA_FILE_SVG;
  const name = document.createElement('span');
  name.className = 'ana-name';
  name.textContent = entry.name;
  row.append(caret, ic, name);

  if (!entry.isDir) {
    row.addEventListener('click', () => anaViewFile(entry, row));
    return row;
  }

  const wrap = document.createElement('div');
  wrap.className = 'ana-node';
  const children = document.createElement('div');
  children.className = 'ana-children';
  children.hidden = true;
  let loaded = false;
  row.addEventListener('click', async () => {
    if (!children.hidden) {
      children.hidden = true;
      row.classList.remove('open');
      return;
    }
    if (!loaded) {
      loaded = true;
      const res = await window.m2log.listDir(entry.path);
      children.innerHTML = '';
      if (res && res.ok && res.entries.length) {
        children.appendChild(anaBuildLevel(res.entries, depth + 1));
      } else if (res && res.ok) {
        children.innerHTML = `<div class="ana-hint" style="padding-left:${8 + (depth + 1) * 16}px">${t('ana.noFiles')}</div>`;
      } else {
        children.innerHTML = `<div class="ana-empty">${escapeHtml((res && res.error) || t('ana.loadFail'))}</div>`;
      }
    }
    children.hidden = false;
    row.classList.add('open');
  });
  wrap.append(row, children);
  return wrap;
}

async function anaViewFile(entry, row) {
  document.querySelectorAll('#anaTree .ana-row.selected').forEach((r) => r.classList.remove('selected'));
  if (row) row.classList.add('selected');
  $('#anaViewName').textContent = entry.name;
  $('#anaViewMeta').textContent = '';
  const content = $('#anaViewContent');
  content.textContent = t('ana.loading');
  const res = await window.m2log.readText(entry.path);
  if (!res || !res.ok) {
    content.textContent = res && res.binary ? t('ana.binary') : (res && res.error) || t('ana.readFail');
    return;
  }
  content.textContent = res.content + (res.truncated ? `\n\n... [${t('ana.truncated')}]` : '');
  $('#anaViewMeta').textContent = formatBytes(res.size) + (res.truncated ? ' · ' + t('ana.truncated') : '');
}

$('#btnAnaBrowse').addEventListener('click', async () => {
  const r = await window.m2log.pickFolder();
  if (r && r.ok && r.path) {
    ana.root = r.path;
    await anaRenderTree();
  }
});
$('#btnAnaReset').addEventListener('click', async () => {
  const r = await window.m2log.logRoot();
  if (r && r.ok && r.path) ana.root = r.path;
  await anaRenderTree();
});
$('#btnAnaRefresh').addEventListener('click', anaRenderTree);
$('#btnAnaOpen').addEventListener('click', () => {
  if (ana.root) window.m2log.openFolder(ana.root);
});
$('#btnAnaCopy').addEventListener('click', async () => {
  const text = $('#anaViewContent').textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copyOk'), 'success');
  } catch (e) {
    toast(t('toast.copyFail') + e.message, 'error');
  }
});

/* ---------- Settings modal ---------- */
function openSettings() {
  $('#setAbbrevLen').value = abbrevLen;
  updateSettingsPreview();
  $('#settingsModal').classList.remove('hidden');
}
function closeSettings() {
  $('#settingsModal').classList.add('hidden');
}
function updateSettingsPreview() {
  const len = clampLen($('#setAbbrevLen').value);
  const name = $('#experimentName').value.trim() || 'Boot Stress Memory Test';
  $('#setPreview').textContent = abbreviate(name, len);
}
$('#btnSettings').addEventListener('click', openSettings);
$('#btnSettingsClose').addEventListener('click', closeSettings);
$('#settingsModal').addEventListener('click', (e) => {
  if (e.target === $('#settingsModal')) closeSettings();
});
$('#setAbbrevLen').addEventListener('input', () => {
  abbrevLen = clampLen($('#setAbbrevLen').value);
  localStorage.setItem(ABBREV_KEY, String(abbrevLen));
  updateSettingsPreview();
  updateFolderPreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

/* ---------- Init ---------- */
loadForm();
loadCustomFields();
loadLogs();
if (!$('#date').value) $('#date').value = todayStr();
updateFolderPreview();
loadLang(currentLang);
