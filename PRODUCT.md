# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Etcher Solutions staff** (Perth, Western Australia): consultants, project managers and admins running client work in Task Hub every day: workboards, timesheets, approvals, retained services and client communications.
- **Clients**: see what Etcher shares with them through the client portal (their tasks, board, schedule, requests, retained services) and answer what is waiting on them: sign-offs, change requests, information.

## Product Purpose

Task Hub is Etcher's operations control surface: one place for client work, time, approvals and communication. Success: staff run their day from it without a spreadsheet on the side, and a client can see where their work stands, and act on it, without an email.

## Areas

- **Workboards**: one board per engagement, with the Main Table, Kanban, list, timeline and capacity views.
- **Retained Services**: one permanent board per retained client, an allowance meter that resets monthly, and requests that arrive from the portal. Retained hours never reach the hourly pro forma.
- **Timesheets and billing**: hours logged against a task or a client; payroll and billing are kept apart (a pro forma edit never writes back to an approved time entry); pro forma invoices and the Xero export.
- **Client portal**: Overview, Tasks, Board, Schedule, Request Work, Notifications and, for retained clients, Retained Services.

## Capabilities and Constraints

- Single-page web app (`index.html`) and a Node API in `api/`; Supabase in production, an offline copy for local work and tests.
- Client-visible vs staff-only is a hard boundary on every record.
- No AI service inside the app.
- Sign-in: email and password, Microsoft sign-in for staff, optional two-step codes and idle sign-out (each behind its own switch).
- The ISO audit module moved to its own site on 20 October 2026 (see `docs/iso-moved.md`).

## Brand Commitments

- Name: Etcher Solutions; product: Task Hub.

## Evidence on Hand

- No customer testimonials, benchmarks or published case studies exist; never fabricate them.

## Product Principles

1. **Few clicks, nothing hidden behind hover.** If a task takes several screens or needs explaining, simplify it.
2. **Status at a glance.** Colour and shape say where something stands before the label does.
3. **Challenge every element.** Anything that needs training or adds steps without value is redesigned or removed.
4. **Keep the intelligence, hide the machinery.** Calculations, permissions, visibility rules and audit trails stay, behind progressive disclosure rather than on every screen.
