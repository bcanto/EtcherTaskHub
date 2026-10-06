// Unit tests for api/_isoZip.js — the dependency-free zip reader/writer Phase 10 uses to edit the
// Excel export template's XML parts directly (chosen over ExcelJS/the vendored xlsx CFB writer after
// the 10.0 spike found both reshape or mis-write a real .xlsx; see docs/iso-audit-integration-plan.md
// A94/A95). Built against a zip this test constructs itself (zlib.deflateRawSync/the module's own
// writeZip), plus the real sanitized template so at least one test exercises a real multi-part xlsx.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const { readZip, writeZip, getPart, setPart, removePart, crc32 } = require(path.join(__dirname, '..', 'api', '_isoZip.js'));
const pass = [], fail = [];
const ok = (c, m) => (c ? pass : fail).push(m);
function eq(a, b, m) { try { assert.deepStrictEqual(a, b); pass.push(m); } catch (e) { fail.push(`${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); } }

// A minimal hand-built zip with one stored and one deflated entry, built the same way writeZip does,
// so a round trip through readZip must recover exactly what was put in.
function makeEntry(name, text, method) {
  const data = Buffer.from(text, 'utf8');
  const rawData = method === 0 ? data : zlib.deflateRawSync(data, { level: 9 });
  return { name, method, flags: 0, modTime: 0, modDate: 0, crc: crc32(data), compSize: rawData.length, uncompSize: data.length, internalAttrs: 0, externalAttrs: 0, rawData };
}

(() => {
  // ── Round trip: write then read back, stored and deflated entries both ────────────────────────
  const entries = [makeEntry('a.txt', 'hello world', 0), makeEntry('b.xml', '<x>' + 'y'.repeat(500) + '</x>', 8), makeEntry('dir/c.txt', '', 8)];
  const buf = writeZip(entries);
  ok(buf.length > 0 && buf.readUInt32LE(0) === 0x04034b50, 'writeZip produces a buffer starting with a Local File Header signature');
  const back = readZip(buf);
  eq(back.map(e => e.name), entries.map(e => e.name), 'readZip recovers every entry name, in order');
  for (const e of entries) {
    const r = back.find(x => x.name === e.name);
    const text = (r.method === 0 ? Buffer.from(r.rawData) : zlib.inflateRawSync(r.rawData)).toString('utf8');
    const original = (e.method === 0 ? Buffer.from(e.rawData) : zlib.inflateRawSync(e.rawData)).toString('utf8');
    ok(text === original, `"${e.name}" content round-trips exactly (method ${e.method})`);
    ok(r.crc === e.crc, `"${e.name}" CRC round-trips exactly`);
  }

  // ── getPart / setPart / removePart ──────────────────────────────────────────────────────────────
  ok(getPart(entries, 'a.txt') === 'hello world', 'getPart reads a stored entry\'s text');
  ok(getPart(entries, 'does/not/exist') === null, 'getPart returns null for a missing part, never throws');
  const before = entries.find(e => e.name === 'b.xml');
  setPart(entries, 'b.xml', '<x>changed</x>');
  ok(getPart(entries, 'b.xml') === '<x>changed</x>', 'setPart replaces a part\'s content');
  ok(entries.find(e => e.name === 'b.xml').crc !== before.crc, 'setPart recomputes the CRC');
  ok(entries.length === 3 && entries[1].name === 'b.xml', 'setPart keeps the entry in its original position, does not add or remove entries');
  ok(getPart(entries, 'a.txt') === 'hello world' && getPart(entries, 'dir/c.txt') === '', 'other entries are untouched by setPart');
  let threw = false; try { setPart(entries, 'nope.xml', 'x'); } catch (e) { threw = true; }
  ok(threw, 'setPart refuses to create a new part that was not already in the zip');
  const n0 = entries.length;
  removePart(entries, 'dir/c.txt');
  ok(entries.length === n0 - 1 && !entries.some(e => e.name === 'dir/c.txt'), 'removePart drops the entry entirely');
  removePart(entries, 'already/gone'); // must not throw on a part that isn't there
  ok(true, 'removePart on a non-existent part is a silent no-op, never throws');

  // ── A genuinely malformed buffer is refused, not silently misread ─────────────────────────────
  let badThrew = false; try { readZip(Buffer.from('not a zip at all')); } catch (e) { badThrew = true; }
  ok(badThrew, 'readZip refuses a buffer with no End Of Central Directory record');

  // ── crc32 matches Node's own zlib-adjacent expectations for a known value (the empty-string CRC
  // is 0, and a one-byte change must change the CRC) ────────────────────────────────────────────
  ok(crc32(Buffer.from('')) === 0, 'crc32 of an empty buffer is 0');
  ok(crc32(Buffer.from('a')) !== crc32(Buffer.from('b')), 'crc32 differs for different input');
  ok(crc32(Buffer.from('a')) === crc32(Buffer.from('a')), 'crc32 is deterministic');

  // ── A real multi-part xlsx: the sanitized template built by Phase 10.1 ────────────────────────
  const tpl = path.join(__dirname, '..', 'iso', 'templates', 'gap-analysis-template.xlsx');
  if (fs.existsSync(tpl)) {
    const tplBuf = fs.readFileSync(tpl);
    const tplEntries = readZip(tplBuf);
    ok(tplEntries.length > 15, `the real template parses into its full part list (got ${tplEntries.length} parts)`);
    const wrote = writeZip(tplEntries);
    const reread = readZip(wrote);
    ok(reread.length === tplEntries.length, 'writing the real template back out and re-reading it keeps every part');
    let mismatch = 0;
    for (const e of tplEntries) {
      const r = reread.find(x => x.name === e.name);
      const a = e.method === 0 ? Buffer.from(e.rawData) : zlib.inflateRawSync(e.rawData);
      const b = r && (r.method === 0 ? Buffer.from(r.rawData) : zlib.inflateRawSync(r.rawData));
      if (!r || !a.equals(b)) mismatch++;
    }
    ok(mismatch === 0, `every part of the real template is byte-identical after a write→read round trip (${mismatch} mismatches)`);
  } else {
    fail.push('iso/templates/gap-analysis-template.xlsx does not exist — the real-file round-trip check was skipped, not passed');
  }

  console.log('\nPASS (' + pass.length + '):'); pass.forEach(m => console.log('  + ' + m));
  console.log('FAIL (' + fail.length + '):'); fail.forEach(m => console.log('  - ' + m));
  process.exit(fail.length ? 1 : 0);
})();
