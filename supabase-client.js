/**
 * supabase-client.js
 *
 * Initializes the Supabase JS client from credentials served by /api/config.
 * Exposes window._supabase (null when Supabase is not configured).
 *
 * Loaded AFTER the @supabase/supabase-js CDN script in index.html.
 * The rest of the app checks `window._supabase` before using Supabase APIs.
 *
 * Init is async, so window._supabase is still unset while it runs. Anything branching on
 * it — doLogin above all — must await window._supabaseReady first, or a fast click lands
 * in the offline fallback purely because /api/config had not resolved yet.
 * window._supabaseInitError records why init produced no client, so the app can tell
 * "not configured, running locally" apart from "this should have worked and did not".
 */

window._supabaseInitError = null;
window._supabaseReady = (async function _initSupabase() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) {
      window._supabaseInitError = 'the configuration service returned HTTP ' + resp.status + '.';
      console.warn('[Supabase] /api/config returned', resp.status);
      return;
    }
    const cfg = await resp.json();

    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      window._supabaseInitError = 'no Supabase credentials are configured on the server.';
      console.info('[Supabase] Not configured — running in offline/localStorage mode.');
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      window._supabaseInitError = 'the Supabase library did not load (CDN blocked or offline).';
      console.warn('[Supabase] CDN script not loaded.');
      return;
    }

    window._supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession:   true,
        detectSessionInUrl: true,
        storageKey: 'etcher_supabase_auth',
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });

    // Listen for auth state changes so the app reacts to token refresh / sign-out
    window._supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED') return; // silent, no UI change needed
      if (event === 'SIGNED_OUT') {
        if (window._shareRouteActive) return; // share page — no auth UI to touch
        const loginVisible = !document.getElementById('login-screen')?.classList.contains('hidden');
        if (!loginVisible && typeof doLogout === 'function') doLogout();
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked a recovery/invite link — flag so startup shows set-password form
        window._supabasePendingPasswordReset = true;
      }
    });

    console.info('[Supabase] Client ready →', cfg.supabaseUrl);

  } catch (e) {
    window._supabaseInitError = e.message || 'an unexpected error occurred during sign-in setup.';
    console.warn('[Supabase] Init error:', e.message);
  }
})();
