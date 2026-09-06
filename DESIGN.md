---
name: Etcher Task Hub
description: Operations control surface for Etcher Solutions — workboards, timesheets, approvals and client comms in one dense, calm interface.
colors:
  navy: "#0d1c33"
  teal: "#97bcbd"
  teal-hover: "#7aa3a4"
  teal-dim: "rgba(151,188,189,0.12)"
  slate: "#8da2b2"
  page-ground: "#edf0f5"
  surface: "#ffffff"
  surface-raised: "#f7f9fc"
  surface-sunken: "#f1f4f8"
  border: "#e4eaf3"
  border-mid: "#d8e0ec"
  text-1: "#0f1929"
  text-2: "#3d5269"
  text-3: "#7a96ad"
  status-neutral: "#64748b"
  status-progress: "#1d6fb8"
  status-review: "#6d28d9"
  status-waiting: "#b45309"
  status-blocked: "#b91c1c"
  status-approval: "#0d6e4e"
  status-approved: "#065f46"
  status-done: "#15803d"
typography:
  display:
    fontFamily: "Jost, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Jost, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Jost, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Lato, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Jost, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.07em"
rounded:
  sm: "6px"
  control: "8px"
  md: "10px"
  lg: "14px"
  modal: "16px"
  xl: "18px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "28px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.teal-hover}"
    textColor: "{colors.navy}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.teal-dim}"
    textColor: "{colors.navy}"
  button-small:
    rounded: "{rounded.control}"
    padding: "5px 11px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
  chip-status:
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  tag-pill:
    backgroundColor: "#e6eff8"
    textColor: "#4d6275"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  nav-item:
    textColor: "#3e5c75"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  nav-item-active:
    textColor: "#e2eef6"
    backgroundColor: "{colors.teal-dim}"
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-1}"
    height: "38px"
    padding: "0 10px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.modal}"
    width: "680px"
---

# Design System: Etcher Task Hub

## Overview

**Creative North Star: "The Quiet Control Room"**

Task Hub is where Etcher Solutions runs its work: crane inspections, HSEQ coordination, client approvals, timesheets and the money that follows them. The interface behaves like a well-built control room. A navy chassis holds the edges of the screen; inside it, white instrument surfaces carry dense, precisely ruled information. Teal is the only voice that raises itself, and it does so sparingly — on the thing you are looking at now, the thing you can act on, the thing that just changed.

Density is a feature here, not a compromise. An operator opening a workboard expects to see thirty rows, not eight, and to read status without reading words — the colour of a chip and the position of a dot do that work before the label does. So the system spends its budget on legibility at small sizes: Jost for anything structural (labels, headings, buttons, table columns), Lato for anything a human wrote (descriptions, comments, notes). The two never swap roles.

Calm under load is the governing constraint. Nothing pulses, nothing slides in from the side to announce itself, nothing competes with the data. Motion exists to explain a state change and then get out of the way. Depth is almost subliminal — surfaces are separated by tone first and shadow second, and every shadow is tinted navy so the interface never picks up the grey cast of a generic admin panel.

**Key Characteristics:**
- Navy chassis, white instruments, teal signal — in that order of area
- Information density treated as the product, not as clutter
- Two fonts with fixed roles: Jost structures, Lato speaks
- Status communicated by colour and shape before it is communicated by text
- Depth that you feel rather than see; navy-tinted, never black
- Quiet at rest, responsive on interaction

## Colors

A cool, low-temperature palette built on one deep navy and one desaturated teal, with a wide neutral range doing most of the visible work and a saturated status set reserved entirely for meaning.

### Primary
- **Deep Instrument Navy** (`{colors.navy}`): The chassis. Sidebar fill, primary button fill, all headings, and the tint colour for every shadow in the system. It is the darkest value present and it anchors the screen at the left edge and the top of the type hierarchy.
- **Muted Signal Teal** (`{colors.teal}`): The single accent. Active navigation, focus rings, the primary call-to-action fill, active tab underlines, and the 3px bar marking the current nav item. Desaturated on purpose — it reads as an instrument indicator, not a marketing colour.
- **Teal Pressed** (`{colors.teal-hover}`): Hover and pressed state for teal fills.
- **Teal Wash** (`{colors.teal-dim}`): 12% teal, used as the hover ground for ghost buttons and nav items so hover reads as warmth rather than as a box.

