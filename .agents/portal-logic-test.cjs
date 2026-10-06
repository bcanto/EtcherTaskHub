// Offline unit tests for api/_portal.js — no browser, no network, no Supabase.
// Run: node .agents/portal-logic-test.cjs     (prints PASS (n): / FAIL (n): like the other suites)
const P = require('../api/_portal.js');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));
const clone = x => JSON.parse(JSON.stringify(x));

// ── Fixture: two clients, one staff roster, every kind of record the portal touches ─────
function fixture() {
  return {
    _savedAt: '2026-01-01T00:00:00.000Z',
    users: [
      { id: 'u1', name: 'Bruna', email: 'bruna@example.com', role: 'admin', active: true },
      { id: 'u2', name: 'Sam', email: 'sam@example.com', role: 'staff', active: true },
      { id: 'u9', name: 'Gone', email: 'gone@example.com', role: 'staff', active: false },
    ],
    clients: [
      { id: 'cA', name: 'Alpha', shortCode: 'ALP', color: '#111111', portalEnabled: true, loginEmail: 'a@alpha.test', supabaseUserId: 'uidA' },
      { id: 'cB', name: 'Beta', shortCode: 'BET', color: '#222222', portalEnabled: true, supabaseUserId: 'uidB' },
      { id: 'cC', name: 'Closed', portalEnabled: false },
    ],
    boards: [
      { id: 'bA', name: 'Alpha board', clientId: 'cA', color: '#aaaaaa', description: 'INTERNAL board note', nextRef: 7 },
      { id: 'bA2', name: 'Alpha archived', clientId: 'cA', archived: true },
      { id: 'bB', name: 'Beta board', clientId: 'cB' },
    ],
    groups: [
      { id: 'gA', boardId: 'bA', clientId: 'cA', name: 'Alpha group' },
      { id: 'gB', boardId: 'bB', clientId: 'cB', name: 'Beta group' },
    ],
    tasks: [
      { id: 'tA1', groupId: 'gA', boardId: 'bA', name: 'Alpha task', status: 'todo', ownerId: 'u1', currentlyWithType: 'client', currentlyWith: 'client', currentlyWithUserId: null,
        hourBudget: 40, description: '<p>Scope for the <b>client</b></p>', assigneeIds: ['u2'], tags: ['secret-tag'], percentComplete: 20, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'tA2', groupId: 'gA', name: 'Alpha with staff', status: 'in-progress', ownerId: 'u2', currentlyWithType: 'staff', currentlyWithUserId: 'u2' },
      { id: 'tA1s', parentTaskId: 'tA1', groupId: 'gA', name: 'Alpha subitem', status: 'todo' },
      { id: 'tAh', groupId: 'gA', name: 'Alpha hidden', clientHidden: true, status: 'todo', currentlyWithType: 'client' },
      { id: 'tAhs', parentTaskId: 'tAh', groupId: 'gA', name: 'Child of hidden', status: 'todo' },
      { id: 'tAarch', groupId: 'gA', name: 'Alpha archived', archived: true },
      { id: 'tB1', groupId: 'gB', name: 'BETA SECRET TASK', status: 'todo', ownerId: 'u1', currentlyWithType: 'client' },
      { id: 'tX', groupId: 'gA', clientId: 'cB', name: 'Explicitly Beta on Alpha group' },
    ],
    clientComments: [
      { id: 'cc1', taskId: 'tA1', authorId: 'u1', authorName: 'Bruna', authorRole: 'staff', body: 'hi' },
      { id: 'cc2', taskId: 'tB1', authorId: 'u1', authorName: 'Bruna', authorRole: 'staff', body: 'BETA COMMENT' },
    ],
    comments: [{ id: 'cm1', taskId: 'tA1', body: 'INTERNAL COMMENT' }],
    taskFiles: [
      { id: 'f1', taskId: 'tA1', name: 'shared.pdf', internalOnly: false },
      { id: 'f2', taskId: 'tA1', name: 'internal.pdf', internalOnly: true },
      { id: 'f3', taskId: 'tA1', name: 'legacy.pdf' },
      { id: 'f4', taskId: 'tB1', name: 'beta.pdf', internalOnly: false },
    ],
    actionRequests: [
      { id: 'ar1', taskId: 'tA1', clientId: 'cA', kind: 'review', title: 'Review it', body: 'please', status: 'open', askedByUserId: 'u1', askedByName: 'Bruna', returnToUserId: 'u2', createdAt: 'x', updatedAt: 'x' },
      { id: 'ar2', taskId: 'tB1', clientId: 'cB', kind: 'review', title: 'BETA ASK', status: 'open' },
    ],
    clientWorkRequests: [
      { id: 'wr1', clientId: 'cA', title: 'Alpha req', status: 'pending' },
      { id: 'wr2', clientId: 'cB', title: 'BETA REQ', status: 'pending' },
    ],
    notifications: [
      { id: 'n1', recipientId: 'uidA', message: 'for alpha', read: false },
      { id: 'n2', recipientId: 'uidB', message: 'BETA NOTE', read: false },
      { id: 'n3', recipientId: 'u1', message: 'staff note', read: false },
    ],
    timeEntries: [{ id: 'te1', taskId: 'tA1', hours: 5 }],
    earningsRates: [{ id: 'er1', rate: 99 }],
    proFormaInvoices: [{ id: 'pf1' }],
    clientNotes: [{ id: 'cn1', clientId: 'cA', sections: [{ content: 'PASSWORD: hunter2' }] }],
    auditLog: [],
    labelConfig: { statuses: {}, priorities: {} },
  };
}
let seq = 0;
const ctxFor = (clientId, userId) => ({ clientId, userId, userName: 'Client Person', now: '2026-09-24T10:00:00.000Z', rid: () => 'r' + (++seq) });

