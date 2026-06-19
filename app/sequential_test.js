const fs = require('fs');
const readline = require('readline');
const { Transform } = require('stream');
const iconv = require('iconv-lite');

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
        return;
      }
      if (!current) return;
      if (!inBody) {
        if (line === '' || line === '\r') { inBody = true; return; }
        const lower = line.toLowerCase();
        if (lower.startsWith('subject:')) current.subject = line.substring(8).trim();
        else if (lower.startsWith('from:')) current.from = line.substring(5).trim();
        else if (lower.startsWith('to:')) current.to = line.substring(3).trim();
        else if (lower.startsWith('date:')) current.date = line.substring(5).trim();
        else if (lower.startsWith('message-id:')) {
          current.messageId = line.substring(11).trim();
          if (global.__DIAG_FOUND_MID === undefined) global.__DIAG_FOUND_MID = 0;
          if (global.__DIAG_FOUND_MID < 20) {
            console.log('[MID-DIAG] FOUND Message-ID line:', JSON.stringify(line), '-> parsed as:', JSON.stringify(current.messageId));
            global.__DIAG_FOUND_MID++;
          }
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

// Test: call parseMboxEmailsStreaming MULTIPLE times in sequence within the SAME
// process, simulating the real app's 62-folder loop, to see if state bleeds between
// calls (which our single-call standalone test could never reveal).
const mboxPath = process.argv[2];
if (!mboxPath) { console.log('Usage: node sequential_test.js <mbox-path>'); process.exit(1); }

async function run() {
  for (let round = 1; round <= 6; round++) {
    console.log(`\n=== ROUND ${round} ===`);
    const results = [];
    const total = await parseMboxEmailsStreaming(mboxPath, async (batch) => {
      for (const e of batch) results.push(e);
    }, { batchSize: 200 });
    const emptyCount = results.filter(e => !e.messageId).length;
    console.log(`Round ${round}: total=${total}, results=${results.length}, emptyMessageId=${emptyCount}`);
  }
}

run().catch(err => console.error('ERROR:', err));
