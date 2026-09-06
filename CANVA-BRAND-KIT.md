# Etcher Task Hub — Brand Kit for Canva

Every value below is extracted from `index.html` (the live app), not invented. Use these to build Canva designs that match the product exactly.

Canva setup: **Brand Hub → Brand Kits → Add colours / Add fonts / Upload logo.**

---

## 1. Core palette

Add these to a Canva colour palette named **Etcher Core**.

| Name | Hex | Where it's used |
|---|---|---|
| Navy | `#0D1C33` | Sidebar background, primary buttons, headings |
| Teal | `#97BCBD` | Primary accent, active states, CTA buttons |
| Teal Hover | `#7AA3A4` | Button hover |
| Slate | `#8DA2B2` | Muted labels, secondary icons |
| Page Background | `#EDF0F5` | App canvas behind cards |
| Surface | `#FFFFFF` | Cards, panels, modals |
| Surface 2 | `#F7F9FC` | Subtle raised rows |
| Surface 3 | `#F1F4F8` | Section dividers, chip backgrounds |

**Tip:** Canva's palette limit is generous but scannable — keep Etcher Core to these 8 and put the rest in secondary palettes below.

### Text colours

| Name | Hex | Use |
|---|---|---|
| Text 1 | `#0F1929` | Headings, primary body |
| Text 2 | `#3D5269` | Secondary body |
| Text 3 | `#7A96AD` | Captions, uppercase micro-labels |

### Borders

| Name | Hex |
|---|---|
| Border | `#E4EAF3` |
| Border Mid | `#D8E0EC` |

---

## 2. Typography

Two families only. Never use one for both roles.

| Role | Font | Weights in use | Canva equivalent |
|---|---|---|---|
| Headings, buttons, nav, micro-labels | **Jost** | 300, 400, 500, 600, 700 | Jost (available in Canva) |
| Body copy, comments, tables | **Lato** | 300, 400, 700 | Lato (available in Canva) |

Google Fonts source used by the app:
```
https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&family=Lato:wght@300;400;700&display=swap
```

### Type rules from the app

- Headings (`h1`–`h5`): Jost, `letter-spacing: -0.01em` — in Canva, set letter spacing to about **-10**.
- Uppercase micro-labels (section headers, table columns): Jost, **10–11px**, weight **700**, `letter-spacing: 0.06–0.08em` — in Canva, letter spacing about **+70**, and turn on All Caps.
- Body: Lato, 12–13px, generous line height (**1.6–1.7**).
- Buttons: Jost, 13px, weight 600 (700 on the teal button).

Canva works in points, not pixels. For a 1:1 match on screen-size graphics, use the pixel numbers directly and design at 1× scale.

---

## 3. Status colours

Task statuses. Each has a text colour, a background chip, and a dot. Save as a Canva palette named **Etcher Status**.

| Status | Text | Chip background | Dot |
|---|---|---|---|
| Not Started | `#64748B` | `#F1F5F9` | `#94A3B8` |
| Ready to Start | `#1D4ED8` | `#DBEAFE` | `#60A5FA` |
| In Progress | `#1D6FB8` | `#E8F2FC` | `#60A5FA` |
| In Review | `#6D28D9` | `#EDE9FE` | `#A78BFA` |
| Waiting on Client | `#B45309` | `#FEF3C7` | `#FBBF24` |
| Needs Changes | `#B45309` | `#FEF3C7` | `#FBBF24` |
| Change Requested by Client | `#92400E` | `#FEF3C7` | `#F59E0B` |
| Blocked | `#B91C1C` | `#FEF2F2` | `#F87171` |
| Sent for Approval | `#0D6E4E` | `#D1FAE5` | `#34D399` |
| Client Approved | `#065F46` | `#A7F3D0` | `#10B981` |
| Completed & Approved | `#065F46` | `#6EE7B7` | `#10B981` |
| Completed | `#15803D` | `#DCFCE7` | `#4ADE80` |
| Cancelled | `#78716C` | `#F5F5F4` | `#A8A29E` |

## 4. Priority colours

