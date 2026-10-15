// Archiving an ISO board: the button sits in the board header, it asks first, and the board then waits in
// Archive & Bin, where an admin restores it. There is no hard delete (every iso_* table refuses DELETE).
const H = require('./_iso-harness.cjs');

H.run('iso-archive-test', 3174, async (t, srv) => {
  const A = srv.ADMIN, LEAD = H.STAFF('u2');
  const inList = async id => (await srv.must(A, { op: 'audit.list' })).some(a => a.id === id);

  // Server: listing archived boards and restoring one are admin-only.
  const b1 = await srv.board({ title: 'Archive me', members: [{ id: 'u2', auditRole: 'lead_auditor' }] });
  await srv.must(A, { op: 'audit.archive', auditId: b1.id });
  const listed = await srv.must(A, { op: 'audit.listArchived' });
  t.ok(listed.some(a => a.id === b1.id && a.archived_at), 'an archived board is listed for Archive & Bin');
  t.ok(!(await inList(b1.id)), 'an archived board is out of the ISO list');
  t.eq((await srv.call(LEAD, { op: 'audit.listArchived' })).status, 403, 'a Lead Auditor who is not an admin cannot list archived boards');
  t.eq((await srv.call(H.CLIENT('cu1', 'c1'), { op: 'audit.listArchived' })).status, 403, 'a client cannot list archived boards');
  t.eq((await srv.call(LEAD, { op: 'audit.restore', auditId: b1.id })).status, 403, 'a Lead Auditor who is not an admin cannot restore');
  await srv.must(A, { op: 'audit.restore', auditId: b1.id });
  t.ok(await inList(b1.id), 'a restored board is back in the ISO list');
  t.ok(!(await srv.must(A, { op: 'audit.listArchived' })).some(a => a.id === b1.id), 'a restored board leaves the archived list');
  t.eq((await srv.call(A, { op: 'audit.restore', auditId: b1.id })).status, 404, 'restoring a board that is not archived is refused');

  // UI: Archive is in the board header and asks first.
  const b2 = await srv.board({ title: 'Header archive' });
  const ui = await t.browser();
  await ui.openBoard(b2.id);
  t.ok(await ui.eval(() => !!document.querySelector('.iso-app-h .iso-archive-btn')), 'Archive is in the board header');
  const hs = await ui.shot('iso-archive-header');
  t.eq(hs.phone, 0, 'the board header with Archive fits a phone');
  await ui.tab('settings');
  t.ok(await ui.eval(() => ![...document.querySelectorAll('#view-container button')].some(b => b.textContent.trim() === 'Archive' && !b.closest('.iso-app-h'))), 'Settings no longer carries a second Archive button');
  await ui.eval(() => document.querySelector('.iso-app-h .iso-archive-btn').click()); await t.sleep(500);
  t.ok(await ui.eval(() => !document.getElementById('confirm-modal').classList.contains('hidden')), 'Archive asks for confirmation first');
  t.ok(await inList(b2.id), 'nothing is archived before the confirmation');
  await ui.eval(() => document.getElementById('confirm-ok-btn').click()); await t.sleep(1800);
  t.ok(!(await inList(b2.id)), 'confirming archives the board');

  // Archive & Bin lists it, with Restore and no Delete.
  await ui.eval(() => renderView('archive')); await t.sleep(1800);
  t.ok(await ui.eval(ref => { const c = document.getElementById('iso-archive-card'); return !!c && c.textContent.includes(ref); }, b2.ref), 'Archive & Bin lists the archived ISO board');
  t.ok(await ui.eval(() => ![...document.querySelectorAll('#iso-archive-card button')].some(b => /delete/i.test(b.textContent))), 'the ISO card offers no Delete');
  const sh = await ui.shot('iso-archive-bin');
  t.eq(sh.phone, 0, 'Archive & Bin with the ISO card fits a phone');
  await ui.eval(id => document.querySelector(`[data-iso-restore="${id}"]`).click(), b2.id); await t.sleep(1800);
  t.ok(await inList(b2.id), 'Restore in Archive & Bin brings the board back');
  t.ok(await ui.eval(ref => !document.getElementById('iso-archive-card').textContent.includes(ref), b2.ref), 'the restored board leaves the Archive & Bin card');
});
