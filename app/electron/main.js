const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

const GREY_NAMES = new Set(['sent','drafts','trash','outbox','junk','spam','archive','templates','queue','корзина','черновики','отправленные']);
const SKIP_FOLDERS = new Set(['news','2026']);

function isGrey(name) {
  const lower = (name || '').toLowerCase();
  return GREY_NAMES.has(lower) || GREY_NAMES.has(lower.replace(/s$/,''));
}

function stripSbd(name) {
  return name.replace(/\.sbd$/i, '');
}

// Decode Thunderbird's modified UTF-7 folder names
// e.g. &BBwENQRFBDAEPQQ4BDoEMA- -> whatever Cyrillic text it represents
function decodeFolderName(name) {
  // Handle Thunderbird's RFC 2152 modified UTF-7 encoding
  if (name.includes('&') && name.includes('-')) {
    try {
      let result = '';
      let i = 0;
      while (i < name.length) {
        if (name[i] === '&' && i + 1 < name.length && name[i + 1] !== '-') {
          // Start of encoded sequence
          const end = name.indexOf('-', i);
          if (end === -1) { result += name[i]; i++; continue; }
          const b64part = name.substring(i + 1, end);
          // Modified UTF-7 uses ',' instead of '/' for base64
          const standardB64 = b64part.replace(/,/g, '/');
          // Pad to multiple of 4
          const padded = standardB64 + '='.repeat((4 - standardB64.length % 4) % 4);
          const bytes = Buffer.from(padded, 'base64');
          // UTF-16BE decoding
          let decoded = '';
          for (let j = 0; j + 1 < bytes.length; j += 2) {
            const code = (bytes[j] << 8) | bytes[j + 1];
            decoded += String.fromCharCode(code);
          }
          result += decoded;
          i = end + 1;
        } else if (name[i] === '&' && name[i + 1] === '-') {
          // &amp; literal
          result += '&';
          i += 2;
        } else {
          result += name[i];
          i++;
        }
      }
      return result || name;
    } catch (e) { return name; }
  }
  return name;
}

function parsePrefs(profilePath) {
  const prefsFile = path.join(profilePath, 'prefs.js');
  if (!fs.existsSync(prefsFile)) return {};

  const prefs = {};
  try {
    const lines = fs.readFileSync(prefsFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/user_pref\("([^"]+)",\s*"([^"]*)"\);/);
      if (m) prefs[m[1]] = m[2];
    }
  } catch (e) { return {}; }

  const servers = {};
  for (const [key, val] of Object.entries(prefs)) {
    const m = key.match(/^mail\.server\.(server\d+)\.(hostname|realhostname|directory-rel|type|name)$/);
    if (m) {
      const [, srvKey, prop] = m;
      if (!servers[srvKey]) servers[srvKey] = {};
      servers[srvKey][prop] = val;
    }
  }
  for (const [, srv] of Object.entries(servers)) {
    const dirRel = srv['directory-rel'] || '';
    const m = dirRel.match(/^\[ProfD\](?:ImapMail|Mail|imapMail|mail)\/(.+)$/);
    srv.dirName = m ? m[1] : '';
  }

  const identities = {};
  for (const [key, val] of Object.entries(prefs)) {
    const m = key.match(/^mail\.identity\.(id\d+)\.(useremail|fullName|valid)$/);
    if (m) {
      const [, idKey, prop] = m;
      if (!identities[idKey]) identities[idKey] = {};
      identities[idKey][prop] = val;
    }
  }

  const accounts = {};
  for (const [key, val] of Object.entries(prefs)) {
    const m = key.match(/^mail\.account\.(account\d+)\.(server|identities|accountKey)$/);
    if (m) {
      const [, acctKey, prop] = m;
      if (!accounts[acctKey]) accounts[acctKey] = {};
      if (prop === 'identities') {
        accounts[acctKey].identityKeys = val.split(',').map(s => s.trim());
      } else {
        accounts[acctKey][prop] = val;
      }
    }
  }

  const emailMap = {};
  const hostMap = {};
  for (const [, acct] of Object.entries(accounts)) {
    const srvKey = acct.server;
    const idKeys = acct.identityKeys || [];
    if (!srvKey || !servers[srvKey]) continue;

    const srv = servers[srvKey];
    const dirName = srv.dirName;
    const hostname = srv.hostname || '';

    let email = null;
    for (const idKey of idKeys) {
      const id = identities[idKey];
      if (id && id.useremail) { email = id.useremail; break; }
    }
    if (!email) continue;

    if (dirName) emailMap[dirName] = email;
    if (hostname) { hostMap[hostname] = email; hostMap[hostname.toLowerCase()] = email; }
    emailMap[srvKey] = email;
  }

  for (const [, srv] of Object.entries(servers)) {
    if (!emailMap[srv.dirName] && srv.type === 'none') {
      emailMap[srv.dirName] = 'Local Folders';
    }
  }

  return { emailMap, hostMap, servers, accounts, identities };
}

