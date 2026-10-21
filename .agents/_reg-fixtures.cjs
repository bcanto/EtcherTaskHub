// Fixture spreadsheets for the registers suites, shaped like the client spreadsheets the user shared on 2026-10-21
// (same headings and layout) but every row made up: no real person, document or company. Written with ExcelJS.
const ExcelJS = require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/exceljs');
const path = require('path');

const day = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const utc = d => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));   // ExcelJS writes dates as UTC midnight
const dmy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

async function docRegister(file, opts = {}) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Doc Register');
  ws.addRow([]);   // the client's sheet has a coloured rule above the headings
  ws.addRow(['File Name', 'Issue / Created\nDate', 'Date Basis', 'Review\nEvery\n(Months)', 'Expiry / Next\nReview Date', 'Days to\nExpiry', 'Review Status', 'Why This Period', 'Notes']);
  const rows = opts.rows || [
    ['QMS-POL-001 - Quality Policy', utc(day(-400)), 'Issue date (register)', 12, utc(day(-35)), -35, 'Overdue', 'Policies state annual review', 'Annual review overdue - review and reissue.'],
    ['QMS-POL-002 - Customer Complaints Policy', utc(day(-340)), 'Issue date (register)', 12, utc(day(25)), 25, 'Current', 'Policies state annual review', ''],
    ['WHS-PRO-001 - Hazard Reporting Procedure', utc(day(-300)), 'Issue date (register)', 12, utc(day(50)), 50, 'Current', 'Annual review (WHS procedure)', ''],
    ['WHS-PRO-002 - Confined Space Procedure', utc(day(-280)), 'Issue date (register)', 12, utc(day(80)), 80, 'Current', 'Annual review (WHS procedure)', ''],
    ['WHS-JHA-001 - Job Hazard Analysis - General Template', utc(day(-10)), 'Issue date (register)', 24, utc(day(720)), 720, 'Current', 'Every 2 years', 'No review period in register or document - 2 years recommended.'],
    ['OPS-CHK-001 - Weekly Site Checklist', dmy(day(-30)), 'Issue date (register)', '24', '', '', '', 'Every 2 years', ''],
    ['OPS-CHK-002 - Monthly Plant Checklist', 'sometime soon', 'Issue date (register)', 12, '', '', '', '', ''],
    ['Visitor Sign-in Form', utc(day(-20)), '', 'annual', '', '', '', '', 'No code on this one'],
    ['', utc(day(-20)), '', 12, '', '', '', '', 'A row with no file name'],
  ];
  rows.forEach(r => ws.addRow(r));
  ws.getColumn(2).numFmt = 'dd/mm/yyyy'; ws.getColumn(5).numFmt = 'dd/mm/yyyy';
  await wb.xlsx.writeFile(file);
  return file;
}
async function trainingMatrix(file, opts = {}) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Qualifications');
  const head = ['ACME SAP ID', 'SURNAME', 'FIRST NAME', 'DOB', 'PHONE', 'EMAIL', 'EMPLOYMENT STATUS', 'POSITION', 'LOCATION', 'DL', 'CLASS', 'DL EXPIRY', 'HRWL #', 'HRWL EXPIRY',
    'Site Essentials 12345', 'Isolation Theory: Lock Holder', 'Heat Stress Prevention Measures', 'Working at Heights Gap Training', '', 'White Card', '4WD'];
  ws.addRow(head);
  const D = n => utc(day(n));
  const rows = opts.rows || [
    ['9000001', 'EXAMPLE', 'Alex', utc(new Date(1980, 1, 2)), '0400 000 001', 'alex@example.invalid', 'Casual', 'Cleaner', 'FIFO - PERTH', 'X100001', 'C', D(-20), '', '', D(-5), D(200), D(17000), D(20), '', D(-400), ''],
    ['9000002', 'SAMPLE', 'Jordan', utc(new Date(1975, 5, 6)), '0400 000 002', 'jordan@example.invalid', 'Full time', 'Supervisor', 'KARRATHA', 'X100002', 'HR', D(300), 'WL 000002', D(45), D(70), '', D(400), '', '', 'Yes', D(-1)],
    ['N/A', 'DEMO', 'Casey', '10/5/199', '0400 000 003', 'casey@example.invalid', 'Casual', 'Cleaner', 'KARRATHA', '', '', '', '', '', '', '', '', '', '', D(5), 'N/A'],
    ['N/A', 'PLACEHOLDER', 'Riley', '', '', '', 'Casual', 'Cleaner', 'TOM PRICE', '', '', D(85), '', '', 'Booked 12/11', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  rows.forEach(r => ws.addRow(r));
  [4, 12, 14, 15, 16, 17, 18, 20, 21].forEach(c => { ws.getColumn(c).numFmt = 'dd/mm/yyyy'; });
  await wb.xlsx.writeFile(file);
  return file;
}
module.exports = { docRegister, trainingMatrix, day };
