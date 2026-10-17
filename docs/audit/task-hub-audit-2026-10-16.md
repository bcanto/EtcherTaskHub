# Task Hub functional audit, 16 October 2026

## Scope and method

- **Code audited:** branch `retained-services`, which contains everything live on `main` plus the undeployed ISO and Retained Services work. Each finding says whether it is **Live** (also on `main`, so in production today) or **Branch** (undeployed only).
- **Line numbers** are `index.html` on `retained-services` after the two fixes below, unless another file is named.
- **Evidence** for every finding is one of:
  - **Code trace:** read and followed through the source; file and line given.
  - **Probe:** reproduced in the running app on a private offline copy, in memory only, never touching real data. The probe scripts are listed at the end.
  - **Unit test:** run against a fake Supabase.
- **Limits.** Production and Supabase were not touched (standing rule), so server behaviour is traced in code. Three findings say "confirm on live": each needs one check by you with a real login.

## Fixed during this audit

Both fixes are on their own branches from `main`, so they can be deployed alone, together, or with the rest. Both are also applied on `retained-services`.

| # | Issue | Fix | Branch, commit | Evidence |
|---|---|---|---|---|
| F1 | "Add Client Failed" with a raw database error (foreign key `profiles_client_id_fkey`). Every new client portal login has failed since migration 004, after the login itself was already made. | `api/invite-user.js` writes the client's row in `clients` first. Retrying finishes a half-made login and sets the password typed. | `client-add-fix`, `be6c168` | Unit test against a fake Supabase that enforces the same key |
| F2 | Clicking OK on a Client form error (for example "password too short") closed the whole form. | Errors mark the field in red with the reason under it. The form stays open with everything typed. | `client-add-fix` | Browser test |
| F3 | Logo colour auto-pick chose a minor colour. A two-thirds red logo came out teal; a purple JPG came out near-white. | Colours are ranked by how much of the logo they fill. | `client-add-fix` | Browser test |
| F4 | Opening Edit on a client with a logo replaced its saved colour, and Save then recoloured every board of that client. | Edit keeps the saved colour and offers the logo's colours as swatches. | `client-add-fix` | Browser test |
| F5 | A new client's portal email was silently dropped if no password was entered. | Asks for the password instead. | `client-add-fix` | Browser test |
| F6 | `invite-user` reused any existing login for the email: a staff login could become a client login, a client's login could move to another client, and the password typed was ignored. | Refused, with a message on the email field. | `client-add-fix` | Unit test |
| F7 | A notification about a sub-item opened the wrong board. Sub-items were saved with no board id. | The jump finds the board through the parent and group. New sub-items record their board, and existing ones are repaired on load. Lands on the right board with the row highlighted and the side panel open. | `notif-board-fix`, `4fecc11` | Browser test, screenshots |

**Regression testing before deployment**

- **`client-add-fix`:**
  - `client-add-test` passes 30 of 30.
  - The full gate on `main` + fix leaves every other suite exactly as on plain `main`. 51 suites are clean (1,191 checks). The rest fail identically without the fix: they test ISO and newer features `main` does not have.
  - 7 of 7 deliberate breaks were caught by the tests.
- **`notif-board-fix`:**
  - `notif-jump-test` passes 8 of 8.
  - The 50 suites that run on `main` pass (1,151 checks) after one test-fixture change, explained below.
  - 4 of 4 deliberate breaks were caught.
- **Test-fixture change.** Three Main Table suites opened "the board with the most tasks", counting each task's own board id. Sub-items now carry a board id, so they counted too and the suites opened a different board. The suites now count top-level tasks. The other board's "0%" label is pre-existing; it is finding L1 below.

### Update, 17 October: the four critical items are fixed

They are four commits (plus a small follow-up to C1) on branch `critical-fixes`, built from `main` so they can be deployed alone, and also applied on `retained-services`.

| # | What changed | Commit on `critical-fixes` | Evidence |
|---|---|---|---|
| C3 | Staff passwords are no longer stored in the browser when Supabase is on; what is there is deleted. | `49116a3` | `crit-c3-passwords-test` 10 checks, can-fail 5/5 |
| C4 | Staff names and initials, client codes, custom status and priority labels, custom column values, the task change history, digest lines, Teams links and Link columns, the @mention list, the share-link manager and the quote number box can no longer run as code. Found by filling every text field with a marker and clicking about 450 controls: 11 fields fired before, none after. | `4f2f4f3` | `crit-c4-injection-test` 22 checks, can-fail 15/15 |
| C2 | Remove staff switches the login off (and stops if it cannot); a switched-off account is refused at sign-in; adding the person again switches it back on. Migration `016_inactive_accounts_lose_access.sql` is written, **not applied**. | `e9db42a` | `crit-c2-staff-access-test` 27 checks, can-fail 12/12 |
| C1 | A failed or contested save never overwrites the shared record: the changes are kept, the save is retried, and a banner stays until it gets through. Closing a tab writes the local copy only. | `0aa53a4`, `4c296c7` | `crit-c1-sync-test` 22 checks, can-fail 13/13 |