// ── Slice: what Alpha sees ───────────────────────────────────────────────────────────────
const s = P.sliceForClient(fixture(), 'cA', 'uidA');
const js = JSON.stringify(s);
const tids = s.tasks.map(t => t.id).sort();
ok(JSON.stringify(tids) === JSON.stringify(['tA1', 'tA1s', 'tA2']), 'slice has exactly Alpha’s visible tasks (got ' + tids + ')');
ok(!tids.includes('tAh') && !tids.includes('tAhs'), 'hidden task and its subitem are excluded');
ok(!tids.includes('tAarch'), 'archived task excluded');
ok(!tids.includes('tX'), 'a task explicitly assigned to Beta is excluded even though it sits in an Alpha group');
for (const leak of ['BETA', 'Beta board', 'INTERNAL', 'secret-tag', 'hunter2', 'PASSWORD', 'bruna@example.com', 'sam@example.com', 'a@alpha.test'])
  ok(!js.includes(leak), 'slice never contains "' + leak + '"');
ok(!js.includes('"hourBudget"') && !js.includes('"ownerId"') && !js.includes('"assigneeIds"') && !js.includes('"currentlyWithUserId"'), 'no hour budget / owner / assignees / holder ids');
ok(s.tasks.find(t => t.id === 'tA1').description === '<p>Scope for the <b>client</b></p>', 'task description is shown to the client');
ok(!js.includes('INTERNAL board note'), 'board description never sent');
{ const b = fixture(); b.tasks[0].clientDescriptionHidden = true;
  const hs = P.sliceForClient(b, 'cA', 'uidA'); const ht = hs.tasks.find(t => t.id === 'tA1');
  ok(ht && ht.description === null && !JSON.stringify(hs).includes('Scope for the'), 'description hidden when staff tick Hide description from client'); }
ok(s.tasks.find(t => t.id === 'tA2').description === undefined || s.tasks.find(t => t.id === 'tA2').description === null, 'no description → none sent');
ok(!('timeEntries' in s) && !('earningsRates' in s) && !('proFormaInvoices' in s) && !('clientNotes' in s) && !('comments' in s), 'no time entries, rates, invoices, client notes or internal comments');
ok(s.users.length === 0 && s.staff.length === 0, 'no staff roster');
ok(s.clients.length === 1 && s.clients[0].id === 'cA' && !('supabaseUserId' in s.clients[0]) && !('loginEmail' in s.clients[0]), 'only own client, without login fields');
ok(s.boards.map(b => b.id).join() === 'bA', 'only own non-archived boards');
ok(s.taskFiles.map(f => f.id).sort().join() === 'f1,f3', 'shared + legacy files only; internal and other-client files excluded');
ok(s.clientComments.length === 1 && !('authorId' in s.clientComments[0]), 'own comments only, staff author id stripped');
ok(s.actionRequests.length === 1 && s.actionRequests[0].id === 'ar1' && !('askedByUserId' in s.actionRequests[0]) && !('returnToUserId' in s.actionRequests[0]) && !('askedByName' in s.actionRequests[0]), 'own action requests only, staff fields stripped');
ok(s.clientWorkRequests.map(r => r.id).join() === 'wr1', 'own work requests only');
ok(s.notifications.map(n => n.id).join() === 'n1', 'own notifications only');
const tA1 = s.tasks.find(t => t.id === 'tA1');
ok(tA1.currentlyWithType === 'client' && tA1.awaitingClient === true && s.tasks.find(t => t.id === 'tA2').currentlyWithType === 'staff', 'holder reduced to client/staff');
ok(tA1.boardId === 'bA' && s.tasks.find(t => t.id === 'tA1s').boardId === 'bA' && s.tasks.find(t => t.id === 'tA1s').clientId === 'cA', 'board/client resolved onto subitems');
ok(P.sliceForClient(fixture(), 'cC', 'x') === null, 'portal-disabled client gets nothing');
ok(P.sliceForClient(fixture(), 'nope', 'x') === null, 'unknown client gets nothing');

// ── Actions ─────────────────────────────────────────────────────────────────────────────
function run(type, extra, clientId = 'cA', userId = 'uidA', prep) {
  const before = fixture(); if (prep) prep(before); const blob = clone(before);
  const r = P.applyPortalAction(blob, ctxFor(clientId, userId), { type, ...extra });
  const problems = r.ok ? P.checkConfined(before, blob, r.spec) : null;
  return { r, before, blob, problems };
}

// postComment
let t = run('postComment', { taskId: 'tA1', body: 'Hello' });
ok(t.r.ok && t.problems.length === 0, 'postComment: ok and confined (' + (t.problems || t.r.error) + ')');
ok(t.blob.clientComments.length === 3 && t.blob.clientComments[2].authorRole === 'client' && t.blob.clientComments[2].authorId === 'uidA', 'postComment: client comment appended');
ok(t.blob.notifications.slice(3).map(n => n.recipientId).join() === 'u1', 'postComment: owner notified');
ok(run('postComment', { taskId: 'tB1', body: 'x' }).r.error, 'postComment: cannot comment on another client’s task');
ok(run('postComment', { taskId: 'tAh', body: 'x' }).r.error, 'postComment: cannot comment on a hidden task');
ok(run('postComment', { taskId: 'tA1', body: '   ' }).r.error, 'postComment: empty rejected');

