const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;

const GREY_NAMES = new Set(['sent','drafts','trash','outbox','junk','spam','archive','templates','queue','корзина','черновики','отправленные']);
const SKIP_FOLDERS = new Set(['news','2026']);

// Accounts/domains to skip (old/junk accounts)
// User actively uses: commercial@field-pro.ae, izhustrov@europa-parts.kz, izhustrov@import-detal36.ru
const SKIP_ACCOUNTS = new Set([
  'eivanova@europa-parts.kz',
  'eivanova@import-detal36.ru',
  'eivanova@agro-pro2014.ru',
  'izhustrov@agro-pro2014.ru',
  'logistic@import-detal36.ru',
  'logistic@field-pro.ae',
  'yandex.com',
  'pop3.field-pro.ae',
]);

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
// Python auto-resolves supplier_id from sender email via supplier_contact_emails table.
async function persistEmailsToDB(emails, syncKey) {
  if (!pythonAvailable || !emails || emails.length === 0) return;

  const folderName = syncKey ? syncKey.split('/').pop() || 'inbox' : 'inbox';
  const accountEmail = syncKey ? syncKey.split('/')[0] || 'unknown' : 'unknown';

  let stored = 0;
  let skipped = 0;
  let failed = 0;

  const BATCH_SIZE = 5;
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (email) => {
      if (!email.messageId) { skipped++; return; }
      try {
        const senderEmail = email.senderEmail || email.from || '';
        const domain = extractDomain(email.from || senderEmail);
        const emailId = email.id || (email.messageId
          ? parseInt(email.messageId.replace(/\D/g, '').substring(0, 8)) || Math.floor(Math.random() * 1000000)
          : Math.floor(Math.random() * 1000000));

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
          supplier_id: null,  // Python resolves from sender_email automatically
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

          // Skip known junk accounts
          const displayNameLower = (displayName || '').toLowerCase();
          if (SKIP_ACCOUNTS.has(displayNameLower) || SKIP_ACCOUNTS.has(displayName)) {
            console.log('[TB] Skipping junk account:', displayName);
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
  // Decode RFC 2047 encoded-word sequences in headers
  e.subject = decodeEncodedWords(e.subject);
  e.from = decodeEncodedWords(e.from);
  const bosses = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru'];
  e.isInternal = bosses.some(b => e.from.toLowerCase().includes(b));
  e.isSentByUser = e.from.includes('izhustrov@import-detal36.ru');
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
  e.id = e.messageId ? parseInt(e.messageId.replace(/\D/g, '').substring(0, 8)) || Math.floor(Math.random() * 1000000) : Math.floor(Math.random() * 1000000);
  e.extracted = { supplier: null, partNumbers: [] };
  e.classification = { step: 0, confidence: 0 };
  return e;
}

// Decode RFC 2047 encoded-word sequences in email headers
// Handles =?charset?B?base64?= and =?charset?Q?quoted-printable?=
function decodeEncodedWords(str) {
  if (!str || !str.includes('=?')) return str;
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (match, charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64
        const bytes = Buffer.from(encoded, 'base64');
        return bytes.toString(charset.toLowerCase().includes('utf') ? 'utf8' : 'latin1');
      } else {
        // Quoted-printable (Q encoding)
        const qp = encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        return qp;
      }
    } catch {
      return match;
    }
  });
}
function cleanMimeBody(raw) {
  if (!raw) return '';

  let text = raw;

  // If multipart, extract the text/plain part first
  const plainMatch = text.match(/Content-Type:\s*text\/plain[^\n]*\n(?:Content-[^\n]+\n)*\n([\s\S]*?)(?=\n--|\n\nContent-Type:|\s*$)/i);
  if (plainMatch) {
    text = plainMatch[1];
  } else {
    // Remove MIME boundary lines and Content-* headers
    text = text.replace(/^--[^\n]+$/gm, '');
    text = text.replace(/^Content-[^\n]+$/gim, '');
  }

  // Decode quoted-printable soft line breaks first
  text = text.replace(/=\r?\n/g, '');
  // Decode quoted-printable =XX hex sequences as UTF-8 bytes
  // Collect consecutive =XX sequences and decode as a UTF-8 buffer
  text = text.replace(/((?:=[0-9A-Fa-f]{2})+)/g, (match) => {
    const bytes = match.match(/=[0-9A-Fa-f]{2}/g).map(h => parseInt(h.slice(1), 16));
    try {
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return match;
    }
  });

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

  // Collapse 3+ consecutive blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
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
    if (stats.size > 500 * 1024 * 1024) return { success: false, error: 'File too large (>500MB)' };
    const content = fs.readFileSync(mboxPath, 'utf8');
    const emails = parseMboxEmails(content, maxEmails);

    // ── Queue emails for background NLP enrichment ──
    if (pythonAvailable && emails.length > 0) {
      persistEmailsToDB(emails, mboxPath).catch(() => {});
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

ipcMain.handle('thunderbird:setSyncFromDate', (_event, date) => {
  _syncFromDate = date || null;
  console.log('[TB-SYNC] Sync-from date set to:', _syncFromDate || 'none');
});
// Receive synced folder paths from renderer (for health checks)
ipcMain.handle('thunderbird:setSyncedPaths', (_event, paths) => {
  const prev = Object.keys(_syncedFolderPaths).length;
  _syncedFolderPaths = paths || {};
  const curr = Object.keys(_syncedFolderPaths).length;
  console.log('[TB-SYNC] Received %d synced folder paths', curr);

  // If we just received paths for the first time (or gained new ones),
  // kick off a sync immediately so persistEmailsToDB runs without waiting 5 min.
  if (curr > 0 && curr !== prev && pythonAvailable) {
    setTimeout(runThunderbirdSync, 2000);
  }
});

ipcMain.handle('suppliers:list', async () => {
  try {
    const result = await callPython('/db/suppliers', null, 'GET');
    return result;
  } catch (err) {
    console.log('[SUPPLIERS] Failed to fetch:', err.message);
    return { suppliers: [] };
  }
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

    // Auto-reload synced folders that are still healthy
    console.log('[TB-SYNC] Reloading %d synced folders: %j', Object.keys(_syncedFolderPaths).length, Object.keys(_syncedFolderPaths));
    for (const [syncKey, mboxPath] of Object.entries(_syncedFolderPaths)) {
      if (missingFolders.includes(syncKey)) continue;
      try {
        const stats = fs.statSync(mboxPath);
        console.log('[TB-SYNC] Reloading folder %s: %s (%d bytes)', syncKey, mboxPath, stats.size);
        if (stats.size > 500 * 1024 * 1024) { console.log('[TB-SYNC] Skipping %s: too large', syncKey); continue; }
        const content = fs.readFileSync(mboxPath, 'utf8');
        const emails = parseMboxEmails(content, 10000);
        if (emails.length > 0) {
          // Apply sync-from date filter for UI display (DB still gets all emails for NLP)
          const displayEmails = _syncFromDate
            ? emails.filter(e => {
                if (!e.sentAt) return true;
                return new Date(e.sentAt) >= new Date(_syncFromDate);
              })
            : emails;

          // Persist ALL emails to SQLite (NLP processes everything)
          if (pythonAvailable) {
            persistEmailsToDB(emails, syncKey).catch(() => {});
          }
          // Queue ALL for NLP
          if (pythonAvailable) {
            queueEmailsForBackgroundNLP(emails).catch(() => {});
          }
          // Send date-filtered emails to renderer for UI display
          mainWindow.webContents.send('thunderbird:folderUpdate', {
            syncKey,
            emails: displayEmails,
            total: displayEmails.length,
          });
        }
      } catch (err) {
        console.log('[TB-SYNC] Reload failed for %s: %s', syncKey, err.message);
      }
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
  // First scan after 15 seconds (let renderer settle and send synced paths)
  setTimeout(runThunderbirdSync, 15000);
  // Then every 5 minutes
  _autoSyncInterval = setInterval(runThunderbirdSync, 5 * 60 * 1000);
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