Known limits: a hand-crafted record can still carry hostile colours or ids into style or handler attributes (only removing inline script from the content policy closes that class); changes made in the last moments before closing a tab reach the server the next time that browser signs in; migration 016 makes a removed person's open session stop at once instead of at token expiry.

### Update, 17 October (later): the eleven high priority items are fixed

Twelve commits on branch `high-fixes`, built on top of `deploy-batch` (the critical fixes plus `client-add-fix` and `notif-board-fix` merged), so they can be deployed after those or one at a time. The same fixes are on `retained-services` (branch `retained-high`), adapted to its Timesheets, boards and Staff form, and with the Billing and retained-services halves of H1 and H6.

| # | What changed | Commit on `high-fixes` | Evidence |
|---|---|---|---|
| H11 | The email endpoint mails one active staff member only, in the caller's own name, with a short text and a ceiling per caller and per person. | `62bf58e` | `high-h11-email-test` 19 checks, can-fail 12/12 |
| H1 | The Staff screen's Role reaches the real login (a new admin-only `role` action in `api/set-password.js`); a Restricted record narrows a staff login at sign-in and while signed in, never widens, never touches an admin; adding a Restricted person no longer fails at the profile step; Billing reaches the signed-in user (retained-services). Nobody can change their own role. | `8bb5286` | `high-h1-roles-test` 47 checks, can-fail 22/22; `high-h1-billing-test` 8 checks, 5/5 |
| H7 | A message raised over an open form appears on its own layer; OK, Escape and a click outside close only the message; the form and what was typed stay. | `ec3e154` | `high-h7-alert-layer-test` 21 checks, can-fail 11/11 |
| H4 | Remove Staff and every way of deleting a task or client keep the unapproved hours (with the person's and the task's name on them), and every confirmation says so. Edit Time Entry keeps a removed person's or client's hours where they are. | `f3419b7`, `9c8fcd7` | `high-h4-hours-test` 29 checks, can-fail 17/17 |
| H6 | Duplicate board copies the board (3 groups and 15 tasks stay 3 and 15; the copy gets its own 3 and 15), numbered afresh, not copied as recurring, and without the original's retained-services arrangement. | `887d2ff` | `high-h6-duplicate-board-test` 17 checks, 11/11; retained: `high-h6-retainer-test` 5 checks, 1/1 |
| H5 | An occurrence has one id made from its source and due date, so two sessions make one task; it has its own reference number; the source is stamped when next due moves. | `5ba479d` | `high-h5-recurring-test` 13 checks, can-fail 10/10 |
| H2 | A revoked share link, a scoped work request and an edited calendar event are stamped; work requests merge on `updatedAt`; removed board access, a deleted client comment and a deleted calendar event are remembered as deleted. | `5e86ca4` | `high-h2-merge-test` 10 checks, can-fail 12/12 |
| H3 | Each custom status and priority is merged on its own time; deletes and resets are remembered. | `39925a1` | `high-h3-labels-test` 14 checks, can-fail 12/12 |
| H9 | At 60 clients, 120 boards, 6,000 tasks, 25,000 hours and 3,000 notifications: Reports 5.6 s to 0.1 s, Notifications 0.64 s to 0.09 s, Time 1.55 s to 0.63 s (windows with "show more"; totals still count everything; Select all covers the rows shown); search boxes wait for a pause; read notifications older than 90 days are cleared. | `f44cb15` | `high-h9-performance-test` 23 checks, can-fail 21/21 |
| H10 | Files sent in the internal comms go to file storage (up to 10 MB) and the record holds a reference; offline they stay in the browser's file store; deleting a message removes its files. | `a6be9b9` | `high-h10-comms-files-test` 20 checks, can-fail 14/14 |
| H8 | Deleting tasks, client create/edit/delete, staff add/edit/remove, hours edits, approvals and rejections (single and bulk) are recorded; every event is also sent to `public.audit_log`; the server writes login, password, access and role events itself; the Audit screen shows both, each change in words (a delete reads as the thing deleted and what went with it, a role change as the old and new role). Migration `017_audit_log_signed_in_insert.sql` is written, **not applied**. | `ab681fe`, `4b1b4af` | `high-h8-audit-test` 58 checks, can-fail 60/60 |

**Regression testing.** `high-fixes` (main-based): 66 suites, 1,530 checks, 0 failures. One suite (`crit-c2-staff-access-test`) lost its browser in the first run (Chrome closed under it) and passed 27 of 27 on three reruns. The combined `deploy-batch` passes 55 suites, 1,267 checks. `retained-high` runs the full retained-services gate. The stored-script fuzz (about 450 controls, every text field marked) finds 0 fields that fire.

