// Shared by golden-capture.cjs (writes .agents/golden/*) and mt-golden-test.cjs (re-captures
// live and diffs against those files). Keeping the capture matrix in one place means the two
// can never silently drift apart — see plan Phase 0.5 / 1's mt-golden-test.
//
// Golden fixture facts (Phase 0.5), so a future editor of the fixture keeps these true:
//   - board b1 'Maintenance Board' (all_internal) / b2 'Private Ops Board' (private, boardShares
//     grants u2). t1 has 4 direct subitems (t1a, t1a1, t1b, t1c) — the Main Table renders exactly
//     one level of subitems (renderWsRow has a single, non-recursive call site at index.html:19091
//     as of 8863987), so there is no grandchild case to capture.
//   - t3/t4 are overdue (tone 'over'/'stale'); t5 is a single-date milestone; t6 lockedDates; t7
//     archived; t8 clientHidden; t9 has baseline dates; t2/t13 are done.
//   - customColumns cc_* cover all 13 types with mixed parent/subitem/both levels (index.html
//     mtOpenAddColModal type list, as of 8863987).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-db.json'), 'utf-8'));
const SESSION = { id: 'u1', type: 'staff', role: 'admin', clientId: null, savedAt: Date.now() };
const FIXED_EPOCH_MS = Date.parse('2026-09-29T04:00:00.000Z'); // "today" for the fixture

const BOARDS = ['b1', 'b2'];
const GROUP_BYS = ['group', 'client', 'status', 'owner', 'priority'];
const SORTS = [null, { col: 'status', dir: 'desc' }];
const ARCHIVED_OPTS = [false, true];
const SEARCH_OPTS = ['', 'inspect']; // matches on b1, no results on b2 — exercises the empty state too
const EXPAND_OPTS = [false, true]; // false = wsExpanded empty (collapsed); true = every parent-with-children expanded
const PERSON_OPTS = [null, 'u2'];

const GANTT_SCALES = ['days', 'weeks', 'months', 'quarters'];
const GANTT_COLOR_BYS = ['status', 'priority'];
const GANTT_BASELINE_OPTS = [false, true];
const GANTT_LEFT_COLLAPSED_OPTS = [false, true];

async function installFixture(page) {
  await page.emulateTimezone('Australia/Perth');
  await page.evaluateOnNewDocument((fx, sess, epoch) => {
    localStorage.setItem('etcher_taskhub_v4', JSON.stringify(fx));
    localStorage.setItem('etcher_session_v1', JSON.stringify(sess));
    // Advancing clock from a fixed start (plan 0.5) — never frozen: offline _startApp waits on
    // Date.now()-t>2000, and _vcGet's 8s TTL must expire.
    const RealDate = Date;
    const startReal = RealDate.now();
    function FakeDate(...args) { if (args.length === 0) return new RealDate(epoch + (RealDate.now() - startReal)); return new RealDate(...args); }
    FakeDate.now = () => epoch + (RealDate.now() - startReal);
    FakeDate.prototype = RealDate.prototype; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, FIXTURE, SESSION, FIXED_EPOCH_MS);
}

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
}

function sortName(s) { return s ? `${s.col}-${s.dir}` : 'none'; }

