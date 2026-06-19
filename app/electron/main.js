const { app, BrowserWindow, ipcMain } = require('electron');
const readline = require('readline');
const iconv = require('iconv-lite'); // proper charset decoding (windows-1251/cp1251 etc.)
                                       // Node's built-in Buffer.toString() only knows
                                       // utf8/latin1/ascii/base64/hex/utf16le — NOT
                                       // Cyrillic codepages, which caused mojibake for
                                       // Russian-language emails declaring charset=windows-1251.

// Defense-in-depth alongside the file-size/email-count caps in the sync loop:
// raises the V8 heap ceiling so a momentary spike doesn't OOM-crash the whole app.
// This does NOT replace the content-size guards — unbounded growth will still
// eventually exhaust memory — it just gives more headroom for legitimate spikes.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=6144');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;

const GREY_NAMES = new Set(['sent','drafts','trash','outbox','junk','spam','archive','templates','queue','корзина','черновики','отправленные']);
const SKIP_FOLDERS = new Set(['news','2026']);

// Accounts to skip — initially hardcoded, overridden by renderer via IPC
// User can toggle accounts on/off in SupplierPane
let _skippedAccounts = new Set([
  'eivanova@europa-parts.kz',
  'eivanova@import-detal36.ru',
  'eivanova@agro-pro2014.ru',
  'izhustrov@agro-pro2014.ru',
  'logistic@import-detal36.ru',
  'logistic@field-pro.ae',
  'yandex.com',
  'pop3.field-pro.ae',
]);
// Keep original as fallback reference
const SKIP_ACCOUNTS = _skippedAccounts;

// ── Python NLP Service Configuration ──
const PYTHON_HOST = '127.0.0.1';
const PYTHON_PORT = 8721;
let pythonAvailable = false;

// HTTP helper to call Python FastAPI service
function callPython(endpoint, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    const isGet = method === 'GET';
    const postData = isGet ? '' : JSON.stringify(payload);
    const options = {
      hostname: PYTHON_HOST,
      port: PYTHON_PORT,
      path: endpoint,
      method: method,
      headers: isGet ? {} : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 120000, // 120s timeout for LLM calls
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (!isGet) req.write(postData);
    req.end();
  });
}

// ── Background NLP Queue (fire-and-forget) ──
async function queueEmailsForBackgroundNLP(emails) {
  if (!pythonAvailable) return;
  const messageIds = emails.map(e => e.messageId).filter(Boolean);
  if (messageIds.length === 0) return;

  // Track these for polling
  for (const id of messageIds) {
    _pendingNlpMessageIds.add(id);
  }

  try {
    const result = await callPython('/nlp/queue', { message_ids: messageIds });
    console.log('[NLP-QUEUE] Queued %d emails. Pending: %d. Stats: %j',
      result.queued || 0, _pendingNlpMessageIds.size, result.stats || {});
    // Start polling if not already running
    startNlpPolling();
  } catch (err) {
    console.log('[NLP-QUEUE] Error:', err.message);
  }
}

// ── Persist emails to SQLite via Python backend ──
// meta: { folderName, accountEmail, supplierId } — explicit, not parsed from a key string.
async function persistEmailsToDB(emails, meta = {}) {
  if (!pythonAvailable || !emails || emails.length === 0) return;

  const folderName = meta.folderName || 'inbox';
  const accountEmail = meta.accountEmail || 'unknown';
  const defaultSupplierId = meta.supplierId || null;

  let stored = 0;
  let skipped = 0;
  let failed = 0;

  const BATCH_SIZE = 5;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (email) => {
      if (!email.messageId) {
        skipped++;
        // Diagnostic: log what this "skipped" email actually looks like, since we've
        // verified parsing produces valid messageIds in isolation — this will tell us
        // if these are genuinely different objects (e.g. from a different code path,
        // or a stale/cached reference) reaching persistEmailsToDB with messageId lost.
        if (skipped <= 3) {
          console.log('[DB-PERSIST] SKIP DIAGNOSTIC: messageId=%s subject=%s from=%s keys=%s',
            JSON.stringify(email.messageId), JSON.stringify(email.subject),
            JSON.stringify(email.from), JSON.stringify(Object.keys(email)));
        }
        return;
      }
      try {
        const senderEmail = email.senderEmail || email.from || '';
        const domain = extractDomain(email.from || senderEmail);
        const emailId = email.id || (email.messageId
          ? parseInt(email.messageId.replace(/\D/g, '').substring(0, 8)) || Math.floor(Math.random() * 1000000)
          : Math.floor(Math.random() * 1000000));

        // Prefer the per-email supplierId tagged during the sync loop (covers
        // inbox/sent address-based matching); fall back to the folder-level default
        // (covers supplier-named folders); null lets Python attempt its own resolution.
        const resolvedSupplierId = (email.supplierId || defaultSupplierId || null);

        await callPython('/db/email', {
          id: emailId,
          profile_name: 'default',
          account_email: accountEmail,
          folder_path: folderName,
          message_id: email.messageId,
          subject: email.subject || '(no subject)',
          sender_email: senderEmail,
          sender_name: email.senderName || senderEmail.split('@')[0] || '',
          sender_domain: domain || 'unknown',
          sent_at: email.sentAt || email.date || new Date().toISOString(),
          body_text: email.body || '',
          body_language: null,
          has_attachments: false,
          thread_id: email.threadId || null,
          step_assigned: email.stepAssigned || 0,
          rfq_id: null,
          supplier_id: resolvedSupplierId,
        });
        stored++;
      } catch (e) {
        failed++;
        if (failed <= 2) console.log('[DB-PERSIST] Failed for %s: %s', email.messageId?.substring(0, 20), e.message.substring(0, 120));
      }
    }));
  }

  console.log('[DB-PERSIST] Stored %d, skipped %d, failed %d (folder: %s)', stored, skipped, failed, folderName);
}

let _nlpPollInterval = null;
const _pendingNlpMessageIds = new Set();

function startNlpPolling() {
  if (_nlpPollInterval) return;
  console.log('[NLP-POLL] Starting result polling (30s)');
  _nlpPollInterval = setInterval(pollNlpResults, 30000);
}

function stopNlpPolling() {
  if (_nlpPollInterval) {
    clearInterval(_nlpPollInterval);
    _nlpPollInterval = null;
    console.log('[NLP-POLL] Stopped');
  }
}

