// Builds supabase/dev/combined-dev-setup.sql by concatenating the real source files, in the
// required dependency order, with clear section markers: `node .agents/_build-dev-setup.cjs`.
// Run again any time one of the six source files changes — never hand-edit the combined output.
// iso-migrations-test fails while the combined copy is stale. Reads and writes files only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + path.sep;
const FILES = [
  'supabase/dev/000_dev_bootstrap.sql',
  'supabase/migrations/009_iso_core.sql',
  'supabase/migrations/010_iso_evidence.sql',
  'supabase/migrations/014_iso_doc_prompts.sql',
  'supabase/migrations/015_iso_history.sql',
  'supabase/migrations/011_iso_reports.sql',
];
const today = new Date().toISOString().slice(0, 10);
// Hash with line endings normalised: git's autocrlf may check these files out as CRLF.
const sha = f => require('crypto').createHash('sha256').update(fs.readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
const header = `-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — combined dev-project setup (one paste instead of six)
--
-- GENERATED ${today} by concatenating the six files below, in the order a fresh Supabase dev
-- project needs them. This file is NOT a new migration and is NOT the source of truth — the
-- individual files under supabase/dev/ and supabase/migrations/ are. If any of those six files
-- changes later, regenerate this one with \`node .agents/_build-dev-setup.cjs\` rather than
-- hand-editing it here (iso-migrations-test fails while it is stale).
--
-- Run this ONCE, in full, in the SQL editor of a brand-new Supabase project created just for ISO
-- dev/verification (suggested name: taskhub-dev) — NEVER against the production project. Safe to
-- run more than once (every piece is IF NOT EXISTS / OR REPLACE).
--
-- After running it: work through "Done when" in docs/iso-audit/go-live-checklist.md §1 — the
-- check queries are inside this file too (search for "Check (read-only)"), one block per source
-- file, right after each one's own content.
--
-- Source files (sha256 of the LF-normalised text, first 16 hex chars, so you can tell if this has gone stale):
${FILES.map(f => `--   ${f.padEnd(42)} ${sha(f)}`).join('\n')}
-- ════════════════════════════════════════════════════════════════════════════

`;
const parts = FILES.map(f => {
  const body = fs.readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n');
  const rule = '-'.repeat(78);
  return `-- ${rule}\n-- SOURCE: ${f}\n-- ${rule}\n\n${body}`;
});
const out = header + parts.join('\n\n'); // LF, matching the source files
fs.writeFileSync(ROOT + 'supabase/dev/combined-dev-setup.sql', out);
console.log('written', Buffer.byteLength(out), 'bytes');
