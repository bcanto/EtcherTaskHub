// Audit M5 (2026-10-18): public.upsert_profile is recorded in migration 019 exactly as it is live, and only the server
// can run it (it is SECURITY DEFINER and checks nothing about who calls it). Static checks only: no server, no browser,
// no database.
const fs = require('fs'), path = require('path');
const H = require('./_static-offline.cjs');
const ROOT = H.ROOT;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (_) { return ''; } };

// ── the migration records the live function ──
const raw = read('supabase/migrations/019_upsert_profile_server_only.sql');
const sql = raw.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');   // comments out: the check lines are not grants
const fn = /CREATE OR REPLACE FUNCTION public\.upsert_profile\(([^)]*)\)([\s\S]*?)\$function\$([\s\S]*?)\$function\$/.exec(sql) || [];
ok(raw.length > 0 && !!fn[0], 'migration 019 records public.upsert_profile');
const args = (fn[1] || '').replace(/\s+/g, ' ').trim();
ok(args === 'p_id uuid, p_name text, p_email text, p_role text, p_display_color text, p_client_id text', 'with the same six arguments as the live function, so the server call is unchanged (' + (args || 'none') + ')');
const body = (fn[3] || '').replace(/\s+/g, ' ');
ok(/INSERT INTO public\.profiles \(id, name, email, role, display_color, client_id\) VALUES \(p_id, p_name, p_email, p_role::user_role, p_display_color, p_client_id\)/.test(body)
  && /ON CONFLICT \(id\) DO UPDATE SET name = EXCLUDED\.name, email = EXCLUDED\.email, role = EXCLUDED\.role, display_color = EXCLUDED\.display_color, client_id = EXCLUDED\.client_id;/.test(body),
  'and the same body as live: it saves the same six columns and updates the same five on a repeat');
const head = fn[2] || '';
ok(/RETURNS void/.test(head) && /SECURITY DEFINER/.test(head), 'still SECURITY DEFINER and returning nothing, as live');
ok(/SET search_path = public\b/.test(head), 'with a fixed search_path, like every other SECURITY DEFINER function in the migrations');

// ── only the server can run it ──
const SIG = 'public\\.upsert_profile\\(uuid, text, text, text, text, text\\)';
const revoke = new RegExp('REVOKE EXECUTE ON FUNCTION ' + SIG + ' FROM ([^;]+);').exec(sql);
const from = revoke ? revoke[1].split(',').map(s => s.trim().toLowerCase()) : [];
ok(['public', 'anon', 'authenticated'].every(r => from.includes(r)), 'the browser roles lose it: execute revoked from public, anon and authenticated (' + (from.join(', ') || 'no revoke') + ')');
ok(new RegExp('GRANT EXECUTE ON FUNCTION ' + SIG + ' TO service_role;').test(sql), 'the server keeps it: execute granted to service_role');
const grants = [...sql.matchAll(/GRANT [^;]*upsert_profile[^;]*;/gi)].map(m => m[0]);
ok(grants.length === 1 && /TO service_role;$/.test(grants[0]), 'and nothing grants it to anyone else (' + (grants.join(' | ') || 'no grant') + ')');
ok(!/\b(DROP|DELETE|TRUNCATE)\b/i.test(sql), 'the migration drops and deletes nothing');

// ── nothing in the app depends on the browser roles having it ──
const isoDir = path.join(ROOT, 'iso');
const browser = ['index.html', 'supabase-client.js', 'db-sync.js']
  .concat(fs.existsSync(isoDir) ? fs.readdirSync(isoDir).filter(f => f.endsWith('.js')).map(f => 'iso/' + f) : []);
const hits = browser.filter(f => /upsert_profile/.test(read(f)));
ok(browser.length >= 3 && hits.length === 0, 'the page never calls it, so taking it from the browser roles breaks nothing (' + browser.length + ' files checked' + (hits.length ? ', called in: ' + hits.join(', ') : '') + ')');
const inv = read('api/invite-user.js');
const hdr = /const adminHeaders = \{([\s\S]*?)\};/.exec(inv);
ok(!!hdr && /'apikey': SUPABASE_SERVICE_ROLE_KEY/.test(hdr[1]) && /'Authorization': `Bearer \$\{SUPABASE_SERVICE_ROLE_KEY\}`/.test(hdr[1]), 'its one caller, api/invite-user.js, signs with the service-role key');
ok(/rpc\/upsert_profile`, \{\s*method: 'POST',\s*headers: adminHeaders,/.test(inv), 'and sends those headers on the upsert_profile call');
const apiFiles = fs.readdirSync(path.join(ROOT, 'api'), { recursive: true }).map(String).filter(f => f.endsWith('.js'));
const apiHits = apiFiles.filter(f => /upsert_profile/.test(read(path.join('api', f))));
ok(apiHits.length === 1 && /invite-user\.js$/.test(apiHits[0].replace(/\\/g, '/')), 'no other server file calls it (' + (apiHits.join(', ') || 'none') + ')');

H.report('m5-upsert-profile-test', pass, fail);
