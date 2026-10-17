# Task Hub sign-in and HTTPS: plan and status

Updated 18 October 2026. Branch `security-sso` (on top of what is live, `main` at `67a4b16`). **Nothing here is
deployed yet**, and nothing changes how anyone signs in until you switch it on.

This replaces the earlier draft (`docs/iso-audit/sso-https-plan.md` on `retained-services`), now for Task Hub itself.
The ISO site has its own copy in its handover.

## What is built (four commits, each tested, every check proven able to fail)

| Part | What it does | Switch | Commit |
|---|---|---|---|
| A. Security headers | The live site sends HSTS (two years, subdomains), refuses to be framed by another site, sends nosniff and a strict referrer policy, plus a content security policy that allows everything the page's own policy already allows (checked), so nothing the site loads today is blocked. One source: `security-headers.cjs`, written into `vercel.json` by `node scripts/gen-vercel-headers.cjs`. | Always on once deployed | `7dc9e82` |
| A. Pinned sign-in library | The login page loads supabase-js 2.117.3 from this site with an integrity hash. It loaded "any 2.x" from a public CDN, so a new release or a compromised CDN would have run on the login page. | Always on once deployed | `7dc9e82` |
| A. Local dev server | Answers on this computer only and never serves `.env`, data exports or internal folders. Before, anyone on the same network could download `.env` (the live service-role key) while it ran. `--lan` opts back in. | Always on (local only) | `7dc9e82` |
| A. Sign in with Microsoft | A "Sign in with Microsoft" button (Supabase Azure provider). The password form stays. | `MICROSOFT_SIGNIN=1` (Vercel) | `7dc9e82` |
| A. Email links | Notification emails link to `https://taskhub.etchersolutions.com` even when `APP_URL` is not set. | Always on once deployed | `7dc9e82` |
| A2. Internal files not published | The live site served the database migrations, the local dev server, the email-intake service and the setup notes to anyone who asked. `.vercelignore` now keeps them off the site (a test checks everything the app needs is still uploaded). | Always on once deployed | `05d4142` |
| B. Idle sign-out | Signs out after a set time without activity, with a warning two minutes before and the reason on the login screen. A browser reopened after the limit starts signed out. Switching it on never signs out someone who has been working. | `SESSION_IDLE_MINUTES` (Vercel), e.g. `480` | `fd7c741` |
| C. Staff use Microsoft only | Once switched on, a staff password session is refused by the database, the app ("Staff accounts sign in with Microsoft"), the server and the MCP connector. A break-glass list keeps one emergency password login. Clients are never affected. | Database switch in migration 018 (starts off) | `e4cd96a` |
| D. Two-step sign-in | A 6-digit code from an authenticator app at sign-in, for password logins (the break-glass admin, clients who want it). Set up from a "Two-step sign-in" button. Once migration 018 is applied, the database refuses a session that skipped the code, and the break-glass login only counts with its code. | `TWO_STEP_SIGNIN=1` (Vercel) | `e289a3b` |

Tests: `sec-a-test` 33 checks (22 proven breaks), `sec-b-test` 16 (15), `sec-c-test` 30 (24), `sec-d-test` 20 (19).

## Decisions taken (the recommended answers; change any of them)

1. **Microsoft the only staff sign-in?** Yes, with one break-glass admin. Built as a database switch (phase B2), not only
   by giving staff random passwords (B1), so a leaked staff password cannot open anything.
2. **Multi-factor for every staff member?** Yes, through Microsoft Conditional Access (it covers Task Hub and the rest
   of Microsoft 365 at once). The authenticator code in Task Hub is for the password logins that remain.
3. **Who holds the break-glass password?** One director, in the company password manager, with two-step sign-in set
   up, tested once a quarter.
4. **Two-step sign-in for clients?** Offered, not required.
5. **Plain `http://` evidence links refused?** That item belongs to the ISO site (its handover, D11).
6. **Idle limit?** Suggested 8 hours (`SESSION_IDLE_MINUTES=480`): one working day, so nobody is signed out mid-task, but
   a computer left signed in overnight is not.

## Your steps, in order (dev project first, then production)

Claude never changes Entra, Supabase or Vercel settings and never runs SQL. Each step says how to undo it.

### 1. Deploy the branch (no behaviour change)

Deploy `security-sso` when you are happy with it (`git push origin security-sso:main`). After it, the live site has the
new headers and the pinned library; everything else waits for its switch. To undo: Vercel, promote the previous
deployment.