async function pollNlpResults() {
  if (!pythonAvailable || _pendingNlpMessageIds.size === 0) {
    if (_pendingNlpMessageIds.size === 0) stopNlpPolling();
    return;
  }
  const ids = Array.from(_pendingNlpMessageIds);
  try {
    const result = await callPython('/nlp/results', { message_ids: ids });
    const results = result.results || {};
    const completedIds = Object.keys(results);
    if (completedIds.length > 0) {
      console.log('[NLP-POLL] %d new results', completedIds.length);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('nlp:results', results);
      }
      for (const id of completedIds) _pendingNlpMessageIds.delete(id);
    }
  } catch (err) {
    // Retry next poll
  }
}

// Check if Python service is running (GET request for /health)
async function checkPython() {
  try {
    const result = await callPython('/health', null, 'GET');
    pythonAvailable = result.status === 'ok';
    console.log('[PY] Python service ' + (pythonAvailable ? 'AVAILABLE' : 'unhealthy') + ':', result);
    return pythonAvailable;
  } catch (err) {
    pythonAvailable = false;
    console.log('[PY] Python service NOT available:', err.message);
    return false;
  }
}

// Enrich top N emails with NLP (supplier extraction + step classification)
// Helper: extract domain from email address like "Name <user@domain.com>" or "user@domain.com"
function extractDomain(fromField) {
  if (!fromField) return '';
  const match = fromField.match(/@([\w.-]+)/);
  return match ? match[1] : '';
}

// Enrich top N emails with NLP — ALL emails processed in parallel for speed
async function enrichEmailsWithNLP(emails, maxEnrich = 2) {
  if (!pythonAvailable) {
    console.log('[NLP] Skipping enrichment — Python service not available');
    return emails;
  }

  const toEnrich = emails.slice(0, maxEnrich);
  console.log('[NLP] Enriching top %d of %d emails (SMART mode, sequential)...', toEnrich.length, emails.length);
  const startTime = Date.now();

  // Process sequentially — CPU can only handle one LLM at a time
  for (let i = 0; i < toEnrich.length; i++) {
    const email = toEnrich[i];
    const senderDomain = extractDomain(email.senderEmail || email.from || '');
    const t0 = Date.now();
    try {
      const [extractResult, classifyResult] = await Promise.all([
        callPython('/nlp/extract-rfq', {
          email_id: email.id || 0,
          subject: email.subject || '',
          body_text: email.body || '',
          sender_domain: senderDomain,
        }),
        callPython('/nlp/classify-step', {
          email_id: email.id || 0,
          subject: email.subject || '',
          body_text: email.body || '',
          previous_emails_in_thread: [],
        }),
      ]);
      const dt = Date.now() - t0;

      const rawParts = extractResult.extracted?.part_numbers || [];
      const partStrings = rawParts.map(p => typeof p === 'string' ? p : (p.part_number || p.partNumber || String(p))).filter(Boolean);

      email.extracted = {
        supplier: extractResult.extracted?.supplier_name || null,
        partNumbers: partStrings,
      };

      const suggestedStep = classifyResult.classification?.suggested_step || 0;
      email.classification = {
        step: suggestedStep,
        confidence: classifyResult.classification?.confidence || 0,
      };
      if (suggestedStep >= 1 && suggestedStep <= 7) {
        email.stepAssigned = suggestedStep;
      }

      console.log('[NLP] Email %d (%dms): supplier="%s", parts=%j, step=%d, conf=%s',
        i + 1, dt, email.extracted.supplier || '-', email.extracted.partNumbers,
        email.classification.step, email.classification.confidence.toFixed(2));
    } catch (err) {
      console.log('[NLP] Email %d failed: %s', i + 1, err.message);
      email.extracted = { supplier: null, partNumbers: [] };
      email.classification = { step: 0, confidence: 0 };
    }
  }

  console.log('[NLP] Enrichment complete: %d emails in %dms', toEnrich.length, Date.now() - startTime);

  // Mark remaining emails as not enriched
  for (let i = maxEnrich; i < emails.length; i++) {
    emails[i].extracted = { supplier: null, partNumbers: [] };
    emails[i].classification = { step: 0, confidence: 0 };
  }

  return emails;
}

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
  if (stats.size < 0) return null; // Accept empty files (0 bytes) as valid MBOX

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

    // ALWAYS add the node if it has children, mboxes, .sbd, subdirs, or is a potential folder
    if (node.children.length > 0 || node.mboxes.length > 0 || g.sbd || g.subdirs || g._maybeFolder) {
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

          // Skip accounts disabled by user
          const displayNameLower = (displayName || '').toLowerCase();
          if (_skippedAccounts.has(displayNameLower) || _skippedAccounts.has(displayName)) {
            console.log('[TB] Skipping account:', displayName);
            continue;
          }

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

    // Merge trees with same email (Mail/ + ImapMail/ dedup)
    const mergedTrees = mergeAccountTrees(trees);

    if (mergedTrees.length > 0) {
      const totalEmails = mergedTrees.reduce((s, t) => s + t.totalEmails, 0);
      console.log('[TB] Profile %s: %d accounts after merge: %s', entry.name, mergedTrees.length, mergedTrees.map(t => t.name + '(' + t.totalEmails + ')').join(', '));
      profiles.push({ name: entry.name, path: profilePath, trees: mergedTrees, totalEmails });
    }
  }

  return { path: tbPath, profiles };
}