// markActionDone
t = run('markActionDone', { requestId: 'ar1', taskId: 'tA1', note: 'done!' });
ok(t.r.ok && t.problems.length === 0, 'markActionDone: ok and confined (' + (t.problems || t.r.error) + ')');
const ta = t.blob.tasks.find(x => x.id === 'tA1');
ok(ta.currentlyWithType === 'staff' && ta.currentlyWithUserId === 'u2' && ta.status === 'todo', 'markActionDone: With back to returnTo, status untouched');
ok(t.blob.actionRequests[0].status === 'done' && t.blob.actionRequests[0].responseNote === 'done!', 'markActionDone: request closed with note');
ok(t.r.emails.length === 1 && t.r.emails[0].to === 'sam@example.com', 'markActionDone: returnTo gets the email');
ok(run('markActionDone', { requestId: 'ar2', taskId: 'tB1' }).r.error, 'markActionDone: other client’s request refused');
ok(run('markActionDone', { requestId: 'ar1', taskId: 'tA2' }).r.error, 'markActionDone: request/task mismatch refused');
{ const b = fixture(); b.tasks[0].currentlyWithType = 'staff';
  ok(P.applyPortalAction(b, ctxFor('cA', 'uidA'), { type: 'markActionDone', requestId: 'ar1', taskId: 'tA1' }).error, 'markActionDone: refused once staff have the task back'); }
{ const b = fixture(); b.actionRequests[0].status = 'done';
  ok(P.applyPortalAction(b, ctxFor('cA', 'uidA'), { type: 'markActionDone', requestId: 'ar1', taskId: 'tA1' }).status === 409, 'markActionDone: closed request refused'); }

