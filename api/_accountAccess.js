// Switching a login on or off (audit C2, 2026-10-17). Leading underscore = shared module, not a Vercel route
// (the project is at its function limit, so account actions live inside set-password.js and invite-user.js).
//
// "Remove staff" used to delete the person from the app's own data only: their login and profile stayed, and
// the next sign-in made a fresh staff record for them. Now removing a person switches their login off:
//   1. the Supabase login is banned (no new sign-in, no refreshed session), and
//   2. profiles.active is false (every server check and, with migration 016, every database policy refuses it).
// Both steps are repeatable, so a failed attempt is simply tried again.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h'; // about 100 years: how Supabase switches a login off while keeping it

function _admin() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}
const _fail = (status, error) => Object.assign(new Error(error), { status });

async function readProfile(userId) {
  const { url, headers } = _admin();
  const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,active&limit=1`, { headers });
  if (!r.ok) throw _fail(500, 'Could not read the account.');
  return (await r.json())[0] || null;
}

async function _setProfileActive(userId, active) {
  const { url, headers } = _admin();
  const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ active }) });
  if (!r.ok) { console.error('[account-access] profile update failed:', r.status, (await r.text()).slice(0, 200)); return false; }
  return true;
}

async function _setBan(userId, banned) {
  const { url, headers } = _admin();
  const r = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', headers, body: JSON.stringify({ ban_duration: banned ? BAN_FOREVER : 'none' }) });
  if (!r.ok) { console.error('[account-access] ban update failed:', r.status, (await r.text()).slice(0, 200)); return false; }
  return true;
}

// → { status, body }. callerId is the admin asking (the endpoint has already checked they are an active admin).
// They cannot switch themselves off, which also means there is always at least one active admin left: the
// caller, whoever else is switched off.
async function setAccess({ userId, enabled, callerId }) {
  try {
    const profile = await readProfile(userId);
    if (!enabled && userId === callerId) return { status: 409, body: { error: 'You cannot remove your own access.' } };
    if (!enabled) {
      // Ban first: it is what stops a new session. The profile follows; either failing is reported so it is retried.
      if (!(await _setBan(userId, true))) return { status: 500, body: { error: 'Could not stop this login. Nothing was changed; try again.' } };
      if (profile && !(await _setProfileActive(userId, false))) return { status: 500, body: { error: 'The login was stopped, but the profile could not be marked inactive. Try again to finish.' } };
    } else {
      if (profile && !(await _setProfileActive(userId, true))) return { status: 500, body: { error: 'Could not switch this account back on. Try again.' } };
      if (!(await _setBan(userId, false))) return { status: 500, body: { error: 'The profile is active again, but the login could not be released. Try again to finish.' } };
    }
    return { status: 200, body: { ok: true } };
  } catch (e) {
    if (e && e.status) return { status: e.status, body: { error: e.message } };
    console.error('[account-access]', e && e.message);
    return { status: 500, body: { error: 'Could not change this account.' } };
  }
}

// An admin adding a person whose login already exists (typically someone removed earlier): switch it back on.
// A profile that is already active, or does not exist yet, is left alone. Returns true when it switched one on.
async function enableIfDisabled(userId) {
  const profile = await readProfile(userId);
  if (!profile || profile.active !== false) return false;
  if (!(await _setProfileActive(userId, true))) throw _fail(500, 'The account exists but could not be switched back on.');
  if (!(await _setBan(userId, false))) throw _fail(500, 'The account is active again, but its login could not be released.');
  return true;
}

module.exports = { UUID_RE, setAccess, enableIfDisabled, readProfile };
