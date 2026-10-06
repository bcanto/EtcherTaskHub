// Phase 8.2 acceptance: evidence file upload, end to end, on a fresh offline temp server. Links stay
// the default (D18); a file is the exception — reserved by the server (which picks the evidence id
// and storage path), sent once (offline: evidence.offlinePut), checked by evidence.register before
// any record exists, read back only through evidence.downloadUrl, and previewed in-page through
// index.html's shared _previewFileData viewer. An upload never changes an assessment or a verdict:
// "Not reviewed" and document status Draft (D20, D22). Section D covers 8c.5: uploading a generated
// document from the Suggested documents card, with its document status, owner, approver and date.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const PORT = 3142;
const pass = [], fail = [];
const ok = (c, m) => (c ? pass.push(m) : fail.push(m));

function waitForServer(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.ok ? resolve() : retry(n)).catch(() => retry(n));
    const retry = n => n <= 0 ? reject(new Error('server did not come up')) : setTimeout(() => attempt(n - 1), 100);
    attempt(tries);
  });
}
async function callIso(user, body) {
  const headers = { 'Content-Type': 'application/json', 'X-ISO-Offline-User': encodeURIComponent(JSON.stringify(user)) };
  const r = await fetch(`http://127.0.0.1:${PORT}/api/iso`, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, body: json };
}
const ADMIN = { id: 'u1', role: 'admin' };
const STAFF2 = { id: 'u2', role: 'staff' };   // implicit contributor on all-internal boards
const STAFF3 = { id: 'u3', role: 'staff' };
const CLIENT1 = { id: 'cu1', role: 'client', clientId: 'c1' };
const data = res => res.body && res.body.data;
const errText = res => (res.body && (res.body.error || res.body.message)) || '';
// A small but real PDF, and a 1×1 PNG.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-82-'));
  const proc = spawn(process.execPath, ['serve.mjs', '--offline', '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, ISO_OFFLINE_DIR: tmpDir }, stdio: 'pipe' });
  let browser = null;
  try {
    await waitForServer(PORT);
    await callIso(ADMIN, { op: 'config.get' });
    process.env.ISO_OFFLINE_DIR = tmpDir;
    const db = require(path.join(ROOT, 'api', '_isoDbOffline.js'));
    const filesDir = path.join(tmpDir, 'files');
    await callIso(ADMIN, { op: 'library.loadSeed' });
    const board = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c1', standards: ['9001'], title: '8.2 board' }));
    const boardC2 = data(await callIso(ADMIN, { op: 'audit.create', clientId: 'c2', standards: ['9001'], title: 'Other client board' }));
    const reqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const [R, R2] = reqs;
    ok(board && boardC2 && R && R2, 'two boards (clients c1 and c2) on the seeded library');
    const ASSESS = ['assessment_state', 'assessment_result', 'applicability', 'effectiveness', 'risk_severity', 'row_version'];
    const snap = async () => JSON.stringify((data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).filter(r => [R.id, R2.id].includes(r.id)).map(r => ASSESS.map(k => r[k])));
    const before = await snap();
    const reserve = (user, extra) => callIso(user, Object.assign({ op: 'evidence.uploadUrl', auditId: board.id, targetType: 'requirement', targetId: R.id, filename: 'Procedure.pdf', size: PDF.length, mime: 'application/pdf' }, extra || {}));
    const put = (user, evidenceId, bytes) => callIso(user, { op: 'evidence.offlinePut', auditId: board.id, evidenceId, dataBase64: bytes.toString('base64') });
    const register = (user, evidenceId) => callIso(user, { op: 'evidence.register', auditId: board.id, evidenceId });
    const reservation = async evidenceId => (await db.list('iso_evidence_uploads', {})).find(r => r.evidence_id === evidenceId);

    // ── A. The round trip ────────────────────────────────────────────────────────────────────
    const res1 = await reserve(ADMIN, { title: 'Document control procedure', versionLabel: '2', role: 'supporting', relevanceNote: 'Covers approval and issue' });
    const u1 = data(res1);
    ok(res1.status === 200 && u1.offline === true && u1.signedUrl === null && /^ievi_/.test(u1.evidenceId) && u1.maxBytes === 4 * 1024 * 1024, `uploadUrl reserves an evidence id; offline there is no signed URL and the cap is 4 MB (got ${res1.status} ${JSON.stringify(u1 || res1.body)})`);
    const r1 = await reservation(u1.evidenceId);
    ok(r1 && r1.storage_path === `c1/${board.id}/${u1.evidenceId}/${r1.storage_path.split('/').pop()}` && /^[0-9a-f]{16}\.pdf$/.test(r1.storage_path.split('/').pop()) && r1.original_filename === 'Procedure.pdf', `the server chose the path <client>/<audit>/<evidence>/<random16>.<ext>; the filename lives only in original_filename (got ${r1 && r1.storage_path})`);
    ok(r1 && Math.abs(new Date(r1.expires_at) - Date.now() - 2 * 3600e3) < 60e3 && r1.reserved_by === 'offline:u1', 'the reservation is the caller\'s and expires in 2 hours');
    const p1 = await put(ADMIN, u1.evidenceId, PDF);
    ok(p1.status === 200 && data(p1).received === PDF.length, 'offlinePut takes the bytes (base64 through /api/iso)');
    const stored = fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : [];
    const blobName = stored.find(n => n.includes(u1.evidenceId) && !n.endsWith('.type'));
    ok(blobName && !/\.[a-z0-9]+$/i.test(blobName) && !/Procedure/.test(blobName), `offline, the bytes sit under .iso-offline/files/ with no extension and never the client's filename (got ${JSON.stringify(stored)})`);
    ok(blobName && fs.readFileSync(path.join(filesDir, blobName + '.type'), 'utf8') === 'application/pdf', 'with the sent type kept beside them (standing in for Storage\'s object metadata)');
    ok((await put(ADMIN, u1.evidenceId, PDF)).status === 400, 'the bytes can be sent only once (no upsert)');
    const reg1 = await register(ADMIN, u1.evidenceId);
    const ev1 = data(reg1) && data(reg1).evidence, link1 = data(reg1) && data(reg1).link;
    ok(reg1.status === 200 && ev1.id === u1.evidenceId && ev1.kind === 'file' && ev1.has_file === true && !('storage_path' in ev1), `register creates the record — kind file, and the response never carries the storage path (got ${reg1.status} ${JSON.stringify(ev1 && Object.keys(ev1))})`);
    ok(ev1.original_filename === 'Procedure.pdf' && Number(ev1.size_bytes) === PDF.length && ev1.mime === 'application/pdf' && ev1.title === 'Document control procedure' && ev1.version_label === '2', 'with the real size, type, filename, title and revision');
    ok(ev1.document_status === 'draft', 'its document status is Draft (D22) — an upload never implies approval');
    ok(link1.review_status === 'submitted' && link1.role === 'supporting' && link1.relevance_note === 'Covers approval and issue', 'and it is linked "Not reviewed" (D20), with the chosen role and note');
    ok((await reservation(u1.evidenceId)).close_reason === 'registered' && (await register(ADMIN, u1.evidenceId)).status === 400, 'the reservation is closed — registering twice is refused');
    const listed = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: R.id })) || []).find(x => x.id === ev1.id);
    ok(listed && listed.hasFile && listed.originalFilename === 'Procedure.pdf' && listed.sizeBytes === PDF.length && listed.documentStatus === 'draft' && listed.reviewStatus === 'submitted' && !('storagePath' in listed) && !('storage_path' in listed), 'evidence.list shows the file\'s name, size and status — not its storage path');
    const dl = data(await callIso(ADMIN, { op: 'evidence.downloadUrl', auditId: board.id, evidenceId: ev1.id }));
    ok(dl && Buffer.from(dl.dataBase64, 'base64').equals(PDF) && dl.filename === 'Procedure.pdf' && dl.mime === 'application/pdf', 'downloadUrl gives back exactly the uploaded bytes, under the original filename');
    const dlPath = data(await callIso(ADMIN, { op: 'evidence.downloadUrl', auditId: board.id, evidenceId: ev1.id, path: '../../../.env', storagePath: 'c2/x/y/z.pdf' }));
    ok(dlPath && Buffer.from(dlPath.dataBase64, 'base64').equals(PDF), 'it never takes a path from the caller — extra path fields are ignored');
    const acts = (await db.list('iso_activity', {})).filter(a => a.audit_id === board.id);
    ok(acts.some(a => a.action === 'evidence_uploaded' && a.entity_id === ev1.id) && acts.some(a => a.action === 'evidence_linked' && a.entity_id === R.id && a.after && a.after.evidenceId === ev1.id) && acts.filter(a => a.action === 'evidence_downloaded' && a.entity_id === ev1.id).length === 2, 'uploaded, linked and each download are logged');
    const png = data(await reserve(ADMIN, { filename: 'Site photo.png', size: PNG.length, mime: 'image/png', targetId: R2.id }));
    await put(ADMIN, png.evidenceId, PNG);
    const evPng = data(await register(ADMIN, png.evidenceId)).evidence;
    ok(evPng.kind === 'photo' && evPng.title === 'Site photo', 'an image is stored as a photo; with no title given, the file name (less its extension) is the title');
    const noMime = data(await reserve(ADMIN, { filename: 'Email.msg', size: 10, mime: '' }));
    ok(noMime && noMime.mime === 'application/vnd.ms-outlook', 'a browser that reports no type gets the extension\'s own type');
    const longRes = data(await reserve(ADMIN, { filename: 'Weird\u0007name/../' + 'x'.repeat(240) + '.pdf' }));
    const rLong = await reservation(longRes.evidenceId);
    ok(rLong.original_filename.length === 200 && rLong.original_filename.endsWith('.pdf') && !/[\u0000-\u001f/\\]/.test(rLong.original_filename), `the stored filename loses control characters and path separators and is cut to 200 characters, keeping its extension (got ${rLong.original_filename.length} chars)`);

    // ── B. Refusals ──────────────────────────────────────────────────────────────────────────
    const nRes = async () => (await db.list('iso_evidence_uploads', {})).length;
    const n0 = await nRes();
    const exe = await reserve(ADMIN, { filename: 'tool.exe', mime: 'application/octet-stream' });
    const svg = await reserve(ADMIN, { filename: 'logo.svg', mime: 'image/svg+xml' });
    const html = await reserve(ADMIN, { filename: 'page.html', mime: 'text/html' });
    ok(exe.status === 400 && svg.status === 400 && html.status === 400 && /SharePoint link/.test(errText(exe)), `types outside the allowlist (exe, svg, html) are refused, pointing to a SharePoint link (got ${exe.status}/${svg.status}/${html.status})`);
    const mismatch = await reserve(ADMIN, { filename: 'report.pdf', mime: 'image/png' });
    ok(mismatch.status === 400 && (await nRes()) === n0, 'a declared type that doesn\'t match the extension is refused — and no reservation was made for any of them');
    await callIso(ADMIN, { op: 'config.set', key: 'evidence_max_upload_mb', value: 1 });
    const big = await reserve(ADMIN, { size: 1.5 * 1024 * 1024 });
    ok(big.status === 400 && /1 MB/.test(errText(big)) && /SharePoint link/.test(errText(big)), `a file over evidence_max_upload_mb is refused; the message names the limit and suggests a link (got ${JSON.stringify(errText(big))})`);
    await callIso(ADMIN, { op: 'config.set', key: 'evidence_max_upload_mb', value: 10 });
    const offBig = await reserve(ADMIN, { size: 5 * 1024 * 1024 });
    ok(offBig.status === 400 && /offline/.test(errText(offBig)), 'offline, anything over 4 MB is refused (base64 must fit serve.mjs\'s body cap)');
    const other = data(await reserve(ADMIN));
    const otherPut = await put(STAFF2, other.evidenceId, PDF), otherReg = await register(STAFF2, other.evidenceId);
    ok(otherPut.status === 403 && otherReg.status === 403, `another user cannot send or register someone else's upload (got ${otherPut.status}/${otherReg.status})`);
    const notYet = await register(ADMIN, other.evidenceId);
    ok(notYet.status === 400 && /not arrived/.test(errText(notYet)) && !(await reservation(other.evidenceId)).closed_at, 'registering before the bytes arrive is refused, and the reservation stays open');
    await put(ADMIN, other.evidenceId, PDF);
    ok((await register(ADMIN, other.evidenceId)).status === 200, '…so the same upload can still be finished');
    const sizeLie = data(await reserve(ADMIN, { size: 100 }));
    await put(ADMIN, sizeLie.evidenceId, Buffer.alloc(120, 1));
    const regLie = await register(ADMIN, sizeLie.evidenceId);
    const rLie = await reservation(sizeLie.evidenceId);
    ok(regLie.status === 400 && /size/.test(errText(regLie)) && !(await db.storageHead(rLie.storage_path)).exists && !(await db.get('iso_evidence', sizeLie.evidenceId)), 'a size that differs from the declared one is refused, the object removed and no record created');
    ok(rLie.close_reason === 'refused', 'that reservation is closed as refused');
    const huge = data(await reserve(ADMIN, { size: 1000 }));
    const rHuge = await reservation(huge.evidenceId);
    await db.storagePut(rHuge.storage_path, Buffer.alloc(26 * 1024 * 1024), 'application/pdf');
    const regHuge = await register(ADMIN, huge.evidenceId);
    ok(regHuge.status === 400 && /25 MB/.test(errText(regHuge)) && !(await db.storageHead(rHuge.storage_path)).exists, 'an object over 25 MB is refused at register (whatever was declared) and removed');
    const typeLie = data(await reserve(ADMIN));
    const rType = await reservation(typeLie.evidenceId);
    await db.storagePut(rType.storage_path, PDF, 'text/html');
    const regType = await register(ADMIN, typeLie.evidenceId);
    ok(regType.status === 400 && /type/.test(errText(regType)) && !(await db.storageHead(rType.storage_path)).exists, 'an object stored with a type outside the allowlist is refused at register and removed');
    const late = data(await reserve(ADMIN));
    await db.patchRow('iso_evidence_uploads', (await reservation(late.evidenceId)).id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const latePut = await put(ADMIN, late.evidenceId, PDF);
    const rLate = await reservation(late.evidenceId);
    ok(latePut.status === 400 && /expired/.test(errText(latePut)) && rLate.close_reason === 'expired' && (await register(ADMIN, late.evidenceId)).status === 400, 'an expired upload is refused and closed as expired');
    // At most 10 open reservations per caller; expired ones are cleaned up by the next uploadUrl.
    const tenIds = [];
    for (let i = 0; i < 10; i++) tenIds.push(data(await reserve(STAFF3, { filename: `f${i}.pdf` })).evidenceId);
    const eleventh = await reserve(STAFF3, { filename: 'f10.pdf' });
    ok(tenIds.every(Boolean) && eleventh.status === 400 && /10 uploads/.test(errText(eleventh)), `a caller may hold at most 10 open uploads (11th: ${eleventh.status})`);
    for (const id of tenIds) await db.patchRow('iso_evidence_uploads', (await reservation(id)).id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const afterExpiry = await reserve(STAFF3, { filename: 'f11.pdf' });
    const closed = (await db.list('iso_evidence_uploads', {})).filter(r => tenIds.includes(r.evidence_id));
    ok(afterExpiry.status === 200 && closed.length === 10 && closed.every(r => r.close_reason === 'expired'), 'once they expire, the next uploadUrl closes them and goes ahead');
    // Clients and other boards.
    const cUp = await reserve(CLIENT1), cDl = await callIso(CLIENT1, { op: 'evidence.downloadUrl', auditId: board.id, evidenceId: ev1.id }), cList = await callIso(CLIENT1, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: R.id });
    ok(cUp.status === 403 && cDl.status === 403 && cList.status === 403, `a client caller can neither upload, download nor list evidence (got ${cUp.status}/${cDl.status}/${cList.status})`);
    const restricted = data(await reserve(ADMIN, { filename: 'Payroll extract.csv', size: 12, mime: 'text/csv', confidentiality: 'restricted' }));
    await put(ADMIN, restricted.evidenceId, Buffer.from('name,amount\n'));
    const evR = data(await register(ADMIN, restricted.evidenceId)).evidence;
    ok(evR.confidentiality === 'restricted' && (await callIso(CLIENT1, { op: 'evidence.downloadUrl', auditId: board.id, evidenceId: evR.id })).status === 403, 'restricted evidence is never served to a client');
    const cross = await callIso(ADMIN, { op: 'evidence.downloadUrl', auditId: boardC2.id, evidenceId: ev1.id });
    ok(cross.status === 404, `asking for client c1's file through client c2's board is refused (got ${cross.status})`);
    const linkEv = data(await callIso(ADMIN, { op: 'evidence.addLink', auditId: board.id, targetType: 'requirement', targetId: R.id, url: 'https://etcher.sharepoint.com/sites/qms/x.docx', title: 'A link' })).evidence;
    ok((await callIso(ADMIN, { op: 'evidence.downloadUrl', auditId: board.id, evidenceId: linkEv.id })).status === 400, 'a link has no file to download');
    const usage = data(await callIso(ADMIN, { op: 'evidence.storageUsage' }));
    const files = (await db.list('iso_evidence', {})).filter(e => e.storage_path);
    ok(usage && usage.files === files.length && usage.bytes === files.reduce((s, e) => s + Number(e.size_bytes), 0) && usage.files >= 4, `storage used = the sum of size_bytes over every uploaded file (got ${JSON.stringify(usage)})`);
    ok((await callIso(STAFF2, { op: 'evidence.storageUsage' })).status === 403, 'storage usage is admin-only');
    ok((await snap()) === before, 'no upload changed an assessment, applicability, effectiveness, risk or version field');

    // ── C. The browser: upload through the form, preview, download ─────────────────────────────
    browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 950 } });
    const page = await browser.newPage();
    const errs = [], external = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
    page.on('dialog', d => { errs.push(`unexpected native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    page.on('request', rq => { const u = rq.url(); if (/^https?:/.test(u) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) && !/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|cdn\.tailwindcss\.com|cdn\.jsdelivr\.net/.test(u)) external.push(u); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));
    await page.type('#login-email', 'b.canto@etchersolutions.com');
    await page.type('#login-password', 'TaskHub123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1800));
    await page.evaluate(() => { window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; });
    await page.evaluate((id) => ISO.openBoard(id, 'requirements'), board.id);
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate((id) => ISO._reqOpenMore(id), R2.id);
    await new Promise(r => setTimeout(r, 1200));
    await page.evaluate(() => ISO._reqDrawerSetTab('evidence'));
    await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-evidence button')].find(b => b.textContent.trim() === '+ Add evidence')?.click());
    await new Promise(r => setTimeout(r, 900));
    const formBefore = await page.evaluate(() => ({ file: getComputedStyle(document.getElementById('evd-file-row')).display, url: getComputedStyle(document.getElementById('evd-url-row')).display, toggle: document.getElementById('evd-upload-toggle')?.textContent.trim() }));
    ok(formBefore.file === 'none' && formBefore.url !== 'none' && formBefore.toggle === 'Upload a file instead', 'the form opens on the link option, with "Upload a file instead" as a secondary button');
    await page.click('#evd-upload-toggle');
    const formAfter = await page.evaluate(() => ({ file: getComputedStyle(document.getElementById('evd-file-row')).display, url: getComputedStyle(document.getElementById('evd-url-row')).display, kind: getComputedStyle(document.getElementById('evd-kind-row')).display, toggle: document.getElementById('evd-upload-toggle')?.textContent.trim(), accept: document.getElementById('evd-file').accept }));
    ok(formAfter.file !== 'none' && formAfter.url === 'none' && formAfter.kind === 'none' && formAfter.toggle === 'Paste a link instead' && /\.pdf/.test(formAfter.accept) && !/\.svg/.test(formAfter.accept), `switching shows the file picker (allowed types only) in place of the link fields (got ${JSON.stringify(formAfter)})`);
    const tmpPdf = path.join(tmpDir, 'Site Induction Procedure.pdf');
    fs.writeFileSync(tmpPdf, PDF);
    const input = await page.$('#evd-file');
    await input.uploadFile(tmpPdf);
    await page.evaluate(() => document.getElementById('evd-file').dispatchEvent(new Event('change', { bubbles: true })));
    ok((await page.evaluate(() => document.getElementById('evd-title').value)) === 'Site Induction Procedure', 'choosing a file fills in the title from its name');
    await page.click('#evd-save');
    await new Promise(r => setTimeout(r, 2000));
    const row = await page.evaluate(() => { const el = [...document.querySelectorAll('#iso-rdp-evidence .iso-evd-file')].find(x => /Site Induction Procedure\.pdf/.test(x.innerText)); const card = el && el.parentElement; return card ? { text: card.innerText, buttons: [...el.querySelectorAll('button')].map(b => b.textContent.trim()) } : null; });
    ok(row && new RegExp(`File: Site Induction Procedure\\.pdf · ${PDF.length} B · Draft`).test(row.text) && /Not reviewed/.test(row.text), `the drawer shows the uploaded file — name, size, Draft — as "Not reviewed" (got ${JSON.stringify(row && row.text.slice(0, 200))})`);
    ok(row && row.buttons.includes('Preview') && row.buttons.includes('Download'), 'with Preview and Download');
    const uiEv = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: R2.id })) || []).find(x => x.originalFilename === 'Site Induction Procedure.pdf');
    ok(uiEv && uiEv.reviewStatus === 'submitted' && uiEv.documentStatus === 'draft' && uiEv.sizeBytes === PDF.length, 'the server holds it as uploaded: Not reviewed, Draft, the real size');
    await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-evidence .iso-evd-file')].find(x => /Site Induction Procedure\.pdf/.test(x.innerText))?.querySelector('button').click());
    await new Promise(r => setTimeout(r, 1200));
    const pv = await page.evaluate(() => { const ov = document.getElementById('_file-preview-ov'); return ov ? { iframe: !!ov.querySelector('iframe[src^="blob:"]'), title: ov.innerText.slice(0, 80) } : null; });
    ok(pv && pv.iframe && /Site Induction Procedure\.pdf/.test(pv.title), `Preview opens the in-page viewer on the PDF itself (got ${JSON.stringify(pv)})`);
    await page.evaluate(() => typeof _closeFilePreview === 'function' && _closeFilePreview());
    // Download: the bytes go through a Blob and <a download> — no navigation, no tab.
    // (The Blob is captured where it is created — the page's CSP rightly blocks fetch() on blob: URLs.)
    await page.evaluate(() => {
      window.__dl = null; window.__blobs = new Map();
      const oc = URL.createObjectURL; URL.createObjectURL = function (b) { const u = oc.call(URL, b); window.__blobs.set(u, b); return u; };
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.href.startsWith('blob:')) { const b = window.__blobs.get(this.href); window.__dl = { name: this.download }; if (b) b.arrayBuffer().then(buf => { window.__dl.bytes = Array.from(new Uint8Array(buf)); }); return; }
        return orig.call(this);
      };
    });
    await page.evaluate(() => [...document.querySelectorAll('#iso-rdp-evidence .iso-evd-file')].find(x => /Site Induction Procedure\.pdf/.test(x.innerText))?.querySelectorAll('button')[1].click());
    await new Promise(r => setTimeout(r, 1200));
    const dlUi = await page.evaluate(() => window.__dl);
    ok(dlUi && dlUi.name === 'Site Induction Procedure.pdf' && Buffer.from(dlUi.bytes || []).equals(PDF), `Download saves exactly the uploaded bytes under the original name (got ${JSON.stringify(dlUi && { name: dlUi.name, n: (dlUi.bytes || []).length })})`);
    // The shared viewer itself: SVG is never rendered inline for ISO, while Workboards keeps its behaviour.
    const svgData = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>').toString('base64');
    const svgIso = await page.evaluate((d) => { _previewFileData(d, 'logo.svg', 'image/svg+xml', { allowSvg: false }); const ov = document.getElementById('_file-preview-ov'); const r = { img: !!ov.querySelector('img'), text: ov.innerText }; _closeFilePreview(); return r; }, svgData);
    const svgWb = await page.evaluate((d) => { _previewFileData(d, 'logo.svg', 'image/svg+xml', {}); const ov = document.getElementById('_file-preview-ov'); const r = { img: !!ov.querySelector('img') }; _closeFilePreview(); return r; }, svgData);
    ok(!svgIso.img && /not available/.test(svgIso.text) && svgWb.img, 'the shared viewer never renders an SVG inline when ISO asks (allowSvg:false); Workboards\' default still does');
    await page.evaluate((a, e) => ISO._evdPreview(a, e), board.id, evPng.id);
    await new Promise(r => setTimeout(r, 1000));
    ok(await page.evaluate(() => !!document.querySelector('#_file-preview-ov img[src^="data:image/png"]')), 'an uploaded photo previews as an image');
    await page.evaluate(() => typeof _closeFilePreview === 'function' && _closeFilePreview());
    // The admin page's storage line.
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
    await page.evaluate(() => window.navigate('iso-admin'));
    await new Promise(r => setTimeout(r, 1500));
    const usage2 = data(await callIso(ADMIN, { op: 'evidence.storageUsage' }));
    const storageLine = await page.evaluate(() => document.querySelector('.iso-storage-used')?.innerText || '');
    ok(storageLine.includes(`in ${usage2.files} files`) && /Evidence storage used: [\d.]+ (B|KB|MB)/.test(storageLine), `the admin page shows storage used across ${usage2.files} files (got ${JSON.stringify(storageLine)})`);
    // ── D. 8c.5: uploading the resulting document (from the Suggested documents card) ─────────
    // R4 (D40): templates are now keyed to v3 document names (iso/seed/prompt-templates/*.json's
    // own `documents`), matched via guidance.list's per-clause `documents` (Column P's catalog).
    const tpls = data(await callIso(ADMIN, { op: 'promptTemplate.list' })) || [];
    const allReqs = data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || [];
    const upGuidance = data(await callIso(ADMIN, { op: 'guidance.list', auditId: board.id })) || {};
    let docTpl = null, docReq = null;
    for (const t of tpls) {
      if (!(t.documents || []).length) continue;
      const r = allReqs.find(x => ![R.id, R2.id].includes(x.id) && (upGuidance[x.id]?.documents || []).some(d => t.documents.includes(d)));
      if (r) { docTpl = t; docReq = r; break; }
    }
    ok(docTpl && docReq, `a requirement the template library suggests a document for (got ${docTpl && docTpl.title})`);
    const relReq = allReqs.find(x => ![R.id, R2.id, docReq.id].includes(x.id));
    await callIso(ADMIN, { op: 'relationship.add', auditId: board.id, fromId: docReq.id, toId: relReq.id, kind: 'shared_evidence', reasonText: 'Same document set.' });
    const snapD = async () => JSON.stringify((data(await callIso(ADMIN, { op: 'requirement.list', auditId: board.id })) || []).filter(r => [docReq.id, relReq.id].includes(r.id)).map(r => ASSESS.map(k => r[k])));
    const beforeD = await snapD();
    const relLinks = async () => (await db.list('iso_evidence_links', {})).filter(l => l.target_id === relReq.id).length;
    const relLinksBefore = await relLinks();
    await page.evaluate((id) => ISO.openBoard(id, 'requirements'), board.id);
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate((id) => ISO._reqOpenMore(id), docReq.id);
    await new Promise(r => setTimeout(r, 1300));
    await page.evaluate(() => ISO._reqDrawerSetTab('evidence'));
    const sd = await page.evaluate((tid) => { const row = document.querySelector(`.iso-suggested-doc[data-template="${tid}"]`); const b = row && [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'Upload document'); return b ? { disabled: b.disabled } : null; }, docTpl.templateId);
    ok(sd && !sd.disabled, `the Suggested documents card's "Upload document" is enabled (got ${JSON.stringify(sd)})`);
    await page.evaluate((tid) => [...document.querySelector(`.iso-suggested-doc[data-template="${tid}"]`).querySelectorAll('button')].find(x => x.textContent.trim() === 'Upload document').click(), docTpl.templateId);
    await new Promise(r => setTimeout(r, 900));
    const form = await page.evaluate(() => ({ file: getComputedStyle(document.getElementById('evd-file-row')).display, doc: getComputedStyle(document.getElementById('evd-doc-row')).display, title: document.getElementById('evd-title').value, status: document.getElementById('evd-docstatus').value, ownerFirst: document.getElementById('evd-owner').options[0].text, approverFirst: document.getElementById('evd-approver').options[0].text, eff: !!document.getElementById('evd-effective'), statuses: [...document.getElementById('evd-docstatus').options].map(o => o.text) }));
    ok(form.file !== 'none' && form.doc !== 'none' && form.title === docTpl.title, `it opens the form straight on the file upload, titled with the document type (got ${JSON.stringify({ file: form.file, doc: form.doc, title: form.title })})`);
    ok(form.status === 'draft' && form.statuses.join('|') === 'Draft|Approved|Superseded|Obsolete' && form.ownerFirst === 'Me' && form.approverFirst === '—' && form.eff, `with document status (Draft by default), owner, approver and effective date (got ${JSON.stringify(form)})`);
    const tmpDoc = path.join(tmpDir, 'Internal Audit Procedure v1.pdf');
    fs.writeFileSync(tmpDoc, PDF);
    await (await page.$('#evd-file')).uploadFile(tmpDoc);
    await page.evaluate(() => document.getElementById('evd-file').dispatchEvent(new Event('change', { bubbles: true })));
    await page.type('#evd-version', '1');
    await page.click('#evd-save');
    await new Promise(r => setTimeout(r, 2200));
    const docEv = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: docReq.id })) || []).find(x => x.originalFilename === 'Internal Audit Procedure v1.pdf');
    ok(docEv && docEv.documentStatus === 'draft' && docEv.title === docTpl.title && docEv.versionLabel === '1', 'uploaded through the form, the document defaults to Draft, titled with its type, with its revision');
    const docEvId = docEv ? docEv.id : 'ievi_missing'; // a missing upload fails each check below, never crashes the suite
    ok(docEv && docEv.reviewStatus === 'submitted', 'its verdict is "Not reviewed" — an upload is never marked sufficient (D20)');
    const sugD = (data(await callIso(ADMIN, { op: 'evidence.suggestions', auditId: board.id, targetId: relReq.id })) || []).filter(s => s.evidenceId === docEvId);
    ok(sugD.length === 1 && (await relLinks()) === relLinksBefore, 'D21 suggests it for the confirmed related requirement — and confirms nothing there (no link row written)');
    ok((await snapD()) === beforeD, 'the assessment state and result of both requirements are untouched');
    // Set at upload: approved, with owner, approver and effective date — still "Not reviewed".
    const apr = data(await reserve(ADMIN, { targetId: docReq.id, filename: 'Signed procedure.pdf', documentStatus: 'approved', ownerUid: 'u2', approverUid: 'u2', effectiveDate: '2026-09-01' }));
    await put(ADMIN, apr.evidenceId, PDF);
    const aprEv = data(await register(ADMIN, apr.evidenceId)).evidence;
    ok(aprEv && aprEv.document_status === 'approved' && aprEv.owner_uid === 'u2' && aprEv.approver_uid === 'u2' && aprEv.effective_date === '2026-09-01', 'status, owner, approver and effective date can all be set at upload');
    const aprLink = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: docReq.id })) || []).find(x => aprEv && x.id === aprEv.id);
    ok(aprLink && aprLink.reviewStatus === 'submitted', 'even an approved document arrives "Not reviewed" — its own status is not the reviewer\'s verdict');
    const badStatus = await reserve(ADMIN, { documentStatus: 'final' }), badDate = await reserve(ADMIN, { effectiveDate: 'soon' }), badApprover = await reserve(ADMIN, { approverUid: "x');y" });
    ok(badStatus.status === 400 && badDate.status === 400 && badApprover.status === 400, 'an unknown status, a non-date or a malformed approver is refused');
    // Changed later: versioned, logged, verdicts untouched.
    const g1 = data(await callIso(ADMIN, { op: 'evidence.get', auditId: board.id, evidenceId: docEvId })) || {};
    const setS = await callIso(STAFF2, { op: 'evidence.setDocumentStatus', auditId: board.id, evidenceId: docEvId, documentStatus: 'approved', approverUid: 'u1', effectiveDate: '2026-10-01', expectedVersion: g1.rowVersion });
    const setD = data(setS) || {};
    ok(setS.status === 200 && setD.document_status === 'approved' && setD.approver_uid === 'u1' && !('storage_path' in setD), `the document status can be changed later — here to Approved (got ${setS.status})`);
    const stale = await callIso(STAFF2, { op: 'evidence.setDocumentStatus', auditId: board.id, evidenceId: docEvId, documentStatus: 'obsolete', expectedVersion: g1.rowVersion });
    ok(stale.status === 409, 'a change based on an old version is refused');
    const chg = (await db.list('iso_activity', {})).find(a => a.action === 'document_status_changed' && a.entity_id === docEvId);
    ok(chg && chg.before && chg.before.document_status === 'draft' && chg.after.document_status === 'approved', 'the change is logged as document_status_changed, with before and after');
    const linkAfter = (data(await callIso(ADMIN, { op: 'evidence.list', auditId: board.id, targetType: 'requirement', targetId: docReq.id })) || []).find(x => x.id === docEvId);
    ok(linkAfter && linkAfter.reviewStatus === 'submitted', 'approving the document leaves the verdict on its link alone');
    const clientSet = await callIso(CLIENT1, { op: 'evidence.setDocumentStatus', auditId: board.id, evidenceId: docEvId, documentStatus: 'draft', expectedVersion: 99 });
    const linkSet = await callIso(ADMIN, { op: 'evidence.setDocumentStatus', auditId: board.id, evidenceId: linkEv.id, documentStatus: 'approved', expectedVersion: 1 });
    ok(clientSet.status === 403 && linkSet.status === 400, 'a client cannot change it, and a link has no document status');
    // The evidence drawer's own control.
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
    await page.evaluate((a, e) => ISO.openEvidenceDrawer(a, e), board.id, docEvId);
    await new Promise(r => setTimeout(r, 1300));
    const ctl = await page.evaluate(() => ({ status: document.getElementById('iso-evd-docstatus')?.value, eff: document.getElementById('iso-evd-effective')?.value, line: document.querySelector('#iso-evd-drawer .iso-evd-docstatus')?.textContent }));
    ok(ctl.status === 'approved' && ctl.eff === '2026-10-01' && ctl.line === 'Approved', `the evidence drawer shows and edits the document status (got ${JSON.stringify(ctl)})`);
    if (await page.$('#iso-evd-docstatus')) await page.select('#iso-evd-docstatus', 'superseded');
    await page.evaluate(() => [...document.querySelectorAll('#iso-evd-drawer button')].find(b => b.textContent.trim() === 'Save document status')?.click());
    await new Promise(r => setTimeout(r, 1500));
    const g2 = data(await callIso(ADMIN, { op: 'evidence.get', auditId: board.id, evidenceId: docEvId })) || {};
    ok(g2.documentStatus === 'superseded' && (await page.evaluate(() => document.getElementById('iso-evd-docstatus')?.value)) === 'superseded', 'saving from the drawer stores it, and the drawer reopens showing it');
    ok((await snapD()) === beforeD, 'after all of 8c.5, both requirements\' assessment fields are still untouched');
    await page.evaluate(() => document.getElementById('generic-modal')?.classList.add('hidden'));
    ok((await page.evaluate(() => window.__opened.length)) === 0, 'nothing ever called window.open');
    ok(external.length === 0, `no request left the local server (got ${JSON.stringify(external.slice(0, 5))})`);
    ok(errs.length === 0, `no console errors or native dialogs (got ${JSON.stringify(errs.slice(0, 8))})`);
  } catch (e) {
    console.error('CRASHED', e);
    fail.push('the suite crashed: ' + e.message);
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }
  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