// addLink
t = run('addLink', { taskId: 'tA1', url: 'sharepoint.com/sites/x' });
ok(t.r.ok && t.problems.length === 0, 'addLink: ok and confined (' + (t.problems || t.r.error) + ')');
const lf = t.blob.taskFiles[t.blob.taskFiles.length - 1];
ok(lf.url === 'https://sharepoint.com/sites/x' && lf.internalOnly === false && lf.uploadedByClientId === 'cA' && lf.actionRequestId === 'ar1', 'addLink: normalised, shared, tagged to open request');
ok(run('addLink', { taskId: 'tA1', url: 'javascript:alert(1)' }).r.error, 'addLink: javascript: rejected');
ok(!/[\"<>]/.test(P.normalizeLinkUrl('x.com/" onmouseover="a" x="<b>')), 'addLink: quotes and angle brackets are encoded');
ok(run('addLink', { taskId: 'tA2', url: 'x.com' }).r.error, 'addLink: refused when task isn’t waiting on the client');

// uploadFile
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
t = run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-123-abc', name: 'plan.pdf', type: 'application/pdf', size: 13, data: PDF }] });
ok(t.r.ok && t.problems.length === 0, 'uploadFile: ok and confined (' + (t.problems || t.r.error) + ')');
{ const rec = t.blob.taskFiles.find(x => x.id === 'cf-123-abc');
  ok(rec && rec.storagePath === 'tasks/tA1/cf-123-abc' && rec.size === 13 && rec.uploadedByClientId === 'cA', 'uploadFile: record points at tasks/<task>/<file id> in storage, size from the real bytes');
  ok(t.r.uploads && t.r.uploads.length === 1 && t.r.uploads[0].path === rec.storagePath && Buffer.from(t.r.uploads[0].base64, 'base64').toString() === '%PDF-1.4 test', 'uploadFile: bytes handed to portal-action for storage');
  ok(!JSON.stringify(t.blob).includes(Buffer.from('%PDF-1.4 test').toString('base64')), 'uploadFile: the bytes are NOT stored in the company record');
  const sl = P.sliceForClient(t.blob, 'cA', 'uidA').taskFiles.find(x => x.id === 'cf-123-abc');
  ok(sl && sl.stored === true && !('storagePath' in sl), 'slice says the file is stored, never where'); }
ok(/could not be read/.test(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-9', name: 'a.pdf', type: 'application/pdf', size: 10 }] }).r.error || ''), 'uploadFile: a record without the file itself is refused');
ok(run('uploadFile', { taskId: 'tA1', files: [1, 2, 3, 4].map(i => ({ id: 'cf-' + i, name: i + '.pdf', type: 'application/pdf', size: 13, data: PDF })) }).r.error, 'uploadFile: more than 3 files per request refused');
ok(/1 MB/.test(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-b', name: 'b.pdf', type: 'application/pdf', size: 1, data: 'data:application/pdf;base64,' + 'A'.repeat(1500000) }] }).r.error || ''), 'uploadFile: size measured from the bytes, not the claimed size');
ok(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-h', name: 'h.pdf', type: 'application/pdf', size: 13, data: 'data:text/html;base64,PGI+' }] }).r.error, 'uploadFile: embedded html refused');
// Visibility of task files to the client
{ const b = fixture();
  b.taskFiles.push({ id: 'fs', taskId: 'tA1', name: 'staff-shared.pdf', internalOnly: false }, { id: 'fc', taskId: 'tA1', name: 'client-own.pdf', uploadedByClientId: 'cA', internalOnly: false });
  const ids = bb => P.sliceForClient(bb, 'cA', 'uidA').taskFiles.map(x => x.id).sort().join(',');
  ok(ids(b) === 'f1,f3,fc,fs', 'files: shared + legacy + own visible, Internal hidden (got ' + ids(b) + ')');
  b.tasks[0].clientAttachmentsHidden = true;
  ok(ids(b) === 'fc', 'files: Attachments switched off → only the client\'s own uploads (got ' + ids(b) + ')');
  ok(P.fileVisibleTo(b, 'cA', b.taskFiles.find(x => x.id === 'fc')) && !P.fileVisibleTo(b, 'cA', b.taskFiles.find(x => x.id === 'fs')), 'fileVisibleTo agrees (download endpoint check)');
  ok(!P.fileVisibleTo(b, 'cB', b.taskFiles.find(x => x.id === 'fc')) && !P.fileVisibleTo(b, 'cA', b.taskFiles.find(x => x.id === 'f4')), 'fileVisibleTo: never another client\'s file'); }
ok(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-1', name: 'x.svg', type: 'image/svg+xml', size: 10 }] }).r.error, 'uploadFile: svg rejected');
ok(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-1', name: 'big.pdf', type: 'application/pdf', size: 2000000, data: 'data:application/pdf;base64,' + 'A'.repeat(2800000) }] }).r.error, 'uploadFile: >1MB rejected');
ok(run('uploadFile', { taskId: 'tA1', files: [{ id: 'f1', name: 'a.pdf', type: 'application/pdf', size: 10 }] }).r.error, 'uploadFile: bad/foreign id rejected');

// approve
// The fixture's open request on tA1 is a "review" ask: that is answered with Mark done, so the
// approval actions are tested against an "approve" ask.
const asApprove = b => { b.actionRequests[0].kind = 'approve'; };
ok(/not waiting on your approval/.test(run('approve', { taskId: 'tA1' }).r.error || ''), 'approve: refused while the open ask is a review, not an approval');
ok(/Mark done/.test(run('requestChanges', { taskId: 'tA1', note: 'x' }).r.error || ''), 'requestChanges: refused while the open ask is a review');
ok(run('approve', { taskId: 'tA1' }, 'cA', 'uidA', b => { b.tasks[0].status = 'ready-approval'; }).r.ok, 'approve: a ready-approval task can be approved whatever the ask');
ok(run('approve', { taskId: 'tA1' }, 'cA', 'uidA', b => { b.actionRequests = b.actionRequests.filter(r => r.taskId !== 'tA1'); }).r.ok, 'approve: with no open ask, approval is allowed (legacy With → Client)');
t = run('approve', { taskId: 'tA1' }, 'cA', 'uidA', asApprove);
ok(t.r.ok && t.problems.length === 0, 'approve: ok and confined (' + (t.problems || t.r.error) + ')');
const tap = t.blob.tasks.find(x => x.id === 'tA1');
ok(tap.status === 'approved-client' && tap.clientApproval.status === 'approved' && tap.currentlyWithUserId === 'u1', 'approve: status, approval, With back to owner');
ok(t.blob.actionRequests[0].status === 'done', 'approve: closes the open request');
ok(run('approve', { taskId: 'tA2' }).r.error, 'approve: refused when not waiting on client');
ok(run('approve', { taskId: 'tB1' }).r.error, 'approve: other client’s task refused');
{ const b = fixture(); asApprove(b); b.tasks[0].approvalType = 'final'; P.applyPortalAction(b, ctxFor('cA', 'uidA'), { type: 'approve', taskId: 'tA1' });
  ok(b.tasks[0].status === 'completed-approved' && b.tasks[0].percentComplete === 100 && !!b.tasks[0].completedAt, 'approve: final delivery completes the task'); }

// requestChanges
t = run('requestChanges', { taskId: 'tA1', note: 'Fix section 2' }, 'cA', 'uidA', asApprove);
ok(t.r.ok && t.problems.length === 0, 'requestChanges: ok and confined (' + (t.problems || t.r.error) + ')');
const trc = t.blob.tasks.find(x => x.id === 'tA1');
ok(trc.status === 'change-requested' && trc.clientApproval.note === 'Fix section 2' && trc.currentlyWithUserId === 'u1', 'requestChanges: status, note, With back to owner');
ok(run('requestChanges', { taskId: 'tA1', note: '' }, 'cA', 'uidA', asApprove).r.error, 'requestChanges: empty note rejected');

// decline
t = run('decline', { taskId: 'tA1', note: 'Over budget this quarter' }, 'cA', 'uidA', asApprove);
ok(t.r.ok && t.problems.length === 0, 'decline: ok and confined (' + (t.problems || t.r.error) + ')');
{ const td = t.blob.tasks.find(x => x.id === 'tA1');
  ok(td.status === 'declined-client' && td.clientApproval.status === 'declined' && td.clientApproval.note === 'Over budget this quarter', 'decline: status and reason recorded');
  ok(td.currentlyWithType === 'staff' && td.currentlyWithUserId === 'u1' && td.awaitingClient === false, 'decline: With back to the owner');
  ok(td.percentComplete === 20 && !td.completedAt, 'decline: not treated as done');
  ok(t.blob.actionRequests[0].status === 'done', 'decline: closes the open request');
  ok(t.blob.notifications.some(n => n.type === 'client_declined' && n.recipientId === 'u1'), 'decline: owner notified');
  ok(t.blob.clientComments.some(c => c.taskId === 'tA1' && /Declined/.test(c.body) && /Over budget/.test(c.body)), 'decline: reason posted to client comms'); }
ok(/why/.test(run('decline', { taskId: 'tA1', note: '  ' }, 'cA', 'uidA', asApprove).r.error || ''), 'decline: a reason is required');
ok(run('decline', { taskId: 'tA1', note: 'x' }).r.error, 'decline: refused while the open ask is a review');
ok(run('decline', { taskId: 'tA2', note: 'x' }).r.error, 'decline: refused when not waiting on client');
ok(run('decline', { taskId: 'tB1', note: 'x' }).r.error, 'decline: other client’s task refused');
ok(run('decline', { taskId: 'tA1', note: 'x' }, 'cA', 'uidA', b => { asApprove(b); b.tasks[0].clientApproval = { status: 'approved' }; }).r.error, 'decline: refused once already approved');

// submitWorkRequest
t = run('submitWorkRequest', { title: 'New thing', description: 'd', priority: 'urgent', attachments: [{ name: 'a.txt', type: 'text/plain', size: 3, data: 'data:text/plain;base64,YWJj' }] });
ok(t.r.ok && t.problems.length === 0, 'submitWorkRequest: ok and confined (' + (t.problems || t.r.error) + ')');
const nwr = t.blob.clientWorkRequests[t.blob.clientWorkRequests.length - 1];
ok(nwr.clientId === 'cA' && nwr.priority === 'urgent' && nwr.status === 'pending', 'submitWorkRequest: always the caller’s own client');
ok(t.blob.notifications.slice(3).length === 2, 'submitWorkRequest: every active staff member notified (not the inactive one)');
ok(run('submitWorkRequest', { title: 'x', clientId: 'cB' }).blob.clientWorkRequests.slice(-1)[0].clientId === 'cA', 'submitWorkRequest: a clientId in the payload is ignored');
ok(run('submitWorkRequest', { title: 'x', attachments: [{ name: 'a.html', type: 'text/html', data: 'data:,x' }] }).r.error, 'submitWorkRequest: html attachment rejected');
{ const big = 'data:application/pdf;base64,' + 'A'.repeat(1300000);   // ~0.97 MB each
  const att = n => Array.from({ length: n }, (_, i) => ({ name: 'f' + i + '.pdf', type: 'application/pdf', size: 975000, data: big }));
  ok(run('submitWorkRequest', { title: 'x', attachments: att(3) }).r.ok, 'submitWorkRequest: three ~1 MB files fit');
  ok(/3 MB/.test(run('submitWorkRequest', { title: 'x', attachments: att(4) }).r.error || ''), 'submitWorkRequest: more than 3 MB in total refused (Vercel body limit is 4.5 MB)'); }

// ── Hardening (2026-09-25 audit): attachments, types, rate limits, storage caps ──
{ const wr = atts => run('submitWorkRequest', { title: 'x', attachments: atts }).r;
  const good = { name: 'a.pdf', type: 'application/pdf', size: 3, data: 'data:application/pdf;base64,QUJD' };
  ok(wr([good]).ok, 'attachment: a real FileReader data URL is accepted');
  ok(wr([{ ...good, data: 'data:,"><img src=x onerror=alert(1)>' }]).error, 'attachment: data URL with markup rejected (was stored raw into an href)');
  ok(wr([{ ...good, data: 'data:application/pdf;base64,QUJD" onmouseover="x' }]).error, 'attachment: quote after the base64 rejected');
  ok(wr([{ ...good, data: 'data:text/html;base64,PGI+' }]).error, 'attachment: embedded text/html rejected whatever type claims');
  ok(wr([{ ...good, data: 'data:image/svg+xml;base64,PGI+' }]).error, 'attachment: embedded svg rejected');
  ok(wr([{ ...good, data: 'javascript:alert(1)' }]).error, 'attachment: non-data URL rejected');
  ok(wr([{ ...good, type: 'TEXT/HTML' }]).error && wr([{ ...good, type: 'text/html;charset=utf-8' }]).error && wr([{ ...good, type: ['text/html'] }]).error, 'type check survives case, parameters and non-string types');
  ok(wr([{ ...good, name: 'a.html. ' }]).error && wr([{ ...good, name: 'b.xhtml' }]).error && wr([{ ...good, name: 'c.mhtml' }]).error, 'extension check: trailing dot/space, xhtml, mhtml');
  const stored = wr([good]); ok(stored.ok, 'accepted'); }
{ const t = run('submitWorkRequest', { title: 'x', attachments: [{ name: 'a.pdf', type: 'Application/PDF', size: 3, data: 'data:application/pdf;base64,QUJD' }] });
  ok(t.blob.clientWorkRequests.slice(-1)[0].attachments[0].type === 'application/pdf', 'stored type is normalised'); }
{ const t = run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-1', name: 'x.PDF', type: 'TEXT/HTML', size: 10 }] });
  ok(/not allowed/.test(t.r.error || ''), 'uploadFile: normalised type check too'); }
// Rate limit: 20 per minute per client login
{ const now = '2026-09-24T10:00:00.000Z', recentTs = '2026-09-24T09:59:30.000Z';
  const prep = n => b => { for (let i = 0; i < n; i++) b.clientComments.push({ id: 'rc' + i, taskId: 'tA1', authorId: 'uidA', authorRole: 'client', body: 'x', createdAt: recentTs }); };
  ok(run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidA', prep(19)).r.ok, 'rate: 20th action in a minute allowed');
  const r = run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidA', prep(20)).r;
  ok(r.error && r.status === 429, 'rate: 21st action in a minute refused (429)');
  ok(run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidB', prep(20)).r.ok, 'rate: counted per login — another login at the client is unaffected');
  ok(run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidA', b => { for (let i = 0; i < 30; i++) b.clientComments.push({ id: 'old' + i, taskId: 'tA1', authorId: 'uidA', authorRole: 'client', body: 'x', createdAt: '2026-09-24T09:50:00.000Z' }); }).r.ok, 'rate: older activity does not count');
  const d = run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidA', b => { for (let i = 0; i < 500; i++) b.clientComments.push({ id: 'd' + i, taskId: 'tA1', authorId: 'uidA', authorRole: 'client', body: 'x', createdAt: '2026-09-24T02:00:00.000Z' }); }).r;
  ok(d.error && d.status === 429 && /Daily/.test(d.error), 'rate: 500 a day refused');
  ok(run('markNotificationsRead', {}, 'cA', 'uidA', prep(25)).r.ok, 'rate: marking notifications read is never blocked'); }
// Work requests: open count and stored attachment caps
{ const openN = n => b => { for (let i = 0; i < n; i++) b.clientWorkRequests.push({ id: 'ow' + i, clientId: 'cA', title: 't', status: 'pending', submittedAt: '2026-09-01T00:00:00.000Z' }); };
  // the fixture already has one pending Alpha request (wr1)
  ok(run('submitWorkRequest', { title: 'x' }, 'cA', 'uidA', openN(8)).r.ok, 'work requests: 10th open request allowed');
  const r = run('submitWorkRequest', { title: 'x' }, 'cA', 'uidA', openN(9)).r;
  ok(r.error && r.status === 429, 'work requests: 11th open request refused');
  ok(run('submitWorkRequest', { title: 'x' }, 'cA', 'uidA', b => { openN(9)(b); b.clientWorkRequests.forEach(w => { if (w.id.startsWith('ow')) w.status = 'scoped'; }); }).r.ok, 'work requests: reviewed ones do not count as open');
  const big = 'data:application/pdf;base64,' + 'A'.repeat(4 * 1048576);
  const att = { name: 'n.pdf', type: 'application/pdf', size: 1, data: 'data:application/pdf;base64,' + 'A'.repeat(1300000) };
  const full = run('submitWorkRequest', { title: 'x', attachments: [att] }, 'cA', 'uidA', b => { b.clientWorkRequests.push({ id: 'h1', clientId: 'cA', status: 'pending', attachments: [{ name: 'a', data: big }, { name: 'b', data: big }] }); }).r;
  ok(full.error && full.status === 429, 'work requests: over ~6 MB of files across open requests refused');
  ok(run('submitWorkRequest', { title: 'no files' }, 'cA', 'uidA', b => { b.clientWorkRequests.push({ id: 'h1', clientId: 'cA', status: 'pending', attachments: [{ name: 'a', data: big }, { name: 'b', data: big }] }); }).r.ok, 'work requests: a request without files still goes through');
  const fat = run('submitWorkRequest', { title: 'x', attachments: [att] }, 'cA', 'uidA', b => { b.meetingNotes = [{ id: 'm', body: 'x'.repeat(10 * 1048576) }]; }).r;
  ok(fat.error && fat.status === 507, 'work requests: files refused once the company record is past 10 MB'); }

// removeFile: a client removes its own uploads, never Etcher's
{ const own = b => b.taskFiles.push({ id: 'cf-own', taskId: 'tA1', name: 'mine.pdf', storagePath: 'tasks/tA1/cf-own', uploadedByClientId: 'cA', internalOnly: false }, { id: 'cf-link', taskId: 'tA1', name: 'sp', type: 'link', url: 'https://x.sharepoint.com/a', uploadedByClientId: 'cA', internalOnly: false });
  let t = run('removeFile', { fileId: 'cf-own' }, 'cA', 'uidA', own);
  ok(t.r.ok && t.problems.length === 0, 'removeFile: ok and confined (' + (t.problems || t.r.error) + ')');
  ok(!t.blob.taskFiles.some(x => x.id === 'cf-own') && t.blob.taskFiles.length === t.before.taskFiles.length - 1, 'removeFile: only that record is gone');
  ok(JSON.stringify(t.r.removals) === JSON.stringify(['tasks/tA1/cf-own']), 'removeFile: its stored object is queued for deletion');
  ok(t.blob.notifications.some(n => /removed "mine.pdf"/.test(n.message)), 'removeFile: Etcher is told');
  ok((t.blob.deletedTaskFileIds || []).includes('cf-own'), 'removeFile: records a tombstone so staff browsers do not bring it back');
  t = run('removeFile', { fileId: 'cf-link' }, 'cA', 'uidA', own);
  ok(t.r.ok && t.r.removals.length === 0, 'removeFile: a client link can be removed too (nothing in storage)');
  ok(run('removeFile', { fileId: 'f1' }, 'cA', 'uidA', own).r.status === 404, 'removeFile: an Etcher file is refused');
  ok(run('removeFile', { fileId: 'cf-own' }, 'cB', 'uidB', own).r.status === 404, 'removeFile: another client cannot remove it');
  ok(run('removeFile', { fileId: 'nope' }).r.status === 404, 'removeFile: unknown id refused'); }
// Write guard: removal only of what was declared
{ const b = fixture(), a = clone(b); a.taskFiles = a.taskFiles.filter(x => x.id !== 'f1');
  ok(P.checkConfined(b, a, { remove: { taskFiles: ['f1'] } }).length === 0, 'guard: a declared removal passes');
  const a2 = clone(b); a2.taskFiles = a2.taskFiles.filter(x => x.id !== 'f1' && x.id !== 'f2');
  ok(P.checkConfined(b, a2, { remove: { taskFiles: ['f1'] } }).length > 0, 'guard: removing one more than declared is caught');
  const a3 = clone(b); a3.taskFiles = a3.taskFiles.filter(x => x.id !== 'f1'); a3.taskFiles[0].name = 'changed';
  ok(P.checkConfined(b, a3, { remove: { taskFiles: ['f1'] } }).length > 0, 'guard: changing a remaining item is caught');
  ok(P.checkConfined(b, clone(b), { remove: { taskFiles: ['f1'] } }).length > 0, 'guard: a declared removal that did not happen is caught'); }

// markNotificationsRead
t = run('markNotificationsRead', {});
ok(t.r.ok && t.problems.length === 0, 'markNotificationsRead: ok and confined (' + (t.problems || t.r.error) + ')');
ok(t.blob.notifications.find(n => n.id === 'n1').read === true && t.blob.notifications.find(n => n.id === 'n2').read === false && t.blob.notifications.find(n => n.id === 'n3').read === false, 'markNotificationsRead: only own notifications');

// misc
ok(run('postComment', { taskId: 'tA1', body: 'x' }, 'cC', 'x').r.status === 403, 'portal-disabled client cannot act');
ok(run('deleteEverything', {}).r.error, 'unknown action rejected');

// ── Share links ──────────────────────────────────────────────────────────────────────────
{ const b = fixture();
  b.tasks.filter(t => t.id === 'tAh' || t.id === 'tAhs').forEach(t => { t.boardId = 'bA'; });   // on the shared board
  b.shareLinks = [
    { id: 'sl1', token: 'aaaaaaaaaaaaaaaaaaaaaaaa', type: 'workboard', targetId: 'bA', revoked: false, createdBy: 'u1' },
    { id: 'sl2', token: 'bbbbbbbbbbbbbbbbbbbbbbbb', type: 'task', targetId: 'tA1', revoked: false },
    { id: 'sl3', token: 'cccccccccccccccccccccccc', type: 'workboard', targetId: 'bB', revoked: true },
  ];
  const bs = P.sliceForShare(b, 'aaaaaaaaaaaaaaaaaaaaaaaa'), bj = JSON.stringify(bs);
  ok(bs && bs.boards.length === 1 && bs.boards[0].id === 'bA', 'share(board): just that board');
  ok(bs.tasks.every(t => (t.boardId || t.workboardId) === 'bA'), 'share(board): only that board’s tasks');
  for (const leak of ['BETA', 'INTERNAL', 'secret-tag', 'hunter2', 'bruna@example.com', '"ownerId"', '"hourBudget"', '"createdBy"', '"description"'])
    ok(!bj.includes(leak), 'share(board) never contains ' + leak);
  ok(bs.users.length === 0 && bs.clients.length === 0, 'share(board): no staff, no clients');
  ok(!bj.includes('Alpha hidden') && !bj.includes('Child of hidden'), 'share(board): hidden-from-client tasks (and their children) left out');
  const ts = P.sliceForShare(b, 'bbbbbbbbbbbbbbbbbbbbbbbb');
  ok(ts.tasks.length === 1 && ts.tasks[0].description === '<p>Scope for the <b>client</b></p>' && ts.users.length === 1 && ts.users[0].name === 'Bruna' && !('email' in ts.users[0]), 'share(task): that task, its description and owner name (as staff chose to share), no email');
  ok(!JSON.stringify(ts).includes('Alpha subitem') && !JSON.stringify(ts).includes('"hourBudget"'), 'share(task): nothing beyond the one task');
  ok(P.sliceForShare(b, 'cccccccccccccccccccccccc') === null, 'share: revoked link refused');
  ok(P.sliceForShare(b, 'dddddddddddddddddddddddd') === null, 'share: unknown token refused');
  ok(P.sliceForShare(b, "aaaa' OR 1=1") === null && P.sliceForShare(b, '') === null, 'share: malformed token refused');
}

// ── Write guard: it must catch damage an action didn't declare ───────────────────────────
{ const b = fixture(), a = clone(b); a.tasks.pop();
  ok(P.checkConfined(b, a, { append: ['clientComments'] }).length > 0, 'guard: catches a removed task'); }
{ const b = fixture(), a = clone(b); a.timeEntries[0].hours = 99;
  ok(P.checkConfined(b, a, { modify: { tasks: ['tA1'] } }).length > 0, 'guard: catches an undeclared collection change'); }
{ const b = fixture(), a = clone(b); a.tasks[1].name = 'x';
  ok(P.checkConfined(b, a, { modify: { tasks: ['tA1'] } }).length > 0, 'guard: catches a change to an undeclared task'); }
{ const b = fixture(), a = clone(b); a.clientComments[0].body = 'edited';
  ok(P.checkConfined(b, a, { append: ['clientComments'] }).length > 0, 'guard: append collections cannot edit existing items'); }
{ const b = fixture(), a = clone(b); a._savedAt = 'new';
  ok(P.checkConfined(b, a, {}).length === 0, 'guard: _savedAt may change'); }

// ── 2026-09-26 audit: rate limit survives upload/remove loops; stale asks; orphan cleanup ──
{ const recentTs = i => new Date(Date.parse('2026-09-24T10:00:00.000Z') - 1000 - i * 1000).toISOString();
  // 20 actions whose records were removed again: only their notifications remain
  const prep = b => { for (let i = 0; i < 20; i++) b.notifications.push({ id: 'rl' + i, recipientId: 'u1', type: 'client_comment', message: 'x', read: false, createdAt: recentTs(i), byUserId: 'uidA' }); };
  const r = run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidA', prep).r;
  ok(r.status === 429, 'rate: actions count even after their records were removed (upload → remove loop)');
  ok(run('postComment', { taskId: 'tA1', body: 'hi' }, 'cA', 'uidB', prep).r.ok, 'rate: another login at the client is not affected');
  const t = run('postComment', { taskId: 'tA1', body: 'hi' });
  ok(t.blob.notifications.slice(-1)[0].byUserId === 'uidA', 'notifications from a portal action record who acted'); }
{ // a stale review ask left on a task staff took back must not block Approve
  const prep = b => { b.tasks[0].currentlyWithType = 'staff'; b.tasks[0].currentlyWithUserId = 'u1'; b.tasks[0].status = 'waiting-client'; };
  ok(run('approve', { taskId: 'tA1' }, 'cA', 'uidA', prep).r.ok, 'approve: a stale open ask on a task no longer with the client does not block it'); }

// portal-action handler with its I/O replaced: bytes uploaded for a write that never lands are deleted
(async () => {
  const path = require('path');
  const base = path.resolve(__dirname, '../api');
  const mock = (name, exp) => { const p = path.join(base, name); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; };
  const blob = fixture(); const put = [], removed = [];
  mock('_authAdmin.js', { requireClientCaller: async () => ({ id: 'uidA', name: 'Client Person', clientId: 'cA' }) });
  mock('_blob.js', { readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }), casWrite: async () => false });
  mock('_storage.js', { putObject: async p => { put.push(p); }, removeObjects: async ps => { removed.push(...ps); } });
  mock('_email.js', { sendNotificationEmail: async () => ({}) });
  delete require.cache[path.join(base, 'portal-action.js')];
  const handler = require('../api/portal-action.js');
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const PDF2 = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 orphan').toString('base64');
  await handler({ method: 'POST', body: { type: 'uploadFile', taskId: 'tA1', files: [{ id: 'cf-orph', name: 'a.pdf', type: 'application/pdf', size: 15, data: PDF2 }] } }, res);
  ok(res.code === 409 && put.length === 1, 'handler: the file is uploaded once even across retries (' + res.code + ', ' + put.length + ' uploads)');
  ok(removed.includes('tasks/tA1/cf-orph'), 'handler: when the record never lands, the uploaded bytes are deleted again');
  // and a successful write keeps them
  put.length = 0; removed.length = 0;
  mock('_blob.js', { readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }), casWrite: async () => true });
  delete require.cache[path.join(base, 'portal-action.js')];
  const handler2 = require('../api/portal-action.js');
  const res2 = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler2({ method: 'POST', body: { type: 'uploadFile', taskId: 'tA1', files: [{ id: 'cf-kept', name: 'b.pdf', type: 'application/pdf', size: 15, data: PDF2 }] } }, res2);
  ok(res2.code === 200 && put.length === 1 && removed.length === 0, 'handler: a saved upload keeps its bytes');
  // partial upload failure: the files that did upload are cleaned up
  put.length = 0; removed.length = 0;
  mock('_storage.js', { putObject: async p => { put.push(p); if (p.endsWith('cf-p2')) throw new Error('storage down'); }, removeObjects: async ps => { removed.push(...ps); } });
  mock('_blob.js', { readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }), casWrite: async () => true });
  delete require.cache[path.join(base, 'portal-action.js')];
  const h3 = require('../api/portal-action.js');
  const res3 = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await h3({ method: 'POST', body: { type: 'uploadFile', taskId: 'tA1', files: ['cf-p1', 'cf-p2'].map(id => ({ id, name: id + '.pdf', type: 'application/pdf', size: 15, data: PDF2 })) } }, res3);
  ok(res3.code === 500 && removed.includes('tasks/tA1/cf-p1') && removed.includes('tasks/tA1/cf-p2'), 'handler: when one of several uploads fails, the ones that went up are deleted too');
  // a save that errors after being sent may have landed: keep the bytes
  put.length = 0; removed.length = 0;
  mock('_storage.js', { putObject: async p => { put.push(p); }, removeObjects: async ps => { removed.push(...ps); } });
  mock('_blob.js', { readBlob: async () => ({ data: clone(blob), updatedAt: 'v1' }), casWrite: async () => { throw new Error('socket hang up'); } });
  delete require.cache[path.join(base, 'portal-action.js')];
  const h4 = require('../api/portal-action.js');
  const res4 = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await h4({ method: 'POST', body: { type: 'uploadFile', taskId: 'tA1', files: [{ id: 'cf-amb', name: 'c.pdf', type: 'application/pdf', size: 15, data: PDF2 }] } }, res4);
  ok(res4.code === 500 && removed.length === 0, 'handler: bytes are kept when the save may have landed (error after sending)');
  // duplicate ids inside one request
  ok(/Duplicate/.test(run('uploadFile', { taskId: 'tA1', files: [{ id: 'cf-d', name: 'a.pdf', type: 'application/pdf', size: 15, data: PDF2 }, { id: 'cf-d', name: 'b.pdf', type: 'application/pdf', size: 15, data: PDF2 }] }).r.error || ''), 'uploadFile: the same id twice in one request is refused');

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  console.log('ERRORS: none');
  process.exit(fail.length ? 1 : 0);
})();