function mergeAccountTrees(trees) {
  const byEmail = new Map();

  // Step 1: Collect ALL Local Folders entries and merge their children
  const allLocalChildren = [];
  const allLocalMboxes = [];
  let localFoldersCount = 0;
  for (const tree of trees) {
    if (tree.name === 'Local Folders') {
      localFoldersCount++;
      console.log('[TB-MERGE] Found Local Folders #%d: %d children, %d mboxes, %d totalEmails', localFoldersCount, tree.children.length, tree.mboxes.length, tree.totalEmails);
      for (const c of tree.children) {
        console.log('[TB-MERGE]  Local child: "%s" (%d emails)', c.name, c.totalEmails || 0);
      }
      allLocalChildren.push(...tree.children);
      allLocalMboxes.push(...tree.mboxes);
    }
  }
  console.log('[TB-MERGE] Total Local Folders found: %d, total children to process: %d', localFoldersCount, allLocalChildren.length);

  // Step 2: Add non-Local-Folders to byEmail (merge duplicates)
  for (const tree of trees) {
    if (tree.name === 'Local Folders') continue;
    console.log('[TB-MERGE] Account in byEmail: "%s" (%d emails)', tree.name, tree.totalEmails);
    if (!byEmail.has(tree.name)) {
      byEmail.set(tree.name, { ...tree, children: [...tree.children], mboxes: [...tree.mboxes] });
    } else {
      const existing = byEmail.get(tree.name);
      console.log('[TB-MERGE]  Merging duplicate "%s": %d + %d emails', tree.name, existing.totalEmails, tree.totalEmails);
      existing.children.push(...tree.children);
      existing.mboxes.push(...tree.mboxes);
      existing.mboxCount += tree.mboxCount;
      existing.totalEmails += tree.totalEmails;
    }
  }

  // Step 3: Move Local Folders children to their accounts
  // Child name pattern: "Sent-izhustrov@import-detal36.ru" or "Отправленные-commercial@field-pro.ae"
  const remainingLocalChildren = [];
  for (const child of allLocalChildren) {
    let moved = false;
    for (const [email, account] of byEmail) {
      if (email === 'Local Folders') continue;
      // Check if child name ends with email (after dash or underscore)
      if (child.name === email || child.name.endsWith('-' + email) || child.name.endsWith('_' + email)) {
        const prefix = child.name.substring(0, child.name.length - email.length).replace(/[-_]$/, '');
        const oldName = child.name;
        child.name = prefix || child.name;
        console.log('[TB-MERGE]  MOVED "%s" → "%s" under "%s"', oldName, child.name, email);
        account.children.push(child);
        account.totalEmails += child.totalEmails || 0;
        moved = true;
        break;
      }
    }
    if (!moved) remainingLocalChildren.push(child);
  }

  // Step 4: Add remaining Local Folders (unmatched items)
  if (remainingLocalChildren.length > 0 || allLocalMboxes.length > 0) {
    byEmail.set('Local Folders', {
      name: 'Local Folders',
      type: 'account',
      children: remainingLocalChildren,
      mboxes: allLocalMboxes,
      mboxCount: allLocalMboxes.reduce((s, m) => s + (m.emailCount || 0), 0),
      totalEmails: remainingLocalChildren.reduce((s, c) => s + (c.totalEmails || 0), 0) + allLocalMboxes.reduce((s, m) => s + (m.emailCount || 0), 0),
    });
    console.log('[TB-MERGE] Remaining Local Folders: %d children', remainingLocalChildren.length);
    for (const c of remainingLocalChildren) {
      console.log('[TB-MERGE]  Remaining: "%s"', c.name);
    }
  }

  // Step 5: Flatten [Gmail] into parent account
  for (const [, tree] of byEmail) {
    const gmailIdx = tree.children.findIndex(c => c.name === '[Gmail]');
    if (gmailIdx >= 0) {
      const gmailNode = tree.children[gmailIdx];
      console.log('[TB-MERGE] Flattening [Gmail] (%d children) into "%s"', gmailNode.children.length, tree.name);
      tree.children.splice(gmailIdx, 1, ...gmailNode.children);
      tree.totalEmails += gmailNode.totalEmails;
    }
  }

  const result = Array.from(byEmail.values());
  console.log('[TB-MERGE] Final accounts: %s', result.map(t => t.name + '(' + t.totalEmails + ')').join(', '));
  return result;
}

