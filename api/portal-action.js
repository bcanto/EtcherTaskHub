// POST /api/portal-action — the client portal's ONLY way to change data.
// Body: { type, ...fields } — one of the actions in api/_portal.js applyPortalAction.
//
// Flow per request: read blob → apply the action to a copy → prove the change is confined to
// what the action declared (checkConfined) → compare-and-swap write → send any emails →
// return the caller's refreshed slice. A lost CAS race re-reads and re-applies on the fresh
// data, so a staff save in between is never overwritten.
const crypto = require('crypto');
const { requireClientCaller } = require('./_authAdmin');
const { readBlob, casWrite } = require('./_blob');
const { sliceForClient, applyPortalAction, checkConfined } = require('./_portal');
const { sendNotificationEmail } = require('./_email');
const { putObject, removeObjects } = require('./_storage');

const rid = () => crypto.randomBytes(6).toString('hex').slice(0, 8);
const sameIgnoringSavedAt = (a, b) => {
  const x = { ...a, _savedAt: null }, y = { ...b, _savedAt: null };
  return JSON.stringify(x) === JSON.stringify(y);
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const caller = await requireClientCaller(req, res);
  if (!caller) return;
  const action = req.body && typeof req.body === 'object' ? req.body : null;
  if (!action || typeof action.type !== 'string') return res.status(400).json({ error: 'Missing action.' });

  try {
    let stored = false;   // uploaded paths are deterministic (tasks/<task>/<file id>): upload once
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, updatedAt } = await readBlob();
      const before = JSON.parse(JSON.stringify(data));
      const after = JSON.parse(JSON.stringify(data));
      const now = new Date().toISOString();
      const result = applyPortalAction(after, { clientId: caller.clientId, userId: caller.id, userName: caller.name, now, rid }, action);
      if (result.error) return res.status(result.status || 400).json({ error: result.error });

      const problems = checkConfined(before, after, result.spec);
      if (problems.length) {
        console.error('[portal-action] refused unconfined write', action.type, problems);
        return res.status(500).json({ error: 'That change could not be saved safely. Please contact Etcher.' });
      }
      if (sameIgnoringSavedAt(before, after)) {
        return res.status(200).json({ ok: true, slice: sliceForClient(after, caller.clientId, caller.id) });
      }
      // Bytes first, so a file record never points at nothing. If the write below loses the
      // race, the retry re-applies with the same ids and the objects are already there.
      if (!stored && result.uploads && result.uploads.length) {
        await Promise.all(result.uploads.map(u => putObject(u.path, Buffer.from(u.base64, 'base64'), u.type)));
        stored = true;
      }
      after._savedAt = now;
      if (await casWrite(after, updatedAt)) {
        await Promise.allSettled((result.emails || []).map(e => sendNotificationEmail(e)));
        if (result.removals && result.removals.length) await removeObjects(result.removals);   // after the record is gone
        return res.status(200).json({ ok: true, slice: sliceForClient(after, caller.clientId, caller.id) });
      }
      await new Promise(r => setTimeout(r, 80 * (attempt + 1)));   // someone saved first — retry on their data
    }
    return res.status(409).json({ error: 'Etcher is saving changes right now — please try again in a moment.' });
  } catch (e) {
    console.error('[portal-action]', e.message);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
};
