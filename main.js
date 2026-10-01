// 성현교회 출석부 — Electron 메인 프로세스
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch { /* 개발 실행 시 없어도 됨 */ }

let win;
const dataDir = () => path.join(app.getPath('documents'), '성현교회출석부');
const dataFile = () => path.join(dataDir(), 'data.json');
const backupDir = () => path.join(dataDir(), '백업');
const ensure = () => fs.mkdirSync(backupDir(), { recursive: true });

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    title: '성현교회 출석부',
    backgroundColor: '#f2f4f1',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '파일', submenu: [
      { label: '데이터 폴더 열기', click: () => { ensure(); shell.openPath(dataDir()); } },
      { label: '업데이트 확인', click: () => checkUpdate(true) },
      { label: `버전 정보 (v${app.getVersion()})`, click: () => dialog.showMessageBox(win, { message: `성현교회 출석부 v${app.getVersion()}`, detail: `데이터 위치: ${dataDir()}` }) },
      { type: 'separator' }, { role: 'quit', label: '종료' } ] },
    { label: '보기', submenu: [
      { role: 'reload', label: '새로고침' }, { role: 'togglefullscreen', label: '전체 화면 (F11)' },
      { role: 'zoomIn', label: '크게' }, { role: 'zoomOut', label: '작게' }, { role: 'resetZoom', label: '원래 크기' },
      { type: 'separator' }, { role: 'toggleDevTools', label: '개발자 도구' } ] }
  ]));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('data:load', () => {
  ensure();
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return null; }
});

ipcMain.handle('data:save', (e, db) => {
  ensure();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, dataFile());
  // 하루 한 번 자동 백업, 최근 60개 보관
  const day = new Date().toISOString().slice(0, 10);
  const b = path.join(backupDir(), `data_${day}.json`);
  if (!fs.existsSync(b)) {
    fs.copyFileSync(dataFile(), b);
    const old = fs.readdirSync(backupDir()).filter(f => /^data_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 60)).forEach(f => fs.unlinkSync(path.join(backupDir(), f)));
  }
  return true;
});

async function askPath(name) {
  const ext = path.extname(name).slice(1) || 'dat';
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  return r.canceled ? null : r.filePath;
}

ipcMain.handle('file:save', async (e, name, bytes) => {
  const p = await askPath(name);
  if (!p) return false;
  fs.writeFileSync(p, Buffer.from(bytes));
  shell.showItemInFolder(p);
  return true;
});

ipcMain.handle('pdf:save', async (e, name, html, opt) => {
  const p = await askPath(name);
  if (!p) return false;
  const tmp = path.join(os.tmpdir(), `seonghyeon_report_${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', landscape: !!(opt && opt.landscape), printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(p, pdf);
  } finally { w.destroy(); fs.unlink(tmp, () => {}); }
  shell.openPath(p);
  return true;
});

// 구글 Apps Script 연동 (CORS 걱정 없이 메인 프로세스에서 요청)
ipcMain.handle('http', async (e, url, opt = {}) => {
  const r = await fetch(url, {
    method: opt.method || 'GET', body: opt.body, redirect: 'follow',
    headers: opt.body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined
  });
  return await r.text();
});

/* ---------- 자동 업데이트 (GitHub Releases) ---------- */
let manualCheck = false;
const sendUpdate = (state, info) => { if (win && !win.isDestroyed()) win.webContents.send('update', { state, ...(info || {}) }); };
function checkUpdate(manual) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) dialog.showMessageBox(win, { message: '설치된 프로그램에서만 업데이트를 확인할 수 있습니다.' });
    return;
  }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(err => {
    sendUpdate('error', { message: String(err && err.message || err) });
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', message: '업데이트를 확인하지 못했습니다.', detail: '인터넷 연결을 확인하세요.\n' + String(err && err.message || err) });
  });
}
function setupUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-not-available', () => {
    sendUpdate('latest');
    if (manualCheck) dialog.showMessageBox(win, { message: `최신 버전입니다 (v${app.getVersion()}).` });
  });
  autoUpdater.on('update-available', info => sendUpdate('downloading', { version: info.version }));
  autoUpdater.on('download-progress', p => sendUpdate('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('error', err => sendUpdate('error', { message: String(err && err.message || err) }));
  autoUpdater.on('update-downloaded', async info => {
    sendUpdate('ready', { version: info.version });
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').trim() : '';
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['지금 다시 시작', '나중에 (종료할 때 설치)'], defaultId: 0, cancelId: 1,
      message: `새 버전 v${info.version}을 받았습니다.`,
      detail: (notes ? notes.slice(0, 600) + '\n\n' : '') + '교인·출석 데이터는 그대로 유지됩니다.'
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
}
ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, dataDir: dataDir() }));
ipcMain.handle('app:checkUpdate', () => { checkUpdate(true); return true; });

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
  // 시작 5초 뒤, 이후 6시간마다 확인
  setTimeout(() => checkUpdate(false), 5000);
  setInterval(() => checkUpdate(false), 6 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