### Neutral
- **Cool Page Ground** (`{colors.page-ground}`): The canvas behind every card and table. Never white — white is reserved for surfaces that hold content.
- **Instrument White** (`{colors.surface}`): Cards, panels, modals, table body, the task side panel.
- **Raised Tint** (`{colors.surface-raised}`): Subtly lifted rows and sub-rows inside tables.
- **Sunken Tint** (`{colors.surface-sunken}`): Section grounds, chip backgrounds, hover fills on quiet controls.
- **Hairline** (`{colors.border}`) and **Hairline Strong** (`{colors.border-mid}`): Dividers and input strokes. The strong variant is for anything a user can type into.
- **Ink** (`{colors.text-1}`): Headings and primary body.
- **Ink Muted** (`{colors.text-2}`): Secondary body, ghost button labels.
- **Ink Quiet** (`{colors.text-3}`): Uppercase micro-labels, table column headers, captions, placeholder-adjacent text.

### Tertiary — Status
Status colours are not decoration and are never reused as brand colours. Each status carries a text colour, a chip background and a dot, and the three must move together.

| Status | Text | Chip | Dot |
|---|---|---|---|
| Not Started | `#64748b` | `#f1f5f9` | `#94a3b8` |
| Ready to Start | `#1d4ed8` | `#dbeafe` | `#60a5fa` |
| In Progress | `#1d6fb8` | `#e8f2fc` | `#60a5fa` |
| In Review | `#6d28d9` | `#ede9fe` | `#a78bfa` |
| Waiting on Client | `#b45309` | `#fef3c7` | `#fbbf24` |
| Needs Changes | `#b45309` | `#fef3c7` | `#fbbf24` |
| Change Requested by Client | `#92400e` | `#fef3c7` | `#f59e0b` |
| Blocked | `#b91c1c` | `#fef2f2` | `#f87171` |
| Sent for Approval | `#0d6e4e` | `#d1fae5` | `#34d399` |
| Client Approved | `#065f46` | `#a7f3d0` | `#10b981` |
| Completed & Approved | `#065f46` | `#6ee7b7` | `#10b981` |
| Completed | `#15803d` | `#dcfce7` | `#4ade80` |
| Cancelled | `#78716c` | `#f5f5f4` | `#a8a29e` |

Priority uses a parallel four-step ramp: Low `#475569` on `#f1f5f9`, Medium `#b45309` on `#fffbeb`, High `#c2410c` on `#fff7ed`, Critical `#b91c1c` on `#fef2f2`.

### Named Rules

**The One Signal Rule.** Teal marks exactly one thing per region: the active nav item, the focused field, the primary action. If two teal elements compete for attention inside the same panel, one of them is wrong.

**The Green Means Approved Rule.** The green band (`#0d6e4e` through `#15803d`) belongs to the approval lifecycle and nothing else. Never use green for a generic success toast, a positive metric, or an accent — in this product green is a contractual state.

**The Navy Shadow Rule.** Every shadow, ring and overlay is tinted `#0d1c33`. Pure black and neutral grey shadows are prohibited; they flatten the palette's cool cast into generic admin grey.

## Typography

**Display Font:** Jost (with `sans-serif` fallback)
**Body Font:** Lato (with `sans-serif` fallback)

Loaded as `Jost:wght@300;400;500;600;700` and `Lato:wght@300;400;700`.

**Character:** Jost is geometric, slightly condensed at small sizes, and holds uppercase tracking without falling apart — which is why it carries every label, column header, button and heading. Lato is humanist and warm at 13px, which is why it carries every sentence a person actually wrote. The pairing reads as machine-structure containing human-content, and that distinction is the whole point.

### Hierarchy
- **Display** (Jost 700, 30px, line-height 1.1, tracking -0.02em): KPI and statistic values only. The largest type in the product is a number.
- **Headline** (Jost 700, 24px, tracking -0.01em): Page titles.
- **Title** (Jost 700, 17px, tracking -0.01em): Panel titles, modal headers, card headings. Intermediate steps of 22px, 20px, 18px and 16px exist for nested contexts.
- **Body** (Lato 400, 13px, line-height 1.6): Descriptions, comments, notes, table cells. 12px for secondary body inside dense rows.
- **Label** (Jost 700, 10.5–11px, tracking 0.06–0.08em, uppercase): Section headers, table column headers, property labels, stat captions. This is the most characteristic type in the system.

### Named Rules

**The Two Roles Rule.** Jost structures, Lato speaks. Headings, buttons, labels, nav, table headers and status chips are Jost. Anything a user typed — descriptions, comments, meeting notes, client messages — is Lato. Never set a heading in Lato or a paragraph in Jost.

**The Tracked Label Rule.** Any uppercase label under 12px carries at least 0.06em letter-spacing and weight 700. Uppercase without tracking is illegible at these sizes and reads as a bug.

**The Number Is The Hero Rule.** In any statistic or KPI, the value gets Display treatment and the caption gets Label treatment. Never the reverse, and never set them at similar sizes.

## Layout

A fixed 215px navy sidebar pinned to the left, with the main content region offset by exactly that width and filling the remaining viewport. The sidebar never scrolls with the page; it owns navigation, the current user, and Sign Out at its foot.

