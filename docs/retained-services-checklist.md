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

## Added the evening of 22 October
- [ ] On a retained board, the **Month** list next to Columns says "This month (N earlier hidden)": tasks finished before this month are hidden, not archived. Pick an earlier month to see what was finished then (the group headers show that month's figures), or All months.
- [ ] Click a "document revision task(s) added" notification: the board opens on those tasks, highlighted. An older one opens the client page. A new client request notification opens the client page.
- [ ] Open a task, change its status, priority and progress: the **Audit trail** at the bottom of Details lists each change with who and when (the Activity tab shows the same). Moving the progress slider twice in a row is one entry.
- [ ] Retained Services dashboard: **Queue** and **Clients** tabs. The queue is grouped by client (close a group from its name), shows 25 rows then Show more. Clients has a search and an order (order added, most allowance used, support tier). Needs attention is one line per client.

## Fixes from the audit (23 October)
- [ ] Retainer plan: switch a service from Items to Hours, then pick last month in the board's Month list: last month still reads by items. The plan says "earlier months keep the plan they had".
- [ ] Untick every senior consultant on a plan with a Senior consult part: a warning says every hour counts to Admin. Last month's senior hours stay where they were.
- [ ] Log an hour on an untagged task under a service whose only part is "Tasks tagged Audit": the client page's hours log says "Not counted".
- [ ] Set a task finished last month to Client Approved, then Completed: it stays counted in last month, and its progress stays at 100%.
- [ ] On a retained board, This month: a task finished last month with a subitem finished this month still shows.
- [ ] Retained Services dashboard, Clients tab: click the "late" count: the Queue opens on late work with every filter cleared.
- [ ] Retainer plan: type a review note, change an owner before saving: the note is still there.
- [ ] Portal, Retained Services tab: type a request title, click Attach files and cancel: the title is still there a minute later.
- [ ] Portal: each service lists this month's work, with "N finished before (month)" under it. A request whose work is finished shows **Delivered** and an **Open the work** button; a declined one shows "Why we declined" in red.
- [ ] Portal: a request sent with files lists the file names (no download; the client already has them).

## The rest of the audit (23 October, second batch)
- [ ] Months close on the 10th of the next month. After that, archive a task finished in a closed month: that month's figure on the board's Month list and in the portal's Earlier months stays the same.
- [ ] A service with quarterly hours: the quarter runs from the retainer's start month (a February start has Feb to Apr). The client page's hours log says which quarter.
- [ ] Portal, Earlier months: an hours service shows the month's hours, and the quarter's hours under it. Months before the retainer started are not shown.
- [ ] Open a task and tick it done, cycle its status, complete it from My Week, drag it to another group, move it on the Gantt: each shows in the task's Audit trail once. Saving the full task window lists only what you changed.
- [ ] Dragging a task to another group takes its subitems along.
- [ ] Click an old notification for a board that was deleted: the board you were on stays open.
- [ ] Open work from a notification: the Month list shows All months for that visit; open the board again and it is back to This month.
- [ ] New retained board with a start month in the past: the monthly jobs start this month (no pile of overdue copies).
- [ ] Try to restore an ended retained board while the client has a running one: it says to end the running one first.
- [ ] Retainer plan: Remove asks first. A lead or senior consultant who has left shows as "(left)".
- [ ] Retained Services dashboard: Needs attention shows eight lines, then Show more. The "allowances at 80%" count opens Clients, most used first. On a client page with more than 12 jobs, "See them in the queue" opens the queue for that client. Arrow keys move along the tabs.
- [ ] Portal: on a phone, each job shows its due date. Attach files can be reached with the Tab key. A note about a request opens My Requests. Someone who has left is not under Your team.

## Security switches (when ready; steps in docs/security/client-portal-security.md)
- [ ] Supabase: Confirm email on, leaked password protection on, minimum password length 12.
- [ ] Supabase: real SMTP, and the site in the redirect URLs. Then Vercel `CLIENT_EMAIL_LINK=1`, and test with your own second email.
- [ ] Vercel `SESSION_IDLE_MINUTES=480` and `TWO_STEP_SIGNIN=1`.
- [ ] Decide on Microsoft sign-in for clients (guests in Etcher's tenant, recommended).
