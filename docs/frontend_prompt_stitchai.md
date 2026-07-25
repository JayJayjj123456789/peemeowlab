# Frontend Design Prompt — JaiKrajok (ใจกระจก)

Build a web interface for an emotion-aware study buddy targeting Thai students (ages 15-22) who study late at night while stressed. This is not a productivity app or clinical tool—it's a supportive friend who explains homework and understands when you're burnt out.

---

## Visual Direction

**Palette:**
- Dark mode only: five stepped surfaces from `#08090E` (deepest) → `#0E0F16` → `#15171F` → `#1C1F2B` → `#252938` (lightest)
- Tint grays toward indigo-violet (late-night study lighting)
- Text: `#E8E9F0` primary, `#9CA3B8` secondary (never pure white)
- Accent: `#52C4F5` cyan-blue (calm, breath, mirror reflection)
- Emotion indicators: `#52C4F5` neutral, `#E0A76F` stressed, `#7BCCB5` positive (subtle glows, not full-screen washes)

**Typography:**
- Display: `'Noto Sans Thai', 'Inter', system-ui` — tracking `-0.02em`
- Body: `'Sarabun', 'Inter', system-ui` — line-height `1.65` minimum (Thai needs more space)
- Mono: `'IBM Plex Mono', monospace`
- All sizes fluid via `clamp()`: display `clamp(2rem, 5vw, 3.5rem)`, body `clamp(1rem, 2vw, 1.125rem)`

**Layout:**
- CSS Grid for page structure (not flex)
- Conversation: centered column, max-width `42rem`
- Input bar: sticky bottom, glass effect (`backdrop-filter: blur(12px)`)
- Emotion indicator: floating card top-right with glowing orb icon

**Components:**
- Buttons: pill shape (`border-radius: 999px`), cyan primary, transparent secondary with border
- Message bubbles: fully rounded with small tail, user messages right-aligned `#252938`, bot messages left-aligned `#15171F` with `2px solid #52C4F5` left border
- Input: auto-expanding textarea (max 5 lines), cyan send button when active
- Crisis messages: warm amber border `#E0A76F` instead of cyan, phone icon, larger text

**Interaction:**
- No spinners—use skeleton shapes with pulse
- Typing indicator: three cyan dots with bounce
- Emotion state transitions: `600ms ease-in-out` color shift
- Focus rings: `2px solid #52C4F5` with `outline-offset: 2px`

---

## Design Tokens (declare as CSS custom properties first)

```css
/* Colors */
--surface-1: #08090E;
--surface-2: #0E0F16;
--surface-3: #15171F;
--surface-4: #1C1F2B;
--surface-5: #252938;
--text-primary: #E8E9F0;
--text-secondary: #9CA3B8;
--accent-cyan: #52C4F5;
--emotion-neutral: #52C4F5;
--emotion-stressed: #E0A76F;
--emotion-positive: #7BCCB5;

/* Spacing */
--space-xs: 0.5rem;
--space-sm: 1rem;
--space-md: 1.5rem;
--space-lg: 2.5rem;
--space-xl: 4rem;

/* Radius */
--radius-full: 999px;
--radius-lg: 1.5rem;
--radius-md: 1.25rem;
--radius-bubble: 1.5rem 1.5rem 0.25rem 1.5rem;

/* Typography */
--font-display: 'Noto Sans Thai', 'Inter', system-ui;
--font-body: 'Sarabun', 'Inter', system-ui;
--font-mono: 'IBM Plex Mono', monospace;
```

Reference these via `var(--surface-3)` everywhere—never hardcode hex values in component styles.

---

## Component Specifications

**ChatBubble (user message):**
- Align: right
- Background: `var(--surface-5)`
- Text: `var(--text-primary)`
- Border radius: `var(--radius-bubble)`
- Max width: `70%`
- Timestamp below: `var(--font-mono)`, `var(--text-secondary)`, small size

**ChatBubble (bot message):**
- Align: left
- Background: `var(--surface-3)`
- Border left: `2px solid var(--accent-cyan)`
- Text: `var(--text-primary)`
- Icon: small abstract mirror/heart glyph (not emoji)

**InputBar:**
- Position: sticky bottom
- Background: `rgba(14, 15, 22, 0.85)` with `backdrop-filter: blur(12px)`
- Grid: `auto / 1fr / auto` (emoji picker | textarea | send button)
- Textarea: auto-expand max 5 lines, placeholder `var(--text-secondary)`
- Send button: pill, `var(--accent-cyan)` when text present, disabled gray when empty

**EmotionIndicator:**
- Position: fixed top-right with margin
- Background: `var(--surface-3)`
- Border radius: `var(--radius-lg)`
- Shadow: `0 4px 12px rgba(0, 0, 0, 0.3)`
- Content: glowing orb (CSS radial gradient) + label "รู้สึก [emotion]"
- Orb color changes with emotion state via `600ms ease-in-out` transition

**Button (primary):**
- Border radius: `var(--radius-full)`
- Background: `var(--accent-cyan)`
- Text: `var(--text-primary)`
- Padding: `var(--space-sm) var(--space-lg)`
- Hover: `transform: scale(1.02)`, increased shadow
- Transition: `200ms ease-out`

**TypingIndicator:**
- Three dots, `var(--accent-cyan)`, gentle bounce animation
- Inside a bot message bubble placeholder with skeleton background

---

## What to Avoid

- ❌ Pastel gradients (purple-to-pink)
- ❌ Corporate blue (`#0066FF`)
- ❌ Chatbot mascot illustrations
- ❌ Geometric background patterns
- ❌ Generic loading spinners
- ❌ Modal pop-ups for everything
- ❌ Desktop-first layouts
- ❌ Default Bootstrap/Tailwind/MUI styling

---

## Reference Aesthetic (feeling, not copying)

- Discord/LINE chat at night (calm, dark, not cluttered)
- Obsidian note-taking (focused, token-based)
- Linear issue tracker (opinionated palette, grid rhythm)
- Studying with a friend in a quiet library after hours—supportive, not clinical

---

## Copy Voice (Thai)

- Greeting: "สวัสดี ใจกระจกพร้อมช่วยเรื่องเรียนแล้วนะ 💙"
- Error: "ตอนนี้สมองเราสับสนอยู่หน่อย ลองใหม่ได้ไหม"
- Empty state: "ส่งข้อความมาได้เลย พร้อมฟังอยู่"
- Crisis response: Use exact wording from `api/app/bots/conversation.py` line 37-42

---

## Technical Context

- Backend: `https://team07.aiforthai.in.th/api/` (already deployed)
- Port: 20060 (reserved for frontend)
- Framework: React or Vue, no component library (build from scratch)
- Mobile-first: single column `<768px`, centered max `42rem` on desktop
- Accessibility: min `44px` touch targets, focus rings, AAA contrast, skip link

---

## Structure

```
frontend/
├── src/
│   ├── styles/
│   │   ├── tokens.css     # all custom properties first
│   │   └── global.css     # reset + body defaults
│   ├── components/
│   │   ├── ChatBubble.tsx
│   │   ├── InputBar.tsx
│   │   ├── EmotionIndicator.tsx
│   │   └── Button.tsx
│   └── pages/
│       └── Conversation.tsx
```

All styling must reference tokens via `var()`. No magic numbers.

---

## Success Test

A Thai student opens this at midnight stressed about an exam. Within 3 seconds they understand:
1. Safe space (dark, calm, no harsh branding)
2. For studying (input obvious, conversation visible)
3. Understands emotion (indicator present but subtle)

Looks like a quiet study companion, not mental health software or a productivity dashboard.
