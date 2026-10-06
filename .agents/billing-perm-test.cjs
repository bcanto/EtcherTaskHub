// Phase 7b.1 acceptance (D16): a non-admin staff member flagged `billing:true` gets the same
// approve/reject/invoice/report access an admin has, without the rest of admin's surface area —
// Sam Wignall (u2), the plan's own named example, needs to approve time and run pro forma
// invoices without being made a full admin. Runs against the shared gate dev server
// (http://localhost:3001, already required to be offline per gate.sh's own check), same
// convention as mt-complete-hours-test.cjs and friends. Swaps `currentUser` in place within the
// SAME page/localStorage to check as Sam, rather than a genuinely separate login/browser context
// — plain Task Hub's --offline mode persists per-browser (unlike ISO's own server-side offline
// store), so a second browser context would boot with none of this fixture's seeded data at all;
// swapping currentUser in place is the established pattern this repo's own
// personal-boards-test.cjs/audit-access.cjs already use for cross-role checks. Every record this
// suite creates is tagged with a BILLINGPERMTEST marker and cleaned up at the end, win or lose.
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const MARK = 'BILLINGPERMTEST';

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1400, height: 900 } });
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });

  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));
  await page.type('#login-email', 'b.canto@etchersolutions.com');
  await page.type('#login-password', 'TaskHub123');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1800));

  // Defensive reset: a prior interrupted run could have left u2 flagged.
  await page.evaluate(() => { const u = DB.users.find(x => x.id === 'u2'); if (u) delete u.billing; saveDB(DB); });

  const R = await page.evaluate((mark) => {
    const o = {};
    const realUser = currentUser;
    const clientId = DB.clients[0]?.id;
    o.hasClient = !!clientId;

    // Three real time entries via the same _teCreateEntry the UI's own form calls.
    const mk = (staffId, label) => _teCreateEntry({ clientId, staffId, hours: 2, date: '2026-01-05', note: mark + '-' + label, billable: true, location: 'remote', earningsRateId: 'er1', earningsRateName: 'Ordinary Hours' }).id;
    const samEntryId = mk('u2', 'sam');
    const adminEntryId = mk('u1', 'admin');
    const adminOwnApproveEntryId = mk('u1', 'admin-self');
    o.entriesCreated = !!samEntryId && !!adminEntryId && !!adminOwnApproveEntryId;

    const sam = DB.staff.find(u => u.id === 'u2');
    o.samIsStaffNoBilling = sam && sam.role === 'staff' && sam.billing !== true;

    // ── As Sam, without Billing ────────────────────────────────────────────────────────────────
    currentUser = sam;
    const navEl = () => document.getElementById('nav-reports-item');
    applyRolePermissions();
    o.beforeNavHidden = !navEl() || getComputedStyle(navEl()).display === 'none';
    o.beforeBlockedHasReports = _acBlockedViews(currentUser).has('reports');

    tsApproveEntry(adminEntryId);
    let e = DB.timeEntries.find(x => x.id === adminEntryId);
    o.beforeApproveRefused = e && e.status === 'submitted';
    document.getElementById('generic-modal')?.classList.add('hidden');

    const pfiCountBefore = (DB.proFormaInvoices || []).length;
    pfiCreate();
    o.beforeInvoiceRefused = (DB.proFormaInvoices || []).length === pfiCountBefore;
    document.getElementById('generic-modal')?.classList.add('hidden');

    // Defence in depth: the Billing checkbox itself never renders for a non-admin viewer, even
    // called directly (the route to reach this modal is already admin-only).
    openStaffModal('u2');
    o.checkboxHiddenForNonAdmin = !document.getElementById('sm-billing-wrap');
    document.getElementById('generic-modal')?.classList.add('hidden');

    // ── Back to the real admin: tick Billing for Sam through the real modal + saveStaff ────────
    currentUser = realUser;
    openStaffModal('u2');
    o.checkboxShownForAdmin = !!document.getElementById('sm-billing-wrap') && getComputedStyle(document.getElementById('sm-billing-wrap')).display !== 'none';
    document.getElementById('sm-billing').checked = true;
    saveStaff('u2');
    const samAfter = DB.staff.find(u => u.id === 'u2');
    o.billingPersisted = samAfter.billing === true;
    const ev = (DB.auditLog || []).slice().reverse().find(a => a.entityType === 'User' && a.entityId === 'u2' && a.action === 'billing_changed');
    o.auditEvent = ev ? { before: JSON.parse(ev.beforeValueJson), after: JSON.parse(ev.afterValueJson) } : null;

    // ── As Sam again, now WITH Billing ─────────────────────────────────────────────────────────
    currentUser = samAfter;
    applyRolePermissions();
    o.afterNavVisible = navEl() && getComputedStyle(navEl()).display !== 'none';
    o.afterBlockedHasReports = _acBlockedViews(currentUser).has('reports');

    renderView('reports');
    o.reportsRendersReal = !/Access Restricted/.test(document.getElementById('view-container')?.innerText || '');

    tsApproveEntry(adminEntryId);
    e = DB.timeEntries.find(x => x.id === adminEntryId);
    o.samApprovesOther = e && e.status === 'approved' && e.approvedByUserId === 'u2';

    tsApproveEntry(samEntryId);
    e = DB.timeEntries.find(x => x.id === samEntryId);
    o.samSelfApproveRefused = e && e.status === 'submitted';
    o.samSelfApproveToastText = document.getElementById('generic-modal-body')?.innerText || '';
    document.getElementById('generic-modal')?.classList.add('hidden');

    // The real register: Approve button absent on her own row, present on someone else's.
    tsStatusTab = 'all'; tsSelectedIds = new Set();
    renderView('reports');
    o.ownRowHasApprove = !!document.querySelector(`button[onclick*="tsApproveEntry('${samEntryId}'"]`);
    o.otherRowHasApprove = !!document.querySelector(`button[onclick*="tsApproveEntry('${adminOwnApproveEntryId}'"]`);

    const pfiCountBilled = (DB.proFormaInvoices || []).length;
    pfiCreate();
    const pfiListAfter = DB.proFormaInvoices || [];
    o.samInvoiceCreated = pfiListAfter.length === pfiCountBilled + 1;
    o.samInvoiceId = pfiListAfter[pfiListAfter.length - 1]?.id || null;

    // ── Admin unchanged: CAN approve their own entry (unlike Sam) ──────────────────────────────
    currentUser = realUser;
    tsApproveEntry(adminOwnApproveEntryId);
    e = DB.timeEntries.find(x => x.id === adminOwnApproveEntryId);
    o.adminApprovesSelf = e && e.status === 'approved' && e.approvedByUserId === 'u1';

    // ── restricted/client with a stray billing:true get nothing extra ──────────────────────────
    o.canBill = {
      adminNoFlag: _canBill({ role: 'admin' }),
      staffNoFlag: _canBill({ role: 'staff' }),
      staffWithFlag: _canBill({ role: 'staff', billing: true }),
      restrictedWithFlag: _canBill({ role: 'restricted', billing: true }),
      clientWithFlag: _canBill({ role: 'client', billing: true }),
      nullUser: _canBill(null),
    };

    // ── Cleanup, still as the real admin ────────────────────────────────────────────────────────
    DB.timeEntries = (DB.timeEntries || []).filter(x => !(x.note || '').startsWith(mark));
    DB.proFormaInvoices = (DB.proFormaInvoices || []).filter(i => i.id !== o.samInvoiceId);
    DB.auditLog = (DB.auditLog || []).filter(a => !(a.entityType === 'User' && a.entityId === 'u2' && a.action === 'billing_changed'));
    const su = DB.users.find(x => x.id === 'u2'); if (su) delete su.billing;
    saveDB(DB);
    renderView('reports');
    return o;
  }, MARK);

  ok(R.hasClient, 'the offline fixture has at least one client to log time against');
  ok(R.entriesCreated, 'three real time entries were created via _teCreateEntry');
  ok(R.samIsStaffNoBilling, 'Sam (u2) is a real staff-role fixture user, starting without Billing');
  ok(R.beforeNavHidden, 'without Billing, Sam does not see the Reports nav item');
  ok(R.beforeBlockedHasReports, 'without Billing, _acBlockedViews(Sam) still blocks the reports route');
  ok(R.beforeApproveRefused, 'without Billing, tsApproveEntry on someone else\'s entry is refused (entry stays submitted)');
  ok(R.beforeInvoiceRefused, 'without Billing, pfiCreate is refused (no invoice created)');
  ok(R.checkboxHiddenForNonAdmin, 'openStaffModal never renders the Billing checkbox when the viewer is not an admin, even called directly');
  ok(R.checkboxShownForAdmin, 'the Billing checkbox IS shown to an admin editing a staff-role user');
  ok(R.billingPersisted, 'saveStaff persisted u.billing=true for Sam');
  ok(!!R.auditEvent && R.auditEvent.before.billing === false && R.auditEvent.after.billing === true, `a real billing_changed Audit Trail event was written (got ${JSON.stringify(R.auditEvent)})`);
  ok(R.afterNavVisible, 'with Billing, Sam now sees the Reports nav item');
  ok(!R.afterBlockedHasReports, 'with Billing, _acBlockedViews(Sam) no longer blocks the reports route');
  ok(R.reportsRendersReal, 'with Billing, navigating to reports renders the real page, not Access Restricted');
  ok(R.samApprovesOther, 'with Billing, Sam approving someone else\'s (the admin\'s) entry works');
  ok(R.samSelfApproveRefused, 'A14: Sam approving her own entry is still refused, even with Billing');
  ok(/own/i.test(R.samSelfApproveToastText), `the self-approval refusal names the reason (got ${JSON.stringify(R.samSelfApproveToastText)})`);
  ok(!R.ownRowHasApprove, 'the Approve button is not rendered on Sam\'s own row in the real register');
  ok(R.otherRowHasApprove, 'the Approve button IS rendered on another staff member\'s row');
  ok(R.samInvoiceCreated, 'with Billing, pfiCreate succeeds for Sam');
  ok(R.adminApprovesSelf, 'admin behaviour is unchanged: an admin CAN approve their own timesheet entry');
  ok(R.canBill.adminNoFlag === true, '_canBill: any admin, regardless of the billing flag, is true');
  ok(R.canBill.staffNoFlag === false, '_canBill: plain staff with no billing flag is false');
  ok(R.canBill.staffWithFlag === true, '_canBill: staff with billing:true is true');
  ok(R.canBill.restrictedWithFlag === false, '_canBill: restricted with billing:true (should never happen, but) is still false');
  ok(R.canBill.clientWithFlag === false, '_canBill: client with billing:true (should never happen, but) is still false');
  ok(R.canBill.nullUser === false, '_canBill: no user at all is false');
  ok(errs.length === 0, `no console errors or unexpected native dialogs through the whole flow (got ${JSON.stringify(errs.slice(0, 10))})`);

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); console.log('\nPASS (0):\nFAIL (1):\n  - the suite crashed: ' + e.message); process.exit(1); });
