// ============================================================================
// Sync Reliability — Electron-side integration (v2, corrected against real main.js)
// ============================================================================
//
// WHAT CHANGED FROM THE FIRST DRAFT, AND WHY:
// - reSyncSingleFolder() as a separate placeholder function is GONE. Your real
//   per-folder logic already lives inline inside runThunderbirdSync()'s
//   `for (const { syncKey, mboxPath, accountName, folderName } of foldersToSync)`
//   loop. Duplicating that logic in a second function would have meant two
//   places to keep in sync forever — instead, extract that loop body into
//   ONE reusable function (`syncOneFolder`, below) and call it from BOTH the
//   main loop and the retry path. This is the integration change needed in
//   main.js itself (see INTEGRATION STEP 1).
// - `/db/sync-failures` is a GET endpoint (per sync_reliability_routes.py),
//   so its callPython() call now correctly passes method='GET' as the 3rd
//   argument, matching your real callPython(endpoint, payload, method) signature.
//
// ============================================================================
// INTEGRATION STEP 1 (required edit to main.js — do this first)
// ============================================================================
// In runThunderbirdSync(), replace the body of the
// `for (const { syncKey, mboxPath, accountName, folderName } of foldersToSync)`
// loop with a call to a new extracted function. Concretely:
//
//   for (const { syncKey, mboxPath, accountName, folderName } of foldersToSync) {
//     await syncOneFolder({ mboxPath, accountName, folderName, getSupplierIdFromAddress });
//   }
//
// And define syncOneFolder ABOVE runThunderbirdSync (or in this file and
// require() it — your choice) as:
//
//   async function syncOneFolder({ mboxPath, accountName, folderName, getSupplierIdFromAddress }) {
//     try {
//       const stats = fs.statSync(mboxPath);
//       const sizeMB = Math.round(stats.size / 1024 / 1024);
//       const accountEmailLower = (accountName || '').toLowerCase();
//
//       async function handleBatch(emails) {
//         for (const e of emails) {
//           e.isSentByUser = accountEmailLower && e.from.toLowerCase().includes(accountEmailLower);
//           const addressToCheck = e.isSentByUser ? e.to : e.from;
//           e.supplierId = getSupplierIdFromAddress(addressToCheck) || null;
//         }
//         if (pythonAvailable) {
//           await persistEmailsToDB(emails, {
//             folderName,
//             accountEmail: accountName,
//             supplierId: null,
//           }).catch(() => {});
//           await queueEmailsForBackgroundNLP(emails).catch(() => {});
//         }
//         emails.length = 0;
//       }
//
//       if (sizeMB > 50) {
//         console.log('[TB-SYNC] Streaming large file: %s (%d MB)', folderName, sizeMB);
//       }
//
//       const totalProcessed = await parseMboxEmailsStreaming(mboxPath, handleBatch, { batchSize: 200 });
//       if (totalProcessed > 0) {
//         console.log('[TB-SYNC] Finished %s: %d emails processed (%d MB)', folderName, totalProcessed, sizeMB);
//       }
//
//       // NEW — the one line this whole feature actually needed:
//       if (totalProcessed > 0) {
//         await syncReliability.verifyAndHandleFolder(accountName, folderName, totalProcessed, {
//           mboxPath, getSupplierIdFromAddress,
//         });
//       }
//
//       return totalProcessed;
//     } catch (err) {
//       console.log('[TB-SYNC] Sync failed for %s: %s', folderName, err.message);
//       return 0;
//     }
//   }
//
// This is a pure refactor (extract function) for the existing behavior —
// nothing about parsing/persisting changes — plus exactly one new call.
// The [PATH-DIAG] AP AIR-specific diagnostic block was intentionally left
// OUT of this extraction since you said earlier it should be removed/
// generalized once confirmed stable; reintroduce it inside syncOneFolder
// if you're not ready to drop it yet.
// ============================================================================

const MAX_RETRIES = 3;
let activeFailures = [];

// callPython is defined in main.js (Electron's HTTP client to the Python
// service). This module doesn't have access to it automatically — main.js
// must call setCallPython(callPython) once, right after requiring this file,
// before any sync verification happens. See INTEGRATION STEP 2 below.
let callPython = null;

function setCallPython(fn) {
  callPython = fn;
}

/**
 * Call this once per folder, right after parseMboxEmailsStreaming finishes
 * (i.e. right after totalProcessed is known) — see INTEGRATION STEP 1 above
 * for exactly where.
 *
 * @param {string} accountEmail
 * @param {string} folderName
 * @param {number} expectedCount - totalProcessed from parseMboxEmailsStreaming
 * @param {object} retryContext - { mboxPath, getSupplierIdFromAddress } —
 *   only needed if a retry actually happens; passed through to syncOneFolder.
 */
