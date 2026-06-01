const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

// ============================================================
// THUNDERBIRD TREE SCANNER
// Returns tree structure matching Thunderbird's folder pane
// ============================================================

const GREY_NAMES = new Set(['sent', 'drafts', 'trash', 'outbox', 'junk', 'spam', 'archive', 'templates', 'queue']);

function isGreyFolder(name) {
  const lower = name.toLowerCase();
  return GREY_NAMES.has(lower) || GREY_NAMES.has(lower.replace(/s$/, ''));
}

function findThunderbirdProfiles() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const tbProfilesPath = path.join(appData, 'Thunderbird', 'Profiles');

  if (!fs.existsSync(tbProfilesPath)) {
    return { error: 'Thunderbird Profiles not found at: ' + tbProfilesPath, path: tbProfilesPath, profiles: [] };
  }

  const entries = safeReaddir(tbProfilesPath);
  const profiles = [];

  for (const entry of entries) {
    const profilePath = path.join(tbProfilesPath, entry.name);
    if (!safeIsDir(profilePath)) continue;

    // Discover mail roots (Mail/, ImapMail/, etc.)
    const mailRoots = discoverMailRoots(profilePath);
    const trees = [];

    for (const root of mailRoots) {
      const tree = scanAccountTree(root.path, root.label, 0);
      if (tree.children.length > 0 || tree.mboxes.length > 0) {
        trees.push(tree);
      }
    }

    const totalEmails = trees.reduce((sum, t) => sum + countTreeEmails(t), 0);

    profiles.push({
      name: entry.name,
      path: profilePath,
      trees,
      totalEmails,
    });
  }

  return { path: tbProfilesPath, profiles };
}

function discoverMailRoots(profilePath) {
  const roots = [];
  const candidates = ['Mail', 'ImapMail', 'mail', 'imapMail'];

  for (const candidate of candidates) {
    const fullPath = path.join(profilePath, candidate);
    if (fs.existsSync(fullPath) && safeIsDir(fullPath)) {
      roots.push({ path: fullPath, label: candidate });
    }
  }

  // Also scan profile root for mail-looking directories
  try {
    const entries = safeReaddir(profilePath);
    for (const entry of entries) {
      const fullPath = path.join(profilePath, entry.name);
      if (!safeIsDir(fullPath)) continue;
      const name = entry.name.toLowerCase();
      if ((name.includes('mail') || name.includes('imap')) && !roots.some(r => r.path === fullPath)) {
        roots.push({ path: fullPath, label: entry.name });
      }
    }
  } catch (e) {}

  return roots;
}

function scanAccountTree(dir, displayName, depth) {
  const result = {
    name: path.basename(displayName) || displayName,
    type: depth === 0 ? 'account' : 'folder',
    children: [],
    mboxes: [],
    mboxCount: 0,
    totalEmails: 0,
  };

  if (depth > 5) return result;

  try {
    const entries = safeReaddirDirent(dir);

    // First pass: collect MBOX files in current directory
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const mbox = checkMboxFile(entry.name, dir);
      if (mbox) {
        result.mboxes.push(mbox);
        result.mboxCount += mbox.emailCount;
        result.totalEmails += mbox.emailCount;
      }
    }

    // Second pass: recurse into subdirectories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subName = entry.name;
      // Skip non-mail directories
      if (subName.startsWith('.') || subName === 'News') continue;
      const subPath = path.join(dir, subName);
      const child = scanAccountTree(subPath, subName, depth + 1);
      if (child.children.length > 0 || child.mboxes.length > 0) {
        child.grey = isGreyFolder(subName);
        result.children.push(child);
        result.totalEmails += child.totalEmails;
      }
    }
  } catch (e) {}

  return result;
}

