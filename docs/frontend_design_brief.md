# Frontend Design Brief — JaiKrajok (ใจกระจก)

**Project:** AI Emotion-Aware Study Buddy for Thai students  
**Context:** Currently LINE-only; this brief is for the web interface (port 20060)  
**Audience:** Thai secondary/university students, 15–22 years old, studying at night, stressed, on phones  

---

## Core principle

JaiKrajok means "mirror heart"—it reflects emotion back with understanding. The interface should feel like talking to someone who *gets it* when you're burnt out at 2 AM with unfinished homework. Not a productivity dashboard. Not a clinical mental health tool. A friend who happens to be good at explaining derivatives.

---

## Palette

**Base:** Dark, stepped in five surface levels, not flat black. Tint the grays toward indigo-violet—the color of late-night study sessions, dim bedroom lighting, blue light from screens.

- Deepest surface: `#08090E` (almost black, cool-tinted)
- Steps: `#0E0F16`, `#15171F`, `#1C1F2B`, `#252938`
- Don't use pure white anywhere. Text is `#E8E9F0` on dark, muted to `#9CA3B8` for secondary copy.

**Accent:** Single luminous color—soft cyan-blue `#52C4F5` (breath, calm, the "mirror" reflecting light). This is for active states, focus rings, emotion indicators when positive.

**Emotion colors** (subtle, never saturated):
- Neutral/calm: the base cyan `#52C4F5`
- Stressed/negative: muted amber `#E0A76F` (warm, not alarming red)
- Positive/motivated: soft mint `#7BCCB5`

Emotion indicators are small, glowing accents—not full-screen washes. Think of a tiny orb or underline that pulses, not a mood ring UI.

---

## Typography

**Families as CSS custom properties:**
```css
--font-display: 'Noto Sans Thai', 'Inter', system-ui;
--font-body: 'Sarabun', 'Inter', system-ui;
--font-mono: 'IBM Plex Mono', 'Courier New', monospace;
```

**Scale:** Fluid with `clamp()` for everything. No fixed `16px`.
- Display (page titles, "ใจกระจก"): `clamp(2rem, 5vw, 3.5rem)`, tight tracking `-0.02em`
- Heading (section labels): `clamp(1.25rem, 3vw, 1.75rem)`
- Body (chat messages, study Q&A): `clamp(1rem, 2vw, 1.125rem)`, line-height `1.65`
- Small (timestamps, metadata): `clamp(0.875rem, 1.5vw, 0.95rem)`

Thai typography needs more line-height than Latin. Never go below `1.6` for body copy with Thai characters.

---

## Layout

**Grid-first.** The page is a vertical rhythm of sections, each a `display: grid` with named areas. Flex only inside components (e.g., a button's icon + label).

**Structure:**
- Conversation area: Grid, centered column max `42rem` wide, margins fluid
- Input bar: Sticky bottom, grid with `auto / 1fr / auto` (emoji picker / text / send button)
- Emotion indicator: Positioned top-right as a small floating card, CSS Grid inside for icon + label

**Spacing:** Token-based, multiples of `0.5rem`. Define as custom properties:
```css
--space-xs: 0.5rem;
--space-sm: 1rem;
--space-md: 1.5rem;
--space-lg: 2.5rem;
--space-xl: 4rem;
```

Reference only via `var(--space-md)`, never hardcode `24px`.

**Radius:** Everything fully rounded.
- Buttons, chips: `border-radius: 999px` (pill)
- Message bubbles: `border-radius: 1.5rem 1.5rem 0.25rem 1.5rem` (chat-style, small tail)
- Cards, panels: `border-radius: 1.25rem`
- Avatar: `border-radius: 50%` (circle)

Store as `--radius-full: 999px`, `--radius-lg: 1.5rem`, etc.

---

## Components

### Chat message bubbles
- **User message:** Right-aligned, background `#252938` (lighter step), text `#E8E9F0`, pill shape
- **Bot message:** Left-aligned, background `#15171F` (darker step), subtle left border `2px solid #52C4F5` (the "mirror" edge)
- Timestamp below each bubble, `--font-mono`, muted `#9CA3B8`, small size
- No avatars unless user uploads a profile image; bot uses a small icon (abstract mirror/heart glyph, not emoji)

### Input bar
- Sticky bottom, glass effect: `background: rgba(14, 15, 22, 0.85)`, `backdrop-filter: blur(12px)`
- Text area auto-expands (max 5 lines), placeholder in muted color
- Send button: pill, cyan accent background when text is present, disabled gray when empty
- Emoji/attachment icon: left side, subtle, same muted color as secondary text

### Emotion indicator (top-right floating card)
- Small rounded card, `--radius-lg`, background same as message bubble
- Icon + label, horizontal flex inside a grid-positioned container
- Icon is a tiny glowing orb (CSS radial gradient or SVG), color matches emotion state
- Label: "รู้สึก [calm/เครียด/positive]" in body font, muted
- Subtle shadow: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)` (soft, not harsh)

### Buttons (general)
- Primary: pill shape, cyan background, white text, no border
- Secondary: pill, transparent background, cyan border `1px solid`, cyan text
- Hover: slight scale `transform: scale(1.02)`, increased shadow
- All transitions `200ms ease-out`

### Study Q&A results
- When bot explains a concept (e.g., math formula), display in a distinct card
- Background: one step lighter than message bubble (so `#1C1F2B` if bubble is `#15171F`)
- Headings inside the card use `--font-display` at heading size
- Code or formulas: `--font-mono`, slight background tint `rgba(82, 196, 245, 0.1)`