**What to know before relying on it**
- **Restricted is enforced in the app, not in the database.** The database has no Restricted role (and a view-only login could not keep notification read marks or its own settings, since all of them live in the one shared record). Closing that gap is a design decision: a `restricted` flag on the profile plus a policy that refuses its writes, and a read-only session in the app. Say if you want it.
- **Existing mismatches are not corrected on their own.** A person whose staff record says Admin but whose login is Staff (or the reverse) stays as it is until an admin changes the role on the Staff screen. People the Staff screen already marks Restricted become view-only at their next sign-in.
- **A role change needs a linked login.** Someone who has never signed in cannot be made an admin from the Staff screen; the screen says so.
- **H8 needs migration 017 for the app's own events to reach the table.** Until you apply it the app stops trying quietly and keeps the local log; the server-side events (logins, passwords, access, roles) do not need it, only the `audit_log` table from migration 004.
- **H10 covers new attachments.** Files already sent in comms stay inside the record until someone moves them; a move can be written if wanted.
- **The one-record design is still there** (T1). The record is 9.3 MB at the size above, over a browser's 5 MB local storage limit; H9 makes the screens fast, it does not shrink the record.

---

## Critical issues

All four are fixed as described above; the text below is the original finding.

### C1. A failed or contested save can overwrite the whole company record with one browser's copy (Live)
- **Issue:**
  - All data is one record (`app_state`, row 1). A save normally reads the server copy, merges, and writes only if nobody wrote in between.
  - If the read fails (network blip, server error) or the save loses four write races in a row, the code falls back to a plain overwrite with this browser's data, not merged with the server copy.
  - Closing a tab with a save pending also does a plain overwrite.
- **Impact:** other people's changes since this browser last merged are silently erased for everyone, with no way to recover them. This sync layer already caused two real losses in September (other paths, since fixed); this path is still open.
- **Location:**
  - The fallback: `index.html:2867` (`if(readErr)break;`) and `index.html:2893` (`return _syncBlindUpsert(payload);`), in `_syncMergeWrite`.
  - The overwrite itself: `_syncBlindUpsert` at `index.html:2852`.
  - The tab-close save: `index.html:3276`.
- **Evidence:** code trace.
- **Recommended fix:** never overwrite blind.
  - On failure, keep the changes queued, retry with backoff, and show a visible "not saved yet" state.
  - On tab close, rely on the local copy and sync on next open, or send it to a server endpoint that merges with a version check. `api/_blob.js casWrite` already does this server-side.
- **Priority:** 1.

### C2. Removing a staff member does not remove their access (Live)
- **Issue:**
  - Remove Staff deletes the person only from the app data. Their login and server profile stay.
  - On their next sign-in the app finds no matching staff record and automatically creates a new one, giving them full staff access again (`index.html:3565`).
  - The database's internal-user check does not look at `active`, so even a deactivated profile can still read and write all company data (`supabase/migrations/002_rls_policies.sql:70`).
- **Impact:** former staff keep full access to every client's data, rates and timesheets.
- **Location:** `deleteStaff` `index.html:17371`; `_supabaseRestoreSession` `index.html:3472`.
- **Evidence:** code trace.
- **Recommended fix:**
  - Remove = disable the login (Supabase admin ban), set `profiles.active=false`, and require `active` in `is_internal()`. That needs a new migration, which you apply.
  - Stop auto-creating staff records for unknown internal logins; ask an admin instead.
- **Priority:** 1.

### C3. Staff passwords are stored in plain text in the admin's browser (Live)
- **Issue:** Add Staff and staff password changes save the password, unencrypted, to the admin browser's local storage key `etcher_pw_v1`. This happens on the live site too, not only on offline copies.
- **Impact:** anyone who can read that browser's storage gets working logins for every staff member that admin created or reset. That includes a script injection (C4) or someone at the computer.
- **Location:** `_savePw` `index.html:3115`, called from `saveStaff` `index.html:17396`.
- **Evidence:** code trace.
- **Recommended fix:**
  - Store nothing when Supabase is on, and delete the key on load.
  - Ask affected staff to change their passwords, starting with any account an admin created or reset from a shared computer.
- **Priority:** 1.

### C4. Stored script injection between staff (Live)
- **Issue:** text typed by one staff member runs as code in another staff member's browser in two places:
  - **Staff names:** inserted unescaped into the task form's Owner list (`index.html:17768`).
  - **Custom status and priority labels:** inserted unescaped on Main Table, Kanban, List, Gantt and Capacity (`statusBadge` `index.html:5590`; `getStatusMeta` and `getPrioMeta` at 5588 and 5677 feed many render sites).
- **Impact:**
  - Any staff session can change these values, and since all data is one shared record, a malicious or compromised staff account can run code as an admin.
  - That code can read the admin's session token and then use admin-only server calls, for example creating accounts or setting passwords.
- **Evidence:** probe. Hostile text was placed in about 35 user-typed fields and every view and panel was rendered. These two fired; everything else was escaped.
- **Recommended fix:** escape both at the source (`escHtml` on staff names in `openTaskModal`; escape `label` in `getStatusMeta` and `getPrioMeta` consumers).
- **Priority:** 1.

## High priority issues