// Streaming mbox parser for arbitrarily large files. Reads line-by-line via readline
// (never holds the full file content in memory), and invokes onBatch(emails) every
// BATCH_FLUSH_SIZE emails so the caller can persist+clear instead of accumulating
// everything until the end. This is what makes "sync everything, regardless of size"
// actually safe — no file-size cutoff needed since memory use stays roughly constant.
async function parseMboxEmailsStreaming(mboxPath, onBatch, options = {}) {
  const BATCH_FLUSH_SIZE = options.batchSize || 200;
  const MAX_RAW_BODY_LEN = 50000; // raw MIME body capture ceiling (headers+boundaries+encoded
                                    // content all live here pre-decode); final stored text gets
                                    // truncated separately, AFTER decoding, in cleanMimeBody.

  return new Promise((resolve, reject) => {
    // CRITICAL: read as 'latin1', NOT 'utf8'. latin1 is a lossless 1:1 byte<->codepoint
    // mapping — every byte survives untouched as a character code 0-255. Reading as utf8
    // would corrupt any byte sequence that isn't valid UTF-8 (e.g. raw Windows-1251 bytes
    // in 8bit/7bit-encoded Russian emails) BEFORE we ever get a chance to look at the
    // message's declared charset. ASCII headers (From:, Subject:, boundaries) are
    // identical in latin1 vs utf8, so all the line-detection logic below still works
    // unchanged — we just convert back to a real Buffer (via Buffer.from(line,'latin1'))
    // whenever we need the original bytes for charset-aware decoding.
    const fileStream = fs.createReadStream(mboxPath, { encoding: 'latin1' });

    // Node's readline only recognizes \n or \r\n as line terminators — a bare \r
    // (old Mac-style line ending, still emitted by some older mail gateways/enterprise
    // systems) is NOT treated as a break, silently fusing two lines into one. This
    // caused a real bug: a boundary marker line ending in bare \r got fused directly
    // onto the next line's "Content-Type:" header with no visible separator. Fix:
    // normalize any \r not already followed by \n into \r\n before readline sees it.
    const { Transform } = require('stream');
    let heldCR = false; // true if the previous chunk ended in \r that we held back
                         // (not yet emitted) because we don't yet know if the next
                         // chunk starts with \n (valid CRLF pair) or something else
                         // (bare CR, needs \n inserted)
    const crNormalizer = new Transform({
      transform(chunk, encoding, callback) {
        let str = chunk.toString('latin1');

        if (heldCR) {
          // Resolve the held-back \r from the previous chunk now that we can see
          // what follows it. Either way the output starts with a valid \r\n.
          if (str[0] === '\n') {
            str = '\r' + str; // valid pair: emit \r then keep the \n that's already there
          } else {
            str = '\r\n' + str; // was bare: supply the missing \n
          }
          heldCR = false;
        }

        if (str.endsWith('\r')) {
          heldCR = true;
          str = str.slice(0, -1); // hold this \r back entirely — do not emit yet
        }

        const normalized = str.replace(/\r(?!\n)/g, '\r\n');
        callback(null, Buffer.from(normalized, 'latin1'));
      },
      flush(callback) {
        // Stream ended while a bare trailing \r was held back — it had nothing
        // after it, so it was bare by definition; supply the missing \n.
        if (heldCR) {
          callback(null, Buffer.from('\r\n', 'latin1'));
        } else {
          callback();
        }
      }
    });
    const normalizedStream = fileStream.pipe(crNormalizer);

    const rl = readline.createInterface({ input: normalizedStream, crlfDelay: Infinity });

    let current = null;
    let inBody = false;
    let batch = [];
    let totalCount = 0;
    let pendingFlush = Promise.resolve(); // serializes onBatch calls so they don't overlap

    function flushBatch() {
      if (batch.length === 0) return;
      const toFlush = batch;
      batch = [];
      // Chain onto pendingFlush so batches are processed in order, and so we can
      // await the final flush before resolving (otherwise the last batch could be
      // lost if the function returns before its async onBatch call completes).
      pendingFlush = pendingFlush.then(() => onBatch(toFlush));
    }

    function pushCurrent() {
      if (current && current.from) {
        if (global.__DIAG_PUSH_COUNT === undefined) global.__DIAG_PUSH_COUNT = 0;
        if (global.__DIAG_PUSH_COUNT < 20) {
          console.log('[PUSH-DIAG] About to finalize: current.messageId=%s current.subject=%s',
            JSON.stringify(current.messageId), JSON.stringify(current.subject));
          global.__DIAG_PUSH_COUNT++;
        }
        const finalized = finalizeEmail(current);
        if (global.__DIAG_PUSH_COUNT <= 20) {
          console.log('[PUSH-DIAG] After finalizeEmail: finalized.messageId=%s', JSON.stringify(finalized.messageId));
        }
        batch.push(finalized);
        totalCount++;
        if (batch.length >= BATCH_FLUSH_SIZE) flushBatch();
      }
    }

    let lastHeaderField = null; // tracks which field the previous line populated, so a
                                  // folded/continuation line (starts with whitespace per
                                  // RFC 5322) can be appended to the right place. This is
                                  // the actual fix: some senders (Microsoft Exchange/Outlook
                                  // observed in practice) emit "Message-ID:" with NOTHING
                                  // after the colon, putting the real value on the next
                                  // line indented with leading whitespace — our parser was
                                  // not handling this at all, silently capturing an empty
                                  // string for any such email.

    rl.on('line', (line) => {
      if (line.startsWith('From ')) {
        // Diagnostic: if the email we're ABOUT to finalize never found a Message-ID,
        // log it now (we have full context: subject/from are already set).
        if (current && current.from && !current.messageId) {
          if (global.__DIAG_MISSING_MID === undefined) global.__DIAG_MISSING_MID = 0;
          if (global.__DIAG_MISSING_MID < 20) {
            console.log('[MID-DIAG] Email finalized with NO Message-ID found. subject=%s from=%s bodyLen=%d',
              JSON.stringify(current.subject), JSON.stringify(current.from), current.body.length);
            global.__DIAG_MISSING_MID++;
          }
        }
        pushCurrent();
        current = { subject: '', from: '', to: '', date: '', messageId: '', body: '', isInternal: false, isSentByUser: false };
        inBody = false;
        lastHeaderField = null;
        return;
      }
      if (!current) return;
      if (!inBody) {
        if (line === '' || line === '\r') { inBody = true; lastHeaderField = null; return; }

        // RFC 5322 header folding: a continuation line starts with a space or tab and
        // belongs to whichever header field came immediately before it. Append it
        // (space-joined) to that field rather than treating it as a new header.
        if ((line.startsWith(' ') || line.startsWith('\t')) && lastHeaderField) {
          const continuation = line.trim();
          if (continuation) {
            current[lastHeaderField] = (current[lastHeaderField] ? current[lastHeaderField] + ' ' : '') + continuation;
            if (lastHeaderField === 'messageId' && global.__DIAG_FOUND_MID !== undefined && global.__DIAG_FOUND_MID < 20) {
              console.log('[MID-DIAG] Folded continuation appended to messageId:', JSON.stringify(line), '-> now:', JSON.stringify(current.messageId));
            }
          }
          return;
        }

        const lower = line.toLowerCase();
        if (lower.startsWith('subject:')) { current.subject = line.substring(8).trim(); lastHeaderField = 'subject'; }
        else if (lower.startsWith('from:')) { current.from = line.substring(5).trim(); lastHeaderField = 'from'; }
        else if (lower.startsWith('to:')) { current.to = line.substring(3).trim(); lastHeaderField = 'to'; }
        else if (lower.startsWith('date:')) { current.date = line.substring(5).trim(); lastHeaderField = 'date'; }
        else if (lower.startsWith('message-id:')) {
          current.messageId = line.substring(11).trim();
          lastHeaderField = 'messageId';
          if (global.__DIAG_FOUND_MID === undefined) global.__DIAG_FOUND_MID = 0;
          if (global.__DIAG_FOUND_MID < 20) {
            console.log('[MID-DIAG] FOUND Message-ID line:', JSON.stringify(line), '-> parsed as:', JSON.stringify(current.messageId));
            global.__DIAG_FOUND_MID++;
          }
        }
        else {
          // Any other header line (not one we track) — clear lastHeaderField so a
          // following indented line isn't wrongly appended to an unrelated field.
          lastHeaderField = null;
        }
      } else {
        if (current.body.length < MAX_RAW_BODY_LEN) current.body += line + '\n';
      }
    });

    rl.on('close', async () => {
      pushCurrent(); // final email in the file
      flushBatch();  // flush whatever's left in the batch buffer
      try {
        await pendingFlush;
        resolve(totalCount);
      } catch (err) {
        reject(err);
      }
    });

    rl.on('error', reject);
    fileStream.on('error', reject);
  });
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
      // Same fix as the streaming parser: capture full raw body, decode properly in
      // cleanMimeBody, truncate the final plain-text result afterward — not before.
      if (current.body.length < 50000) current.body += line + '\n';
    }
  }
  if (current && current.from) emails.push(finalizeEmail(current));
  return emails;
}

