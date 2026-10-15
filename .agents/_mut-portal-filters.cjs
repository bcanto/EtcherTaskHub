// Can-fail mutations for the portal filters (node .agents/_canfail.cjs .agents/_mut-portal-filters.cjs --green).
module.exports = [
  { id: 'pf-ignored', suite: 'portal-filters-test', file: 'index.html', note: 'the filters are drawn but never applied',
    find: "  const ft=fl?_cpFilterTasks(section,tasks):tasks,", replace: "  const ft=tasks," },
  { id: 'pf-no-bar', suite: 'portal-filters-test', file: 'index.html', note: 'no filter bar',
    find: "  const bar=fl?_cpFilterBar(section,boards,tasks,ft):'';", replace: "  const bar='';" },
  { id: 'pf-subtasks-lost', suite: 'portal-filters-test', file: 'index.html', note: 'subtasks of a matching task are dropped',
    find: '  return tasks.filter(t=>keep.has(t.parentId?t.parentId:t.id));', replace: '  return tasks.filter(t=>keep.has(t.id));' },
  { id: 'pf-shared-state', suite: 'portal-filters-test', file: 'index.html', note: 'every tab shares one set of filters',
    find: "function cpSetFilter(section,key,value){if(!_cpFilters[section])return;_cpFilters[section][key]=value||'';cpNavigate(section);}",
    replace: "function cpSetFilter(section,key,value){['tasks','workboard','schedule'].forEach(s=>{_cpFilters[s][key]=value||'';});cpNavigate(section);}" },
  { id: 'pf-clear-broken', suite: 'portal-filters-test', file: 'index.html', note: 'Clear filters does nothing',
    find: "function cpClearFilters(section){_cpFilters[section]={};cpNavigate(section);}", replace: "function cpClearFilters(section){cpNavigate(section);}" },
  { id: 'pf-who-on-board', suite: 'portal-filters-test', file: 'index.html', note: 'the Board tab lists staff names in a With filter',
    find: "    ${section==='tasks'?sel('who','With',", replace: "    ${true?sel('who','With'," },
];
