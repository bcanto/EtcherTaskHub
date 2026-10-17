// GET /api/intake/pending — placeholder until email intake is deployed.
// The staff app polls this every 30 s for new emails for the Triage Zone. Locally, serve.mjs answers it from its own
// queue (fed by email-intake.mjs). In production nothing did, so an earlier version of this file answered "[]" so the
// console stopped filling with 404s — but the app's own poller already has a circuit breaker that stops asking once
// it sees a 404 (the comment at startIntakePoller() in index.html), and answering 200 here defeated it: the app polled
// a permanently empty placeholder every 30 seconds forever (audit L6, 2026-10-17). Answering 404 instead, until the
// real service exists, lets that circuit breaker do its job: one failed poll, then none until the next full reload.
module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'Email intake is not set up yet.' });
};
