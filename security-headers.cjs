// Release-1 B6.1: the one source of Task Hub's security headers. serve.mjs sends these on every local
// response; scripts/gen-vercel-headers.cjs writes the same set into vercel.json for the live site, and
// serve-security-test asserts the two are equal — so local and live can't drift. (Before B6.1 the live
// site had only index.html's CSP meta tag: no HSTS, no frame-ancestors, no X-Frame-Options.)
const PROD_SUPABASE_HOST = 'wowwiafaqzovlfwzyktj.supabase.co';

function buildCsp(supabaseHost) {
  const host = supabaseHost || PROD_SUPABASE_HOST;
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://placehold.co https://*.supabase.co",
    `connect-src 'self' https://${host} wss://${host}`,
    "object-src 'none'",
    // The PDF preview frames the file as a blob: URL; data: iframes are refused and
    // without frame-src this falls back to default-src 'self' and blocks the preview.
    "frame-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders(supabaseHost) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-XSS-Protection': '1; mode=block',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Browsers ignore HSTS over plain http (localhost), so sending it locally is harmless and keeps
    // the two header sets identical.
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Content-Security-Policy': buildCsp(supabaseHost),
  };
}

module.exports = { PROD_SUPABASE_HOST, buildCsp, securityHeaders };
