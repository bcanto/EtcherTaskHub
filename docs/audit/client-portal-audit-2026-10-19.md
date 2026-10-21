# Client portal audit, 19 October 2026

Scope: the client portal as it stands on `retained-services` (Overview, Tasks, Board, Schedule, Request Work,
Notifications and the task window), at desktop and phone width, signed in as the sample client General Cranes. The ISO
Audits tab is left out because ISO is moving to its own site. Method: measured in a real browser (contrast, target sizes,
keyboard order, semantics), the impeccable detector run over `index.html`, and screenshots of every tab.

## Score

| Dimension | Before | After the major fixes |
|---|---|---|
| Accessibility | 2 | 3 |
| Performance | 3 | 3 |
| Responsive design | 2 | 3 |
| Theming | 1 | 1 |
| Implementation integrity | 2 | 2 |
| **Total** | **10 / 20** | **12 / 20** |

## Major findings: fixed 19 October 2026

| # | Finding | What changed | Test |
|---|---|---|---|
| 1 | On a phone the Tasks rows hid the task name (in "Waiting on you" it vanished, leaving a date and an Approve button) | The name gets the row's width (two lines, then an ellipsis), the date and chips sit under it, a row asking for an answer puts its buttons below. Wide screens are unchanged. | `portal-audit-test` |
| 2 | Grey, teal and amber text below the readable minimum on every tab (200 or more text elements; the header label was 1.7:1) | One muted ink `#5b6f84` (5.2:1 on white), teal text becomes `#31585a`, amber `#8a5200`, and the header label `#8da2b2` on navy. The Gantt date axis is shared with the staff timeline, so it is a little darker there too (colour only). | `portal-audit-test` |
| 3 | The task window was not a dialog: no role or name, focus stayed behind it, Escape did nothing, and its dark backdrop was announced as a button | Dialog role named by the task title, focus moves in and returns to the row that opened it, Tab stays inside, Escape closes it through the app's one Escape chain (after any dialog on top), the backdrop is no longer made a keyboard button. | `portal-audit-test` |

## Still open (none blocks a client)

| Priority | Finding | Suggested command |
|---|---|---|
| P2 | Screen readers cannot tell which tab is open: the tabs are `div`s with no "current" state, there is no `main` landmark, and Schedule, Request Work and Notifications have no heading | harden |
| P2 | The 60 second refresh redraws the whole tab, which throws a keyboard user's focus to the top and resets the Schedule's scroll (only typing in a field is protected, `_startPortalRefresh`) | harden |
| P2 | The filter dropdowns are 20px tall on a phone, below the 24px minimum (WCAG 2.5.8) | adapt |
| P2 | The Board's "With" column is cut off at desktop width ("HSEQ Coordin") with no ellipsis | layout |
| P2 | One action has two names: Overview says "Sign off" and "Request changes", Tasks says "Approve" and "Request Review" | clarify |
| P2 | Copy breaks the punctuation rule: arrows in date ranges, " · " separators, dashes in interface text | clarify |
| P2 | Design system drift: 28 colours, 9 font sizes and 5 corner radii outside DESIGN.md; the same list-row CSS written twice; a default-framework red on the notification badge | polish |
| P3 | Text symbols used as icons (the check, return arrow, warning triangle and caret) instead of drawn icons | polish |
| P3 | On a phone the tab strip cuts "Request Work" off with no hint that Notifications is further along | adapt |
| P3 | The Sign out button uses `transition: all` | polish |

## Notes for the next pass

- DESIGN.md's own "quiet text" colour `#7a96ad` is 3.1:1 on white. The portal now uses `#5b6f84`; the staff app still uses
  the lighter greys, and the same fix would help there (`/impeccable colorize`, then `document`).
- The portal restyle was layered over the older styles, which is why the duplicate rules and extra palette exist. One
  consolidation pass (polish) removes them.
