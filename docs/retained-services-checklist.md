# Retained Services: what to check (22 October 2026)

Tick each one on the live site. Use a test client (or Daltech), not a real client's board.

## Boards
- [ ] On any board, add a task to a group that you have reordered by dragging: it appears at the bottom of that group and stays there after a refresh.
- [ ] Paste several lines into "+ Add item": they appear in the order pasted, at the bottom.
- [ ] Add a column, drag it between two built-in columns, and drag its edge wider: the cells move and resize with the header.

## New retained board
- [ ] Retained Services, + New retained board: nothing is ticked until you choose a bundle.
- [ ] Each bundle fills in its services; Plus lets you swap add-ons; Core greys out the add-ons.
- [ ] Switch HSEQ to **Hours**: it shows "HSEQ elements, 5 h a month, Everyone" and "Audits (mini and main), 8 h a quarter, Tasks tagged Audit".
- [ ] Switch Continuous Improvement to **Hours**: "Admin 8 h" and "Senior consult 3 h".
- [ ] Pick a Senior consultant at the top. The summary on the right shows "Hours a month".
- [ ] Starts is a list of months; Create stays off until the bundle is complete.

## On the board
- [ ] IMS reads "document revisions". A task set to In Progress shows a half orange square; Completed shows a full green one.
- [ ] Log 1.5 hours on a CI task as yourself: Admin shows 1 green square and a half square. Ask the senior consultant to log an hour: it fills Senior consult.
- [ ] Tag a HSEQ task "Audit" and log hours on it: they fill the Audits part, which reads "this quarter".
- [ ] Retainer plan: Track by Items or Hours on each service; edit a part's hours; tick senior consultants.

## Client page
- [ ] Overview: "Hours logged in October" lists each entry, who logged it and what it counts to.
- [ ] Training matrix: fills the width, counts under each heading, key on top, people in the order of the spreadsheet; "Most urgent first" reorders them.

## Requests
- [ ] On a new request (Clients or the Retained Services queue): **Decline** sits beside Add to Workboard and asks for a reason.
- [ ] The client's portal shows that request as Declined, with your reason.

## Client portal (sign in as a test client)
- [ ] Retained Services tab: green and half orange squares, hours parts where a service is in hours, and "Request work under your retainer" at the bottom.
- [ ] Request Work tab: only ad hoc and other boards, with a pointer to the Retained Services tab.
- [ ] Nowhere in the portal: who logged hours, fees, the hours log, registers or renewal tasks.

## Security switches (when ready; steps in docs/security/client-portal-security.md)
- [ ] Supabase: Confirm email on, leaked password protection on, minimum password length 12.
- [ ] Supabase: real SMTP, and the site in the redirect URLs. Then Vercel `CLIENT_EMAIL_LINK=1`, and test with your own second email.
- [ ] Vercel `SESSION_IDLE_MINUTES=480` and `TWO_STEP_SIGNIN=1`.
- [ ] Decide on Microsoft sign-in for clients (guests in Etcher's tenant, recommended).
