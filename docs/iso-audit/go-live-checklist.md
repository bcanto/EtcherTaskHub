# ISO Audit — go-live checklist (release-1 B6, your steps)

These are the steps only you can do. Claude never runs SQL, never touches production and never deploys
without your say-so. Do them in order; each one says how you know it worked.

## 1. Supabase dev project (B6.7 — the plan's STOP 3)

1. In Supabase, create a new project called **taskhub-dev** (same region as production, Sydney).
2. Open **SQL editor** and run these files from `supabase/migrations/`, one at a time, **in this exact
   order** (011 depends on 015's `iso_audit_snapshots` table, so it has to run after it, not before,
   despite the lower number):
   `009_iso_core.sql`, `010_iso_evidence.sql`, `014_iso_doc_prompts.sql`, `015_iso_history.sql`,
   `011_iso_reports.sql`.
   Each one is safe to run twice.
3. Run the verification queries at the end of `009_iso_core.sql` (section "Verification"). Every query
   should return the empty result its comment describes.
4. Create a storage bucket named **iso-evidence**, private, 25 MB file limit.
5. Put the dev project's URL, anon key and service-role key in a file `dev.env` (never commit it), then
   start the local server against it: `node serve.mjs --envfile dev.env`. Sign in as a staff user and as
   a client user — the client must not see ISO until a board is shared with them.

**Done when:** the four migrations ran without errors and the verification queries are empty.

## 2. Sign in with Microsoft (B6.8)

1. **Microsoft Entra admin centre → App registrations → New registration.**
   - Name: *Etcher Task Hub*.
   - Supported account types: **Accounts in this organisational directory only (Etcher only — single tenant)**.
   - Redirect URI (Web): `https://<your-supabase-project>.supabase.co/auth/v1/callback`.
2. In the new app: **Certificates & secrets → New client secret** (24 months). Copy the **value** now.
3. Note the **Application (client) ID** and the **Directory (tenant) ID**.
4. **Supabase → Authentication → Providers → Azure:** turn it on, paste the client ID and secret, and set
   **Azure Tenant URL** to `https://login.microsoftonline.com/<Directory (tenant) ID>` — this is what
   restricts sign-in to Etcher accounts.
5. In Vercel (and in `dev.env` for testing), set `MICROSOFT_SIGNIN=1`. The **Sign in with Microsoft**
   button appears on the login screen only when this is set. The email + password login stays as the
   emergency way in — keep at least one admin with a password.
6. **Microsoft 365 → Security → Conditional Access:** require multi-factor sign-in for every admin.

**Done when:** you sign in with your Microsoft account on the dev site and land in Task Hub as yourself.

## 3. Operations (B6.9)

- **Supabase → Authentication → Rate limits:** keep sign-in attempts low (the defaults are fine; check
  they are on).
- **Backups:** move production to a plan with daily backups, then do **one test restore** into a scratch
  project and open it.
- **Breach plan:** one page — who decides, who tells clients, and the 30-day assessment under Australia's
  Notifiable Data Breaches scheme (OAIC). Keep it with the company policies.
- **Key rotation note:** where the Supabase service-role key and the MCP secret live, and how to replace
  them (Supabase → Settings → API → roll; update Vercel env; redeploy).
- **Vercel:** a paid plan for business use.

## 4. Go-live sequence (B6.10)

1. **Commit** — tell Claude "commit and push" when you are happy (the `iso-release-1` branch is local
   only until then).
2. **Deploy dark** — deploy with `ISO_ENABLED` not set. Nothing ISO is visible.
3. **Apply the migrations to production** — the same five files, in the same order, in production's SQL
   editor (you, not Claude). Create the **iso-evidence** bucket there too.
4. **Turn ISO on for staff** — set `ISO_ENABLED=1` in Vercel and redeploy.
5. **Pilot board** — one real gap analysis for one client, staff only, delivered with the Excel workbook.

## What changed on the live site with B6 (for your awareness)

- The live site now sends proper security headers (HSTS, no framing, the same content policy as before).
- The login library is a fixed, checked copy (`vendor/supabase-js-2.117.3.umd.js`) instead of "whatever
  version the CDN serves today". To upgrade it later, ask Claude to re-vendor and re-hash it.
- Shared progress links now stop working a year after they were made (the share dialog shows the date).
  Links made before this change keep working until you revoke them.