function checkMboxFile(fileName, parentDir) {
  // Known non-MBOX extensions
  const skipExts = new Set(['.msf','.json','.dat','.sqlite','.db','.js','.txt','.log','.ics','.xml','.bak','.tmp','.cache','.sqlite-journal','.html','.htm','.css','.png','.jpg','.gif','.ico','.woff','.woff2']);
  const ext = path.extname(fileName).toLowerCase();
  if (skipExts.has(ext)) return null;
  if (fileName.startsWith('.')) return null;
  if (fileName.endsWith('.sbd')) return null;

  const fp = path.join(parentDir, fileName);
  let stats;
  try { stats = fs.statSync(fp); } catch (e) { return null; }
  if (stats.size < 1) return null; // Even empty files are valid MBOX

  const hasMsf = fs.existsSync(fp + '.msf');

  // If .msf exists, definitely an MBOX
  if (hasMsf) {
    return { name: fileName, path: fp, size: stats.size, modified: stats.mtime.toISOString(), emailCount: Math.max(1, Math.floor(stats.size / 4000)) };
  }

  // Check header for MBOX indicators
  let isMbox = false;
  let emailCount = 0;

  try {
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(Math.min(4096, stats.size));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const h = buf.toString('utf8', 0, n);
    if (h.startsWith('From ') || h.includes('X-Mozilla-Status:') || h.includes('Message-ID:')) {
      isMbox = true;
    }
    if (isMbox) {
      const fromMatches = h.match(/\nFrom /g);
      emailCount = (fromMatches ? fromMatches.length : 0) + 1;
      if (stats.size > 4096) {
        const estimated = Math.max(1, Math.floor(stats.size / 4000));
        if (estimated > emailCount) emailCount = estimated;
      }
    }
  } catch (e) {}

  // RELAXED: If no extension and in a mail folder, assume MBOX
  if (!isMbox && ext === '' && stats.size >= 0) {
    // Could be an empty MBOX or one with unusual headers
    return { name: fileName, path: fp, size: stats.size, modified: stats.mtime.toISOString(), emailCount: Math.max(0, Math.floor(stats.size / 4000)) };
  }

  if (!isMbox) return null;
  return { name: fileName, path: fp, size: stats.size, modified: stats.mtime.toISOString(), emailCount };
}

