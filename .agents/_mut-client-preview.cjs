// Can-fail mutations for the local client preview login (node .agents/_canfail.cjs .agents/_mut-client-preview.cjs --green).
module.exports = [
  { id: 'cpl-supabase-open', suite: 'client-preview-login-test', file: 'index.html', note: 'the preview login stays open with Supabase present',
    find: "function _localClientPreviewAllowed(){const h=location.hostname;return!window._supabase&&(", replace: "function _localClientPreviewAllowed(){const h=location.hostname;return(" },
  { id: 'cpl-portal-off', suite: 'client-preview-login-test', file: 'index.html', note: 'a client with the portal off can still sign in',
    find: "      if(!c.portalEnabled){showLoginError(`The client portal is off for ${c.name}. Turn it on in Client Manager first.`);return;}\n", replace: '' },
  { id: 'cpl-any-password', suite: 'client-preview-login-test', file: 'index.html', note: 'any password signs a client in',
    find: "  if(_localClientPreviewAllowed()&&pass===_LOCAL_CLIENT_PASSWORD){", replace: "  if(_localClientPreviewAllowed()){" },
  { id: 'cpl-flag-opens', suite: 'client-preview-login-test', file: 'index.html', note: 'the etcher_local_auth flag opens the preview login',
    find: "function _localClientPreviewAllowed(){const h=location.hostname;return!window._supabase&&(h==='localhost'||h==='127.0.0.1'||h==='::1');}",
    replace: "function _localClientPreviewAllowed(){const h=location.hostname;return!window._supabase&&(h==='localhost'||h==='127.0.0.1'||h==='::1'||localStorage.getItem('etcher_local_auth')==='1');}" },
  {"id":"cp-local-needs-pw","suite":"client-preview-login-test","file":"index.html","note":"a local copy still demands a password with the email","find":"    if(!c.supabaseUserId&&_localClientPreviewAllowed()){","replace":"    if(false){"},
  {"id":"cp-local-email-lost","suite":"client-preview-login-test","file":"index.html","note":"the local email is not stored","find":"    if(localEmail!==null)c.loginEmail=localEmail||undefined;","replace":""},
  {"id":"cp-local-new-client","suite":"client-preview-login-test","file":"index.html","note":"a new local client drops its email","find":"active:true,loginEmail:email||undefined,portalEnabled:","replace":"active:true,portalEnabled:"},
];
