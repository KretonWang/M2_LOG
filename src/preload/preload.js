'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld('m2log', {
  exportLog: (payload) => ipcRenderer.invoke('log:export', payload),
  openFolder: (targetPath) => ipcRenderer.invoke('log:openFolder', targetPath),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  latestDownload: () => ipcRenderer.invoke('download:latest'),
  logRoot: () => ipcRenderer.invoke('fs:logRoot'),
  listDir: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
  readText: (filePath) => ipcRenderer.invoke('fs:readText', filePath),
  loadI18n: (lang) => ipcRenderer.invoke('i18n:load', lang),
});