Content is organised as cards on the cool page ground, with 20px internal padding and consistent vertical rhythm between them. Data-heavy views abandon cards for full-bleed tables: rows are 38px tall, sub-rows sit on a raised tint, group headers are 36px, and a 14px spacer row separates groups so the eye can find the boundaries without a heavy rule.

Tables carry a sticky header (`top: -1px`) and live inside a bounded-height scroll container, so the column labels stay readable at any scroll depth. Because a sticky header requires a scroll container, the page-level container must not itself scroll — that constraint is load-bearing and should not be "simplified" away.

The task detail panel slides in from the right as a fixed overlay with its own header, tab strip and independently scrolling body. Its properties are laid out as a label/value list: a fixed 66px uppercase label column and a flexible value column, with each row about 30px tall.

Spacing steps in use: 4, 8, 12, 16, 20 and 28px. Component padding is drawn from this scale — buttons 8×16, small buttons 5×11, nav items 6×11, cards 20, modal headers 24×28×16.

Responsive behaviour is narrow: this is a desktop operations tool. A single breakpoint at 540px collapses the smallest layouts, and 700px stacks the My Week grid. Below roughly 820px the main table scrolls horizontally rather than reflowing — preserving column alignment matters more than fitting a phone.

### Named Rules

**The Sidebar Is Furniture Rule.** The navy rail is fixed at 215px and is never collapsed, themed, or re-coloured per view. It is the one constant on screen.

**The Bottom Alignment Rule.** Long scrolling surfaces end where the sidebar's Sign Out button sits. Board content that stops well short of the viewport bottom, leaving dead space, is a layout bug.

## Elevation & Depth

Depth is ambient and deliberately close to subliminal. Surfaces are separated by tone first — page ground, then white surface, then raised and sunken tints — and shadow is applied only to say "this floats above the page". Cards at rest carry a shadow you would struggle to point at; modals carry one you can. Every shadow in the system is a two-layer stack (a tight contact shadow plus a wide diffuse one) plus a hairline ring, and every one is tinted navy at low opacity.

### Shadow Vocabulary
- **Hairline** (`0 1px 2px rgba(13,28,51,0.05), 0 0 0 1px rgba(13,28,51,0.04)`): Chips, small controls, anything that needs an edge more than a lift.
- **Card** (`0 1px 3px rgba(13,28,51,0.05), 0 4px 12px rgba(13,28,51,0.05), 0 0 0 1px rgba(13,28,51,0.04)`): Default resting elevation for cards and panels.
- **Raised** (`0 2px 8px rgba(13,28,51,0.07), 0 12px 28px rgba(13,28,51,0.06), 0 0 0 1px rgba(13,28,51,0.04)`): Hover state on interactive cards; dropdowns anchored to a control.
- **Floating** (`0 4px 16px rgba(13,28,51,0.1), 0 24px 48px rgba(13,28,51,0.08), 0 0 0 1px rgba(13,28,51,0.05)`): Popovers, menus, the people picker.
- **Overlay** (`0 8px 32px rgba(13,28,51,0.13), 0 40px 80px rgba(13,28,51,0.09), 0 0 0 1px rgba(13,28,51,0.06)`): Modals only.

Modal overlays use `rgba(8,18,34,0.55)` with a 7px backdrop blur — the page behind stays legible as context but is clearly out of reach.

### Named Rules

**The Tone Before Shadow Rule.** Reach for a surface tint before reaching for a shadow. Shadow is reserved for elements that genuinely leave the page plane: menus, popovers, modals, the sliding task panel.

**The Two-Layer Rule.** Never ship a single-layer `box-shadow`. Every elevation is contact plus diffuse plus ring; a lone blur reads flat and cheap at these low opacities.

## Shapes

Corners are gently rounded and consistently scaled to element size: 6px on small controls and inline selects, 8px on buttons, inputs and nav items, 10px on cards, 14px on large panels, 16px on modals, 18px on the largest surfaces. Anything that represents a piece of metadata rather than a container — status chips, tag pills, priority badges — is fully pill-shaped at 20px. Avatars are perfect circles with a 2px white ring, and stack with a -6px overlap when a task has several assignees.

Borders are hairlines: 1px `{colors.border}` for dividers and structure, stepping up to 1.5px for anything interactive that a user can type into or click through. The heavier stroke is how an input announces itself without needing a fill.

### Named Rules

**The Pill Means Metadata Rule.** Full pill radius (20px) is reserved for status, priority and tags. A pill-shaped button would read as a status chip and is prohibited.

**The Radius Follows Size Rule.** Radius scales with the element. A 6px radius on a modal or an 18px radius on a chip both break the form language.

## Components

