// The hostile-data seed shared by the injection suite and the audit probe. Self-contained: it runs in the page.
const SEED = () => {
  window.__xh = new Set(); window.__x = f => window.__xh.add(f);
  const P = f => `<img src=x onerror="__x('${f}:tag')">"><img src=x onerror=__x('${f}:attr')>');__x('${f}:js');//</textarea></select></title></script><img src=x onerror=__x('${f}:rc')>`;
  window.__P = P;
  const now = new Date().toISOString(), today = now.slice(0, 10);
  const TEXT = {
    users: ['name', 'initials', 'email'], clients: ['name', 'contactName', 'contactEmail', 'loginEmail', 'shortCode'], boards: ['name', 'description'], groups: ['name'],
    tasks: ['name', 'title', 'clientDescription'], timeEntries: ['note', 'earningsRateName', 'rejectionReason'], comments: ['body', 'authorName'], notifications: ['message', 'preview'],
    scheduleEvents: ['title', 'description', 'teamsLink'], digests: ['title', 'intro', 'closing'], earningsRates: ['name', 'xeroEarningsRateName'], boardViews: ['name'],
  };
  for (const [coll, keys] of Object.entries(TEXT)) (DB[coll] || []).forEach(rec => keys.forEach(k => { if (k in rec) rec[k] = P(coll + '.' + k); }));
  // The app aliases staff/users and boards/workboards to the same arrays; make sure both see the poison.
  DB.staff = DB.users; DB.workboards = DB.boards;
  const t = DB.tasks.find(x => (x.boardId || x.workboardId) === 'b1' && !x.parentTaskId), t2 = DB.tasks.find(x => (x.boardId || x.workboardId) === 'b1' && !x.parentTaskId && x.id !== t.id);
  DB.labelConfig = DB.labelConfig || { statuses: {}, priorities: {} };
  DB.labelConfig.statuses.cs_x1 = { label: P('labelConfig.status'), color: '#123456', bg: '#eeeeee', dot: '#123456' };
  DB.labelConfig.priorities.cp_x1 = { label: P('labelConfig.priority'), color: '#654321', bg: '#eeeeee' };
  if (t2) { t2.status = 'cs_x1'; t2.priority = 'cp_x1'; }
  t.ownerId = 'u2'; t.assigneeIds = ['u2', 'u3'];
  const CC = ['text', 'longtext', 'number', 'date', 'labels', 'people', 'status', 'priority', 'link', 'checkbox', 'progress', 'file'];
  DB.customColumns = CC.map((type, i) => ({ id: 'ccx_' + type, boardId: 'b1', name: P('customColumn.name.' + type), type, level: 'both', order: i, options: type === 'labels' ? [{ id: 'ox1', label: P('customColumn.option'), color: '#123456' }] : undefined }));
  DB.customColumnValues = [
    { id: 'cv1', taskId: t.id, columnId: 'ccx_text', value: P('cv.text') }, { id: 'cv2', taskId: t.id, columnId: 'ccx_longtext', value: P('cv.longtext') },
    { id: 'cv3', taskId: t.id, columnId: 'ccx_number', value: P('cv.number') }, { id: 'cv4', taskId: t.id, columnId: 'ccx_link', value: P('cv.link') },
    { id: 'cv5', taskId: t.id, columnId: 'ccx_people', value: 'u2' }, { id: 'cv6', taskId: t.id, columnId: 'ccx_labels', value: 'ox1' },
    { id: 'cv7', taskId: t.id, columnId: 'ccx_status', value: 'cs_x1' }, { id: 'cv8', taskId: t.id, columnId: 'ccx_priority', value: 'cp_x1' },
    { id: 'cv9', taskId: t.id, columnId: 'ccx_date', value: P('cv.date') }, { id: 'cv10', taskId: t.id, columnId: 'ccx_progress', value: P('cv.progress') },
  ];
  DB.checklistItems = [{ id: 'cl1', taskId: t.id, title: P('checklist.title'), text: P('checklist.text'), done: false, order: 0 }];
  DB.auditLog = [
    { id: 'ae1', entityType: 'Task', entityId: t.id, actorId: 'u2', action: 'updated:status', beforeValueJson: JSON.stringify({ label: P('audit.label'), displayValue: P('audit.old') }), afterValueJson: JSON.stringify({ label: P('audit.label2'), displayValue: P('audit.new') }), createdAt: now },
    { id: 'ae2', entityType: 'Task', entityId: t.id, actorId: 'u2', action: P('audit.action'), createdAt: now },
    { id: 'ae3', entityType: 'User', entityId: 'u2', actorId: 'u2', action: 'billing_changed', createdAt: now },
  ];
  DB.internalComms = [{ id: 'ic1', authorId: 'u2', body: P('comms.body'), attachments: [{ name: P('comms.file'), type: 'text/plain', data: 'data:text/plain;base64,eA==' }], timestamp: now }];
  DB.taskFiles = [{ id: 'tf1', taskId: t.id, name: P('taskFile.name'), size: 3, type: 'text/plain', url: '', addedAt: now, internalOnly: false }, { id: 'tf2', taskId: t.id, name: P('taskFile.link'), size: 0, type: 'link', url: 'https://example.test/', addedAt: now }];
  DB.boardShares = [{ id: 'bs1', boardId: 'b1', userId: 'u2' }];
  DB.personalChecklist = [{ id: 'pc1', userId: currentUser.id, name: P('personalChecklist.name'), done: false, order: 0 }];
  DB.wbFolders = [{ id: 'wbf1', name: P('wbFolder.name'), collapsed: false, order: 0, ownerId: currentUser.id }]; DB.boards.find(b => b.id === 'b2').folderId = 'wbf1';
  DB.shareLinks = [{ id: 'sl1', token: 'abcdefghij0123456789', type: 'task', targetId: t.id, label: P('shareLink.label'), createdAt: now, revoked: false }];
  DB.actionRequests = [{ id: 'ar1', taskId: t.id, clientId: 'c1', kind: 'review', title: P('actionRequest.title'), body: P('actionRequest.body'), status: 'open', createdAt: now, updatedAt: now }];
  DB.clientWorkRequests = [{ id: 'wr1', clientId: 'c1', title: P('workRequest.title'), description: P('workRequest.description'), status: 'pending', submittedAt: now, submittedBy: P('workRequest.by'), category: P('workRequest.category'), priority: 'med' }];
  DB.clientNotes = [{ id: 'cn1', clientId: 'c1', sections: [{ id: 'sec1', title: P('clientNote.title'), body: P('clientNote.body'), updatedAt: now }] }];
  DB.quotes = [{ id: 'q1', number: P('quote.number'), clientId: 'c1', title: P('quote.title'), recipientName: P('quote.recipientName'), recipientContact: P('quote.recipientContact'), recipientEmail: P('quote.recipientEmail'), date: today, expiryDate: '', status: 'draft', notes: P('quote.notes'), internalNotes: P('quote.internalNotes'), discountPct: 0, taxPct: 10, lineItems: [{ id: 'ql1', description: P('quote.line'), qty: 1, unitPrice: 10, taskId: null }], createdBy: 'u1', createdAt: now, updatedAt: now, auditEvents: [{ id: 'qa1', event: 'created', actorId: 'u2', at: now }] }];
  DB.proFormaInvoices = [{ id: 'pfi1', number: P('pfi.number'), clientId: 'c1', dateFrom: '', dateTo: '', issueDate: today, status: 'draft', preparedById: 'u1', notes: P('pfi.notes'), clientNotes: P('pfi.clientNotes'), lineItems: [{ id: 'pl1', description: P('pfi.line'), hours: 2, rate: 100, amount: 200, staffName: P('pfi.staff'), taskName: P('pfi.task') }], comments: [{ id: 'pc1', authorId: 'u2', authorName: P('pfi.commentAuthor'), body: P('pfi.comment'), createdAt: now }], auditEvents: [{ id: 'pa1', event: 'created', actorId: 'u2', at: now }], createdAt: now, createdByUserId: 'u1', updatedAt: now }];
  DB.errorLog = [{ id: 'ERR-X', at: now, view: 'x', type: 'x', message: P('errorLog.message') }];
  DB.digests = (DB.digests || []).map((d, i) => ({ ...d, status: i === 0 ? 'draft' : d.status, items: [{ id: 'di1', text: P('digest.item') }] }));
  DB.meetingNotes = [{ id: 'mn1', taskId: t.id, boardId: 'b1', title: P('meeting.title'), body: P('meeting.body'), kind: 'meeting', date: today, startTime: '09:00', endTime: '10:00', authorId: 'u2', createdAt: now, updatedAt: now, links: [{ taskId: t.id }], attendees: [] }];
  window.__probe = { t: t.id, t2: t2 && t2.id };
};

module.exports = { SEED };