### H1. Role, Restricted and Billing settings in the Staff screen do not apply to real logins (Live)
- **Fixed 17 October** (`8bb5286`). Role changes reach the login; Restricted and Billing apply at sign-in. Restricted is enforced in the app only (see the update above).
- **Issue:**
  - On the live site, the signed-in user's role comes from the server profile (`index.html:3496`), never from the Staff screen. So changing someone's role there does nothing.
  - "Restricted, view only" does not exist as a server role (`supabase/migrations/001_initial_schema.sql:15` allows admin, pm, staff, client), so restricted people keep full staff rights.
  - The Billing tick is checked on the signed-in user (`_canBill` `index.html:6251`) but never copied onto it, so Billing staff get no Reports, approvals or invoicing. The offline test passes only because the offline login copies the whole staff record.
- **Impact:** people have more or less access than you set. View-only users can edit everything, and Billing staff cannot approve.
- **Evidence:** code trace. **Confirm on live** with one Billing-ticked staff login (Reports should be missing).
- **Recommended fix:**
  - Keep role, restricted and billing on the profile and change them through an admin endpoint, or copy them from the staff record at sign-in.
  - Enforce restricted on the server too.
- **Priority:** 2.

### H2. Some edits are undone by a colleague's next save (Live)
- **Fixed 17 October** (`5e86ca4`). The named edits are stamped and the named deletes are remembered. Other edit sites that stamp nothing are not covered by this sweep.
- **Issue:** the merge keeps your local copy when neither side has a last-updated time. Several edits do not stamp one:
  - share link revoke `index.html:15880`
  - work request scoping `wrDoAddToWorkboard` `index.html:10904`
  - calendar events `saveSchedEvent` `index.html:7793`
  - recurring "next due" `index.html:23683`

  Several deletes leave no record that they happened, so they come back from other computers:
  - removing a person's board access `index.html:7230`
  - deleting a client comment `deleteClientComment` `index.html:23525`
  - deleting a calendar event `index.html:7823`
- **Impact:**
  - A revoked public link becomes active again, and removed board access comes back.
  - A scoped work request returns to the queue and can be scoped twice, creating duplicate tasks.
- **Evidence:** probe. After a colleague's save, the revoked link was active again and the scoped request was pending again.
- **Recommended fix:** stamp `updatedAt` on every edit and add tombstones for these deletes. One sweep of all create and edit sites (list in the probe output).
- **Priority:** 2.

### H3. Custom statuses and priorities are lost on sync (Live)
- **Fixed 17 October** (`39925a1`).
- **Issue:** labels are stored as an object, and for objects the merge keeps the server's copy (`index.html:2989`). A status or priority you create, rename, recolour or delete is not included when you save, and is replaced when a colleague's change arrives.
- **Evidence:** probe. A new status was missing from what the save sends, and gone after the next merge.
- **Recommended fix:** merge `labelConfig` per label with its own timestamp, the same way client note sections are merged.
- **Priority:** 2.

### H4. Remove Staff silently deletes the person's unapproved hours (Live)
- **Fixed 17 October** (`f3419b7`, `9c8fcd7`).
- **Issue:**
  - Remove Staff deletes every time entry of theirs that is not yet approved. The confirmation only mentions tasks.
  - Deleting a task or a client also deletes unapproved hours, though those confirmations do say so.
- **Impact:** payroll hours for work already done disappear before anyone approves them.
- **Location:** `deleteStaff` `index.html:17371`; `_cascadeDeleteTasks` `index.html:18397`.
- **Evidence:** probe. A 7.5-hour submitted entry was deleted.
- **Recommended fix:** keep the entries (mark them "staff removed" or "task deleted") so they can still be approved or rejected, and say so in the confirmation.
- **Priority:** 2.

### H5. Recurring tasks are created twice, and with a duplicate reference number (Live)
- **Fixed 17 October** (`5ba479d`).
- **Issue:** every open session creates the next occurrence at start-up and at midnight (`_checkRecurringTasks` `index.html:23683`). Advancing "next due" stamps no time, so other sessions never see it.
- **Impact:** duplicate tasks every period. Each copy also keeps the original's reference number.
- **Evidence:** probe. Two sessions produced two copies, both with the original's reference.
- **Recommended fix:**
  - Stamp the source.
  - Make creation idempotent: skip when a copy with the same source and due date exists.
  - Clear `refNumber` on copies.
- **Priority:** 2.

### H6. Duplicate board doubles the original and leaves the copy empty (Live)
- **Fixed 17 October** (`887d2ff`).
- **Issue:** copied groups and tasks keep the original's `boardId`, which wins over the new `workboardId` (`duplicateWorkboard` `index.html:24136`).
- **Evidence:** probe. Original went from 3 groups and 15 tasks to 6 and 30; the copy had 0 and 0.
- **Recommended fix:** set both ids on every copy. Copy only groups and tasks that resolve to the board. Clear `refNumber`, retainer and share settings on the copy.
- **Priority:** 2.