### Buttons
- **Shape:** Gently rounded (8px), 8×16px padding, Jost 13px weight 600.
- **Primary (teal):** Teal fill `{colors.teal}` with navy text `{colors.navy}` at weight 700 — the inversion of the usual dark-button convention, and the product's signature action. Carries a soft teal-tinted shadow.
- **Primary (navy):** Navy fill with white text, for confirmations and dense contexts where teal would over-signal.
- **Ghost:** Transparent with a 1.5px hairline border and muted ink. On hover the border turns teal, the text goes navy, and the ground fills with teal wash.
- **Hover / Focus:** Only `transform` and `box-shadow` transition, on `cubic-bezier(0.2,0,0,1)`. Focus-visible is a 2px teal outline at 2px offset — present on every interactive element without exception.
- **Small:** 5×11px padding at 12px, for inline row actions.

### Chips
- **Status:** Pill (20px), 3×8px padding, 12px weight 600. Background and text both come from the status table; they are never mixed across statuses.
- **Tag:** Pill, `#e6eff8` ground with `#4d6275` text at 11px weight 600, with an inline remove affordance on hover.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Instrument white on the cool page ground.
- **Shadow Strategy:** Card elevation at rest; Raised on hover only when the whole card is clickable.
- **Border:** 1px `rgba(13,28,51,0.04)` — a ring, not a visible frame.
- **Internal Padding:** 20px.

### Inputs / Fields
- **Style:** White ground, 1.5px `{colors.border}` stroke, 8px radius, 8×12px padding, Lato 13px.
- **Focus:** Border shifts to teal and a 3px `rgba(151,188,189,0.2)` glow appears. No outline, no colour change to the fill.
- **Inline table inputs:** Chrome is stripped entirely — no border, no background, just a 2px teal bottom rule. Editing in a table should not make the table jump.

### Navigation
- **Style:** Jost 12px weight 500 on the navy rail, resting ink `#3e5c75`.
- **Hover:** Teal wash ground, teal text.
- **Active:** Text lifts to `#e2eef6`, weight 600, a left-to-right teal gradient fills the item (20% → 5%), and a 3px teal bar is inset on the left edge.
- **Sections:** Collapsible with a chevron; items can be pinned to the top of the rail.

### Task Detail Panel (signature)
The product's most distinctive surface. A right-side overlay with a fixed header (editable title, status and priority pills, an overflow menu), a tab strip, and a scrolling body. The body is organised into four collapsible sections — Properties, Description, Comments, Client Thread — each with a chevron, an optional count badge, and a one-line "peek" of its content shown only while collapsed. Section open/closed state persists per user.

Inside Properties, fields are compact label/value rows (66px uppercase label, flexible value, ~30px tall). Assignees are a single overlapping avatar stack rather than a list of controls; clicking it opens a picker where each click cycles a person through assign → promote to lead → unassign. Destructive actions live in the header overflow menu, never loose at the bottom of the scroll.

### Data Tables
Sticky white header at 34px with Jost 11px uppercase column labels in quiet ink. Rows 38px, hairline-separated, with a hover tint of `#f4f8ff`. Row actions are hidden at `opacity: 0` and revealed on row hover. Selected rows tint blue, except status and priority cells, which keep their own colour and take an inset overlay instead — the status colour must survive selection.

## Do's and Don'ts

### Do:
- **Do** keep teal to a single element per region — the One Signal Rule is the difference between a control room and a dashboard demo.
- **Do** set every label under 12px in Jost 700 uppercase with at least 0.06em tracking.
- **Do** tint every shadow, ring and overlay with navy `#0d1c33`.
- **Do** pull status and priority colours from the tables above as a triple (text + chip + dot); they are never chosen individually.
- **Do** give every interactive element hover, `:focus-visible` and active states. Focus-visible is a 2px teal outline at 2px offset.
- **Do** collapse long user-entered text — descriptions, comments, notes — behind an expand affordance. Pasted content must never be allowed to dominate a panel.
- **Do** reach for a surface tint before a shadow when separating two areas.
- **Do** keep the panel and table chrome dense: 38px rows, 30px property rows, 34px headers.

### Don't:
- **Don't** use pure black or neutral-grey shadows, or a single-layer `box-shadow`.
- **Don't** use green outside the approval lifecycle, or any status colour as a decorative accent.
- **Don't** set a heading in Lato or a paragraph in Jost.
- **Don't** give a button a full pill radius — pills mean metadata.
- **Don't** use `transition: all`; animate `transform` and `opacity` (and `box-shadow` on buttons) only.
- **Don't** introduce a third font family or a second accent colour.
- **Don't** let a scroll container wrap the page-level view — it breaks the sticky table headers, which are load-bearing.
- **Don't** leave an overflowing tab strip or toolbar scrollable without hiding its scrollbar; a scrollbar sitting above a bottom border reads as a doubled rule.
- **Don't** trade density for whitespace in data views. Fewer visible rows is a regression, not a cleaner design.
