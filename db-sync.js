/**
 * db-sync.js — Supabase ↔ localStorage DB bridge
 *
 * Maps between the app's camelCase in-memory DB shape and Supabase's
 * snake_case table rows. Used for Phase 2 (auth) and Phase 3 (data layer).
 *
 * Design principles:
 * - fromSupabase*(row) → converts Supabase row to app format
 * - toSupabase*(obj)   → converts app object to Supabase row (for writes)
 * - fetchAllData(sb)   → loads all Supabase data and returns a DB-shaped object
 *                        (called once after login; result is merged into window.DB)
 * - syncUpsert(sb, table, rows, conflict) → bulk upsert to Supabase
 *
 * The app's rendering layer reads from window.DB — no changes needed there.
 * Writes still flow through saveDB(DB) and will call syncSaveTask / syncSaveBoard
 * etc. from the mutation site (Phase 3 step).
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSION: Supabase → App
// ═══════════════════════════════════════════════════════════════════════════

function _fromProfile(row) {
  return {
    id:                   row.id,
    name:                 row.name,
    email:                row.email,
    role:                 row.role,           // 'admin' | 'pm' | 'staff' | 'client'
    clientId:             row.client_id || null,
    displayColor:         row.display_color || '#64748b',
    color:                row.display_color || '#64748b',
    initials:             row.initials || (row.name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?',
    capacityHoursPerDay:  Number(row.capacity_hours_per_day) || 8,
    active:               row.active !== false,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
    // password not stored in Supabase profiles — auth handled by Supabase Auth
  };
}

function _fromClient(row) {
  return {
    id:             row.id,
    name:           row.name,
    shortCode:      row.short_code || '',
    color:          row.color || '#64748b',
    contactName:    row.contact_name || '',
    contactEmail:   row.contact_email || '',
    portalEnabled:  row.portal_enabled || false,
    archived:       row.archived || false,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

function _fromWorkboard(row) {
  return {
    id:           row.id,
    name:         row.name,
    description:  row.description || '',
    clientId:     row.client_id || null,
    ownerId:      row.owner_id,
    visibility:   row.visibility || 'all_internal',
    archived:     row.archived || false,
    color:        row.color || '#97bcbd',   // display_color stored in custom field or default
    order:        row.display_order || 0,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    // workboardId alias for compatibility
    get workboardId() { return this.id; },
  };
}

function _fromGroup(row) {
  return {
    id:         row.id,
    boardId:    row.board_id,
    workboardId:row.board_id,  // legacy alias
    clientId:   row.client_id || null,
    name:       row.name,
    color:      row.color || '#64748b',
    collapsed:  row.collapsed || false,
    order:      row.display_order || 0,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

function _fromTask(row) {
  // currently_with_type + currently_with_user_id → legacy currentlyWith field
  let currentlyWith = '';
  const cwType = row.currently_with_type || 'none';
  if (cwType === 'client')        currentlyWith = 'client';
  else if (cwType === 'approver') currentlyWith = 'approver';
  else if (cwType === 'staff')    currentlyWith = row.currently_with_user_id || '';

  return {
    id:                   row.id,
    boardId:              row.board_id,
    workboardId:          row.board_id,  // legacy alias
    groupId:              row.group_id || null,
    parentTaskId:         row.parent_task_id || null,
    clientId:             row.client_id || null,
    name:                 row.name,
    title:                row.name,      // legacy alias
    description:          row.description || '',
    clientDescription:    row.client_description || '',
    status:               row.status || 'todo',
    priority:             row.priority || 'med',
    ownerId:              row.owner_id || null,
    currentlyWithType:    cwType,
    currentlyWithUserId:  row.currently_with_user_id || null,
    currentlyWith:        currentlyWith,
    startDate:            row.start_date || null,
    endDate:              row.end_date || null,
    lockedDates:          row.locked_dates || false,
    percentComplete:      row.percent_complete || 0,
    percentMode:          row.percent_mode || 'manual',
    hourBudget:           Number(row.hour_budget) || 0,
    awaitingClient:       row.awaiting_client || false,
    tags:                 row.tags || [],
    archived:             row.archived || false,
    completedAt:          row.completed_at || null,
    order:                row.display_order || 0,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
    dependencies:         [],  // loaded separately from task_dependencies
  };
}

function _fromComment(row) {
  return {
    id:         row.id,
    taskId:     row.task_id,
    authorId:   row.author_id,
    body:       row.body,
    text:       row.body,     // legacy alias
    visibility: row.visibility || 'internal',
    edited:     row.edited || false,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

function _fromTimeEntry(row) {
  return {
    id:             row.id,
    taskId:         row.task_id,
    userId:         row.user_id,
    staffId:        row.user_id,  // legacy alias
    hours:          Number(row.hours),
    date:           row.date,
    note:           row.note || '',
    billable:       row.billable !== false,
    billingType:    row.billing_type || 'project',
    clientRate:     row.client_rate ? Number(row.client_rate) : null,
    status:         'approved',   // Supabase schema doesn't track this; default approved
    earningsRateId: 'er1',
    earningsRateName: 'Ordinary Hours',
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

function _fromTaskFile(row) {
  return {
    id:           row.id,
    taskId:       row.task_id,
    storagePath:  row.storage_path,
    name:         row.name,
    mimeType:     row.mime_type || '',
    sizeBytes:    row.size_bytes,
    internalOnly: row.internal_only !== false,
    uploadedBy:   row.uploaded_by,
    uploadedAt:   row.uploaded_at,
  };
}

function _fromScheduleEvent(row) {
  return {
    id:          row.id,
    userId:      row.user_id,
    title:       row.title,
    description: row.description || '',
    startDate:   row.start_date,
    endDate:     row.end_date || null,
    eventType:   row.event_type || 'event',
    createdAt:   row.created_at,
  };
}

function _fromWorkRequest(row) {
  return {
    id:            row.id,
    clientId:      row.client_id,
    submittedBy:   row.submitted_by,
    title:         row.title,
    description:   row.description || '',
    priority:      row.priority || 'med',
    status:        row.status || 'pending',
    linkedTaskId:  row.linked_task_id || null,
    linkedBoardId: row.linked_board_id || null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function _fromPersonalChecklistItem(row) {
  return {
    id:     row.id,
    userId: row.user_id,
    text:   row.text,
    done:   row.done || false,
    order:  row.display_order || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSION: App → Supabase (for writes)
// ═══════════════════════════════════════════════════════════════════════════

function _toSupabaseTask(t) {
  // Resolve currentlyWith* fields
  const cwType = t.currentlyWithType || 'none';
  let cwUserId = null;
  if (cwType === 'staff') cwUserId = t.currentlyWithUserId || null;

  return {
    id:                     t.id,
    board_id:               t.boardId || t.workboardId,
    group_id:               t.groupId || null,
    parent_task_id:         t.parentTaskId || null,
    client_id:              t.clientId || null,
    name:                   t.name || t.title,
    description:            t.description || null,
    client_description:     t.clientDescription || null,
    status:                 t.status || 'todo',
    priority:               t.priority || 'med',
    owner_id:               t.ownerId || null,
    currently_with_type:    cwType,
    currently_with_user_id: cwUserId,
    start_date:             t.startDate || null,
    end_date:               t.endDate || null,
    locked_dates:           t.lockedDates || false,
    percent_complete:       t.percentComplete || 0,
    percent_mode:           t.percentMode || 'manual',
    hour_budget:            t.hourBudget || 0,
    awaiting_client:        t.awaitingClient || false,
    tags:                   t.tags || [],
    archived:               t.archived || false,
    completed_at:           t.completedAt || null,
    display_order:          t.order || 0,
    updated_at:             new Date().toISOString(),
  };
}

function _toSupabaseWorkboard(b) {
  return {
    id:            b.id,
    name:          b.name,
    description:   b.description || null,
    client_id:     b.clientId || null,
    owner_id:      b.ownerId || null,
    visibility:    b.visibility || 'all_internal',
    archived:      b.archived || false,
    display_order: b.order || 0,
    updated_at:    new Date().toISOString(),
  };
}

function _toSupabaseGroup(g) {
  return {
    id:            g.id,
    board_id:      g.boardId || g.workboardId,
    client_id:     g.clientId || null,
    name:          g.name,
    color:         g.color || '#64748b',
    collapsed:     g.collapsed || false,
    display_order: g.order || 0,
    updated_at:    new Date().toISOString(),
  };
}

function _toSupabaseComment(c) {
  return {
    id:         c.id,
    task_id:    c.taskId,
    author_id:  c.authorId,
    body:       c.body || c.text,
    visibility: c.visibility || 'internal',
    edited:     c.edited || false,
    updated_at: new Date().toISOString(),
  };
}

function _toSupabaseTimeEntry(te) {
  return {
    id:           te.id,
    task_id:      te.taskId,
    user_id:      te.userId || te.staffId,
    hours:        te.hours,
    date:         te.date,
    note:         te.note || null,
    billable:     te.billable !== false,
    billing_type: te.billingType || 'project',
    client_rate:  te.clientRate || null,
    updated_at:   new Date().toISOString(),
  };
}

function _toSupabaseClient(c) {
  return {
    id:             c.id,
    name:           c.name,
    short_code:     c.shortCode || null,
    color:          c.color || '#64748b',
    contact_name:   c.contactName || null,
    contact_email:  c.contactEmail || null,
    portal_enabled: c.portalEnabled || false,
    archived:       c.archived || false,
    updated_at:     new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH ALL — populates a full DB-shaped object from Supabase
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetches all data accessible to the current Supabase user and returns
 * an object shaped like the app's DB (for merging into window.DB).
 *
 * RLS ensures each user only gets data they are allowed to see.
 * Call this once per login; subsequent writes use per-table sync functions.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @returns {Promise<object>} partial DB object
 */
