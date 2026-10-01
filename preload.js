const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('churchAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (db) => ipcRenderer.invoke('data:save', db),
  saveFile: (name, bytes) => ipcRenderer.invoke('file:save', name, bytes),
  savePDF: (name, html, opt) => ipcRenderer.invoke('pdf:save', name, html, opt),
  http: (url, opt) => ipcRenderer.invoke('http', url, opt),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  onUpdate: (fn) => ipcRenderer.on('update', (e, s) => fn(s)),
  lanStart: () => ipcRenderer.invoke('lan:start'),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  onLanIncoming: (fn) => ipcRenderer.on('lan:incoming', (e, { id, data }) => {
    let out = null;
    try { out = fn(data); } catch (err) { out = null; }
    ipcRenderer.send('lan:reply', id, out);
  })
});