function finalizeEmail(e) {
  if (!e.subject) e.subject = '(no subject)';
  if (!e.from) e.from = 'Unknown';
  // Decode RFC 2047 encoded-word sequences in headers (=?charset?B/Q?...?=)
  e.subject = decodeEncodedWords(e.subject);
  e.from = decodeEncodedWords(e.from);
  // For headers that AREN'T RFC2047-wrapped but still contain raw non-ASCII bytes
  // (common: senders just put UTF-8 directly in headers without encoded-word wrapping):
  // re-decode from the latin1-preserved byte sequence to recover proper UTF-8 text.
  // Cheap no-op for pure-ASCII headers (round-trips identically), only matters when
  // non-ASCII bytes are actually present.
  if (/[\x80-\xff]/.test(e.subject)) {
    try { e.subject = Buffer.from(e.subject, 'latin1').toString('utf8'); } catch {}
  }
  if (/[\x80-\xff]/.test(e.from)) {
    try { e.from = Buffer.from(e.from, 'latin1').toString('utf8'); } catch {}
  }
  const bosses = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru'];
  e.isInternal = bosses.some(b => e.from.toLowerCase().includes(b));
  // isSentByUser is no longer determined here — it depends on which account's mailbox
  // this email came from, which isn't known inside finalizeEmail. The sync loop sets
  // it per-email based on the actual account being processed.
  e.body = cleanMimeBody(e.body || '');
  e.sentAt = e.date || new Date().toISOString();
  e.senderEmail = e.from;
  // Extract display name from "Name <email>" format, fallback to email local part
  const nameMatch = e.from.match(/^([^<]+)<[^>]+>/);
  e.senderName = nameMatch ? nameMatch[1].trim() : (e.from.split('@')[0] || 'Unknown');
  e.rfqId = 0;
  e.supplierId = 0;
  e.stepAssigned = 0;
  e.threadConfidence = 1.0;
  e.hasConflict = false;
  // Generate a stable numeric ID from messageId without collision risk
  if (e.messageId) {
    let hash = 0;
    for (let i = 0; i < e.messageId.length; i++) {
      hash = ((hash << 5) - hash) + e.messageId.charCodeAt(i);
      hash |= 0; // Convert to 32bit int
    }
    e.id = Math.abs(hash);
  } else {
    e.id = Math.floor(Math.random() * 1000000000);
  }
  e.extracted = { supplier: null, partNumbers: [] };
  e.classification = { step: 0, confidence: 0 };
  return e;
}

// Decode RFC 2047 encoded-word sequences in email headers
// Handles =?charset?B?base64?= and =?charset?Q?quoted-printable?=
function decodeWithCharset(bytes, charset) {
  const normalized = (charset || 'utf-8').toLowerCase().replace(/^x-/, '');
  try {
    if (iconv.encodingExists(normalized)) {
      return iconv.decode(bytes, normalized);
    }
  } catch {
    // fall through to utf8 default below
  }
  return bytes.toString('utf8');
}

function decodeEncodedWords(str) {
  if (!str || !str.includes('=?')) return str;
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (match, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64
        const bytes = Buffer.from(encoded, 'base64');
        return decodeWithCharset(bytes, charset);
      } else {
        // Quoted-printable (Q encoding) — collect raw bytes first, THEN decode with
        // the declared charset, instead of assuming each =XX byte is already a
        // correct Unicode code point (that assumption is what produced mojibake
        // for non-UTF-8 charsets like windows-1251).
        const withSpaces = encoded.replace(/_/g, ' ');
        const byteArr = [];
        for (let i = 0; i < withSpaces.length; i++) {
          if (withSpaces[i] === '=' && i + 2 < withSpaces.length) {
            byteArr.push(parseInt(withSpaces.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            byteArr.push(withSpaces.charCodeAt(i));
          }
        }
        return decodeWithCharset(Buffer.from(byteArr), charset);
      }
    } catch {
      return match;
    }
  });
}
function decodeRfc2231Filename(str) {
  // Decode RFC 2231 encoded filename*=UTF-8''%XX%XX sequences
  return str.replace(/UTF-8''([^\s;]+)/gi, (_, encoded) => {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  });
}

function getMimeHeaderBlock(part) {
  // Only the text up to the FIRST blank line is this part's own header block.
  // Critical: prevents false-positive matches on nested content further down.
  const idx = part.search(/\r?\n\r?\n/);
  return idx >= 0 ? part.slice(0, idx) : part;
}