### H7. Error popups wipe forms in the shared dialog, including two client-portal forms (Live)
- **Fixed 17 October** (`ec3e154`).
- **Issue:** `showAlert` writes into the same dialog as the form, replacing it (`index.html:3810`). These 13 forms report problems that way, so clicking OK closes the form and loses what was typed:
  - Add/Edit Staff, Edit Time Entry
  - timesheet reject, bulk reject, bulk reject per staff member, bulk approve
  - calendar events, triage routing (single and bulk), add work request to a board, pro forma import
  - the client portal's Request changes and Respond

  In the portal, a failed send (`_portalAction` `index.html:3396`) loses the client's typed note.
- **Not affected:** board sharing, add group and the presence pickers.
- **Evidence:** code trace (each form's submit function checked). The same mechanism was reproduced on the Client form before F2.
- **Recommended fix:** give alerts their own layer above the dialog. That fixes all 13 at once.
- **Priority:** 2.

### H8. The audit trail misses key actions and can be edited (Live)
- **Fixed 17 October** (`ab681fe`, wording follow-up `4b1b4af`). Needs migration 017 for the app's own events to reach the server table.
- **Issue:**
  - Nothing is recorded for: task deletion, client create/edit/delete, staff add/remove/role change, time entry edits, timesheet approval and rejection.
  - The log keeps only the last 1,000 events.
  - It lives in the shared record, which any staff session can rewrite.
- **Location:** `writeAuditEvent` `index.html:6175`.
- **Evidence:** code trace (every call site counted).
- **Recommended fix:** write audit events server-side to their own append-only table (the ISO module already does this with `iso_activity`), and cover the actions above.
- **Priority:** 2.

### H9. Performance at a realistic data size (Live)
- **Fixed 17 October** (`f44cb15`). Screens are fast at the tested size; the record itself is not smaller (T1).
- **Issue:**
  - Probe setup: 60 clients, 120 boards, 6,000 tasks, 25,000 time entries and 3,000 notifications. That is roughly two years for a ten-person team.
  - The company record is then 9.3 MB, which is over a typical browser's 5 MB local storage limit, and every save uploads all of it.
- **Measured:**

  | View | Time to open |
  |---|---|
  | Reports | 5.9 s (renders every matching entry, no paging) |
  | Timesheets | 1.4 s |
  | Capacity | 0.7 s |
  | Notifications | 0.5 s |
  | Global search | 0.2 s per keystroke, no debounce |

- **Recommended fix:**
  - Page the Reports and Timesheets tables.
  - Debounce search.
  - Prune old notifications.
  - Plan the move off the single record (T1) before the data grows.
- **Priority:** 2.

### H10. Comms attachments are stored inside the company record (Live)
- **Fixed 17 October** (`a6be9b9`) for new attachments.
- **Issue:** files up to 4 MB sent in a board's comms are saved as text inside the record (`wsSendComms` `index.html:19112`), not in file storage.
- **Impact:** one file adds about 5.3 MB to every sync and every user's local copy.
- **Recommended fix:** upload to Supabase Storage, as task files already do (`_storageUpload`).
- **Priority:** 2.

### H11. Any staff session can send any email as Etcher (Live)
- **Fixed 17 October** (`62bf58e`).
- **Issue:** `api/notify-email.js` accepts any recipient and any text from any staff login. There is no rate limit.
- **Impact:** a compromised staff account can send phishing mail from Etcher's address.
- **Recommended fix:**
  - Accept a notification id or task id, not free text.
  - Look up the recipient server-side and allow only staff and client logins.
  - Add a rate limit.
- **Priority:** 3.

## Medium priority issues

| # | Issue | Impact | Location | Recommended fix |
|---|---|---|---|---|
| M1 | Deleting a client leaves its boards, client notes and work requests behind (probe: 1 board, 2 notes and 1 request left). Live. | Orphaned records that point at a client that no longer exists. | `confirmDelete` `index.html:18412` | Archive the client instead, or cascade to boards, notes and requests and say so. |
| M2 | Clients screen has no search, filter, sort or archive. Counts treat completed and cancelled work as open. Live. | Slow to find a client. Wrong numbers. Delete is the only way to retire a client. | `renderClients` `index.html:10599` | Add search and sort by name, use done statuses for counts, and add Archive. |
| M3 | The `pm` role (valid on the server) sees nothing: every page is blocked and no task is visible. Live. | A pm login is unusable. | `_acBlockedViews` 6333, `canViewTask` 6279, `canEditTask` 6305 | Treat pm like staff (or admin, if intended) in all three. |
| M4 | Sign-in falls back to matching a login to a staff record by display name, and saves the link permanently. Live. | A new login with the same name as a colleague takes over their tasks, hours and notifications. | `index.html:3544` | Match by stored id or email only; ask an admin otherwise. |
| M5 | `upsert_profile`, used by every login creation, is not in any migration file. Live. | A new database (dev, or a rebuild) cannot create logins. Adding a "Restricted" staff member probably fails, because that role is not in the role list (confirm on live). | `api/invite-user.js` | Capture its definition into a migration. You run the read-only `pg_get_functiondef` query and I write the file. |
| M6 | The quote number is placed inside an inline event handler. Live. | A quote number with an apostrophe breaks the field, and a crafted one runs script for other staff (rule A81). | `index.html:14595` | Pass it in a `data-` attribute. |
| M7 | `api/upload-state.js` overwrites the whole record with whatever is posted, protected by one shared secret and no version check. Live. | One mistaken call wipes all data. | `api/upload-state.js` | Remove it, or require the current version (`casWrite`). |
| M8 | `api/set-password.js` puts the user id into the admin URL unencoded and has no minimum length. Live. | Admin-only, but an odd id can reach other admin endpoints. Weak passwords are accepted. | `api/set-password.js` | Validate the id as a UUID and enforce at least 8 characters on the server. |
| M9 | Calendar events: editing someone else's event makes you its owner, so it can vanish from the real owner's calendar. Date is not required. End time can be before start. Live. | Lost or invisible events. | `saveSchedEvent` `index.html:7793` | Keep the owner, require a date, check the times. |
| M10 | Global search is not debounced and searches tasks only. Live. | Typing lag on larger data (H9). Clients, boards and notes are not findable from it. | `onGlobalSearch` `index.html:5202` | Debounce 150 ms. Consider reusing the dashboard search's results. |
| M11 | Edit Time Entry save does not re-check that the entry is still unapproved. Live. | An entry approved while the form was open can still be changed. | `saveEditTimeEntry` `index.html:11825` | Re-check status at save. |
| M12 | Notifications are never pruned. One email per notification, so bulk actions send many. Sent to inactive staff and for tasks they cannot open. Live. | Record growth, email noise. | `notify` `index.html:17498` | Prune after 90 days, batch emails, check active and access. |
| M13 | Deleting a custom status or priority has no confirmation and leaves tasks on a status with no label. Live. | Tasks show a raw key. | `wsDeleteCustomLabel` `index.html:25058` | Confirm, and move affected tasks to a chosen status. |
| M14 | Client Notes is unusable on a phone: the three desktop columns are squeezed in and the note is cut off (probe: 340 px of sideways overflow at 390 px). Live. | Notes cannot be read or edited on mobile. | `renderNotes` | Stack the columns below 760 px, as the portal already does. |
| M15 | Keyboard access: many clickable areas are plain elements with no role or tab stop (probe counts): Main Table 40, Capacity 34, Schedule 31, Gantt 24, Timesheets 18, Kanban 13, Reports 12, Digest 12, Dashboard 10. Reports has 22 unlabelled inputs, Main Table 11. Live. | Keyboard and screen-reader users cannot reach these controls. | Probe output per view | Use buttons, or add `role` and `tabindex` with Enter and Space handlers; add labels. |
| M16 | A 744 KB logo is preloaded on every page load to show at 28 to 96 px. The 570 KB ISO module loads for every user even with ISO off (Branch). | Slower first load, especially on phones. | `index.html:30`; the ISO `<script>` tags | Export a small logo (under 30 KB). Load ISO only when enabled. |
| M17 | Comment delete has no confirmation, and the function does not re-check the author (the button is only shown to the author or an admin). Live. | One click permanently removes a comment. | `tpDeleteComment` `index.html:23385` | Confirm, and check the author in the function. |

### Update, 17 October (later): the medium priority items are fixed

Three commits on branch `medium-fixes`, built on top of `high-fixes` (which already carries `deploy-batch`), so they
can be deployed in one step with everything before them or on their own. Ported to `retained-services` after its own
gate is clean.

| # | What changed | Evidence |
|---|---|---|
| M1 | Deleting a client deals with what it leaves behind, and says so: a board with nothing else on it is archived, a board holding other work stays without the client, its client notes and work requests are deleted (remembered as deleted, so an older copy merging in cannot bring them back). | `med-a-test` 25 checks, can-fail 18/18 |
| M2 | Clients has search (name, code or email), sort (name, most open work, recently added) and Archive / Restore. Counts leave out finished and cancelled work. | `med-b-test` 19 checks, can-fail 18/18 |
| M3 | A `pm` login (valid on the server, no screen knew it) signs in as staff instead of seeing nothing. | `med-a-test` |
| M4 | Sign-in links a login to a staff record by its stored id or email only, never by display name, and never takes over a record already linked to another login. | `med-a-test` |
| M5 | Not yet done: needs a read-only `pg_get_functiondef` query from you (the Why column of the report item). | open |
| M6 | Already safe: the quote number was already passed through `escHtml` and read from an input's value, never built into an inline handler. Kept covered by `med-a-test`. | `med-a-test` |
| M7 | `api/upload-state.js`, which could overwrite the whole record with one call behind a single shared secret, is removed. Nothing called it. | — |
| M8 | Already fixed in the critical batch (17 October, earlier): the user id is validated as a UUID and the server enforces at least 8 characters. | — |
| M9 | Editing a colleague's calendar event keeps them as its owner; a date is required; an event cannot end before it starts. | `med-a-test` |
| M10 | Already fixed with H9 (search is debounced). | — |
| M11 | An entry approved while its edit form was open can no longer be changed; checked again at save. | `med-a-test` |
| M12 | No notification for someone who has left or about a task they cannot open. Notification emails are gathered for two seconds and sent as one per person, cut to what the email service accepts. | `med-b-test` |
| M13 | Deleting a custom status or priority asks first and moves its tasks to To Do or Medium instead of leaving them on a raw key. | `med-a-test` |
| M14 | Client Notes stacks its three columns below 760px, as the portal already did. | `med-b-test` |
| M15 | Every clickable area on every screen gets a tab stop and opens with Enter or Space; placeholder-only inputs get an accessible name. | `med-b-test` |
| M16 | The logo preloaded on every page is 18 KB instead of 744 KB (the favicon likewise, 17 KB instead of 147 KB). Full-size files kept for PDFs. ISO's own load-only-when-enabled is already true on `retained-services`, where ISO lives. | `med-b-test` |
| M17 | Deleting a comment asks first, and only its author or an admin can, checked in the function itself rather than only by hiding the button. | `med-a-test` |

Also while in the area, a request from you: Create WorkBoard now offers 24 colours (the original 8 kept) plus a "+"
picker for any colour, and the WorkBoards header no longer runs 12px off a phone screen. `wb-colours-test` 7 checks,
can-fail 4/4.

**Regression testing.** `medium-fixes`: 69 suites, 1,587 checks, 0 failures (one suite needed a one-line update: its
scripted delete of a custom label now has to click the new confirmation, same as a person would).

### Update, 17 October (later still): the low priority items are fixed

One commit on branch `medium-fixes`, on top of the batch above.

| # | What changed | Evidence |
|---|---|---|
| L1 | A parent row whose sub-items are all not-started shows a dash, like every other not-started row, instead of "0%" next to "0/3". | `low-test` 15 checks, can-fail 10/10 |
| L2 | Recurring tasks: "Same board" off used to have no effect (it copied the source's board regardless, which was already the default); it now clears the board. "Same assignee" off cleared the owner but left the other assignees in place; it now clears them too. | `low-test` |
| L3 | A clickable area under 32x32px is grown to that size at runtime, on every screen. A colour swatch (its title is the hex code, not a label) is left at its real size, since a dense colour grid is a deliberate pattern, not an accident. | `low-test` |
| L4 | "director" is not a role the server or anything else issues; the five checks for it were dead code, now removed. | `low-test` |
| L5 | Documented rather than built: there is no database table behind the MCP connector by design, so a denylist would be a table added purely for this. `api/_mcpAuth.js` now spells out the two things that can be revoked today (the whole secret, or one person's access to new tokens) and the gap (one lost device, on its own, until its token expires). | — |
| L6 | The production placeholder for the email intake endpoint answered 200 with an empty list forever, defeating the app's own circuit breaker (built to stop polling after one 404). It now answers 404 until the real service exists. | `low-test` |
| L7 | Built 18 October with the sign-in work (branch `security-sso`, part B): signs out after a set time without activity, off until `SESSION_IDLE_MINUTES` is set in Vercel. See `docs/security/sso-https-plan.md`. | built, not deployed |

**Regression testing.** `medium-fixes`: 70 suites, 1,607 checks, 0 failures (`iso-import-test` does not apply on `main`, which has no ISO files). The full gate caught two problems in the tap-target fix, both fixed before deployment: a button in a narrow table column could be pushed past it (it now only grows taller there), and the note box's delete cross grew over the corner of the note (a button floating over other content is never grown). Deployed 18 October (`67a4b16`); the live site was checked byte for byte.

## Low priority improvements

| # | Issue | Benefit | Recommended enhancement |
|---|---|---|---|
| L1 | A parent row with sub-items shows "0%" next to "0/3" although empty progress is a dash elsewhere (seen on a seed board). | Consistent table. | Show the dash when the roll-up is 0. |
| L2 | Recurring "copy same board" has no effect, and assignees are kept when the owner is cleared. | Settings do what they say. | Fix both in `_checkRecurringTasks`. |
| L3 | Small tap targets under 24 px: Main Table 63, Capacity 29, Reports 18 (probe). | Easier on touch screens. | Pad icon buttons to 32 px or more. |
| L4 | Role checks for "director" are dead code (no such role). | Less confusion. | Remove. |
| L5 | MCP connector tokens can only be revoked all at once (rotate the secret). | Finer control if one device is lost. | Add a short denylist, or keep as is and document it. |
| L6 | The app checks for emails every 30 s against an endpoint that always answers "none". | Less background traffic. | Poll only when email intake is set up. |
| L7 | Supabase sessions never time out from inactivity. | Shared computers do not stay signed in. | Built with the sign-in work (`docs/security/sso-https-plan.md`, part B), not deployed yet. |

## Technical debt

| Component | Risk | Refactor recommendation |
|---|---|---|
| T1. All data in one JSON record merged in the browser | The root of C1, H2, H3 and H9. It grows without limit and every save sends everything. | Move collections to their own tables (004 already defines `tasks`, `clients`, `time_entries` and others, unused), or at least a server merge endpoint with version checks. |
| T2. Permissions enforced only in the browser for app data | Any staff session can read and change everything, including rates, all timesheets and client notes, whatever the screens allow. | Server-side checks per collection (RLS on real tables, or an API in front of the record). |
| T3. Two names for the same field (`boardId` and `workboardId`, `users` and `staff`, `boards` and `workboards`) | Bugs whenever only one is set (F7, H6). | One canonical field, migrated once. |
| T4. One 1.95 MB page with 1,238 global functions and inline handlers | Slow to change safely. The security policy must allow `unsafe-inline` and `unsafe-eval`. | Split into modules and use delegated events, starting with new work. |
| T5. Alerts share the form dialog | H7 and similar bugs in every new form. | A separate alert layer (also a quick win). |
| T6. Hard-coded identities and seed passwords in the page (`_KNOWN_IDS`, seed users) | Shipped to every visitor's browser, and fragile. | Move to data, or remove once every user is linked. |
| T7. Older tests use :3001 and the seed admin, and ISO tests need a server that takes `--port` (missing on `main`) | Tests can touch your own data, and `main` cannot run them. | Move the remaining suites to private servers, as done today for three. |

## Quick wins

| Improvement | Estimated effort | Expected benefit |
|---|---|---|
| Stop storing passwords; clear the key on load (C3) | 1 hour | Closes a credential leak |
| Escape staff names and status/priority labels (C4) | 2 hours | Closes script injection between staff |
| Separate alert layer (H7) | Half a day | 13 forms stop losing typed input, including the client portal |
| Stamp edits and add tombstones (H2) | Half a day | Revoked links and access stay revoked; requests stay scoped |
| Remove Staff keeps time entries and says so (H4) | 30 minutes | No lost payroll hours |
| Debounce global search (M10) | 15 minutes | No typing lag |
| Smaller logo (M16) | 15 minutes | Faster first load |
| Quote number to a `data-` attribute (M6) | 15 minutes | Closes an injection path |
| Clients search and sort (M2) | 1 to 2 hours | Faster client lookup |

## Final summary

| | Count |
|---|---|
| Fixed during this audit | 44 (F1 to F7, C1 to C4, H1 to H11, M1 to M4 and M6 to M17, L1 to L6) |
| Critical | 4 (all fixed 17 October) |
| High | 11 (all fixed 17 October) |
| Medium | 17 (16 fixed 17 October; M5 needs one query from you) |
| Low | 7 (6 fixed 17 October; L7 built 18 October with the sign-in work, not deployed yet) |
| Technical debt items | 7 |
| **Total issues found** | **46**: 44 fixed, 2 open (M5, L7; neither critical nor high), plus 7 technical debt items |

**Checked and found sound:**
- Every button on 18 views clicked (435 controls) with no script error, and every view opens without errors.
- Every function called from a button exists.
- Script injection: about 35 fields tested, all escaped when rendered except the two in C4. The quote number (M6) only runs when the field loses focus, so it was found in the code instead.
- Client portal data isolation: server-built slice.
- MCP token handling.
- Pro forma never writes back to approved hours.
- Approved time entries cannot be edited or deleted.
- Billing staff cannot approve their own time.
- Email intake no longer repaints while typing.
- Every view fits a phone screen except Client Notes (M14).

**Estimated effort to resolve:**
- Critical: done.
- High: done.
- Medium: done, except M5 (waiting on one query from you).
- Low: done, except L7 (built with the sign-in work, waiting for that deploy).
- T1 and T2 are a separate project of 3 to 6 weeks, worth planning before the data reaches H9's size.

**Recommended deployment order:**
1. **Now:** `deploy-batch` (C1 to C4, `client-add-fix` and `notif-board-fix` merged; 55 suites clean), or each of those three branches on its own. Then apply migration `016_inactive_accounts_lose_access.sql` yourself.
2. **Then:** `high-fixes` (H1 to H11, on top of `deploy-batch`; 66 suites clean). It can go in one step with the first, or later. Apply migration `017_audit_log_signed_in_insert.sql` yourself when you want the app's own events in the permanent trail.
3. **Then:** `medium-fixes` (M and L items, on top of `high-fixes`; 70 suites clean). It can go in one step with the above. M5 still needs a query from you; L7 is covered by the SSO plan. Then plan T1 and T2.
4. **The ISO / Retained Services release** (`retained-services`, which already carries everything above): after its migrations and the SSO plan.

Each batch gets its own tests (each proven able to fail) and a clean full gate before it is offered for deployment.

## Probe scripts

Kept out of the repo (scratchpad), available on request:
- `audit-handlers.cjs`: inline handler names.
- `audit-views.cjs`: 18 views, every control clicked, accessibility and phone width.
- `audit-xss-locate.cjs`: stored script injection.
- `audit-data.cjs`: duplicate board, recurring, Remove Staff, delete client, settings merge, unstamped edits, scale.
- `audit-stamps.cjs`: create sites without `updatedAt`.
- `audit-task-push.cjs`: task creates without a board id.
