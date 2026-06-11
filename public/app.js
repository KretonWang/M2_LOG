// M2 LOG Tool - 前端邏輯
const $ = (sel) => document.querySelector(sel);

const state = {
  lastExportPath: null,
};

const panes = {
  uefi: $('#uefiLog'),
  sam: $('#samLog'),
};

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
  // 動態元件
  updateCounter();
  document.querySelectorAll('#customFields .custom-row').forEach((row) => {
    row.querySelector('.cf-label').setAttribute('placeholder', t('custom.label.ph'));
    row.querySelector('.cf-value').setAttribute('placeholder', t('custom.value.ph'));
    row.querySelector('.btn-remove').setAttribute('title', t('custom.remove.title'));
  });
}

async function loadLang(lang) {
  try {
    const res = await fetch(`i18n/${lang}.json`);
    if (!res.ok) throw new Error('i18n load failed');
    I18N = await res.json();
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    const label = document.getElementById('langLabel');
    if (label) label.textContent = lang === 'zh' ? 'EN' : '中';
    applyI18n();
  } catch (e) {
    /* 載入失敗則保留現有文字 */
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
  });
});

/* ---------- Splitter (drag to resize left/right) ---------- */
const splitter = document.getElementById('splitter');
const layout = document.querySelector('.layout');
const LEFT_KEY = 'm2log_left_width';
const MIN_LEFT = 260;
const MIN_RIGHT = 360;

function applyLeftWidth(px) {
  // 右側保留至少 MIN_RIGHT，左側不小於 MIN_LEFT，總寬符合螢幕
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
  // 視窗縮放時重新夾住寬度
  window.addEventListener('resize', () => {
    const cur = parseInt(getComputedStyle(layout).getPropertyValue('--left-width'), 10);
    if (!Number.isNaN(cur)) applyLeftWidth(cur);
  });
}

/* ---------- Tabs ---------- */
const tabs = document.querySelectorAll('.tab');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.target;
    document.querySelectorAll('.log-pane').forEach((p) => p.classList.remove('active'));
    $(`#pane-${target}`).classList.add('active');
    panes[target].focus();
    updateCounter();
  });
});

/* ---------- Counter ---------- */
function countText(text) {
  const chars = text.length;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  return { chars, lines };
}

function updateCounter() {
  const activeTab = document.querySelector('.tab.active').dataset.target;
  const { chars, lines } = countText(panes[activeTab].value);
  $('#counter').textContent = t('counter.tpl', '{lines} 行 · {chars} 字元')
    .replace('{lines}', lines)
    .replace('{chars}', chars);
}

panes.uefi.addEventListener('input', updateCounter);
panes.sam.addEventListener('input', updateCounter);

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

/* ---------- Experiment name → folder preview ---------- */
function isEnglishName(name) {
  const s = String(name || '').trim();
  return /^[A-Za-z0-9 _-]+$/.test(s) && /[A-Za-z]/.test(s);
}

// 與後端相同的 10 碼縮寫規則
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
    <button type="button" class="btn-remove" title="${t('custom.remove.title')}">&times;</button>
  `;
  row.querySelector('.cf-label').value = label;
  row.querySelector('.cf-value').value = value;
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', saveCustomFields));
  row.querySelector('.btn-remove').addEventListener('click', () => {
    row.remove();
    saveCustomFields();
  });
  $('#customFields').appendChild(row);
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
  payload.uefiLog = panes.uefi.value;
  payload.samLog = panes.sam.value;

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
  if (!payload.uefiLog.trim() && !payload.samLog.trim()) {
    toast(t('toast.needLog'), 'error');
    return;
  }

  const btn = $('#btnExport');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '輸出失敗');

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
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p || state.lastExportPath }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(t('toast.explorerOk'), 'info');
  } catch (err) {
    toast(t('toast.openFail') + err.message, 'error');
  }
}

/* ---------- Wire up ---------- */
$('#btnExport').addEventListener('click', doExport);
$('#btnOpenExplorer').addEventListener('click', () => openFolder(state.lastExportPath));
$('#btnAddField').addEventListener('click', () => {
  addCustomRow();
  saveCustomFields();
});
$('#experimentName').addEventListener('input', updateFolderPreview);
$('#btnLang').addEventListener('click', () => {
  loadLang(currentLang === 'zh' ? 'en' : 'zh');
});
$('#btnClearLogs').addEventListener('click', () => {
  panes.uefi.value = '';
  panes.sam.value = '';
  updateCounter();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    doExport();
  }
});

/* ---------- Init ---------- */
loadForm();
loadCustomFields();
if (!$('#date').value) $('#date').value = todayStr();
updateFolderPreview();
updateCounter();
loadLang(currentLang);