async function verifyAndHandleFolder(accountEmail, folderName, expectedCount, retryContext) {
  if (!callPython) {
    throw new Error(
      'sync_reliability_electron.js: setCallPython() was never called. ' +
      'Add `syncReliability.setCallPython(callPython);` once in main.js, ' +
      'right after the require() line for this module.'
    );
  }
  try {
    const verifyResult = await callPython('/db/verify-sync', {
      account_email: accountEmail,
      folder_path: folderName,
      expected_count: expectedCount,
    });

    if (verifyResult.is_match) {
      await _clearResolvedFailureIfAny(accountEmail, folderName);
      return { ok: true };
    }

    console.warn(
      '[SYNC-RELIABILITY] Mismatch detected: %s / %s — expected %d, got %d',
      accountEmail, folderName, verifyResult.expected_count, verifyResult.actual_count
    );

    return await _retryLoop(accountEmail, folderName, expectedCount, retryContext);
  } catch (e) {
    console.error('[SYNC-RELIABILITY] verifyAndHandleFolder failed: %s', e.message);
    return { ok: false, error: e.message };
  }
}

async function _retryLoop(accountEmail, folderName, originalExpectedCount, retryContext) {
  const failuresResp = await callPython('/db/sync-failures?status=pending,retrying', null, 'GET');
  const failure = (failuresResp.items || []).find(
    f => f.account_email === accountEmail && f.folder_path === folderName
  );
  if (!failure) {
    console.error('[SYNC-RELIABILITY] Expected a failure record but found none — aborting retry loop');
    return { ok: false, error: 'failure_record_missing' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const retryDecision = await callPython(`/db/sync-retry/${failure.id}`, {});

    if (retryDecision.escalate) {
      await _refreshActiveFailures();
      console.error(
        '[SYNC-RELIABILITY] ESCALATED after %d retries: %s / %s — alarm raised, report ready',
        MAX_RETRIES, accountEmail, folderName
      );
      return { ok: false, escalated: true, report: retryDecision.report };
    }

    console.log('[SYNC-RELIABILITY] Retry attempt %d/%d for %s / %s', attempt, MAX_RETRIES, accountEmail, folderName);

    // Re-runs the SAME extracted function used by the main sync loop — no
    // duplicated streaming logic. Requires syncOneFolder to be reachable
    // here (either both in main.js, or exported from main.js and required
    // into this file — see INTEGRATION STEP 1).
    const reprocessedCount = await syncOneFolder({
      mboxPath: retryContext.mboxPath,
      accountName: accountEmail,
      folderName,
      getSupplierIdFromAddress: retryContext.getSupplierIdFromAddress,
    });

    const verifyResult = await callPython('/db/verify-sync', {
      account_email: accountEmail,
      folder_path: folderName,
      expected_count: reprocessedCount || originalExpectedCount,
    });

    if (verifyResult.is_match) {
      await callPython(`/db/sync-resolve/${failure.id}`, {});
      await _refreshActiveFailures();
      console.log('[SYNC-RELIABILITY] Resolved on retry %d: %s / %s', attempt, accountEmail, folderName);
      return { ok: true, resolvedOnRetry: attempt };
    }
  }

  await _refreshActiveFailures();
  return { ok: false, escalated: true };
}

async function _clearResolvedFailureIfAny(accountEmail, folderName) {
  const failuresResp = await callPython('/db/sync-failures?status=pending,retrying', null, 'GET');
  const match = (failuresResp.items || []).find(
    f => f.account_email === accountEmail && f.folder_path === folderName
  );
  if (match) {
    await callPython(`/db/sync-resolve/${match.id}`, {});
    await _refreshActiveFailures();
  }
}

async function _refreshActiveFailures() {
  const result = await callPython('/db/sync-failures?status=escalated,pending,retrying', null, 'GET');
  activeFailures = result.items || [];
}

function getActiveFailures() {
  return activeFailures;
}

async function escalateToDeepseek(failureId) {
  return await callPython(`/db/sync-escalate/${failureId}`, {});
}

module.exports = {
  setCallPython,
  verifyAndHandleFolder,
  getActiveFailures,
  escalateToDeepseek,
};

// ============================================================================
// IPC SKELETON — add to your main.js ipcMain handlers
// ============================================================================
//
// ipcMain.handle('get-sync-alarms', async () => {
//   return syncReliability.getActiveFailures();
// });
//
// ipcMain.handle('send-sync-failure-to-deepseek', async (event, failureId) => {
//   return await syncReliability.escalateToDeepseek(failureId);
// });
// ============================================================================