function checkMboxFile(fileName, parentDir) {
  const skipExts = new Set(['.msf','.json','.dat','.sqlite','.db','.js','.txt','.log','.ics','.xml','.bak','.tmp','.cache','.sqlite-journal','.html','.htm','.css','.png','.jpg','.gif','.ico','.woff','.woff2','.sbd']);

  const ext = path.extname(fileName).toLowerCase();
  if (skipExts.has(ext)) return null;
  // Skip dotfiles
  if (fileName.startsWith('.')) return null;

  const filePath = path.join(parentDir, fileName);
  let stats;
  try { stats = fs.statSync(filePath); } catch (e) { return null; }
  if (stats.size < 10) return null;

  // STRONG SIGNAL: .msf companion file exists
  const hasMsf = fs.existsSync(filePath + '.msf');

  let isMbox = false;
  let emailCount = 0;

  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    const header = buffer.toString('utf8', 0, bytesRead);

    if (hasMsf) {
      isMbox = true;
    } else if (header.startsWith('From ')) {
      isMbox = true;
    } else if (header.includes('\nFrom ') && (header.includes('Message-ID:') || header.includes('Subject:'))) {
      isMbox = true;
    } else if (header.includes('X-Mozilla-Status:')) {
      isMbox = true;
    }

    if (isMbox) {
      const fromMatches = header.match(/\nFrom /g);
      emailCount = (fromMatches ? fromMatches.length : 0) + 1;
      if (stats.size > 8192) {
        const estimated = Math.max(1, Math.floor(stats.size / 4000));
        if (estimated > emailCount) emailCount = estimated;
      }
    }
  } catch (e) { return null; }

  if (!isMbox) return null;

  return {
    name: fileName,
    path: filePath,
    size: stats.size,
    modified: stats.mtime.toISOString(),
    emailCount,
  };
}

function countTreeEmails(tree) {
  let count = tree.mboxCount || 0;
  if (tree.children) {
    for (const child of tree.children) {
      count += countTreeEmails(child);
    }
  }
  return count;
}

// Safe fs helpers
function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return []; }
}

function safeReaddirDirent(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return []; }
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); }
  catch (e) { return false; }
}

// ============================================================
// MBOX EMAIL PARSER
// ============================================================

function parseMboxEmails(content, maxEmails) {
  const emails = [];
  const lines = content.split('\n');
  let currentEmail = null;
  let inBody = false;

  for (let i = 0; i < lines.length && emails.length < maxEmails; i++) {
    const line = lines[i];

    if (line.startsWith('From ')) {
      if (currentEmail && currentEmail.from) {
        emails.push(finalizeEmail(currentEmail));
      }
      currentEmail = { subject: '', from: '', to: '', date: '', messageId: '', body: '', isInternal: false, isSentByUser: false };
      inBody = false;
      continue;
    }

    if (!currentEmail) continue;

    if (!inBody) {
      if (line === '' || line === '\r') {
        inBody = true;
        continue;
      }
      const lower = line.toLowerCase();
      if (lower.startsWith('subject:')) currentEmail.subject = line.substring(8).trim();
      else if (lower.startsWith('from:')) currentEmail.from = line.substring(5).trim();
      else if (lower.startsWith('to:')) currentEmail.to = line.substring(3).trim();
      else if (lower.startsWith('date:')) currentEmail.date = line.substring(5).trim();
      else if (lower.startsWith('message-id:')) currentEmail.messageId = line.substring(11).trim();
    } else {
      if (currentEmail.body.length < 1000) currentEmail.body += line + '\n';
    }
  }

  if (currentEmail && currentEmail.from) {
    emails.push(finalizeEmail(currentEmail));
  }

  return emails;
}

function finalizeEmail(e) {
  if (!e.subject) e.subject = '(no subject)';
  if (!e.from) e.from = 'Unknown';
  const bossEmails = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru'];
  e.isInternal = bossEmails.some(be => e.from.toLowerCase().includes(be));
  e.isSentByUser = e.from.includes('izhustrov@import-detal36.ru');
  e.body = e.body.trim();
  return e;
}

// ============================================================
// IPC HANDLERS
// ============================================================

ipcMain.handle('thunderbird:discover', () => {
  try {
    return findThunderbirdProfiles();
  } catch (err) {
    console.error('[TB] Discover crash:', err);
    return { error: err.message, profiles: [] };
  }
});

ipcMain.handle('thunderbird:readMbox', async (_event, mboxPath, maxEmails = 100) => {
  try {
    const stats = fs.statSync(mboxPath);
    if (stats.size > 200 * 1024 * 1024) {
      return { success: false, error: 'File too large (>200MB)' };
    }
    const content = fs.readFileSync(mboxPath, 'utf8');
    const emails = parseMboxEmails(content, maxEmails);
    return { success: true, emails, total: emails.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// WINDOW
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1280,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
    show: false,
    backgroundColor: '#130A1B',
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.openDevTools();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
