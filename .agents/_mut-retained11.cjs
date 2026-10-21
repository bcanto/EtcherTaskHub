// Can-fail mutations for Retained Services with its client portal, end to end (node .agents/_canfail.cjs .agents/_mut-retained11.cjs --green).
module.exports = [
  { id: 'rt11-renew-visible', suite: 'retained11-test', file: 'index.html', note: 'renewal tasks show in the client portal',
    find: "registerQuals:due.map(x=>x.name),clientHidden:true});", replace: "registerQuals:due.map(x=>x.name)});" },
  { id: 'rt11-review-hidden', suite: 'retained11-test', file: 'index.html', note: 'document review tasks are hidden from the client',
    find: "completedAt:null,registerDocId:d.id});", replace: "completedAt:null,registerDocId:d.id,clientHidden:true});" },
  { id: 'rt11-portal-fee', suite: 'retained11-test', file: 'index.html', note: 'the portal shows a fee amount',
    find: "<dt>Fee</dt><dd>Fixed monthly fee</dd>", replace: "<dt>Fee</dt><dd>Fixed monthly fee, $6,543.21</dd>" },
  { id: 'rt11-queue-level', suite: 'retained11-test', file: 'index.html', note: 'the queue ignores the client\'s level',
    find: "  const lvOf=b=>_rsLevel(b.retainer.priority)||_rsLevel('Standard');", replace: "  const lvOf=b=>_rsLevel('Standard');" },
  { id: 'rt11-starts', suite: 'retained11-test', file: 'index.html', note: 'a retainer that begins next month says Started',
    find: "${started?`<dt>${rt.startMonth>rt.month?'Starts':'Started'}</dt>", replace: "${started?`<dt>Started</dt>" },
];
