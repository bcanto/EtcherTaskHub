// Minimal, dependency-free ZIP reader/writer for editing an .xlsx (an .xlsx is an OPC ZIP
// container) one part at a time. No vendored library here round-trips a zip byte-for-byte: the
// spike (A94, docs/iso-audit-integration-plan.md) found ExcelJS rewrites drawings/headers/footers/
// column widths on load→write, and the vendored xlsx-0.20.3's own CFB.write defaults to the OLE2
// binary format, not zip. This module instead copies every untouched part's raw compressed bytes
// through unchanged and only recompresses the few parts Phase 10 actually edits (sharedStrings.xml,
// a couple of sheet XML files, docProps/core.xml) — so conditional formatting, data bars, drawings,
// the logo, headers/footers and column widths can never be touched by this code, because it never
// reads or rewrites their bytes at all.
'use strict';
const zlib = require('zlib');

// ── CRC-32 (the zip format's own checksum; Node has no built-in) ──────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Read: parse the Central Directory (authoritative part list) then each Local File Header + data.
// Returns an ordered array of entries so writeZip can reproduce the original order for untouched
// parts (some tools care about xl/[Content_Types].xml or similar being early; preserving order is
// the conservative choice). Each entry keeps its raw compressed bytes untouched by default. ────────
function readZip(buf) {
  // End Of Central Directory: find the signature from the end (it can be followed by a comment).
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid zip (xlsx) file — no End Of Central Directory record found.');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  const CD_SIG = 0x02014b50, LFH_SIG = 0x04034b50;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== CD_SIG) throw new Error('Corrupt zip: central directory entry ' + i + ' has a bad signature.');
    const versionMadeBy = buf.readUInt16LE(p + 4);
    const versionNeeded = buf.readUInt16LE(p + 6);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const modTime = buf.readUInt16LE(p + 12);
    const modDate = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const internalAttrs = buf.readUInt16LE(p + 36);
    const externalAttrs = buf.readUInt32LE(p + 38);
    const lfhOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    // Local File Header, to find where the actual (possibly compressed) data starts.
    if (buf.readUInt32LE(lfhOffset) !== LFH_SIG) throw new Error(`Corrupt zip: local file header for "${name}" has a bad signature.`);
    const lfhNameLen = buf.readUInt16LE(lfhOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    const rawData = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, method, flags, modTime, modDate, crc, compSize, uncompSize, versionMadeBy, versionNeeded, internalAttrs, externalAttrs, rawData });
  }
  return entries;
}

// Decompresses one entry's data (method 0 = stored, 8 = deflate — the only two a real .xlsx uses).
function inflateEntry(entry) {
  if (entry.method === 0) return Buffer.from(entry.rawData);
  if (entry.method === 8) return zlib.inflateRawSync(entry.rawData);
  throw new Error(`Unsupported zip compression method ${entry.method} for "${entry.name}" — only stored/deflate are handled.`);
}

// Gets a part's text content by path (any path form — case-sensitive, exact), or null if absent.
function getPart(entries, name) {
  const e = entries.find(x => x.name === name);
  return e ? inflateEntry(e).toString('utf8') : null;
}

// Replaces a part's content (re-deflated, method/flags/CRC/sizes recomputed) in place; the entry
// keeps its position in the array, so untouched entries before/after it are unaffected.
function setPart(entries, name, utf8Text) {
  const i = entries.findIndex(x => x.name === name);
  if (i < 0) throw new Error(`Cannot replace "${name}" — it is not a part of this zip.`);
  const data = Buffer.from(utf8Text, 'utf8');
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  entries[i] = { ...entries[i], method: 8, crc: crc32(data), compSize: compressed.length, uncompSize: data.length, rawData: compressed };
}

// Removes a part entirely (used for comments/externalLinks parts that should not exist at all —
// not used on this template since the source workbook has none, but kept for a future source that does).
function removePart(entries, name) {
  const i = entries.findIndex(x => x.name === name);
  if (i >= 0) entries.splice(i, 1);
}

// ── Write: a fresh Local File Header + data per entry (never the original's exact header bytes,
// since local-header extra fields can carry a Zip64/Info-ZIP data descriptor this rewrite doesn't
// need), then a fresh Central Directory + EOCD. Untouched entries keep their original compressed
// bytes and CRC exactly — only re-framed, never re-compressed. ────────────────────────────────────
function writeZip(entries) {
  const localChunks = [], centralChunks = [];
  let offset = 0;
  const dosTimeDate = () => { const d = new Date(); const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f); const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f); return { time, date }; };
  const fresh = dosTimeDate();
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags — never set the UTF-8 bit; part names here are plain ASCII
    lfh.writeUInt16LE(e.method, 8);
    lfh.writeUInt16LE(e.modTime != null ? e.modTime : fresh.time, 10);
    lfh.writeUInt16LE(e.modDate != null ? e.modDate : fresh.date, 12);
    lfh.writeUInt32LE(e.crc, 14);
    lfh.writeUInt32LE(e.compSize, 18);
    lfh.writeUInt32LE(e.uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // no extra field
    localChunks.push(lfh, nameBuf, e.rawData);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by (plain, matches version needed)
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(e.modTime != null ? e.modTime : fresh.time, 12);
    cd.writeUInt16LE(e.modDate != null ? e.modDate : fresh.date, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.compSize, 20);
    cd.writeUInt32LE(e.uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(e.internalAttrs || 0, 36);
    cd.writeUInt32LE(e.externalAttrs || 0, 38);
    cd.writeUInt32LE(offset, 42);
    centralChunks.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + e.rawData.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  offset += centralBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); // disk numbers
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

module.exports = { readZip, writeZip, getPart, setPart, removePart, crc32 };
