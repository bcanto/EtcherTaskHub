// Release-1 B6.1: writes security-headers.cjs's header set into vercel.json (every path), so the live
// site sends exactly what serve.mjs sends locally. Run after changing security-headers.cjs:
//   node scripts/gen-vercel-headers.cjs
// serve-security-test fails if vercel.json and security-headers.cjs disagree.
const fs = require('fs');
const path = require('path');
const { securityHeaders } = require('../security-headers.cjs');

const file = path.join(__dirname, '..', 'vercel.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.headers = [{ source: '/(.*)', headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })) }];
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('vercel.json headers written (' + cfg.headers[0].headers.length + ')');