function extractTextPlainPart(raw, depth, usedBoundaries) {
  // Recursively descend into multipart structures to find the real text/plain leaf.
  // Handles multipart/mixed wrapping multipart/alternative (common nested case).
  if (depth > 4) return null; // safety limit
  usedBoundaries = usedBoundaries || new Set();

  const boundaryMatch = raw.match(/Content-Type:\s*multipart\/[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*?boundary=["']?([^\s;"'\r\n]+)["']?/i);

  if (!boundaryMatch) {
    // Not multipart at this level — check if THIS is a text/plain leaf
    const header = getMimeHeaderBlock(raw);
    if (/Content-Type:\s*text\/plain/i.test(header) && !/Content-Disposition:\s*attachment/i.test(header)) {
      return raw;
    }
    return null;
  }

  const boundary = boundaryMatch[1];
  if (usedBoundaries.has(boundary)) return null; // prevent self-recursion on same boundary
  const newUsed = new Set(usedBoundaries);
  newUsed.add(boundary);

  const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = raw.split(new RegExp(`--${escapedBoundary}(?:--)?\\r?\\n`, 'g'));

  for (const part of parts) {
    if (!part.trim()) continue;
    const header = getMimeHeaderBlock(part);

    if (/Content-Disposition:\s*attachment/i.test(header)) continue;

    // Skip any part that isn't text/plain or a multipart container — this catches
    // attachments that DON'T declare Content-Disposition: attachment explicitly
    // (some scanners/clients only set Content-Type: application/pdf + a name=
    // parameter, no disposition header at all). Without this check, such a part's
    // raw base64 content was leaking into the stored body text.
    const contentTypeMatch = header.match(/Content-Type:\s*([^;\r\n]+)/i);
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : '';
    if (contentType && contentType !== 'text/plain' && !contentType.startsWith('multipart/')) {
      continue;
    }

    // Direct text/plain leaf? Check ONLY this part's own header block.
    if (/Content-Type:\s*text\/plain/i.test(header)) {
      return part;
    }
    // Nested multipart (e.g. multipart/alternative inside multipart/mixed)? Recurse.
    if (/Content-Type:\s*multipart\//i.test(header)) {
      const nested = extractTextPlainPart(part, depth + 1, newUsed);
      if (nested) return nested;
    }
  }

  return null;
}

function cleanMimeBody(raw) {
  if (!raw) return '';

  let text = raw;
  var encoding = '';
  var charset = 'utf-8';

  const plainPart = extractTextPlainPart(raw, 0);

  if (plainPart) {
    // Strip headers (everything up to the first blank line) from this part
    const headerEnd = plainPart.search(/\r?\n\r?\n/);
    text = headerEnd >= 0 ? plainPart.slice(headerEnd) : plainPart;

    // Capture encoding AND charset from THIS part's headers specifically
    const partEncodingMatch = plainPart.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    encoding = partEncodingMatch ? partEncodingMatch[1].toLowerCase() : '';
    const charsetMatch = plainPart.match(/charset\s*=\s*"?([\w-]+)"?/i);
    if (charsetMatch) charset = charsetMatch[1];
  } else if (/Content-Type:\s*multipart\//i.test(raw)) {
    // Multipart but no text/plain leaf found anywhere (attachment-only or html-only) — bail empty
    text = '';
  } else {
    // Not multipart — single body, just strip headers if present
    const encodingMatch = text.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '';
    const charsetMatch = text.match(/charset\s*=\s*"?([\w-]+)"?/i);
    if (charsetMatch) charset = charsetMatch[1];
    const headerEnd = text.search(/\r?\n\r?\n/);
    if (headerEnd >= 0 && /^(Content-|MIME-)/im.test(text.slice(0, headerEnd))) {
      text = text.slice(headerEnd);
    }
  }

  // Decode base64 if needed, honoring the declared charset (not just UTF-8) —
  // this fixes mojibake for Russian/other non-UTF-8 senders.
  if (encoding === 'base64') {
    try {
      const rawBytes = Buffer.from(text.replace(/\s/g, ''), 'base64');
      text = decodeWithCharset(rawBytes, charset);
    } catch (e) {
      // Fall through if base64 decode fails
    }
  } else if (charset && charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'utf8') {
    // Raw 8bit/7bit/unspecified body with a NON-UTF-8 declared charset (e.g. windows-1251).
    // `text` at this point is a latin1-decoded string where each character code 0-255
    // is exactly one original byte (that's what the latin1 file read upstream guarantees).
    // Converting it back to a real Buffer and decoding with the declared charset is what
    // actually fixes the mojibake — this is the missing piece that base64/QP-only handling
    // didn't cover, since plenty of real-world Russian mail (especially older clients) sends
    // 8bit-encoded windows-1251 text with no further encoding layer to "decode".
    try {
      const rawBytes = Buffer.from(text, 'latin1');
      text = decodeWithCharset(rawBytes, charset);
    } catch (e) {
      // Fall through, keep text as-is if charset decode fails
    }
  } else {
    // No declared charset (or explicitly utf-8): `text` is still a latin1-decoded
    // string at this point (each char = 1 raw byte, from the upstream latin1 file
    // read). For the common case — genuinely UTF-8 content — converting it back to
    // a Buffer and re-decoding as utf8 recovers the original multi-byte characters
    // correctly. This is the necessary counterpart to the latin1 read: without this
    // step, EVERY email's body (not just non-UTF-8 ones) would display as raw
    // codepoints instead of proper text.
    try {
      const rawBytes = Buffer.from(text, 'latin1');
      text = rawBytes.toString('utf8');
    } catch (e) {
      // Keep as-is if this fails for any reason
    }
  }

  // Decode quoted-printable soft line breaks first
  text = text.replace(/=\r?\n/g, '');
  // Decode quoted-printable =XX hex sequences, honoring the declared charset —
  // collect the raw byte sequence first, THEN decode as one unit (a multi-byte
  // UTF-8 or single-byte CP1251 character can span multiple =XX groups; decoding
  // each =XX independently as UTF-8 was the root cause of Cyrillic mojibake).
  if (encoding === 'quoted-printable' || /=[0-9A-Fa-f]{2}/.test(text)) {
    text = text.replace(/((?:=[0-9A-Fa-f]{2})+)/g, (match) => {
      const bytes = match.match(/=[0-9A-Fa-f]{2}/g).map(h => parseInt(h.slice(1), 16));
      try {
        return decodeWithCharset(Buffer.from(bytes), charset);
      } catch {
        return match;
      }
    });
  }

  // Strip <style>...</style> blocks entirely (content + tags)
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Strip <script>...</script> blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Strip HTML tags if any remain
  if (text.includes('<')) {
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/?(div|p|tr|li|h[1-6])[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/gi, ' ')
               .replace(/&amp;/gi, '&')
               .replace(/&lt;/gi, '<')
               .replace(/&gt;/gi, '>')
               .replace(/&quot;/gi, '"');
  }

  // Final safety net: strip any leftover MIME header lines that leaked through
  text = text.replace(/^(Content-Type|Content-Disposition|Content-Transfer-Encoding|MIME-Version|name|filename\*?\d*\*?)\s*[:=][^\n]*$/gim, '');
  // Strip leftover RFC 2231 encoded filename fragments (filename*0*=UTF-8''%XX...)
  text = text.replace(/filename\*\d*\*?=.*$/gim, '');
  text = text.replace(/\bUTF-8''[%0-9A-Za-z]+/g, '');

  // Collapse 3+ consecutive blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  text = text.trim();

  // Truncate the FINAL decoded plain text (not the raw pre-decode blob) — this is
  // the fix for the base64-truncation-then-decode bug: decoding now always sees the
  // complete encoded content, so the result is always clean text before we cut it down.
  const MAX_FINAL_BODY_LEN = 1500;
  if (text.length > MAX_FINAL_BODY_LEN) {
    text = text.slice(0, MAX_FINAL_BODY_LEN) + '\n[...truncated]';
  }

  return text;
}

ipcMain.handle('thunderbird:discover', () => {
  try {
    return findThunderbirdProfiles();
  } catch (err) {
    console.error('[TB] Discover crash:', err);
    return { error: err.message, profiles: [] };
  }
});

ipcMain.handle('thunderbird:listMboxes', () => {
  // Returns flat list of all available MBOX files across all profiles/accounts
  // Each entry: { syncKey, mboxPath, name, accountName, totalEmails }
  try {
    const result = findThunderbirdProfiles();
    const mboxes = [];

    for (const profile of (result.profiles || [])) {
      for (const account of (profile.trees || [])) {
        // Flatten children recursively
        function flattenChildren(children, prefix) {
          for (const child of (children || [])) {
            const syncKey = `${profile.name}/${account.name}/${prefix}${child.name}/${child.name}`;
            const mboxPath = child.path || '';
            if (mboxPath && child.totalEmails > 0) {
              mboxes.push({
                syncKey,
                mboxPath,
                name: child.name,
                accountName: account.name,
                totalEmails: child.totalEmails || 0,
              });
            }
            if (child.children?.length > 0) {
              flattenChildren(child.children, `${prefix}${child.name}/`);
            }
          }
        }
        flattenChildren(account.children, '');
      }
    }

    // Sort by totalEmails desc
    mboxes.sort((a, b) => b.totalEmails - a.totalEmails);
    return { mboxes };
  } catch (err) {
    console.error('[TB] listMboxes crash:', err);
    return { mboxes: [] };
  }
});

ipcMain.handle('thunderbird:readMbox', async (_event, mboxPath, maxEmails = 100) => {
  try {
    const stats = fs.statSync(mboxPath);
    if (stats.size > 500 * 1024 * 1024) return { success: false, error: 'File too large (>500MB)' };
    // latin1, not utf8 — see parseMboxEmailsStreaming's comment for why. Keeps this
    // manual-read path consistent with the main sync path's charset handling.
    const content = fs.readFileSync(mboxPath, 'latin1');
    const emails = parseMboxEmails(content, maxEmails);

    // ── Queue emails for background NLP enrichment ──
    if (pythonAvailable && emails.length > 0) {
      persistEmailsToDB(emails, { folderName: path.basename(mboxPath), accountEmail: 'unknown' }).catch(() => {});
      queueEmailsForBackgroundNLP(emails).catch(err => {
        console.log('[NLP-QUEUE] Failed:', err.message);
      });
    }

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

// ── Auto-Sync State ──
let _syncedFolderPaths = {};    // syncKey -> mboxPath (received from renderer)
let _syncFromDate = null;       // ISO date string filter e.g. "2025-01-01"
let _autoSyncInterval = null;   // 5-minute timer
let _isScanning = false;        // prevent overlapping scans

ipcMain.handle('suppliers:list', async () => {
  try {
    const result = await callPython('/db/suppliers', null, 'GET');
    return result;
  } catch (err) {
    console.log('[SUPPLIERS] Failed to fetch:', err.message);
    return { suppliers: [] };
  }
});

// ── Account sync management ──
ipcMain.handle('thunderbird:setSkippedAccounts', (_event, skipped) => {
  _skippedAccounts = new Set(skipped || []);
  console.log('[TB-SYNC] Skipped accounts updated:', Array.from(_skippedAccounts));
});

ipcMain.handle('thunderbird:listAccounts', () => {
  // Returns all accounts found in Thunderbird profile regardless of skip list
  // Temporarily clear skip list to get full account list
  const saved = _skippedAccounts;
  _skippedAccounts = new Set(); // show everything
  try {
    const result = findThunderbirdProfiles();
    const accounts = [];
    for (const profile of (result.profiles || [])) {
      for (const tree of (profile.trees || [])) {
        accounts.push({
          name: tree.name,
          totalEmails: tree.totalEmails || 0,
          mboxCount: tree.mboxCount || 0,
        });
      }
    }
    return { accounts };
  } catch (err) {
    return { accounts: [] };
  } finally {
    _skippedAccounts = saved; // restore
  }
});

ipcMain.handle('thunderbird:setSyncFromDate', (_event, date) => {
  _syncFromDate = date || null;
  console.log('[TB-SYNC] Sync-from date set to:', _syncFromDate || 'none');
});
// Receive synced folder paths from renderer (for health checks)
ipcMain.handle('thunderbird:setSyncedPaths', (_event, paths) => {
  // Kept for backwards compatibility but no longer drives sync
  // Auto-discovery now handles folder selection
  const curr = paths ? Object.keys(paths).length : 0;
  console.log('[TB-SYNC] setSyncedPaths received %d paths (auto-discovery active)', curr);
});

// Perform full Thunderbird sync + health check
async function runThunderbirdSync() {
  if (_isScanning) {
    console.log('[TB-SYNC] Scan already in progress, skipping');
    return;
  }
  _isScanning = true;
  const t0 = Date.now();

  try {
    console.log('[TB-SYNC] Starting auto-sync...');
    const result = findThunderbirdProfiles();

    if (result.error) {
      console.log('[TB-SYNC] Scan failed:', result.error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('thunderbird:syncError', result.error);
      }
      return;
    }

    // Health check: verify synced folders still exist
    const missingFolders = [];
    for (const [syncKey, mboxPath] of Object.entries(_syncedFolderPaths)) {
      if (!fs.existsSync(mboxPath)) {
        console.log('[TB-HEALTH] Synced folder missing: %s -> %s', syncKey, mboxPath);
        missingFolders.push(syncKey);
      }
    }

    // Send results to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('thunderbird:autoSync', {
        profiles: result.profiles,
        missingFolders,
        scanTimeMs: Date.now() - t0,
      });
    }

    console.log('[TB-SYNC] Auto-sync complete: %d profiles, %d missing folders, %dms',
      result.profiles.length, missingFolders.length, Date.now() - t0);

    // Auto-discover folders to sync:
    // Sync ALL folders in ALL active accounts (except junk/trash/spam), regardless of name.
    // Supplier assignment is PURELY by sender/recipient address matching against
    // supplier_contact_emails patterns — folder names/locations are not used for
    // supplier attribution at all anymore. A Thunderbird folder is just a place mail
    // happens to be filed; it carries no semantic meaning for this app.
    console.log('[TB-SYNC] Discovering emails across all folders (excluding junk/trash)...');

    // Fetch supplier contact patterns for address-based resolution
    let supplierDomains = new Set();
    let supplierEmails = new Set();
    let supplierPatternMap = {}; // supplierId -> {domains: [], emails: []}

    if (pythonAvailable) {
      try {
        const cp = await callPython('/db/supplier-contact-patterns', null, 'GET');
        for (const p of (cp.patterns || [])) {
          const sid = p.supplier_id;
          if (!supplierPatternMap[sid]) supplierPatternMap[sid] = { domains: [], emails: [] };
          if (p.email_pattern.startsWith('@')) {
            const domain = p.email_pattern.slice(1).toLowerCase();
            supplierDomains.add(domain);
            supplierPatternMap[sid].domains.push(domain);
          } else {
            const email = p.email_pattern.toLowerCase();
            supplierEmails.add(email);
            supplierPatternMap[sid].emails.push(email);
          }
        }
        console.log('[TB-SYNC] Supplier domains:', [...supplierDomains].join(', '));
      } catch (e) {
        console.log('[TB-SYNC] Pattern fetch error:', e.message);
      }
    }

    function extractBareEmail(raw) {
      if (!raw) return '';
      const m = raw.match(/<([^>]+)>/);
      return (m ? m[1] : raw).toLowerCase().trim();
    }

    function getSupplierIdFromAddress(raw) {
      const bare = extractBareEmail(raw);
      const domain = bare.split('@')[1];
      for (const [sid, patterns] of Object.entries(supplierPatternMap)) {
        if (patterns.emails.includes(bare)) return Number(sid);
        if (domain && patterns.domains.includes(domain)) return Number(sid);
      }
      return null;
    }

    // Folder name fragments to EXCLUDE entirely (case-insensitive substring match)
    // Covers English and Russian trash/junk/spam naming conventions, plus Gmail's
    // special virtual folders (All Mail duplicates everything; Starred/Drafts aren't
    // real correspondence).
    const EXCLUDED_FOLDER_PATTERNS = [
      'junk', 'trash', 'spam', 'garbage', 'deleted', 'draft', 'starred', 'all mail',
      'корзина',      // trash (RU)
      'удален',       // deleted (RU, covers удаленные/удалённые)
      'спам',         // spam (RU)
      'мусор',        // garbage (RU)
      'черновик',     // drafts (RU)
      'помечен',      // starred/flagged (RU)
      'вся почта',    // all mail (RU, Gmail)
    ];

    function isExcludedFolder(name) {
      const lower = (name || '').toLowerCase();
      return EXCLUDED_FOLDER_PATTERNS.some(p => lower.includes(p));
    }

    // Recursively collect every leaf folder (one with an actual mbox file) in an account tree
    function collectAllFolders(children, accountName, profileName, acc) {
      for (const child of (children || [])) {
        if (isExcludedFolder(child.name)) continue;
        if (child.path && fs.existsSync(child.path)) {
          acc.push({
            syncKey: `${profileName}/${accountName}/${child.path}`,
            mboxPath: child.path,
            accountName,
            folderName: child.name || 'unknown',
          });
        }
        if (child.children && child.children.length) {
          collectAllFolders(child.children, accountName, profileName, acc);
        }
      }
      return acc;
    }

    const foldersToSync = [];
    for (const profile of (result.profiles || [])) {
      for (const account of (profile.trees || [])) {
        const accountName = account.name || '';
        if (_skippedAccounts.has(accountName) || _skippedAccounts.has(accountName.toLowerCase())) continue;
        collectAllFolders(account.children, accountName, profile.name, foldersToSync);
      }
    }

    console.log('[TB-SYNC] Found %d folders to scan', foldersToSync.length);


    // Send updated synced paths to renderer for UI display
    const syncedPathsForRenderer = {};
    for (const f of foldersToSync) {
      syncedPathsForRenderer[f.syncKey] = f.mboxPath;
    }

    for (const { syncKey, mboxPath, accountName, folderName } of foldersToSync) {
      try {
        const stats = fs.statSync(mboxPath);
        const sizeMB = Math.round(stats.size / 1024 / 1024);

        const accountEmailLower = (accountName || '').toLowerCase();

        // Per-batch handler: tag supplierId, persist, queue for NLP, then let the batch
        // be garbage collected. Memory stays roughly constant regardless of file size,
        // since we never hold more than one batch (~200 emails) at a time.
        async function handleBatch(emails) {
          for (const e of emails) {
            e.isSentByUser = accountEmailLower && e.from.toLowerCase().includes(accountEmailLower);
            const addressToCheck = e.isSentByUser ? e.to : e.from;
            e.supplierId = getSupplierIdFromAddress(addressToCheck) || null;
          }
          if (pythonAvailable) {
            await persistEmailsToDB(emails, {
              folderName,
              accountEmail: accountName,
              supplierId: null,
            }).catch(() => {});
            await queueEmailsForBackgroundNLP(emails).catch(() => {});
          }
          emails.length = 0; // explicit cleanup hint
        }

        if (sizeMB > 50) {
          console.log('[TB-SYNC] Streaming large file: %s (%d MB)', folderName, sizeMB);
        }

        // TEMP DIAGNOSTIC: log the exact path string and its stat info right before
        // parsing, to rule out any path/file mismatch vs our manual standalone tests.
        if (folderName === 'AP AIR') {
          console.log('[PATH-DIAG] mboxPath=%s', JSON.stringify(mboxPath));
          console.log('[PATH-DIAG] path length=%d, char codes of last 10 chars=%s',
            mboxPath.length, JSON.stringify(mboxPath.slice(-10).split('').map(c => c.charCodeAt(0))));
          try {
            const s = fs.statSync(mboxPath);
            console.log('[PATH-DIAG] stat: size=%d, mtime=%s', s.size, s.mtime.toISOString());
          } catch (e) {
            console.log('[PATH-DIAG] statSync FAILED:', e.message);
          }
        }

        const totalProcessed = await parseMboxEmailsStreaming(mboxPath, handleBatch, { batchSize: 200 });
        if (totalProcessed > 0) {
          console.log('[TB-SYNC] Finished %s: %d emails processed (%d MB)', folderName, totalProcessed, sizeMB);
        }
      } catch (err) {
        console.log('[TB-SYNC] Sync failed for %s: %s', folderName, err.message);
      }
    }

    // Notify renderer that supplier data may have updated (just refresh counts)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('thunderbird:syncComplete', {
        timestamp: new Date().toISOString()
      });
    }

  } catch (err) {
    console.error('[TB-SYNC] Auto-sync error:', err);
  } finally {
    _isScanning = false;
  }
}

function startAutoSync() {
  if (_autoSyncInterval) return;
  console.log('[TB-SYNC] Starting auto-sync (every 5 minutes)');
  // First scan after 5 seconds (let renderer settle)
  setTimeout(runThunderbirdSync, 5000);
  // Then every 30 minutes — MBOX files don't change that frequently
  _autoSyncInterval = setInterval(runThunderbirdSync, 30 * 60 * 1000);
}

function stopAutoSync() {
  if (_autoSyncInterval) {
    clearInterval(_autoSyncInterval);
    _autoSyncInterval = null;
    console.log('[TB-SYNC] Auto-sync stopped');
  }
}

app.whenReady().then(async () => {
  // Check Python NLP service on startup
  await checkPython();
  if (!pythonAvailable) {
    console.log('[PY] Python NLP service not available. NLP enrichment disabled.');
    console.log('[PY] Start it with: uvicorn main:app --port 8721 (from python_service folder)');
  }

  createWindow();

  // Start background Thunderbird auto-sync after window loads
  mainWindow.once('ready-to-show', () => {
    startAutoSync();
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAutoSync();
  stopNlpPolling();
  if (process.platform !== 'darwin') app.quit();
});