function scanFolderTree(dir, depth) {
  const result = { children: [], mboxes: [], mboxCount: 0, totalEmails: 0 };
  if (depth > 15) return result;

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return result; }

  // First pass: group files and directories by base name
  // In Thunderbird: folder "Foo" has file "Foo" (MBOX) and dir "Foo.sbd" (subfolders)
  const groups = {}; // baseName -> { mbox: null, sbd: null, subdirs: [] }

  for (const ent of entries) {
    const n = ent.name;
    if (n.startsWith('.') || n === 'News' || SKIP_FOLDERS.has(n.toLowerCase())) continue;

    if (ent.isDirectory()) {
      if (n.endsWith('.sbd')) {
        const base = stripSbd(n);
        if (!groups[base]) groups[base] = {};
        groups[base].sbd = path.join(dir, n);
      } else {
        // Regular subdirectory (not .sbd) - rare but possible
        if (!groups[n]) groups[n] = {};
        if (!groups[n].subdirs) groups[n].subdirs = [];
        groups[n].subdirs.push(path.join(dir, n));
      }
    } else {
      // File - could be an MBOX
      const mbox = checkMboxFile(n, dir);
      if (mbox) {
        if (!groups[n]) groups[n] = {};
        groups[n].mbox = mbox;
      } else {
        // Not recognized as MBOX but could be a folder with no emails yet
        // Thunderbird creates empty files for folders
        if (path.extname(n) === '') {
          if (!groups[n]) groups[n] = {};
          // Don't add as mbox, but mark for potential inclusion
          groups[n]._maybeFolder = true;
        }
      }
    }
  }

  // Build tree nodes from groups
  for (const [base, g] of Object.entries(groups)) {
    const displayName = decodeFolderName(base);
    const nodePath = g.mbox ? g.mbox.path : (g.sbd || (g.subdirs && g.subdirs[0]) ? path.join(dir, base) : path.join(dir, base));
    const node = {
      name: displayName,
      path: nodePath,
      grey: isGrey(displayName),
      children: [],
      mboxes: [],
      mboxCount: 0,
      totalEmails: 0,
    };

    if (g.mbox) {
      node.mboxes.push(g.mbox);
      node.mboxCount += g.mbox.emailCount;
      node.totalEmails += g.mbox.emailCount;
    }

    if (g.sbd) {
      // Recurse into .sbd directory for children
      const sbd = scanFolderTree(g.sbd, depth + 1);
      for (const c of sbd.children) {
        node.children.push(c);
        node.totalEmails += c.totalEmails;
      }
      // Also pick up any mboxes directly in .sbd
      for (const m of sbd.mboxes) {
        node.mboxes.push(m);
        node.mboxCount += m.emailCount;
        node.totalEmails += m.emailCount;
      }
    }

    if (g.subdirs) {
      for (const sd of g.subdirs) {
        const ch = scanFolderTree(sd, depth + 1);
        if (ch.children.length > 0 || ch.mboxes.length > 0) {
          node.children.push(ch);
          node.totalEmails += ch.totalEmails;
        }
      }
    }

    // ALWAYS add the node if it has children, mboxes, .sbd, or is a potential folder
    if (node.children.length > 0 || node.mboxes.length > 0 || g.sbd || g._maybeFolder) {
      result.children.push(node);
      result.totalEmails += node.totalEmails;
      // Also add to mboxes list at this level for aggregation
      if (g.mbox) result.mboxes.push(g.mbox);
    }
  }

  return result;
}