---

## Interaction

**No loading spinners.** Use skeleton shapes with a subtle pulse animation (`opacity` shift from `0.5` to `0.7`). The skeleton matches the shape of the expected content (message bubble outline, not a generic circle).

**Typing indicator:** Three dots, same cyan accent, gentle bounce animation. Inside a bot message bubble placeholder.

**Emotion transitions:** When emotion state changes (e.g., Sentiment API detects stress), the orb in the top-right card shifts color over `600ms ease-in-out`. No abrupt snaps.

**Crisis keyword response:** If bot detects crisis keywords and shows the 1323 hotline message, that message bubble gets a distinct warm amber left border (`#E0A76F` instead of cyan), larger text, and a small phone icon. Not alarming red—supportive warmth.

---

## Accessibility

- All interactive elements min `44px` touch target (mobile-first)
- Focus rings: `2px solid #52C4F5`, `border-radius` matches the element, `outline-offset: 2px`
- Color is never the only indicator—emotion states have icons + labels
- Text contrast: `#E8E9F0` on `#08090E` is >15:1, well above WCAG AAA
- Skip link for keyboard users to jump to input

---

## What NOT to do

- No pastel gradients, no purple-to-pink, no glassmorphism everywhere
- No corporate SaaS blue (`#0066FF` etc.), no default Bootstrap/Tailwind palette
- No chatbot mascot illustrations (cartoony robot, friendly blob)—this is not for children
- No "modern" geometric patterns in the background (abstract triangles, mesh gradients)
- No fixed desktop-first layout—design for phones, adapt to desktop
- No modal pop-ups for everything—keep flow in the conversation thread
- No separate "dashboard" with stats graphs (emotion trend is future scope, not Phase 1)

---

## Reference feeling (not visual copy)

- Late-night Discord or LINE chat, but calmer
- Obsidian note-taking app (dark, focused, not cluttered)
- Linear issue tracker (clean grid, token-based spacing, opinionated palette)
- The emotional tone of a friend who studies with you in a library after hours—supportive, not clinical

---

## Technical notes

- Responsive: single-column on `<768px`, conversation stays centered on desktop (don't fill ultra-wide)
- Backend API: `https://team07.aiforthai.in.th/api/` already exists; see `api/app/main.py` for routes
- Auth: TBD (Phase 1 was LINE-only; web may use simple session or LINE Login)
- Framework choice: React or Vue, component library none (build from scratch to match this aesthetic)

---

## Deliverable structure

```
frontend/
├── src/
│   ├── styles/
│   │   ├── tokens.css        # all custom properties (colors, spacing, radius, fonts)
│   │   └── global.css        # base reset, body defaults
│   ├── components/
│   │   ├── ChatBubble.tsx
│   │   ├── InputBar.tsx
│   │   ├── EmotionIndicator.tsx
│   │   └── Button.tsx
│   └── pages/
│       └── Conversation.tsx
└── README.md
```

All colors, spacing, and radius must be declared as custom properties in `tokens.css` first, then referenced via `var()`. No magic numbers in component styles.

---

## Tone of voice (copy)

- **Bot greeting:** "สวัสดี ใจกระจกพร้อมช่วยเรื่องเรียนแล้วนะ 💙" (warm, friend tone, not formal)
- **Error state:** "ตอนนี้สมองเราสับสนอยู่หน่อย ลองใหม่ได้ไหม" (self-deprecating, not "Error 500")
- **Empty state:** "ส่งข้อความมาได้เลย พร้อมฟังอยู่" (inviting, not "Start a conversation!")
- **Crisis response:** Already defined in `conversation.py`—keep that exact wording

---

## Success criteria

A Thai student opens this at midnight, stressed about an exam. Within 3 seconds they know:
1. This is safe to vent in (dark, calm palette, no harsh branding)
2. It's for studying (input bar is obvious, chat history visible)
3. It understands emotion (floating indicator is present but non-intrusive)

The interface doesn't look like mental health software. It looks like a quiet study space with someone who listens.
