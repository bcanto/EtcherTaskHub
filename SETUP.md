# Email Intake Setup — Etcher Task Hub

This guide covers everything needed to activate the Email Triage Zone so that emails
forwarded to `taskhub@etchersolutions.com` automatically appear as draft tasks on the dashboard.

---

## What you can do right now (no credentials needed)

The Triage Zone UI is already live on the dashboard. To preview it:

1. Start the dev server: `node serve.mjs`
2. Log in as admin
3. On the Dashboard, click **"+ Test email"** in the Email Triage Zone
4. A sample email appears — click **Route →** to turn it into a task

---

## Step 1 — Create the shared mailbox in Microsoft 365

> Requires: Microsoft 365 Global Admin role

1. Go to **Microsoft 365 Admin Center** → Users → Shared mailboxes
2. Click **+ Add a shared mailbox**
3. Display name: `TaskHub Intake`
4. Email: `taskhub@etchersolutions.com`
5. Click **Save**

No license required for shared mailboxes.

---

## Step 2 — Register an Azure AD App

> Requires: Azure AD Global Admin or Application Administrator

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → App registrations
2. Click **+ New registration**
   - Name: `Etcher TaskHub Email Intake`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: leave blank
3. Click **Register**. Copy the **Application (client) ID** and **Directory (tenant) ID**.

### Add API permissions

1. In your app registration → **API permissions** → **+ Add a permission**
2. Choose **Microsoft Graph** → **Application permissions**
3. Add these permissions:
   - `Mail.Read`
   - `Mail.ReadWrite`
4. Click **Grant admin consent for [your organisation]** ✓

### Create a client secret

1. In your app registration → **Certificates & secrets** → **+ New client secret**
2. Description: `TaskHub Intake Secret`
3. Expiry: 24 months (set a calendar reminder to rotate before it expires)
4. Copy the **Value** immediately — you cannot retrieve it later

---

## Step 3 — Configure environment variables

Copy `.env.example` to `.env` and fill in:

```env
# Supabase (existing)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...

# Email Intake — Microsoft Graph
TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CLIENT_SECRET=your-client-secret-value
MAILBOX_UPN=taskhub@etchersolutions.com
WEBHOOK_URL=https://your-public-url.ngrok.io   # see Step 4
TASKHUB_API=http://localhost:3001
```

**Never commit `.env` to git.** It is already in `.gitignore`.

---

## Step 4 — Expose your local server publicly (dev only)

Microsoft Graph webhooks require a public HTTPS URL to deliver notifications.

### Using ngrok (recommended for dev)

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3001
```

Copy the `https://xxxx.ngrok.io` URL and set it as `WEBHOOK_URL` in `.env`.

> In production, deploy behind a real domain with HTTPS (Azure App Service, Fly.io, etc.)
> and set `WEBHOOK_URL=https://yourdomain.com`.

---

## Step 5 — Run the email intake service

Start both processes in separate terminals:

```bash
# Terminal 1 — web server
node serve.mjs

# Terminal 2 — email intake service
node email-intake.mjs
```

On startup, `email-intake.mjs` will:
1. Authenticate with Microsoft Graph
2. Poll the inbox for any unread messages
3. Register a webhook subscription for near real-time delivery (requires `WEBHOOK_URL`)
4. Poll every 5 minutes as a fallback

---

## Step 6 — Test end-to-end

1. From any email client, forward an email to `taskhub@etchersolutions.com`
2. Within ~30 seconds (webhook) or up to 5 minutes (poll fallback), the email appears in the Triage Zone on the dashboard
3. Click **Route →** to select a workboard, group, assignee, due date, and priority
4. Click **Create Task & Route** — the email becomes a task in the chosen workboard
5. The original email is marked as read and moved to a **TaskHub Processed** folder

---

## Alternative ingestion methods (fallbacks)

If Microsoft 365 setup is delayed, these alternatives work without Azure AD:

### Option A — SendGrid Inbound Parse

1. Add an MX record pointing `taskhub.etchersolutions.com` to SendGrid's servers
2. In SendGrid Dashboard → Settings → Inbound Parse → Add Host & URL
   - Host: `taskhub.etchersolutions.com`
   - URL: `https://your-server.com/api/intake`
3. SendGrid POSTs a `multipart/form-data` payload to your URL. Adapt `email-intake.mjs` to parse this format.

### Option B — Mailgun Routes

Similar to SendGrid. In Mailgun → Receiving → Create Route:
- Expression: `match_recipient("taskhub@etchersolutions.com")`
- Action: `forward("https://your-server.com/api/intake")`

### Option C — IMAP polling (universal fallback)

```bash
npm install imapflow
```

Replace the Graph poll in `email-intake.mjs` with:

```js
import { ImapFlow } from 'imapflow';
const client = new ImapFlow({
  host: 'outlook.office365.com', port: 993, secure: true,
  auth: { user: MAILBOX_UPN, pass: MAILBOX_PASSWORD },
});
// connect, search UNSEEN, fetch, process
```

Requires storing the mailbox password in `.env`. Less secure than app-only Graph auth.

---

## Subscription renewal

Graph webhook subscriptions expire after 48 hours. `email-intake.mjs` automatically renews
them every 47 hours while the process is running.

For production, use a process manager (PM2, systemd) to keep `email-intake.mjs` alive:

```bash
npm install -g pm2
pm2 start email-intake.mjs --name taskhub-intake
pm2 save
pm2 startup
```

---

## Security notes

- Only emails from `etchersolutions.com` (and domains in `ALLOWED_DOMAINS` in `email-intake.mjs`) create tasks. All others are quarantined (marked read, not imported).
- The Azure AD client secret should be rotated before it expires. Set a calendar reminder.
- In production, move the secret to Azure Key Vault and load it via Managed Identity.
- When Supabase migration goes live, the intake service should use the service role key (never the anon key) to write to the `email_intake` table — see `supabase/004_email_intake.sql`.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No emails appearing | Is `email-intake.mjs` running? Check terminal output |
| "No credentials found" | Check `.env` has TENANT_ID, CLIENT_ID, CLIENT_SECRET |
| Webhook not receiving | Is ngrok running? Does `WEBHOOK_URL` match ngrok URL? |
| "Permission denied" from Graph | Check admin consent was granted for Mail.Read + Mail.ReadWrite |
| Emails appear but fail to route | Open browser console — check for JS errors in the Route modal |
| Client secret expired | Rotate in Azure AD → App registrations → Certificates & secrets |