function findThunderbirdProfiles() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const tbPath = path.join(appData, 'Thunderbird', 'Profiles');

  if (!fs.existsSync(tbPath)) {
    return { error: 'Thunderbird not found at ' + tbPath, path: tbPath, profiles: [] };
  }

  const profiles = [];
  const entries = fs.readdirSync(tbPath, { withFileTypes: true });

  for (const entry of entries) {
    const profilePath = path.join(tbPath, entry.name);
    if (!entry.isDirectory()) continue;

    const prefs = parsePrefs(profilePath);
    if (!prefs.emailMap) continue;

    const seenPaths = new Set();
    const trees = [];

    for (const candidate of ['Mail', 'ImapMail', 'mail', 'imapMail']) {
      const root = path.join(profilePath, candidate);
      try {
        const realPath = fs.realpathSync(root).toLowerCase();
        if (seenPaths.has(realPath)) continue;
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
        seenPaths.add(realPath);

        const rootEntries = fs.readdirSync(root, { withFileTypes: true });
        for (const ent of rootEntries) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue;

          const accountPath = path.join(root, ent.name);
          const tree = scanFolderTree(accountPath, 0);
          if (tree.children.length === 0 && tree.mboxes.length === 0) continue;

          let displayName = prefs.emailMap[ent.name] || prefs.emailMap[ent.name.toLowerCase()];
          if (!displayName) {
            const stripped = ent.name.replace(/-\d+$/, '');
            displayName = prefs.emailMap[stripped] || prefs.emailMap[stripped.toLowerCase()];
          }
          if (!displayName) {
            displayName = prefs.hostMap[ent.name] || prefs.hostMap[ent.name.toLowerCase()];
          }
          if (!displayName) displayName = ent.name.replace(/^imap\./, '').replace(/^pop\./, '');

          trees.push({
            name: displayName,
            type: 'account',
            children: tree.children,
            mboxes: tree.mboxes,
            mboxCount: tree.mboxCount,
            totalEmails: tree.totalEmails,
          });
        }
      } catch (e) {}
    }

    if (trees.length > 0) {
      const totalEmails = trees.reduce((s, t) => s + t.totalEmails, 0);
      profiles.push({ name: entry.name, path: profilePath, trees, totalEmails });
    }
  }

  return { path: tbPath, profiles };
}

function parseMboxEmails(content, maxEmails) {
  const emails = [];
  const lines = content.split('\n');
  let current = null;
  let inBody = false;

  for (let i = 0; i < lines.length && emails.length < maxEmails; i++) {
    const line = lines[i];
    if (line.startsWith('From ')) {
      if (current && current.from) emails.push(finalizeEmail(current));
      current = { subject: '', from: '', to: '', date: '', messageId: '', body: '', isInternal: false, isSentByUser: false };
      inBody = false;
      continue;
    }
    if (!current) continue;
    if (!inBody) {
      if (line === '' || line === '\r') { inBody = true; continue; }
      const lower = line.toLowerCase();
      if (lower.startsWith('subject:')) current.subject = line.substring(8).trim();
      else if (lower.startsWith('from:')) current.from = line.substring(5).trim();
      else if (lower.startsWith('to:')) current.to = line.substring(3).trim();
      else if (lower.startsWith('date:')) current.date = line.substring(5).trim();
      else if (lower.startsWith('message-id:')) current.messageId = line.substring(11).trim();
    } else {
      if (current.body.length < 1000) current.body += line + '\n';
    }
  }
  if (current && current.from) emails.push(finalizeEmail(current));
  return emails;
}

function finalizeEmail(e) {
  if (!e.subject) e.subject = '(no subject)';
  if (!e.from) e.from = 'Unknown';
  const bosses = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru'];
  e.isInternal = bosses.some(b => e.from.toLowerCase().includes(b));
  e.isSentByUser = e.from.includes('izhustrov@import-detal36.ru');
  e.body = e.body.trim();
  e.sentAt = e.date || new Date().toISOString();
  e.senderEmail = e.from;
  e.senderName = e.from.split('@')[0] || 'Unknown';
  e.rfqId = 0;
  e.supplierId = 0;
  e.stepAssigned = 0;
  e.threadConfidence = 1.0;
  e.hasConflict = false;
  e.id = e.messageId ? parseInt(e.messageId.replace(/\D/g, '').substring(0, 8)) || Math.floor(Math.random() * 1000000) : Math.floor(Math.random() * 1000000);
  return e;
}

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
    if (stats.size > 200 * 1024 * 1024) return { success: false, error: 'File too large (>200MB)' };
    const content = fs.readFileSync(mboxPath, 'utf8');
    const emails = parseMboxEmails(content, maxEmails);
    return { success: true, emails, total: emails.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
