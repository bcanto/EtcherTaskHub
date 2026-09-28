// GET /api/intake/pending — placeholder until email intake is deployed.
// The staff app polls this every 30 s for new emails for the Triage Zone. Locally, serve.mjs
// answers it from its own queue (fed by email-intake.mjs); in production nothing did, so every
// poll was a 404 in the console. Until the Microsoft Graph intake service exists here, answer
// "nothing pending". It returns no data, so it needs no caller check.
module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json([]);
};
