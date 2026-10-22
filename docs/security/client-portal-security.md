# Client portal security: review and next steps

22 October 2026. Written for Bruna and the directors. Companion to `docs/security/sso-https-plan.md` (staff sign-in).

## 1. What was checked today (the Retained Services work)

| Area | Result |
|---|---|
| What the portal receives about a retainer | Built field by field on the server (`api/_portal.js`, `sliceRetainer`). New fields are totals only: items done and in progress, hours used per part. Never: time entries, who logged hours, staff ids, the senior consultant list, fees, rates. A test checks this on every run (`retained14-test`). |
| Hidden work | Renewal tasks and anything marked hidden never appear and never count towards the client's allowance, items or hours (`retained10-test`, `retained14-test`). |
| Work requests | The service a client picks is checked on the server against the client's own boards (`workRequestRef`); a client cannot file a request against another client's work. Retainer requests now come from the Retained Services tab, ad hoc ones from Request Work. |
| Text typed by staff that clients see | Hour part names, decline reasons and notes are escaped wherever they show; none goes into a click handler. |
| Staff-only actions | Changing hours or parts in the plan is admin only; declining a request needs a staff login (`requireInternalUser`); the hours log is on the staff client page only. |
| Client logins | Until now staff typed the client's password, and the login was created already "confirmed": the client never proved the email was theirs. Fixed behind a switch (section 3, step 2). |

Nothing found that exposes one client's data to another, or staff-only data to a client.

## 2. Where client security stands

| Control | State |
|---|---|
| HTTPS, security headers, pinned sign-in library | Live |
| Portal data cut down on the server (each client gets only its own slice) | Live |
| Idle sign-out (`SESSION_IDLE_MINUTES`) | Built, applies to clients too. Off until set. |
| Two-step sign-in with an authenticator app (`TWO_STEP_SIGNIN`) | Built, offered to clients from the portal header. Off until set. |
| Email-link logins (`CLIENT_EMAIL_LINK`) | Built today. Off until set. |
| Microsoft sign-in | Built for staff only (Etcher's tenant). Clients: see section 4. |

## 3. Recommended now (no new code)

1. **Supabase, Authentication settings:** check that the email provider has *Confirm email* on, turn on *Leaked password protection*, set the minimum password length to 12, and leave the default rate limits on. Consider *Bot protection* (Cloudflare Turnstile) on sign-in.
2. **Email-link logins for clients:**
   1. Supabase, Authentication, *SMTP*: use a real mail service (Microsoft 365 or a sending service). Supabase's built-in sender is rate-limited and not meant for live use.
   2. Supabase, Authentication, *URL configuration*: the Site URL and redirect list include `https://taskhub.etchersolutions.com`.
   3. Vercel: `CLIENT_EMAIL_LINK=1`, and optionally `SITE_URL=https://taskhub.etchersolutions.com`. Redeploy.
   4. Test with your own second email: add it as a client portal login, open the email, set a password, sign in.

   From then on a new client login is the email only. The client confirms the address and sets their own password; nobody at Etcher knows it. Existing client logins keep working.
3. **Idle sign-out:** Vercel `SESSION_IDLE_MINUTES=480` (8 hours), as already planned for staff. It applies to clients too.
4. **Two-step sign-in:** Vercel `TWO_STEP_SIGNIN=1`. Clients see a "Two-step sign-in" button in the portal header. Recommended: ask clients whose portal holds sensitive documents (licences, audit findings) to turn it on.

## 4. Microsoft sign-in for clients

Many clients already use Microsoft 365. Letting them sign in with their own Microsoft account gives them their own company's protections: their MFA, their password policy, and their offboarding (when someone leaves the client company, their access to Etcher's portal ends too).

**The constraint:** Supabase allows one Microsoft (Azure) provider, and ours is locked to Etcher's tenant so that only Etcher staff can use it. Opening it to every Microsoft tenant would weaken the staff side.

| Option | How it works | Verdict |
|---|---|---|
| A. Clients as guests in Etcher's tenant (Entra B2B) | An admin invites a client user as a guest in Etcher's Microsoft tenant. They sign in to Etcher's portal with their *own* company account through the existing "Sign in with Microsoft" button. Etcher's Conditional Access can require MFA for guests, or trust the client's MFA. | **Recommended.** No change to the Supabase provider. Free up to 50,000 monthly guest users. Removing the guest ends their access at once. |
| B. Open the provider to all organisations (multi-tenant) | Any Microsoft work account can sign in; the server would have to tell staff from clients by tenant id. | Not recommended: one mistake in that check would let an outside account reach staff screens. |
| C. Microsoft for staff, email link plus two-step for clients | What is built today, once switched on. | Fine for clients without Microsoft 365. Keep it alongside A. |

**Option A, step by step:**

1. Turn on email-link logins first (section 3, step 2), so each client user has a login tied to their real address.
2. Entra admin centre, *External Identities*: allow guest invitations by admins only. In *Cross-tenant access settings*, choose whether to trust a client's MFA (simpler for them) or require Etcher's own (stricter).
3. Entra, *Conditional Access*: a policy for guest users of the Task Hub app that requires MFA. Report-only first, then on.
4. Invite the client user as a guest with the same email as their portal login. Supabase links a Microsoft sign-in to an existing login only when it treats both emails as verified, and Microsoft does not always mark the email as verified. Test with one friendly client first. If it does not link, the step 5 change links it on the server, using the email the client confirmed.
5. Small app change, to build when wanted (about a day, with tests): in the portal, a "Sign in with your company Microsoft account" option for clients; in Client Manager, a per-client choice of "Email link" or "Microsoft (guest)"; and a check that a client's Microsoft sign-in email matches the client's own email domain.

**Decide before step 5:** should a client whose company uses Microsoft 365 be *required* to use it (strongest; their offboarding then governs access), or only *offered* it?

## 5. Further improvements (later)

- **Email domain lock per client:** portal logins for a client only on that client's own email domain (for example `@generalcranes.com.au`), with an override for personal or contractor addresses. This stops a mistyped address from becoming a working login. Small change.
- **Sign-in history:** record each client sign-in (when, from what device or IP) in the audit trail, visible to admins. Useful for ISO evidence and incident checks.
- **Review client access each quarter:** a list of client logins, last sign-in, and whether two-step is on; remove anyone not used for 90 days.
- **Report a suspicious sign-in:** a short "this wasn't me" path for clients that signs out every session for that login.
