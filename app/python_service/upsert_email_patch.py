# ============================================================================
# PATCH: upsert_email race-condition fix
# File: database.py
# ============================================================================
#
# WHAT THIS FIXES
# ----------------
# persistEmailsToDB (main.js, Electron side) fires batches of 5 emails
# concurrently via Promise.all(batch.map(...)) -> POST /db/email per email.
# upsert_email does a plain "SELECT ... WHERE message_id = ?" existence check
# followed by a separate INSERT. When two emails in the same batch share a
# message_id (confirmed: forwarded/CC/resaved copies of the same email living
# twice in one mbox), both calls can run the SELECT before either INSERT
# commits. Both see "doesn't exist yet", both attempt INSERT, the second one
# hits the real UNIQUE constraint on emails.message_id and raises -> surfaces
# to Electron as HTTP 500 / DB_ERROR -> counted as "failed" in
# [DB-PERSIST] Stored X, skipped Y, failed Z.
#
# Verified via SQLite query: the surviving row is intact (no corruption, no
# duplicate row) -- the failing INSERT was correctly rejected, it just wasn't
# handled gracefully. This patch makes the "lost the race" case fall through
# to the exact same UPDATE logic already used for legitimate re-syncs, so the
# losing call's metadata still gets merged in instead of being dropped as an
# error.
#
# WHY THIS FULLY PREVENTS RECURRENCE (not just a partial mitigation)
# --------------------------------------------------------------------
# The only way emails.message_id can raise UNIQUE constraint failed is via
# the INSERT statement (there is no other write path to that column). After
# this patch, that specific exception is caught, and the only logic standing
# between you and a future 500 for this exact scenario is:
#   1. The except clause only swallows IntegrityError whose message contains
#      "UNIQUE constraint failed: emails.message_id" -- any other integrity
#      error (e.g. a different constraint) is re-raised, not masked.
#   2. On catching it, we don't retry the INSERT (which would just race
#      again) -- we go straight to UPDATE ... WHERE message_id = ?, which is
#      safe to run any number of times concurrently for the same message_id
#      (SQLite serializes writes to the same row; whichever UPDATE call runs
#      second just re-applies the same fields, which is a no-op in effect).
#   3. We re-SELECT the row's id at the end so the return value is still a
#      valid {"email_id": ..., "action": ...} for whatever Electron-side code
#      consumes it (check persistEmailsToDB / callPython callers if they key
#      off "action" -- "updated_after_race" is a new value, see note below).
#
# So: for *this exact failure mode* (duplicate message_id within or across
# concurrent batches), recurrence is structurally prevented, not just logged
# more gracefully. It cannot reappear as a 500/DB_ERROR for this cause again.
#
# WHAT THIS DOES **NOT** PREVENT (read before assuming "fixed forever")
# ------------------------------------------------------------------------
# - A *different* UNIQUE constraint (e.g. if you ever add one on another
#   column) would still raise, by design (see point 1 above) -- that's
#   intentional, not a gap.
# - This does not fix the root cause of *why* duplicates exist in the mbox
#   in the first place (forwarded/CC/resaved copies). That's a Thunderbird/
#   mail-data characteristic, not a bug -- the correct behavior is exactly
#   what this patch does: treat the second copy as "this email already
#   exists, refresh its fields," which is what already happens for the
#   normal (non-race) duplicate-on-resync case.
# - If you ever change BATCH_SIZE upward (more concurrency) or move to
#   true SQL-level upserts later (e.g. "INSERT ... ON CONFLICT(message_id)
#   DO UPDATE SET ...", supported by SQLite 3.24+), this patch becomes
#   redundant but harmless -- the except branch just won't ever fire.
#   Switching to ON CONFLICT is the more "correct" long-term fix (atomic,
#   no SELECT-then-act window at all) but requires touching more of the
#   surrounding function than is safe to do blind; see optional upgrade
#   note at the bottom of this file.
# ============================================================================

import sqlite3
# ^ Confirm this import exists at the top of database.py already.
#   If using aiosqlite, sqlite3.IntegrityError is still the correct exception
#   class to catch (aiosqlite wraps and re-raises stdlib sqlite3 exceptions).
#   If you want to verify with certainty in your environment, you can
#   temporarily add `print(type(e), e)` in the except block before deploying.