Check after deploying: the site loads, you can sign in, a PDF preview and an Excel export still work (they load
libraries the content security policy must allow).

### 2. Microsoft sign-in (phase A)

1. Microsoft Entra: app registration, single tenant, redirect `https://<project>.supabase.co/auth/v1/callback`.
2. Client secret, 24 months. Put the expiry date in the calendar: sign-in breaks when it lapses.
3. Token configuration: add the optional claims `email` and `xms_edov`. Without `xms_edov`, Supabase does not treat the
   Microsoft email as verified and a sign-in can create a second, empty account instead of opening the existing one.
4. Supabase, Authentication, Providers: Azure on, tenant URL `https://login.microsoftonline.com/<tenant id>`.
5. Supabase, Authentication, URL configuration: Site URL `https://taskhub.etchersolutions.com`; redirect allow-list
   only the https production address(es) and `http://localhost:3001` for development.
6. Vercel: `MICROSOFT_SIGNIN=1`, redeploy.
7. Test: a staff member signs in with Microsoft and lands as themselves (in Supabase, Users, one row with two
   identities, not two rows); someone with no account gets no access; a removed staff member is refused.
8. Conditional Access: require multi-factor sign-in for everyone who uses the app.

To undo: remove `MICROSOFT_SIGNIN` in Vercel (the button disappears; passwords work as before).

### 3. Idle sign-out

Vercel: `SESSION_IDLE_MINUTES=480`, redeploy. To undo: remove it.

### 4. Two-step sign-in

1. Supabase, Authentication: check multi-factor (TOTP) is enabled (it is by default).
2. Vercel: `TWO_STEP_SIGNIN=1`, redeploy.
3. The break-glass admin signs in with their password, opens "Two-step sign-in", scans the QR code, confirms with a
   code, signs out, and checks that signing in now asks for the code.

To undo: remove `TWO_STEP_SIGNIN` (the button disappears; anyone who already set one up is still asked for it, by
design).

### 5. Staff use Microsoft only (phase B2)

1. Apply `supabase/migrations/018_staff_sign_in_with_microsoft.sql` (SQL editor; it changes nothing by itself). It
   includes migration 016's rule, so it is right whether or not you applied 016.
2. Check a Microsoft session really says "oauth": sign in with Microsoft, then in the browser console run
   `JSON.parse(atob((await window._supabase.auth.getSession()).data.session.access_token.split('.')[1])).amr`. It must
   list `"method":"oauth"`. If it shows anything else, stop and tell Claude.
3. Add the break-glass admin (after step 4.3):
   `insert into public.break_glass_accounts (email, note) values ('<their email>', 'break-glass');`
4. Switch on: `update public.security_settings set staff_microsoft_only = true, updated_at = now() where id = 1;`
5. Test: a staff password sign-in is refused with "Staff accounts sign in with Microsoft"; Microsoft sign-in works; the
   break-glass admin gets in with password plus code; a client login is unaffected.

To undo, at once: `update public.security_settings set staff_microsoft_only = false, updated_at = now() where id = 1;`
The file also has a complete roll-back.

## HTTPS: where things stand

| Item | State |
|---|---|
| The live site is https only (http redirects) | Live (Vercel) |
| HSTS two years with subdomains, no framing, nosniff, content security policy as a header | Built (part A), live after step 1 |
| Login library pinned with an integrity hash | Built (part A), live after step 1 |
| Calls to Supabase over https and wss only | The content security policy's `connect-src`, live after step 1 |
| Supabase redirect allow-list: https addresses only (plus localhost for development) | Your step 2.5 |
| Email links on the real address | Built (part A); also set `APP_URL=https://taskhub.etchersolutions.com` in Vercel to be explicit |
| HSTS preload list | Later, once the whole `etchersolutions.com` domain is on https |
| The local dev server stays plain http on this computer only | Built (part A) |

## Known limits

- The content security policy still allows inline scripts (`'unsafe-inline'`, `'unsafe-eval'`), because the app is one
  page with inline handlers. Removing that is the long-term item T4 in the audit report.
- A session already open when someone is removed lasts until its token expires (up to an hour), unless migration 016
  (or 018, which includes it) is applied: then it stops at once.
- The "oauth" name in step 5.2 comes from how Supabase records Microsoft sign-ins; it is checked on your dev project
  before anything depends on it.
