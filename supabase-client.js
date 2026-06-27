/**
 * supabase-client.js
 *
 * Initializes the Supabase JS client from credentials served by /api/config.
 * Exposes window._supabase (null when Supabase is not configured).
 *
 * Loaded AFTER the @supabase/supabase-js CDN script in index.html.
 * The rest of the app checks `window._supabase` before using Supabase APIs.
 */

(async function _initSupabase() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return;
    const cfg = await resp.json();

    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      console.info('[Supabase] Not configured — running in offline/localStorage mode.');
      return;
    }

    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[Supabase] CDN script not loaded yet.');
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
        // If the page is already on the login screen, nothing to do
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
    console.warn('[Supabase] Init error:', e.message);
  }
})();