// Runs the entire capture matrix against an already-booted page and returns
// [{name, html}], in a fixed, deterministic order. Never touches disk.
async function captureAll(page, { onProgress } = {}) {
  const out = [];
  const push = (name, html) => { out.push({ name, html }); if (onProgress) onProgress(out.length); };

  // ── 1. Left nav (no boards pinned — a fresh fixture never seeds localStorage.navPins) ──────
  await page.evaluate(() => { openWorkboard('b1'); navigate('dashboard'); });
  await new Promise(r => setTimeout(r, 300));
  push('nav.html', await page.evaluate(() => document.getElementById('main-nav').innerHTML));

  // ── 2. Bulk bar with 2 rows selected (board b1) ────────────────────────────────────────────
  await page.evaluate(() => { openWorkboard('b1'); navigate('workspace'); wsSelected = new Set(['t1', 't2']); updateBulkBar(); });
  await new Promise(r => setTimeout(r, 300));
  push('bulk-bar.html', await page.evaluate(() => document.getElementById('ws-bulk-bar').innerHTML));
  await page.evaluate(() => { wsSelected.clear(); updateBulkBar(); });

  // ── 3. Comms & Notes panel, once per board ─────────────────────────────────────────────────
  for (const boardId of BOARDS) {
    await page.evaluate((boardId) => { openWorkboard(boardId); navigate('workspace'); wsOpenComms(); }, boardId);
    await new Promise(r => setTimeout(r, 300));
    push(`comms_${boardId}.html`, await page.evaluate(() => document.getElementById('comms-panel').innerHTML));
    await page.evaluate(() => wsCloseComms());
  }

  // ── 4. Main Table capture matrix ────────────────────────────────────────────────────────────
  for (const boardId of BOARDS) {
    for (const gb of GROUP_BYS) {
      for (const sort of SORTS) {
        for (const arch of ARCHIVED_OPTS) {
          for (const search of SEARCH_OPTS) {
            for (const exp of EXPAND_OPTS) {
              for (const person of PERSON_OPTS) {
                await page.evaluate((boardId, gb, sort, arch, search, exp, person) => {
                  openWorkboard(boardId);
                  wsGroupBy = gb;
                  wsSort = sort ? { col: sort.col, dir: sort.dir } : { col: null, dir: 'asc' };
                  wsShowArchived = arch;
                  wsMtSearch = search;
                  wsMtPersonFilter = person || '';
                  wsExpanded = exp
                    ? new Set(DB.tasks.filter(t => !t.parentTaskId && DB.tasks.some(c => c.parentTaskId === t.id)).map(t => t.id))
                    : new Set();
                  wsSelected = new Set();
                  navigate('workspace');
                }, boardId, gb, sort, arch, search, exp, person);
                await new Promise(r => setTimeout(r, 45));
                const html = await page.evaluate(() => document.getElementById('ws-table-scroll').outerHTML);
                const name = `mt_${boardId}_gb-${gb}_sort-${sortName(sort)}_arch-${arch ? 1 : 0}_search-${search ? 1 : 0}_exp-${exp ? 1 : 0}_person-${person ? 1 : 0}.html`;
                push(name, html);
              }
            }
          }
        }
      }
    }
    // reset the shared, non-per-ctx state back to defaults before the next board / section
    await page.evaluate(() => { wsGroupBy = 'group'; wsSort = { col: null, dir: 'asc' }; wsShowArchived = false; wsMtSearch = ''; wsMtPersonFilter = ''; wsExpanded = new Set(); });
  }

  // ── 5. Gantt capture matrix ─────────────────────────────────────────────────────────────────
  for (const boardId of BOARDS) {
    for (const scale of GANTT_SCALES) {
      for (const colorBy of GANTT_COLOR_BYS) {
        for (const baseline of GANTT_BASELINE_OPTS) {
          for (const leftCollapsed of GANTT_LEFT_COLLAPSED_OPTS) {
            await page.evaluate((boardId, scale, colorBy, baseline, leftCollapsed) => {
              openWorkboard(boardId);
              ganttScale = scale; ganttColorBy = colorBy; ganttShowBaseline = baseline; ganttLeftCollapsed = leftCollapsed;
              navigate('gantt');
            }, boardId, scale, colorBy, baseline, leftCollapsed);
            await new Promise(r => setTimeout(r, 60));
            const html = await page.evaluate(() => document.querySelector('.g2-container').outerHTML);
            const name = `gantt_${boardId}_scale-${scale}_color-${colorBy}_base-${baseline ? 1 : 0}_left-${leftCollapsed ? 1 : 0}.html`;
            push(name, html);
          }
        }
      }
    }
    await page.evaluate(() => { ganttScale = 'weeks'; ganttColorBy = 'status'; ganttShowBaseline = false; ganttLeftCollapsed = false; });
  }

  // ── 6. Excel export sheet XML (board b1) — same unzip technique as excel-export-test.cjs ────
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-xlsx-'));
  try {
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await page.evaluate(() => { openWorkboard('b1'); navigate('workspace'); wsMtExport(); });
    let file = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const f = fs.readdirSync(dlDir).filter(n => n.endsWith('.xlsx'));
      if (f.length) { file = path.join(dlDir, f[0]); break; }
    }
    if (file) {
      const xdir = path.join(dlDir, '_unzipped');
      execSync(`unzip -o -q "${file}" -d "${xdir}"`);
      const sheetPath = path.join(xdir, 'xl', 'worksheets', 'sheet1.xml');
      if (fs.existsSync(sheetPath)) push('export_sheet1.xml', fs.readFileSync(sheetPath, 'utf-8'));
    }
  } finally {
    fs.rmSync(dlDir, { recursive: true, force: true });
  }

  return out;
}

module.exports = { ROOT, FIXTURE, SESSION, FIXED_EPOCH_MS, installFixture, boot, captureAll };
