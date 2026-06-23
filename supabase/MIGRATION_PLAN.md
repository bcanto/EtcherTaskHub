# Etcher Task Hub — Backend Migration Plan

## Why This Migration Is Necessary

The current application has **zero real security**. Every access control check is client-side JavaScript.
Any user can open the browser console and:

```js
currentUser.role = 'admin';       // instant privilege escalation
DB.auditLog = [];                  // tamper with audit trail
DB.users[0].password = 'x';       // change any password
currentUser.clientId = 'c2';       // access another client's data
```

This is not fixable by writing more client-side code. A backend is required.

---

## Target Architecture

**Supabase** (managed PostgreSQL + Auth + Storage + Edge Functions)

| Layer | Current | Target |
|-------|---------|--------|
| Auth | localStorage comparison | Supabase Auth (JWT in httpOnly-equivalent) |
| Database | localStorage JSON blob | PostgreSQL with Row Level Security |
| File storage | base64 in localStorage | Supabase Storage (S3-compatible) |
| Access control | Client-side JS | PostgreSQL RLS policies (server-enforced) |
| Audit log | Mutable client JS array | Append-only PostgreSQL table |
| Secrets | Hardcoded in source | Environment variables + Supabase secrets |

---

## Migration Phases

### Phase 1 — Foundation (Do First) ✅ Partially Done

- [x] Create `.gitignore` with `.env`
- [x] Create `.env.example` with documented variable names
- [x] Write `001_initial_schema.sql` — all tables with constraints
- [x] Write `002_rls_policies.sql` — all RLS policies
- [x] Write `003_storage_policies.sql` — bucket setup + storage RLS
- [x] Harden `escHtml()` to escape quotes
- [x] Remove `<br>` injection patterns → use `white-space:pre-wrap`
- [ ] Set up Supabase project (https://app.supabase.com)
- [ ] Run migrations against Supabase project
- [ ] Configure storage buckets
- [ ] Add Supabase JS client to the app

### Phase 2 — Authentication

Replace the current `doLogin()` / localStorage session with Supabase Auth:

```js
// REPLACE THIS:
function doLogin(){
  const user = DB.users.find(u => u.email === email && u.password === pass);
  currentUser = user; // ← trivially bypassable
}

// WITH THIS:
async function doLogin(){
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { showLoginError(error.message); return; }
  // currentUser is now set from the server-verified JWT session
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  currentUser = profile; // role comes from the database, not the client
}
```

Steps:
- [ ] Install `@supabase/supabase-js`
- [ ] Create `supabase-client.js` with URL + anon key from `.env`
- [ ] Replace `doLogin()` with Supabase Auth
- [ ] Replace `doLogout()` with `supabase.auth.signOut()`
- [ ] Add `supabase.auth.onAuthStateChange()` handler
- [ ] Remove all localStorage-based session logic
- [ ] Remove hardcoded passwords from seed data
- [ ] Invite real users through Supabase Auth (email + magic link or set password)

### Phase 3 — Data Layer

Replace localStorage read/write with Supabase queries:

```js
// REPLACE THIS:
function saveDB(data){ localStorage.setItem('etcher_taskhub_v4', JSON.stringify(data)); }

// WITH THIS: (example for task status update)
async function wsCellSave(taskId, field, value){
  const { error } = await supabase
    .from('tasks')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) { showAlert('Save failed: ' + error.message); return; }
  // Optimistic update still works for UI
}
```

Priority order:
- [ ] Tasks (read, create, update, archive, delete)
- [ ] Comments (read, create, delete) with visibility enforcement
- [ ] Workboards + groups
- [ ] Notifications (real-time via Supabase Realtime)
- [ ] Time entries
- [ ] Files (upload to Storage, metadata to task_files)
- [ ] Client work requests
- [ ] Audit log (write via Edge Function or service role)

### Phase 4 — File Migration

Replace base64-in-localStorage with Supabase Storage:

```js
// REPLACE THIS:
_saveFileData(fid, e.target.result); // base64 in localStorage

// WITH THIS:
const filePath = `${clientId}/${boardId}/${taskId}/${fid}/${file.name}`;
const { error: uploadErr } = await supabase.storage
  .from('task-attachments')
  .upload(filePath, file, { contentType: file.type });

// Then save metadata to task_files:
await supabase.from('task_files').insert({
  task_id: taskId,
  storage_path: 'task-attachments/' + filePath,
  name: file.name,
  mime_type: file.type,
  size_bytes: file.size,
  internal_only: true,  // safe default
  uploaded_by: currentUser.id
});

// Downloads use signed URLs (expire after 1 hour):
const { data } = await supabase.storage
  .from('task-attachments')
  .createSignedUrl(filePath, 3600);
// data.signedUrl is the download link — never a permanent public URL
```

### Phase 5 — Client Portal Security

The client portal is currently all client-side trust. After migration:
- Client auth goes through Supabase Auth with `role: 'client'` in profiles
- All data fetched by clients goes through RLS — the DB enforces what they can see
- `sanitizeTaskForClient()` becomes a Supabase view or computed columns
- File downloads require signed URLs validated against RLS

### Phase 6 — Audit & Hardening

- [ ] Move audit log writes to Supabase Edge Functions (server-side, tamper-proof)
- [ ] Add login attempt logging (failed logins, IP, user agent)
- [ ] Add rate limiting on auth endpoints (Supabase supports this)
- [ ] Enable 2FA for admin accounts (Supabase Auth MFA)
- [ ] Set up Supabase alerts for suspicious patterns
- [ ] Remove all hardcoded demo credentials from source

---

## Security Findings — Current App (Immediate Risk)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | No server-side auth — login is localStorage comparison | CRITICAL | Requires Phase 2 |
| 2 | Plaintext passwords in localStorage and source code | CRITICAL | Requires Phase 2 |
| 3 | All RBAC is client-side JS — trivially bypassed | CRITICAL | Requires Phase 3 |
| 4 | Client portal data separation is client-side only | CRITICAL | Requires Phase 3+5 |
| 5 | Audit log is mutable by any user via console | HIGH | Requires Phase 6 |
| 6 | File data stored as base64 in localStorage | HIGH | Requires Phase 4 |
| 7 | `escHtml()` didn't escape quotes in attribute context | MEDIUM | ✅ Fixed |
| 8 | Multiline user content used `<br>` injection pattern | LOW | ✅ Fixed |
| 9 | `.env` not in `.gitignore` | HIGH | ✅ Fixed |
| 10 | No HTTPS enforcement | MEDIUM | Requires Phase 6 + hosting |

---

## Supabase Project Setup

1. Create project at https://app.supabase.com
2. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Settings → API
3. Copy `SUPABASE_SERVICE_ROLE_KEY` for server-side Edge Functions
4. Create `.env` from `.env.example` and fill in values
5. Run migrations:
   ```bash
   npx supabase db push
   # OR paste SQL files directly into Supabase SQL Editor
   ```
6. Create storage buckets (migration 003 handles policies, but bucket creation
   may need to happen via Dashboard → Storage first)
7. Enable Email auth in Supabase Dashboard → Authentication → Providers
8. Create first admin user via Supabase Dashboard → Authentication → Users
   then set role = 'admin' in profiles table

---

## Environment Variables Required

See `.env.example` for the full list. Minimum required:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server/edge functions only, never in browser)