async def upsert_email(db, data: dict) -> dict:
    """
    (Keep your existing docstring / earlier lines of the function —
    thread_id resolution, sender_type resolution, supplier_id resolution —
    UNCHANGED above this point. Only the block below — from the existence
    check through the end of the function — should be replaced.)
    """

    # Check if exists
    cursor = await db.execute(
        "SELECT id FROM emails WHERE message_id = ?",
        (data.get("message_id"),)
    )
    existing = await cursor.fetchone()

    if existing:
        # Update metadata only — never overwrite NLP results, step_assigned, or supplier_id
        # if they were already set by SMART mode
        await db.execute("""
            UPDATE emails SET
                profile_name = ?, account_email = ?, folder_path = ?,
                subject = ?, sender_email = ?, sender_name = ?,
                sent_at = ?, body_language = ?,
                has_attachments = ?,
                thread_id = CASE WHEN thread_id IS NULL THEN ? ELSE thread_id END,
                body_text = ?,
                supplier_id = CASE WHEN supplier_id IS NULL THEN ? ELSE supplier_id END,
                sender_type = CASE WHEN sender_type IS NULL THEN ? ELSE sender_type END,
                step_assigned = CASE WHEN nlp_status IN ('completed','manual') THEN step_assigned ELSE ? END,
                parsed_at = datetime('now')
            WHERE message_id = ?
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("subject"), data.get("sender_email"), data.get("sender_name"),
            data.get("sent_at"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"),
            data.get("body_text"),
            data.get("supplier_id"),
            data.get("sender_type"),
            data.get("step_assigned", 0),
            data.get("message_id"),
        ))
        await db.commit()
        return {"email_id": existing["id"], "action": "updated"}

    # Insert
    try:
        cursor = await db.execute("""
            INSERT INTO emails (
                profile_name, account_email, folder_path, message_id,
                subject, sender_email, sender_name, sent_at,
                body_text, body_language, has_attachments, thread_id,
                step_assigned, rfq_id, supplier_id, sender_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("message_id"), data.get("subject"),
            data.get("sender_email"), data.get("sender_name"), data.get("sent_at"),
            data.get("body_text"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"), data.get("step_assigned", 0),
            data.get("rfq_id"), data.get("supplier_id"), data.get("sender_type"),
        ))
        await db.commit()
        return {"email_id": cursor.lastrowid, "action": "inserted"}

    except sqlite3.IntegrityError as e:
        if "UNIQUE constraint failed: emails.message_id" not in str(e):
            raise  # a different integrity error — don't mask it, something else is wrong

        # Lost the race: another concurrent call (same Promise.all batch, or an
        # overlapping batch) inserted this message_id between our SELECT and our
        # INSERT. The row legitimately exists now — we just didn't see it in time.
        # Fall through to the same UPDATE logic as the normal "already exists" path
        # rather than surfacing this as a DB_ERROR.
        await db.execute("""
            UPDATE emails SET
                profile_name = ?, account_email = ?, folder_path = ?,
                subject = ?, sender_email = ?, sender_name = ?,
                sent_at = ?, body_language = ?,
                has_attachments = ?,
                thread_id = CASE WHEN thread_id IS NULL THEN ? ELSE thread_id END,
                body_text = ?,
                supplier_id = CASE WHEN supplier_id IS NULL THEN ? ELSE supplier_id END,
                sender_type = CASE WHEN sender_type IS NULL THEN ? ELSE sender_type END,
                step_assigned = CASE WHEN nlp_status IN ('completed','manual') THEN step_assigned ELSE ? END,
                parsed_at = datetime('now')
            WHERE message_id = ?
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("subject"), data.get("sender_email"), data.get("sender_name"),
            data.get("sent_at"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"),
            data.get("body_text"),
            data.get("supplier_id"),
            data.get("sender_type"),
            data.get("step_assigned", 0),
            data.get("message_id"),
        ))
        await db.commit()

        row_cursor = await db.execute(
            "SELECT id FROM emails WHERE message_id = ?",
            (data.get("message_id"),)
        )
        row = await row_cursor.fetchone()
        return {"email_id": row["id"] if row else None, "action": "updated_after_race"}


# ============================================================================
# OPTIONAL FOLLOW-UP (not required, not part of this patch — read only if
# you want the structurally cleanest possible fix later):
#
# SQLite 3.24+ supports atomic upserts:
#
#   INSERT INTO emails (message_id, subject, ...) VALUES (?, ?, ...)
#   ON CONFLICT(message_id) DO UPDATE SET
#       subject = excluded.subject,
#       ... (same field list as your UPDATE branch)
#   WHERE emails.message_id = excluded.message_id;
#
# This removes the SELECT-then-act window entirely (single atomic statement,
# no race possible by construction) and would let you delete the try/except
# above entirely. It's a bigger structural change (one statement instead of
# three code paths) so it's deliberately NOT included in this patch — apply
# the try/except version first, confirm it resolves the failed count to 0
# across a few syncs, and consider the ON CONFLICT rewrite as a later
# simplification once you're not mid-investigation.
# ============================================================================
