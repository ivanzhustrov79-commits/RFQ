const fs = require('fs');
const path = require('path');

const mainCjs = path.join(__dirname, 'electron', 'main.cjs');

const content = `const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

// ============================================================
// THUNDERBIRD SCANNER
// ============================================================

function findThunderbirdProfiles() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const tbProfilesPath = path.join(appData, 'Thunderbird', 'Profiles');
  if (!fs.existsSync(tbProfilesPath)) return { error: 'Thunderbird not found', path: tbProfilesPath, profiles: [] };

  const entries = fs.readdirSync(tbProfilesPath, { withFileTypes: true });
  const profiles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = path.join(tbProfilesPath, entry.name);

    // Discover mail roots dynamically
    const mailRoots = [];
    for (const cand of ['Mail', 'ImapMail', 'mail', 'imapMail']) {
      const p = path.join(profilePath, cand);
      if (fs.existsSync(p)) mailRoots.push({ path: p, label: cand });
    }
    // Also check any other mail-named dirs
    try {
      for (const e of fs.readdirSync(profilePath, { withFileTypes: true })) {
        if (e.isDirectory() && e.name.toLowerCase().includes('mail') && !mailRoots.some(r => r.path === path.join(profilePath, e.name))) {
          mailRoots.push({ path: path.join(profilePath, e.name), label: e.name });
        }
      }
    } catch (e) {}

    const allFolders = [];
    for (const root of mailRoots) {
      const f = scanDir(root.path, root.label, 0);
      allFolders.push(...f);
    }

    profiles.push({
      name: entry.name,
      path: profilePath,
      folders: allFolders,
      totalEmails: allFolders.reduce((s, f) => s + f.mboxes.reduce((s2, m) => s2 + m.emailCount, 0), 0),
    });
  }

  return { path: tbProfilesPath, profiles };
}

function scanDir(dir, label, depth) {
  const folders = [];
  if (depth > 4) return folders;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const subDirs = entries.filter(e => e.isDirectory());
    const files = entries.filter(e => !e.isDirectory());

    const skipExts = new Set(['.msf','.json','.dat','.sqlite','.db','.js','.txt','.log','.ics','.xml','.bak','.tmp','.cache','.sqlite-journal','.html','.htm','.css','.png','.jpg','.gif','.ico','.woff','.woff2']);
    const mboxes = [];

    for (const entry of files) {
      const ext = path.extname(entry.name).toLowerCase();
      if (skipExts.has(ext)) continue;
      const fp = path.join(dir, entry.name);
      const stats = fs.statSync(fp);
      if (stats.size < 10) continue;

      const hasMsf = fs.existsSync(fp + '.msf');
      let isMbox = false, emailCount = 0;

      try {
        const fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(4096);
        const n = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        const h = buf.toString('utf8', 0, n);
        if (hasMsf || h.startsWith('From ') || h.includes('X-Mozilla-Status:')) isMbox = true;
        if (isMbox) {
          const m = h.match(/\\nFrom /g);
          emailCount = (m ? m.length : 0) + 1;
          if (stats.size > 4096) emailCount = Math.max(emailCount, Math.floor(stats.size / 4000));
        }
      } catch (e) { continue; }

      if (isMbox) mboxes.push({ name: entry.name, path: fp, size: stats.size, modified: stats.mtime.toISOString(), emailCount });
    }

    if (mboxes.length > 0) folders.push({ account: label, path: dir, mboxes });

    for (const sub of subDirs) {
      const subFolders = scanDir(path.join(dir, sub.name), label + '/' + sub.name, depth + 1);
      folders.push(...subFolders);
    }
  } catch (e) {}
  return folders;
}

function parseMboxEmails(content, maxEmails) {
  const emails = [];
  const lines = content.split('\\n');
  let cur = null, inBody = false;
  for (let i = 0; i < lines.length && emails.length < maxEmails; i++) {
    const line = lines[i];
    if (line.startsWith('From ')) {
      if (cur && cur.from) emails.push(finalize(cur));
      cur = { subject: '', from: '', to: '', date: '', messageId: '', body: '', isInternal: false, isSentByUser: false };
      inBody = false;
      continue;
    }
    if (!cur) continue;
    if (!inBody) {
      if (line === '' || line === '\\r') { inBody = true; continue; }
      const l = line.toLowerCase();
      if (l.startsWith('subject:')) cur.subject = line.substring(8).trim();
      else if (l.startsWith('from:')) cur.from = line.substring(5).trim();
      else if (l.startsWith('to:')) cur.to = line.substring(3).trim();
      else if (l.startsWith('date:')) cur.date = line.substring(5).trim();
      else if (l.startsWith('message-id:')) cur.messageId = line.substring(11).trim();
    } else {
      if (cur.body.length < 1000) cur.body += line + '\\n';
    }
  }
  if (cur && cur.from) emails.push(finalize(cur));
  return emails;
}

function finalize(e) {
  if (!e.subject) e.subject = '(no subject)';
  if (!e.from) e.from = 'Unknown';
  const boss = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru'];
  e.isInternal = boss.some(b => e.from.toLowerCase().includes(b));
  e.isSentByUser = e.from.includes('izhustrov@import-detal36.ru');
  e.body = e.body.trim();
  return e;
}

// ============================================================
// IPC HANDLERS
// ============================================================

ipcMain.handle('thunderbird:discover', () => findThunderbirdProfiles());

ipcMain.handle('thunderbird:readMbox', async (_event, mboxPath, maxEmails = 100) => {
  try {
    const st = fs.statSync(mboxPath);
    if (st.size > 200 * 1024 * 1024) return { success: false, error: 'File too large (>200MB)' };
    const content = fs.readFileSync(mboxPath, 'utf8');
    return { success: true, emails: parseMboxEmails(content, maxEmails), total: 0 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// WINDOW
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1280, minHeight: 700,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
    show: false, backgroundColor: '#130A1B',
  });
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`;

// Backup old file
if (fs.existsSync(mainCjs)) {
  fs.copyFileSync(mainCjs, mainCjs + '.backup');
  console.log('Backup created: electron/main.cjs.backup');
}

// Write new file
fs.writeFileSync(mainCjs, content);
console.log('electron/main.cjs written successfully');

// Verify
const lines = fs.readFileSync(mainCjs, 'utf8').split('\n');
const handlers = lines.filter(l => l.includes('ipcMain.handle'));
console.log('IPC handlers found:', handlers.length);
handlers.forEach(h => console.log('  -', h.trim()));
`;

fs.writeFileSync(path.join(__dirname, 'fix-electron.js'), content);
console.log('fix-electron.js created. Run: node fix-electron.js');
