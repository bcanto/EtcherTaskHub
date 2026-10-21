// Can-fail mutations for Retained Services batch 8 (node .agents/_canfail.cjs .agents/_mut-retained9.cjs --green).
module.exports = [
  { id: 'rt9-target', suite: 'retained9-test', file: 'index.html', note: 'renewals ignore Mobilisation and go to HSEQ',
    find: "s=ss.find(x=>x.key==='mob')||ss.find(x=>x.key==='hseq');", replace: "s=ss.find(x=>x.key==='hseq');" },
  { id: 'rt9-no-dup', suite: 'retained9-test', file: 'index.html', note: 'a person with a renewal task gets a second one',
    find: "if(!p||_regPersonInHand(p))return;", replace: "if(!p)return;" },
  { id: 'rt9-current', suite: 'retained9-test', file: 'index.html', note: 'a person with nothing due gets a task',
    find: "    const due=_regPersonDue(p,today);if(!due.length)return;", replace: "    const due=_regPersonDue(p,today);" },
  { id: 'rt9-due', suite: 'retained9-test', file: 'index.html', note: 'a renewal is always due today',
    find: "endDate:first&&first>today?first:today,percentComplete:0,percentMode:'manual',hourBudget:0,lockedDates:false,order:order++,\n      description:'From the training matrix: '", replace: "endDate:today,percentComplete:0,percentMode:'manual',hourBudget:0,lockedDates:false,order:order++,\n      description:'From the training matrix: '" },
  { id: 'rt9-attention', suite: 'retained9-test', file: 'index.html', note: 'the dashboard ignores people who need renewals',
    find: "    if(n.tNeed)out.push(", replace: "    if(false)out.push(" },
  { id: 'rt9-done', suite: 'retained9-test', file: 'index.html', note: 'a finished renewal is forgotten',
    find: "  const at=String(t.completedAt||t.updatedAt||'').slice(0,10);return !!at&&_regDays(at,_regToday())<=30;", replace: "  return false;" },
  { id: 'rt9-report', suite: 'retained9-test', file: 'index.html', note: 'the report leaves out document control and training',
    find: "prepared:toDateStr(new Date()),regs:_mrRegs(b,ym)};", replace: "prepared:toDateStr(new Date()),regs:null};" },
];