async function fetchAllData(sb) {
  const results = await Promise.allSettled([
    sb.from('profiles').select('*'),
    sb.from('clients').select('*').eq('archived', false),
    sb.from('workboards').select('*').eq('archived', false),
    sb.from('groups').select('*'),
    sb.from('tasks').select('*').eq('archived', false),
    sb.from('comments').select('*'),
    sb.from('time_entries').select('*'),
    sb.from('task_files').select('id,task_id,storage_path,name,mime_type,size_bytes,internal_only,uploaded_by,uploaded_at'),
    sb.from('schedule_events').select('*'),
    sb.from('client_work_requests').select('*'),
    sb.from('personal_checklist').select('*'),
    sb.from('task_dependencies').select('*'),
    sb.from('board_shares').select('*'),
  ]);

  function _ok(result) {
    if (result.status === 'rejected') return [];
    if (result.value.error) { console.warn('[db-sync] fetch error:', result.value.error.message); return []; }
    return result.value.data || [];
  }

  const [
    profilesRaw, clientsRaw, boardsRaw, groupsRaw, tasksRaw,
    commentsRaw, timeEntriesRaw, taskFilesRaw, scheduleRaw,
    workRequestsRaw, checklistRaw, depsRaw, sharesRaw,
  ] = results.map(_ok);

  const users = profilesRaw.map(_fromProfile);

  // Build dependency list per task
  const depsByTask = {};
  depsRaw.forEach(d => {
    if (!depsByTask[d.dependent_task_id]) depsByTask[d.dependent_task_id] = [];
    depsByTask[d.dependent_task_id].push(d.predecessor_task_id);
  });

  const tasks = tasksRaw.map(row => {
    const t = _fromTask(row);
    t.dependencies = depsByTask[t.id] || [];
    return t;
  });

  return {
    users,
    staff:          users,                           // legacy alias
    clients:        clientsRaw.map(_fromClient),
    boards:         boardsRaw.map(_fromWorkboard),
    workboards:     boardsRaw.map(_fromWorkboard),   // legacy alias
    groups:         groupsRaw.map(_fromGroup),
    tasks,
    comments:       commentsRaw.map(_fromComment),
    timeEntries:    timeEntriesRaw.map(_fromTimeEntry),
    taskFiles:      taskFilesRaw.map(_fromTaskFile),
    scheduleEvents: scheduleRaw.map(_fromScheduleEvent),
    clientWorkRequests: workRequestsRaw.map(_fromWorkRequest),
    personalChecklist:  checklistRaw.map(_fromPersonalChecklistItem),
    dependencies:   depsRaw.map(d => ({
      id:              d.id,
      predecessorId:   d.predecessor_task_id,
      dependentId:     d.dependent_task_id,
      lagDays:         d.lag_days || 0,
    })),
    boardShares: sharesRaw.map(s => ({
      boardId:    s.board_id,
      userId:     s.user_id,
      grantedAt:  s.granted_at,
    })),
    // These are not in Supabase schema — keep whatever's in localStorage
    // earningsRates, internalComms, wbComms, auditLog, errorLog, migrationFlags
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INDIVIDUAL SYNC — called when specific records change
// ═══════════════════════════════════════════════════════════════════════════

async function syncUpsertTask(sb, task) {
  const { error } = await sb.from('tasks').upsert(_toSupabaseTask(task), { onConflict: 'id' });
  if (error) console.error('[db-sync] task upsert:', error.message, task.id);
  return !error;
}

async function syncUpsertWorkboard(sb, board) {
  const { error } = await sb.from('workboards').upsert(_toSupabaseWorkboard(board), { onConflict: 'id' });
  if (error) console.error('[db-sync] workboard upsert:', error.message, board.id);
  return !error;
}

async function syncUpsertGroup(sb, group) {
  const { error } = await sb.from('groups').upsert(_toSupabaseGroup(group), { onConflict: 'id' });
  if (error) console.error('[db-sync] group upsert:', error.message, group.id);
  return !error;
}

async function syncUpsertComment(sb, comment) {
  const { error } = await sb.from('comments').upsert(_toSupabaseComment(comment), { onConflict: 'id' });
  if (error) console.error('[db-sync] comment upsert:', error.message, comment.id);
  return !error;
}

async function syncUpsertTimeEntry(sb, entry) {
  const { error } = await sb.from('time_entries').upsert(_toSupabaseTimeEntry(entry), { onConflict: 'id' });
  if (error) console.error('[db-sync] time_entry upsert:', error.message, entry.id);
  return !error;
}

async function syncUpsertClient(sb, client) {
  const { error } = await sb.from('clients').upsert(_toSupabaseClient(client), { onConflict: 'id' });
  if (error) console.error('[db-sync] client upsert:', error.message, client.id);
  return !error;
}

async function syncDeleteTask(sb, taskId) {
  const { error } = await sb.from('tasks').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', taskId);
  if (error) console.error('[db-sync] task archive:', error.message, taskId);
  return !error;
}

async function syncDeleteWorkboard(sb, boardId) {
  const { error } = await sb.from('workboards').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', boardId);
  if (error) console.error('[db-sync] workboard archive:', error.message, boardId);
  return !error;
}

// ── Export on window so index.html can call these ─────────────────────────
window._dbSync = {
  fetchAllData,
  syncUpsertTask,
  syncUpsertWorkboard,
  syncUpsertGroup,
  syncUpsertComment,
  syncUpsertTimeEntry,
  syncUpsertClient,
  syncDeleteTask,
  syncDeleteWorkboard,
  // Conversion helpers — useful for one-off data migration scripts
  _toSupabaseTask,
  _toSupabaseWorkboard,
  _toSupabaseGroup,
  _toSupabaseComment,
  _toSupabaseTimeEntry,
  _toSupabaseClient,
};
