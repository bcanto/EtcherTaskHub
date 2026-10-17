# Sign-in with Microsoft (SSO) and HTTPS: plan

> **Replaced 18 October 2026** by `docs/security/sso-https-plan.md`, which covers Task Hub itself, says what is
> built and lists your steps. This draft is kept for its reasoning. The ISO site has its own copy in its handover.

Status: draft for decision, 2026-10-16. Nothing here is built or switched on yet beyond what
"Already in place" says. Decide the open questions at the end before the ISO pilot.

## Why now

The ISO pilot puts a client's gap analysis, evidence files and report in Task Hub. Today a staff
login is an email and a password that Task Hub checks itself, with no second factor. If one password
leaks, every client's data is open. SSO moves staff sign-in to Etcher's Microsoft 365 account, where
multi-factor sign-in, leaver handling and sign-in logs already exist.

## Already in place

| Item | Where | State |
|---|---|---|
| "Sign in with Microsoft" button and flow (Supabase Azure provider) | index.html `signInWithMicrosoft`, `api/config.js` | Built in B6.8, hidden until `MICROSOFT_SIGNIN=1` |
| Setup steps for Entra + Supabase | go-live-checklist.md section 2 | Written, not done |
| New accounts start with no access (role client, no client) | migration 008 | Live |
| HTTPS on production, http redirects to https (308) | Vercel | Live (checked 2026-10-16) |
| HSTS, 2 years | Vercel default | Live, but without `includeSubDomains` |
| Full security headers: CSP, no framing, nosniff, HSTS with subdomains | vercel.json on retained-services | Ships with the ISO release; **not on production yet** (main has none of them) |
| Login library pinned and integrity-checked | vendor/supabase-js-2.117.3 | Ships with the ISO release |
| Calls to Supabase over https/wss only | CSP `connect-src` | Ships with the ISO release |

## Part 1: SSO for staff

### Who signs in how

| Who | Sign-in | Second factor |
|---|---|---|
| Etcher staff | Microsoft (Etcher tenant only) | Microsoft multi-factor, required by Conditional Access |
| One break-glass admin | Email and password, kept in a sealed place | Supabase authenticator-app MFA (Phase C) |
| Clients | Email and password (they are not in Etcher's tenant) | Optional authenticator-app MFA later (Phase C) |

### Phase A: switch it on, password stays (no code)

The user's steps (go-live-checklist section 2), done on the **dev** project first:

1. Entra app registration, single tenant, redirect `https://<project>.supabase.co/auth/v1/callback`.
2. Client secret (24 months; put the expiry date in the calendar, sign-in breaks when it lapses).
3. In the app's **Token configuration**, add the optional claims `email` and `xms_edov`. Supabase only
   treats a Microsoft email as verified with `xms_edov`; without it, a staff member's Microsoft sign-in
   can create a **second, empty account** instead of opening their existing one. (Verify on dev, step 6.)
4. Supabase Azure provider on, tenant URL `https://login.microsoftonline.com/<tenant id>`.
5. Supabase **Authentication > URL configuration**: Site URL `https://taskhub.etchersolutions.com`;
   redirect allow-list holds only the production https URL(s) and `http://localhost:3001` for dev.
6. Set `MICROSOFT_SIGNIN=1` in `.env.dev`, then test:
   - an existing staff member signs in with Microsoft and lands as **themselves** (same profile,
     same boards); in Supabase > Users their row shows two identities, not two rows;
   - someone with no Task Hub account signs in with Microsoft and gets **no access** (migration 008);
   - a deactivated staff member (`profiles.active=false`) is refused;
   - sign-out, then back in, on the same browser.
7. Conditional Access: require multi-factor sign-in for everyone who uses the app (not only admins).
8. Same steps on production, then `MICROSOFT_SIGNIN=1` in Vercel.

Claude's part: none needed for the switch. If step 6 shows a duplicate account, a small fix (match on
email and link) is a separate, tested change.

### Phase B: staff use Microsoft only (decision needed)

Phase A adds a door; the password door stays open. To close it for staff:

| Option | What it does | Cost | Weakness |
|---|---|---|---|
| B1. Replace staff passwords with random ones nobody knows (break-glass admin keeps theirs) | Password sign-in fails for staff; Microsoft works | User does it in Supabase, no code | A "forgot password" email reopens it, unless reset emails are limited to the break-glass admin |
| B2. Server and database refuse a staff session not made through Microsoft | Enforced in code: `api/_isoAuth.js` / `api/_authAdmin.js` check how the session was made; an RLS check does the same for the app data | Code + migration (user applies), tests | Most work; needs care so the break-glass admin still gets in |
| B3. Stay at Phase A | Microsoft is the normal way in, password still works | Nothing | A leaked staff password still opens everything |

Recommended: **B1 for the pilot**, B2 after it if the pilot goes ahead with more clients.

Leavers: with B1 or B2, disabling the person in Microsoft 365 stops new sign-ins, but a session already
open can last until its token expires. Keep setting `profiles.active=false` on leaving (the server
already refuses inactive accounts on every ISO call).

### Phase C: MFA for the password logins that remain

Supabase authenticator-app MFA (TOTP) for the break-glass admin, and offered to clients. Needs a small
enrolment screen and a code prompt at login, plus a server check on staff-only actions. Build after the
pilot unless a client asks for it.

## Part 2: HTTPS

Production is already https-only. What is left is making sure nothing undoes that:

| # | Item | Who | Recommended |
|---|---|---|---|
| H1 | Ship the full header set (CSP, no framing, HSTS with subdomains) | Comes with the ISO deploy | Yes; it is already tested on retained-services |
| H2 | Supabase redirect allow-list: https production URLs only, plus localhost for dev | User, Supabase settings | Yes, part of Phase A step 5 |
| H3 | Evidence links typed by staff: refuse `http://`, accept `https://` only | Claude, small change in the evidence link check (`api/_iso.js`), with a test | Yes |
| H4 | Share links: built from the page's own https address | Already true (index.html share dialog) | No change |
| H4b | Links in emails use `APP_URL`, defaulting to `https://etcher-task-hub.vercel.app` (api/_email.js) | User, Vercel env | Set `APP_URL=https://taskhub.etchersolutions.com` so emails point at the real address |
| H5 | HSTS preload list | Needs the whole etchersolutions.com domain on https first | No, not for the pilot |
| H6 | Local server stays http on localhost | Dev only, never reachable from outside | Leave as is |

## Order of work

1. Deploy the ISO release dark (go-live checklist section 4.2), which also brings H1.
2. Phase A on dev, then production (the user, about an hour; Claude helps check step 6).
3. H3 (Claude, one small tested change) and H4b (the user, one Vercel setting).
4. Phase B1 before the first real client board.
5. Pilot.
6. After the pilot: B2 and Phase C if the work continues.

## Open questions (recommended answer first)

1. **Make Microsoft the only staff sign-in for the pilot?** Recommended: yes, B1 (random passwords,
   one break-glass admin). Alternative: Phase A only.
2. **Multi-factor for every staff member, or admins only?** Recommended: every staff member, through
   Conditional Access (it covers Task Hub and the rest of Microsoft 365 at once).
3. **Who holds the break-glass admin password?** Recommended: one director, stored in the company
   password manager, tested once a quarter.
4. **Client MFA?** Recommended: not for the pilot; offer it when Phase C is built.
5. **Refuse plain http evidence links (H3)?** Recommended: yes.
