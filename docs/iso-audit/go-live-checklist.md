# ISO Audit — go-live checklist (release-1 B6, your steps)

These are the steps only you can do. Claude never runs SQL, never touches production and never deploys
without your say-so. Do them in order; each one says how you know it worked.

## 1. Supabase dev project (B6.7 — the plan's STOP 3)

1. In Supabase, create a new project called **taskhub-dev** (same region as production, Sydney).
2. Open **SQL editor** and run **`supabase/dev/000_dev_bootstrap.sql`** first — this is a dev-project-only
   file (never run it against production): it sets up `auth.users` → `profiles` wiring, three helper
   functions, and makes a brand-new sign-up start with no access until promoted. Without this, a real
   Supabase sign-in gets no profile row and nothing works. Its own check queries are in a comment at
   the bottom (3 checks: the `role` default, 4 RLS policies on `profiles`, the 3 helper functions exist).
3. Then run these files from `supabase/migrations/`, one at a time, **in this exact order** (011 depends
   on 015's `iso_audit_snapshots` table, so it has to run after it, not before, despite the lower number):
   `009_iso_core.sql`, `010_iso_evidence.sql`, `014_iso_doc_prompts.sql`, `015_iso_history.sql`,
   `011_iso_reports.sql`.
   Each one is safe to run twice.

   *(Prefer one paste instead of six? `supabase/dev/combined-dev-setup.sql` has all six files
   concatenated in this exact order, generated from the real files above by
   `node .agents/_build-dev-setup.cjs`. If one of those six files changes later, rerun that command —
   never hand-edit the combined copy; the test suite fails while it is out of date.)*
4. Run the check queries in the `── Check (read-only) ──` comment near the end of `009_iso_core.sql`.
   Every query should return the empty/expected result its own comment describes.
5. Create a storage bucket named **iso-evidence**, private, 25 MB file limit.
6. Put the dev project's `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in a file
   named exactly **`.env.dev`** in the project folder. That name is gitignored (`git check-ignore .env.dev`
   prints a rule); `dev.env` is **not**, so don't use it. Never paste these values into a chat.
7. Run the database verifier yourself: `node .agents/iso-db-verify.cjs`. It reads `.env.dev` only,
   refuses to run against production, and checks the real database the way the offline tests check
   the offline store (numbering, append-only and no-delete triggers, RLS refusing anon and client
   keys, every ISO function refused from the browser). Expect `FAIL (0)`.
8. Start the local server against the dev project: `node serve.mjs --envfile .env.dev`. Sign in as a
   staff user and as a client user — the client must not see ISO until a board is shared with them.
   (A brand-new sign-up starts as role `client` with no access by design — promote your own test
   accounts to `admin`/`staff` via the Supabase table editor on `profiles` before testing staff features.)

**Done when:** all six files ran without errors, every check query returned what its comment says, and
`iso-db-verify` shows `FAIL (0)`.

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
5. In Vercel (and in `.env.dev` for testing), set `MICROSOFT_SIGNIN=1`. The **Sign in with Microsoft**
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
3. **Apply the migrations to production** — the same five `supabase/migrations/` files from step 1.3,
   same order, in production's SQL editor (you, not Claude). **Not** `000_dev_bootstrap.sql` — that one
   is dev-only (its own header says so) and production already has the real `profiles`/auth wiring from
   the numbered production migrations. Create the **iso-evidence** bucket there too.
4. **Turn ISO on for staff** — set `ISO_ENABLED=1` in Vercel and redeploy.
5. **Pilot board** — one real gap analysis for one client, staff only, delivered with the Excel workbook.

## What changed on the live site with B6 (for your awareness)

- The live site now sends proper security headers (HSTS, no framing, the same content policy as before).
- The login library is a fixed, checked copy (`vendor/supabase-js-2.117.3.umd.js`) instead of "whatever
  version the CDN serves today". To upgrade it later, ask Claude to re-vendor and re-hash it.
- Shared progress links now stop working a year after they were made (the share dialog shows the date).
  Links made before this change keep working until you revoke them.