| Priority | Marker | Text | Background |
|---|---|---|---|
| Low | ▼ | `#475569` | `#F1F5F9` |
| Medium | ● | `#B45309` | `#FFFBEB` |
| High | ▲ | `#C2410C` | `#FFF7ED` |
| Critical | ‼ | `#B91C1C` | `#FEF2F2` |

---

## 5. Shape and depth

### Corner radius

| Token | Value | Applied to |
|---|---|---|
| Small | `6px` | Inputs, small chips |
| Medium | `10px` | Cards, panels |
| Large | `14px` | Modals |
| X-Large | `18px` | Hero surfaces |
| Pill | `20px` | Status chips, tag pills |

Canva: set corner rounding on rectangles to match. A Canva "rounding" slider value of roughly 10–15 % gives the 10px card look at typical card sizes.

### Shadows

The app layers two shadows plus a hairline ring. Canva only offers a single shadow per element, so use the closest approximation:

| Level | Real CSS | Canva approximation |
|---|---|---|
| Card | `0 1px 3px rgba(13,28,51,0.06), 0 4px 12px rgba(13,28,51,0.04)` | Blur 12, Offset 4, Transparency 6 %, colour `#0D1C33` |
| Raised | `0 2px 8px rgba(13,28,51,0.07), 0 12px 28px rgba(13,28,51,0.06)` | Blur 28, Offset 12, Transparency 8 %, colour `#0D1C33` |
| Floating / modal | `0 8px 32px rgba(13,28,51,0.13), 0 40px 80px rgba(13,28,51,0.09)` | Blur 60, Offset 30, Transparency 12 %, colour `#0D1C33` |

Shadows are always tinted navy `#0D1C33` at low opacity — never neutral black.

---

## 6. Component recipes

Rebuild these in Canva when mocking up screens or making marketing graphics.

**Card**
Fill `#FFFFFF` · Radius 10px · Padding 20px · Border 1px `rgba(13,28,51,0.04)` · Card shadow.

**Primary button (teal)**
Fill `#97BCBD` · Text `#0D1C33` · Jost 13px weight 700 · Padding 8×16px · Radius 8px.

**Primary button (navy)**
Fill `#0D1C33` · Text `#FFFFFF` · Jost 13px weight 600 · Padding 8×16px · Radius 8px.

**Status chip**
Fill = status chip background · Text = status text colour · 12px weight 600 · Padding 3×8px · Radius 20px.

**Tag pill**
Fill `#E6EFF8` · Text `#4D6275` · 11px weight 600 · Padding 2×8px · Radius 20px.

**Sidebar**
Width 215px · Fill `#0D1C33` · Nav item text `#3E5C75` · Active nav item: text `#E2EEF6`, 3px teal `#97BCBD` bar on the left edge, background gradient `rgba(151,188,189,0.20)` → `rgba(151,188,189,0.05)` left to right.

**Avatar**
Circle · 2px white ring · Stacked avatars overlap by 6px.

---

## 7. Logos

Already in the project root — upload these to the Canva Brand Kit:

| File | Use |
|---|---|
| `Etcher_Logo_2026.png` | Primary logo, light backgrounds |
| `Etcher White Logo.png` | Light backgrounds, reversed |
| `etcher TASK HUB white logo.png` | Task Hub product lockup, dark backgrounds |
| `etcher TASK HUB white logo nobg.png` | Task Hub lockup, transparent — preferred for Canva |
| `favicon_taskapp.png` | App icon, favicons, small square marks |

Put the white/no-background lockup on navy `#0D1C33` — that is the app's own sidebar treatment and the most on-brand pairing.

---

## 8. Do not

- Do not use default Canva blues or purples as a primary — teal `#97BCBD` on navy `#0D1C33` is the brand pair.
- Do not use pure black `#000000` for text or shadows. Text is `#0F1929`; shadows are tinted `#0D1C33`.
- Do not set headings and body in the same font. Jost for headings, Lato for body.
- Do not use a flat neutral drop shadow. Always low-opacity navy.
- Do not invent new status colours — pull from the table in section 3 so graphics match the app.
