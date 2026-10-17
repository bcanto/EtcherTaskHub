// H10 (audit 2026-10-17): files sent in the internal comms were saved as text inside the company record (up to 4 MB each,
// about 5.3 MB once encoded), which every save uploads and every person's browser keeps. Now they go to file storage like
// task files and the record holds a reference only; where file storage is not available the bytes stay in this browser's own
// file store. File storage is a stand-in here (no real project). Runs on its own server (no :3001).
const H = require('./_static-offline.cjs');
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);

(async () => {
  const srv = await H.serve(3213);
  const b = await H.launch();
  try {
    const { page: p, errors } = await H.openPage(b, 'http://127.0.0.1:3213/');
    await p.evaluate(() => {
      // A stand-in for file storage: remembers what was uploaded, removed and asked for.
      window.__store = { up: [], rm: [], signed: [], failUpload: false };
      window.__downloads = [];
      window._clickDownload = (href, name) => { window.__downloads.push({ href: String(href).slice(0, 60), name }); };
      window.__storageOn = (on) => {
        if (!on) { window._supabase = undefined; _supabaseSyncEnabled = false; return; }
        window._supabase = { storage: { from: (bucket) => ({
          upload: async (path, file, opts) => { if (window.__store.failUpload) return { error: { message: 'down' } }; window.__store.up.push({ bucket, path, size: file.size, type: opts.contentType }); return { error: null }; },
          createSignedUrl: async (path, secs, o) => { window.__store.signed.push({ path, name: o && o.download }); return { data: { signedUrl: 'https://files.test/' + path + '?download=' + (o && o.download) }, error: null }; },
          remove: (paths) => { window.__store.rm.push(...paths); return Promise.resolve({}); },
        }) } };
        _supabaseSyncEnabled = true;
      };
      // a file of a given size, with its type
      window.__file = (name, type, bytes) => new File([new Uint8Array(bytes).fill(65)], name, { type });
      window.__send = async (files, text) => {
        wsCommsOpen = true; openWorkboard(DB.workboards[0].id); navigate('workspace'); wsCommsOpen = true; renderView('workspace');
        await new Promise(r => setTimeout(r, 200));
        document.getElementById('comms-input').value = text || 'with files';
        wsCommsFiles = files;
        const before = JSON.stringify(DB).length;
        await wsSendComms();
        const msg = DB.internalComms[DB.internalComms.length - 1];
        return { msg: JSON.parse(JSON.stringify(msg)), grew: JSON.stringify(DB).length - before };
      };
    });

    // ── File storage on: the file goes up, the record holds a reference ──
    await p.evaluate(() => window.__storageOn(true));
    let r = await p.evaluate(() => window.__send([window.__file('plan.pdf', 'application/pdf', 3 * 1024 * 1024)], 'the plan'));
    const att = r.msg.attachments[0];
    const up = await p.evaluate(() => window.__store.up);
    ok(r.msg.attachments.length === 1 && att.name === 'plan.pdf' && att.type === 'application/pdf' && att.size === 3 * 1024 * 1024 && /^cf/.test(att.id) && att.storagePath === 'tasks/comms/' + att.id, 'a 3 MB file sent in comms is kept as a reference to file storage (' + JSON.stringify(att).slice(0, 220) + ')');   // cut: a broken record would put the whole file in this message
    ok(!('data' in att) && JSON.stringify(r.msg).indexOf('base64') < 0, 'and none of the file is stored as text in the record');
    ok(r.grew < 1500, 'the company record grew by ' + r.grew + ' bytes, not by the size of the file');
    ok(up.length === 1 && up[0].path === att.storagePath && up[0].bucket === 'task-files' && up[0].size === 3 * 1024 * 1024, 'the file was uploaded to the private files bucket under tasks/comms/');
    ok(await p.evaluate(id => !localStorage.getItem('etcher_files_v4') || !JSON.parse(localStorage.getItem('etcher_files_v4'))[id], att.id), 'and a copy is not kept in this browser\'s file store');
    // Up to 10 MB is allowed with file storage; more is not.
    r = await p.evaluate(() => window.__send([window.__file('big.zip', 'application/zip', 8 * 1024 * 1024)], 'big'));
    ok(r.msg.attachments.length === 1 && r.msg.attachments[0].storagePath && r.grew < 1500, 'with file storage a file up to 10 MB is accepted (8 MB sent, record grew ' + r.grew + ' bytes)');
    r = await p.evaluate(async () => { const out = await window.__send([window.__file('huge.bin', 'application/octet-stream', 11 * 1024 * 1024)], 'huge'); return { ...out, alert: document.getElementById('generic-modal-body').innerText }; });
    ok(r.msg.attachments.length === 0 && /over 10 MB/.test(r.alert), 'a file over 10 MB is refused, and the message goes without it (' + r.alert.replace(/\s+/g, ' ').slice(0, 60) + ')');
    await p.evaluate(() => closeGenericModal());
    // Opening it asks for a signed link with the file's own name.
    const msgId = (await p.evaluate(() => DB.internalComms.find(m => (m.attachments || []).some(a => a.name === 'plan.pdf')).id));
    await p.evaluate(id => wsOpenCommsFile(id, 0), msgId);
    const dl = await p.evaluate(() => ({ signed: window.__store.signed, downloads: window.__downloads }));
    ok(dl.signed.length === 1 && dl.signed[0].path === att.storagePath && dl.signed[0].name === 'plan.pdf' && dl.downloads.length === 1 && dl.downloads[0].name === 'plan.pdf' && /files\.test/.test(dl.downloads[0].href), 'opening it asks for a signed download link and downloads it under its own name');
    // What the panel shows: a chip that opens it, and no stored text for an address.
    const panel = await p.evaluate(() => { wsCommsOpen = true; renderView('workspace'); const a = [...document.querySelectorAll('#comms-thread a')].find(x => /plan\.pdf/.test(x.textContent)); return a ? { href: a.getAttribute('href'), onclick: a.getAttribute('onclick') || '', hasDownloadAttr: a.hasAttribute('download') } : null; });
    ok(panel && panel.href === '#' && /^event\.preventDefault\(\);wsOpenCommsFile\('[^']+',\d+\)$/.test(panel.onclick) && !panel.hasDownloadAttr, 'the chip in the thread opens it through the app (and does not jump the page), with no address built from stored text (' + JSON.stringify(panel).slice(0, 220) + ')');
    // A failed upload keeps the file in this browser instead of losing it, and still keeps it out of the record.
    await p.evaluate(() => { window.__store.failUpload = true; });
    r = await p.evaluate(() => window.__send([window.__file('notes.txt', 'text/plain', 200 * 1024)], 'fallback'));
    const fb = r.msg.attachments[0];
    ok(fb && fb.stored === true && !fb.storagePath && !('data' in fb) && r.grew < 1500, 'if the upload fails the file is kept in this browser\'s file store and the record holds only a reference (' + JSON.stringify(fb).slice(0, 220) + ', grew ' + r.grew + ')');
    ok(await p.evaluate(id => !!JSON.parse(localStorage.getItem('etcher_files_v4') || '{}')[id], fb.id), 'its bytes are in this browser\'s file store');
    const fbMsg = await p.evaluate(() => DB.internalComms[DB.internalComms.length - 1].id);
    await p.evaluate(id => { window.__downloads.length = 0; return wsOpenCommsFile(id, 0); }, fbMsg);
    ok(await p.evaluate(() => window.__downloads.length === 1 && /^data:/.test(window.__downloads[0].href) && window.__downloads[0].name === 'notes.txt'), 'and opening it uses that copy');
    r = await p.evaluate(async () => { const out = await window.__send([window.__file('mid.bin', 'application/octet-stream', 6 * 1024 * 1024)], 'mid'); return { ...out, alert: document.getElementById('generic-modal-body').innerText }; });
    ok(r.msg.attachments.length === 0 && /could not be uploaded/.test(r.alert), 'a 6 MB file whose upload failed is not squeezed into the browser store: it is refused with a reason (' + r.alert.replace(/\s+/g, ' ').slice(0, 70) + ')');
    await p.evaluate(() => { closeGenericModal(); window.__store.failUpload = false; });

    // ── No file storage (offline): this browser's own store, still not in the record ──
    await p.evaluate(() => window.__storageOn(false));
    r = await p.evaluate(() => window.__send([window.__file('offline.csv', 'text/csv', 1024 * 1024)], 'offline'));
    const off = r.msg.attachments[0];
    ok(off && off.stored === true && !off.storagePath && !('data' in off) && r.grew < 1500 && (await p.evaluate(id => !!JSON.parse(localStorage.getItem('etcher_files_v4') || '{}')[id], off.id)), 'offline, a 1 MB file stays in this browser and the record grew by ' + r.grew + ' bytes');
    r = await p.evaluate(async () => { const out = await window.__send([window.__file('five.bin', 'application/octet-stream', 5 * 1024 * 1024)], 'five'); return { ...out, alert: document.getElementById('generic-modal-body').innerText }; });
    ok(r.msg.attachments.length === 0 && /over 4 MB/.test(r.alert), 'offline the old 4 MB limit still applies (' + r.alert.replace(/\s+/g, ' ').slice(0, 60) + ')');
    await p.evaluate(() => closeGenericModal());

    // ── Messages sent before this fix still open, but never from an unchecked address ──
    const legacy = await p.evaluate(() => {
      const ok64 = 'data:text/plain;base64,SGVsbG8=';
      DB.internalComms.push({ id: 'legacy1', authorId: currentUser.id, body: 'old', attachments: [{ name: 'old.txt', type: 'text/plain', data: ok64 }, { name: 'evil.txt', type: 'text/plain', data: 'javascript:alert(1)' }], timestamp: new Date().toISOString() });
      wsCommsOpen = true; renderView('workspace');
      const links = [...document.querySelectorAll('#comms-thread a')].filter(a => /old\.txt|evil\.txt/.test(a.textContent)).map(a => ({ name: a.textContent.trim(), href: a.getAttribute('href') }));
      window.__downloads.length = 0; wsOpenCommsFile('legacy1', 0); const okOpen = window.__downloads.slice();
      window.__downloads.length = 0; wsOpenCommsFile('legacy1', 1); const evilOpen = window.__downloads.slice();
      return { links, okOpen, evilOpen, alert: document.getElementById('generic-modal-body').innerText };
    });
    const lOk = legacy.links.find(l => /old\.txt/.test(l.name)), lEvil = legacy.links.find(l => /evil\.txt/.test(l.name));
    ok(lOk && lOk.href === 'data:text/plain;base64,SGVsbG8=' && lEvil && lEvil.href === '#', 'an old attachment still links to its data, and one holding anything else (a script address) links nowhere (' + JSON.stringify(legacy.links) + ')');
    ok(legacy.okOpen.length === 1 && legacy.okOpen[0].name === 'old.txt' && legacy.evilOpen.length === 0 && /cannot be opened/.test(legacy.alert), 'opening an old attachment works; opening the unsafe one is refused');
    await p.evaluate(() => closeGenericModal());

    // ── Deleting a message removes its files ──
    await p.evaluate(() => window.__storageOn(true));
    r = await p.evaluate(() => window.__send([window.__file('gone.pdf', 'application/pdf', 100 * 1024)], 'to delete'));
    const gone = r.msg;
    await p.evaluate(id => wsDeleteComms(id), gone.id);
    const rm = await p.evaluate(() => window.__store.rm);
    ok(rm.includes(gone.attachments[0].storagePath) && !(await p.evaluate(id => DB.internalComms.some(m => m.id === id), gone.id)), 'deleting a message removes its file from file storage too (' + JSON.stringify(rm.slice(-1)) + ')');
    await p.evaluate(() => window.__storageOn(false));
    r = await p.evaluate(() => window.__send([window.__file('gone2.txt', 'text/plain', 1024)], 'local delete'));
    await p.evaluate(id => wsDeleteComms(id), r.msg.id);
    ok(await p.evaluate(id => !JSON.parse(localStorage.getItem('etcher_files_v4') || '{}')[id], r.msg.attachments[0].id), 'and from this browser\'s file store');
    ok(errors.length === 0, 'no page errors (' + errors.slice(0, 2).join(' | ') + ')');
    await p.close();
  } catch (e) { fail.push('crashed: ' + (e && e.stack || e)); }
  finally { await b.close(); srv.stop(); H.report('high-h10-comms-files-test', pass, fail); }
})();
