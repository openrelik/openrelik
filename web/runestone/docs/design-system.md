# Technical Console Design System

A design specification and architectural reference for high-density, professional technical console interfaces.

---

## Table of Contents

- [§1. Philosophy & Manifesto: The Technical Console](#1-philosophy--manifesto-the-technical-console)
- [§2. Color System & OKLCH Perceptual Contrast](#2-color-system--oklch-perceptual-contrast)
- [§3. Typography & Numerical Discipline](#3-typography--numerical-discipline)
- [§4. Shapes & Box Geometry](#4-shapes--box-geometry)
- [§5. Layout Architecture & Spatial Rules](#5-layout-architecture--spatial-rules)
- [§6. The Button System](#6-the-button-system)
- [§7. Surface Primitives: Sheets, Cards, and Wells](#7-surface-primitives-sheets-cards-and-wells)
- [§8. Form Controls & Inputs](#8-form-controls--inputs)
- [§9. Data Tables & Tabular Ergonomics](#9-data-tables--tabular-ergonomics)
- [§10. Floating Surfaces: Dialogs, Sheets, and Tooltips](#10-floating-surfaces-dialogs-sheets-and-tooltips)
- [§11. Keyboard Ergonomics & Interaction Patterns](#11-keyboard-ergonomics--interaction-patterns)
- [§12. Motion, Transitions & Accessibility](#12-motion-transitions--accessibility)
- [§13. Loading, Pending & Network States](#13-loading-pending--network-states)

---

## §1. Philosophy & Manifesto: The Technical Console

A console is an **instrument**, not a marketing surface.

Engineers, analysts, and operators use technical consoles to explore complex data structures, diagnose incidents, coordinate pipelines, and execute precision operations. The design principles of consumer applications (e.g. sprawling whitespace, decorative gradients, giant hero banners, and hidden functionality behind nested hamburger menus) fail in technical tools.

```
       Consumer Web App                        Technical Console
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  [Hero Wallpaper / Banner]   │        │ [Path / Prompt / Filter Bar] │
├──────────────────────────────┤        ├──────────────────┬───────────┤
│                              │        │  Fixed Data Grid │ Context   │
│   Card  (3 items visible)    │        │  (40+ rows)      │ Inspector │
│                              │        │                  │           │
├──────────────────────────────┤        ├──────────────────┴───────────┤
│  [Infinite Scroll Spinner]   │        │ [Status Bar: Counts & Hints] │
└──────────────────────────────┘        └──────────────────────────────┘
```

The technical console is governed by five non-negotiable principles:

1. **Information Density over White Space**  
   Every pixel must earn its presence. Users need to survey dozens of entities, statuses, timestamps, and relations simultaneously to form situational awareness. Whitespace is used as a deliberate separator, never as decorative filler.

2. **Calm, Low Visual Noise**  
   Colors and visual weights are strictly rationed. The interface is predominantly neutral so that when an accent color appears, it carries unambiguous semantic meaning (e.g. execution state, warning, active selection). Decorative borders, random colored badges, and shouting uppercase labels are eliminated.

3. **Zero Layout Jitter**  
   The interface must remain physically stable at all times. Content loading, cursor movement, hover states, and dynamic number updates must never push surrounding elements by a single pixel. Numbers and timestamps use fixed-width tabular lining numerals (`tabular-nums`). Row heights are locked.

4. **Keyboard-First Velocity**  
   The mouse is optional; the keyboard is primary. Every key operation (navigation, selection, filtering, inspection, execution, and dismissal) has a single-key or standard modifier shortcut. Navigating the console should feel as fluid and rapid as working in a high-performance terminal or code editor.

5. **A Physical, Predictable Mental Model**  
   Views represent contiguous spatial environments: a path bar at the top, a split workspace in the middle (listing alongside a contextual inspector), and a grounded status bar at the bottom. Surfaces sit on clear elevation planes: `canvas` → `surface` → `sunken` → `float`.

---

## §2. Color System & OKLCH Perceptual Contrast

The color system is constructed using the **OKLCH** color space (Lightness, Chroma, Hue). In legacy RGB/HSL models, different hues with the same "lightness" value have wildly different perceived brightness (e.g., yellow looks significantly brighter than blue). OKLCH guarantees perceptual uniformity: colors sharing a lightness value have identical perceived contrast against a given background.

### The Uniform Lightness Rule for Accents

To prevent any single status hue from shouting louder than its peers, **all semantic accents share an identical OKLCH lightness level**:

- **Dark Theme (`data-theme="dark"`)**: All accents sit at **OKLCH L 0.82**. Hue alone distinguishes them. Each accent clears at least **10:1** contrast on `--color-surface`.
- **Light Theme (`data-theme="light"`)**: All accents sit at **OKLCH L 0.449**. This is mathematically calculated as the lightest lightness level at which **every hue clears WCAG AAA (7:1)** against a pure white panel (`brand` 7.60:1, `success` 6.99:1, `warning` 7.56:1, `danger` 8.20:1).

```
   Dark Mode (OKLCH L = 0.82)                Light Mode (OKLCH L = 0.449)
┌────────────────────────────────┐        ┌────────────────────────────────┐
│ Brand:   #a9c7ee (> 10:1)      │        │ Brand:   #0052a7 (7.60:1, AAA) │
│ Success: #6fdea2 (> 10:1)      │        │ Success: #00673c (6.99:1, AAA) │
│ Warning: #edbb65 (> 10:1)      │        │ Warning: #724d00 (7.56:1, AAA) │
│ Danger:  #efb3b0 (> 10:1)      │        │ Danger:  #9d1426 (8.20:1, AAA) │
└────────────────────────────────┘        └────────────────────────────────┘
  Accents share equal visual weight         Accents share equal visual weight
```

### Semantic Token Palette

All tokens live in `src/assets/main.css`. A four-line script in `index.html` resolves `'system' | 'light' | 'dark'` onto `<html data-theme="...">` before first paint, so CSS only defines the dark `@theme` defaults and `:root[data-theme='light']`.

| Token Name                 | Dark Value | Light Value | Semantic Purpose & Usage                                                                                                |
| :------------------------- | :--------- | :---------- | :---------------------------------------------------------------------------------------------------------------------- |
| `--color-canvas`           | `#0e0e12`  | `#f2f2f5`   | Outer application viewport background.                                                                                  |
| `--color-surface`          | `#16161c`  | `#ffffff`   | Primary panel background (sheets, tables, dialog bodies).                                                               |
| `--color-sunken`           | `#1b1b22`  | `#f7f7fc`   | Recessed zones: table headers, code wells, status bars.                                                                 |
| `--color-border`           | `#26262f`  | `#e7e7ed`   | Structural borders between panels, rows, and splits.                                                                    |
| `--color-border-strong`    | `#33333f`  | `#d5d6dd`   | Control boundaries (input fields, button outlines).                                                                     |
| `--color-ink`              | `#e6e6ec`  | `#29292d`   | Primary body text, titles, prominent values (14.49:1).                                                                  |
| `--color-ink-secondary`    | `#a6a6b4`  | `#545460`   | Secondary descriptions, timestamps, table metadata (7.49:1 dark, 7.46:1 light).                                         |
| `--color-ink-muted`        | `#818293`  | `#707081`   | Micro-labels, column headers, shortcut badges (≥ 4.5:1 on sunken).                                                      |
| `--color-tooltip`          | `#2a2a34`  | `#29292d`   | Tooltip fill. Dark lifts it above the panels; light inverts it.                                                         |
| `--color-tooltip-ink`      | `#e6e6ec`  | `#f2f2f5`   | Tooltip text (11.42:1 dark, 12.97:1 light).                                                                             |
| `--color-tooltip-border`   | `#3b3b48`  | `#29292d`   | Tooltip rim; in light it is the chip itself.                                                                            |
| `--color-brand`            | `#a9c7ee`  | `#0052a7`   | Primary brand accent, keyboard focus rings, active links.                                                               |
| `--color-brand-strong`     | `#a9c7ee`  | `#4186e0`   | Primary solid button fill; light matches `--color-brand-icon` (OKLCH L 0.62) instead of near-black.                     |
| `--color-brand-stronger`   | `#c6dbf5`  | `#2b70c9`   | Primary solid button hover fill (OKLCH L 0.55 in light mode).                                                           |
| `--color-brand-tint`       | `#0e2745`  | `#d7ebff`   | Brand badge backgrounds, switch active backgrounds.                                                                     |
| `--color-brand-tint-hover` | `#16375f`  | `#c3dfff`   | Hover fill for brand-tinted controls.                                                                                   |
| `--color-brand-selected`   | `#131e2c`  | `#e4f2ff`   | Row selection background in data grids.                                                                                 |
| `--color-selection`        | `#27466f`  | `#bcd9fb`   | Text or byte selection inside dense viewers.                                                                            |
| `--color-success`          | `#6fdea2`  | `#00673c`   | Completed tasks, passing health checks, ready state (`--color-success-ink` alias).                                      |
| `--color-success-tint`     | `#102d1e`  | `#d1f3de`   | Success badge fills.                                                                                                    |
| `--color-warning`          | `#edbb65`  | `#724d00`   | Degraded state, marks/highlights, cautionary notices.                                                                   |
| `--color-warning-tint`     | `#31240d`  | `#f9e6c8`   | Warning badge fills, viewer line/byte/row mark fills.                                                                   |
| `--color-danger`           | `#efb3b0`  | `#9d1426`   | Errors, failed executions, destructive actions (`--color-danger-ink` alias).                                            |
| `--color-danger-tint`      | `#451214`  | `#ffe0de`   | Danger badge fills, danger button hover fills.                                                                          |
| `--color-idle`             | `#878899`  | `#6a6a7a`   | Inactive, paused, or queued processes.                                                                                  |
| `--color-idle-tint`        | `#22222b`  | `#ececf1`   | Idle badge fills.                                                                                                       |
| `--color-brand-icon`       | `#a9c7ee`  | `#4186e0`   | Solid folder, running-workflow, and prompt caret icons. Light lifts the accent to OKLCH 0.62 (3.68:1, a graphic's 3:1). |
| `--color-success-icon`     | `#6fdea2`  | `#469a6b`   | Solid finished-workflow icons (3.45:1 light).                                                                           |
| `--color-danger-icon`      | `#efb3b0`  | `#d95356`   | Solid failed-workflow icons (3.95:1 light).                                                                             |

### Derived Tints Rule

Status accents are **never displayed as solid, saturated blocks of color**. Solid alert banners trigger visual exhaustion and induce false urgency. Instead, status indicators always use **tint fills** (lightness ~0.27 in dark mode, light pastels in light mode) paired with crisp accent borders and text:

```html
<!-- Correct: Quiet, clear, readable -->
<span class="badge border border-success/40 bg-success-tint text-success"> Completed </span>

<!-- Forbidden: Solid shouting block -->
<span class="bg-success text-canvas font-bold">Completed</span>
```

### Chart Series Separation

- **Series Bands (`--color-series-1`…`8`)**: Eight hues emitted via `@theme static` (so runtime `var(--color-series-N)` indexing in `LineChart.vue` works), all set to OKLCH lightness **0.56**, chroma **0.11**. These bands sit well below text accents so area fills never overwhelm foreground data, keep their contrast across both dark and light panels, and guarantee separation under simulated protanopia across the primary three series (> 7.7 and 15.5 distance).

---

## §3. Typography & Numerical Discipline

### One Family, Two Faces

The console is set in IBM Plex: **Plex Sans** for the interface and prose, **Plex Mono** for data. Both are self-hosted from `public/fonts/` (never a font service) and designed as a pair, so the mix reads as one system.

```css
--font-sans: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; /* the page */
--font-mono: 'IBM Plex Mono', ui-monospace, monospace; /* data: `font-mono` */
```

_Rule: Mono if the operator might copy it, compare it character by character, or line it up._ That is file contents (the text, hex and table viewers, which are laid out in character widths and must be mono), file and folder names, paths and the path bar's prompt, hashes, IDs, offsets, case references, detail values (`KeyValueRow`), code and specs (`code`, `pre` and `kbd` are mono already), and inputs that take any of these. Everything else (headings, labels, buttons, menus, dialogs, help, status and error messages, rendered Markdown prose) is Sans.

Why the split: monospace reads more slowly as running text and takes about a fifth more width, which costs most in reports, dialogs and narrow columns. In evidence, though, telling `0`/`O` and `1`/`l`/`I` apart and comparing a hash by eye is the job, so data keeps the fixed-width face.

### The 4-Step Type Scale

To prevent visual clutter, the typography scale is restricted to **exactly four sizes**:

```
Scale Step     Size      Weight      Line Height   Class / Purpose
────────────────────────────────────────────────────────────────────────────────
Card Title     14px      600 (Bold)  1.3           .card-title (Panel headers, modal titles)
Body           13px      400 (Norm)  1.5           Base body text (12px in dense views, dialogs, inputs)
Micro-Label    12px      500 (Med)   1.3           .micro-label (Headers, column tags, tracking 0.06em)
Badge / Kbd    11px      500 (Med)   1.45          .badge, status bar, HelpDialog <kbd> (10px in KeyHint)
```

1. **Card Title (`14px`, weight 600, `line-height: 1.3`)**  
   Used for sheet headers, modal titles, and section dividers. Sentence case is enforced via CSS:
   ```css
   .card-title {
     font-size: 14px;
     font-weight: 600;
     color: var(--color-ink);
   }
   .card-title::first-letter {
     text-transform: uppercase;
   }
   ```
2. **Body Text (`13px`, weight 400, `line-height: 1.5`)**  
   The foundation of the console. Applied to `body` globally. Used in data rows, descriptions, and inputs.
3. **Micro-Label (`12px`, weight 500, `letter-spacing: 0.06em`)**  
   Used for table column headers, form field labels, and property keys.
   _Rule: Always write micro-labels in lowercase._ All-caps shouts; the letter-spacing (`0.06em`) and muted tone (`--color-ink-muted`) distinguish the label without shouting.
4. **Badge / Footnote (`11px`, weight 500, `line-height: 1.45`)**  
   Used in status badges, status bar items, compact viewer column headers (`TableViewer`, `HexViewer`), and `HelpDialog` `<kbd>` shortcut hints. (`KeyHint.vue` `<kbd>` and `UserAvatar` fallback initials step down to `10px`; dense console views, dialogs, and popovers set `12px`; `LoginView`'s wordmark uses `28px`.)

### Numerical Zero-Jitter (`.tabular`)

Any component displaying dynamic numbers, counters, sizes, file hashes, or timestamps **must** apply `.tabular`. Plex Sans sets proportional figures by default, so without it a changing number moves what follows it:

```css
.tabular {
  font-variant-numeric: tabular-nums;
}
```

This forces lining figures of identical width. When a counter increments from `9` to `10`, or a clock ticks from `11:59` to `12:00`, no adjacent element shifts.

---

## §4. Shapes & Box Geometry

A technical console draws **boxes**, not cards. Rounding must remain tight and mechanical. Pill-shaped buttons and heavily rounded container corners waste space and fight tabular grid lines.

### Radius Tokens

```
  --radius-sheet: 4px      (Panel boundaries, modals, large split containers)
  --radius-card: 4px       (Cards, wells, recessed code blocks)
  --radius-control: 3px    (Buttons, form fields, text inputs, selects)
  --radius-check: 2px      (Checkboxes, badges, keyboard keycap badges)
```

```
┌──────────────────────────────────────────────────────────────────┐ --radius-sheet: 4px
│  ┌───────────────────────────┐      ┌─────────────────────────┐  │
│  │ Button: 3px               │      │ Checkbox / Badge: 2px   │  │
│  │ [--radius-control]        │      │ [--radius-check]        │  │
│  └───────────────────────────┘      └─────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Inset Well: 4px [--radius-card]                            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

- **Pill Shapes Forbidden**: Never apply `rounded-full` to buttons, inputs, or badges. The only round elements are the `Switch` track and sliding knob, person/group avatar discs (`18px` `UserAvatar`, plus larger discs in `AccountDialog` and `ShareDialog`), and the `6px` (`size-1.5`) status/pulsing dots.
- **Focus Rings**: All interactive controls share a standardized, high-visibility focus outline:
  ```css
  :focus-visible {
    outline: 2px solid var(--color-brand);
    outline-offset: 2px;
    border-radius: 2px;
  }
  ```

---

## §5. Layout Architecture & Spatial Rules

### 1. Edge-to-Edge Full-Viewport Canvas

The application shell spans the complete browser viewport edge-to-edge:

```html
<main class="h-dvh overflow-y-auto bg-canvas">
  <!-- Views mount here without outer margin gutters -->
</main>
```

_Rule: Never wrap the primary view in page-level margin gutters (e.g. `p-8` or `max-w-7xl mx-auto`)._ The browser window itself is the frame.

### 2. The Three-Tier View Anatomy

Every primary console view conforms to a three-tier vertical architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. PATH BAR (h-7 / 28px) + VIEW TOOLBAR (h-10 / 40px)                       │
│    [Path / Breadcrumb / Prompt]                          [Action Buttons]   │
├──────────────────────────────────────────────────────────────┬──────────────┤
│ 2. MAIN WORKSPACE (flex-1, min-h-0)                          │ 2b. SIDE PANE│
│                                                              │ (File 416px  │
│    Data Grid / File Listing / Canvas                         │  Task 256px) │
│    - Sticky table header (h-7 folder / h-6 table)            │              │
│    - Contained scrollable body                               │ File details,│
│    - Keyboard cursor selection                               │ viewer or    │
│                                                              │ task inspect │
├──────────────────────────────────────────────────────────────┴──────────────┤
│ 3. GROUNDING STATUS BAR (h-7 / 28px)                                        │
│    [Counts / Totals]     [Net dot · Queue · metrics · settings · help · User]│
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Tier 1: Top Chrome (`PathBar` `h-7` / 28px + View Toolbar `h-10` / 40px)**: `PathBar` anchors current location, breadcrumbs, and the prompt above the view's toolbar (`FolderToolbar`, `FileView`, and `MetricsView` headers at `h-10`) for view-level actions. A listing's filter is not here: it narrows the table, so it sits in the table's header, in the column it matches (a folder's names). (`LoginView` omits the top bar and status bar.)
- **Tier 2: Work Area (`flex-1 min-h-0`)**: Edge-to-edge multi-pane flex layout.
  - _Primary Pane_: Expands flexibly (`min-w-0 flex-1`) with internal scroll containment.
  - _Side Pane_: Only where it shows what the primary pane cannot — a file's details and viewer inspector beside its content (`FileSidePanel.vue`), a workflow panel under the toolbar (`WorkflowPanel.vue`), or the selected workflow task inspector (`TaskInspector.vue`). Both `FileSidePanel.vue` (`416px` initial, `280px` min) and `FolderView`'s `TaskInspector.vue` (`256px` / `w-64` initial, `220px` min; `w-72` inside full-screen `WorkflowPanel`) are resizable by their left edge (`usePanelWidth`, capped at 60% viewport width, hidden below `xl` via `max-xl:hidden`). A plain folder listing has no side panel for row metadata: a pane that repeats a row's own columns earns no width.
- **Tier 3: Grounding Status Bar (`h-7` / 28px)**: Anchored to the bottom (`bg-sunken border-t border-border`). Displays view counts and selection totals on the left, and connection status, network dot, upload queue toggle, `metrics`, `settings`, `help`, and account/sign-out controls on the right. No keyboard shortcut reminders: see §11.

### 3. Scroll Containment & Positioning Context

- Never rely on window-level scrolling for data listings. The outer shell remains locked, while the table body scrolls with `overflow-y-auto`.
- All sheet containers must declare `position: relative`. Without this, screen-reader helper elements (`.sr-only`) resolve against the `<html>` root, escape `overflow: hidden`, and corrupt the page scroll height.

---

## §6. The Button System

Buttons represent actions with strict visual hierarchy. Consoles fail when every button looks identical or when views invent novel button stylings.

### The Five Variants Rule

There are **exactly five variants, and only five**. If a view requests a sixth look, the view's information hierarchy has drifted:

```
Variant       Visual Style                            Usage Policy
─────────────────────────────────────────────────────────────────────────────────────────────
primary       bg-brand-strong text-canvas             MAX ONE PER VIEW. The primary action.
brand         bg-surface border-brand text-brand      Row-level leading action or secondary focus.
secondary     bg-surface border-border-strong text-ink Standard default button for all actions.
danger        bg-surface border-danger/60 text-danger Destructive actions. NEVER SOLID.
ghost         transparent text-ink-secondary          Low-prominence actions, icon triggers.
```

```html
<!-- Primary: Solid brand, strictly 1 per screen -->
<button class="bg-brand-strong text-canvas hover:bg-brand-stronger ...">Commit</button>

<!-- Brand: Outlined, leading row action without competing with Primary -->
<button class="bg-surface text-brand border border-brand hover:bg-brand-tint ...">Create</button>

<!-- Secondary: The standard interactive trigger -->
<button class="bg-surface text-ink border border-border-strong hover:bg-sunken ...">Export</button>

<!-- Danger: Outlined in danger hue, NEVER solid -->
<button class="bg-surface text-danger border border-danger/60 hover:bg-danger-tint ...">
  Delete
</button>

<!-- Ghost: Transparent, hover reveals -->
<button class="text-ink-secondary hover:text-ink ...">Cancel</button>
```

#### The Danger Button Rule

_Danger buttons are never solid fills._ A solid red button creates unwarranted tension on a technical dashboard. Destructive actions use outlined styling with danger ink and a subtle danger-tint hover fill.

### The Two Heights Rule

Buttons exist in **exactly two sizes, and only two**:

1. **Default (`size="default"`, `px-3 py-1.5`, `ghost` `px-2 py-1.5`, height ~32px)**: Used in toolbars, dialog footers, and standalone panels.
2. **Row (`size="row"`, `px-2 py-0.5`, `ghost` `px-1.5 py-0.5`, height ~24px)**: Used _inside_ data table rows or compact toolbars. Because table rows have a `28px` (`h-7`) height floor, a standard 32px button would overflow the row line.

_Rule: Padding is the whole of the size._ Font size (inherited from its container: `13px` root default or `12px` in dense views/dialogs), weight (`500`), and icon gap (`gap-2`) remain identical between sizes.

### Grouping Buttons: Space, Not Lines

Buttons in a bar sit `gap-1.5` (6px) apart. Groups are set apart by space alone: a `<span class="w-1.5 shrink-0" aria-hidden="true" />` between them makes the gap 18px, three times the gap inside a group. No vertical dividers between toolbar groups; a line is a heavier mark than the difference it would point at.

- _Exceptions_: menus keep their separator before destructive items (§11, the row menu), and a small compound control may divide its parts (the flowchart's zoom: `− 100% +` | fit).

---

## §7. Surface Primitives: Sheets, Cards, and Wells

The console creates visual depth using four distinct surface layers rather than drop shadows:

```
Elevation Layer    Token / Class                     Border                                                Purpose
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Level 0: Canvas    --color-canvas                    None                                                  Application frame backdrop
Level 1: Surface   --color-surface                   border-border                                         Work panels, tables, dialogs
Level -1: Sunken   --color-sunken                    None / border-border                                  Table headers, wells, status bars
Level 2: Floating  --shadow-float / --shadow-popover .sheet: border-border; popovers: border-border-strong; Modals (--shadow-float); menus, popovers &
                                                     tooltips: border-tooltip-border                       tooltips (--shadow-popover)
```

### 1. `.sheet` (Panel Container)

The foundational panel that encloses page content:

```css
.sheet {
  position: relative;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sheet);
}
```

### 2. `.card` (Bordered Section Box)

Used to isolate a distinct group of controls or metrics inside a larger panel:

```css
.card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 14px;
}
```

### 3. `.well` (Recessed Inset)

Used for code previews, raw terminal outputs, log displays, or secondary groupings:

```css
.well {
  background-color: var(--color-sunken);
  border-radius: var(--radius-card);
  padding: 12px;
}
```

### 4. `.badge` (State Pill-Box)

Compact status tag representing an entity's operational state:

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--radius-check);
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.45;
}
```

_Rule: Always combine `.badge` with a corresponding semantic tint and border:_

```html
<span class="badge border border-brand/40 bg-brand-tint text-brand">queued</span>
```

_Exception — identifiers:_ a badge holding an id rather than a state (a case reference in the path bar) is neutral, `border-border-strong bg-sunken text-ink-secondary`, because hue means status and an id is not one.

---

## §8. Form Controls & Inputs

Form controls prioritize fast keyboard data entry and unambiguous states.

### Standard Field Primitive (`.field`)

Native inputs, selects, and textareas use `.field`:

```css
.field {
  @apply h-8 border border-border-strong bg-surface px-2 text-ink;
  border-radius: var(--radius-control);
}
```

Focus styling uses the global `:focus-visible` ring (or explicit `focus:border-brand outline-none` where components supply it). Compact bar inputs override height (`h-7` or `h-5`).

### Stacked Labels (`.labelled`)

To avoid fragile horizontal column alignments in forms, labels stack vertically over their input:

```html
<label class="labelled">
  <span class="micro-label">target hostname</span>
  <input class="field" type="text" placeholder="api.internal.net" />
</label>
```

### Master Switch vs. Detail Checkbox

- **Checkboxes (`accent-brand`)**: Used for individual item selection, list multi-selection, and independent boolean settings.
- **Switches (`Switch.vue`, `role="switch"`)**: Reserved exclusively for **master toggles** that rule an entire subsystem or disable a group of subordinate settings. Subordinate settings are never switches; they are checkboxes that dim when the master switch is disabled.

```html
<!-- Master switch enables/disables entire AI feature suite -->
<button
  role="switch"
  :aria-checked="aiEnabled"
  class="relative inline-flex h-4 w-7 rounded-full border ..."
>
  <span class="size-2.5 rounded-full ..." />
</button>
```

### Key-Value Displays (`KeyValueRow` & `CopyValue`)

Metadata inspectors display properties in structured rows:

- **Inline Row**: Label on left (`.micro-label`), value on right (`font-mono text-right break-all text-ink`). Missing values render as an en-dash (`–`) in `text-ink-muted`.
- **Stacked Row**: Used for long IDs, file paths, or crypto hashes. Applies `.tabular mt-0.5 break-all select-all`.
- **Copyable Items**: Interactive values display clipboard feedback on click (`hover:text-brand data-[copied=true]:text-success`); `CopyValue.vue` reveals a compact `Copy` / `Check` icon on hover, focus, and copied state.

---

## §9. Data Tables & Tabular Ergonomics

Data tables are the core workhorse of the technical console.

```
┌────┬─────────────────────────────┬─────────────┬────────────────┬──────────────┐
│ [x]│ Name (asc/desc)             │ Size (tab)  │ Type           │ Modified     │
├────┼─────────────────────────────┼─────────────┼────────────────┼──────────────┤
│ [ ]│ ▶ parent-directory          │ —           │ directory      │ 2h ago       │
│[x]│ ▌ document.pdf (cursor)     │ 412.4 KB    │ application/pdf│ 14m ago      │
│ [ ]│   telemetry.json            │  84.1 KB    │ text/json      │ just now     │
└────┴─────────────────────────────┴─────────────┴────────────────┴──────────────┘
```

1. **Sticky Header**: `FolderTable` pins its header with `sticky top-0 z-[1] bg-surface` (`h-7`, `shadow-[inset_0_-1px_0_var(--color-border)]`) and places its `h-5` `filter names` input in the name column; `TableViewer` uses `sticky top-0 z-10 h-6 border-b border-border bg-sunken`; `HexViewer` uses a non-sticky `h-6` header (`MarkdownView` tables use `bg-sunken` and `border-border-strong`). Column headers use `.micro-label` (or `11px` `.micro-label` in compact viewers) with click-to-sort indicators.
2. **Row Height Floor**: Rows have a locked height (`h-7` / `28px` in explorer listings and upload rows; `h-6` / `24px` in `TableViewer`; `h-5` / `20px` in `TextViewer` and `HexViewer`). Rows never wrap multi-line text dynamically; long names are truncated with `v-overflow-tooltip`, and empty files in `FolderTable` can fold behind a toggle row.
3. **Alignment Discipline**:
   - String names, descriptors, and folder `modified (utc)` timestamps (`.tabular`): **Left-aligned**.
   - Byte `size` (folder listing) and `TableViewer` row-number/numeric/date columns: **Right-aligned** with `.tabular`.
   - Action buttons and status badges: **Right-aligned** or centered in fixed-width columns.
4. **Visual Row States**:
   - **Active Cursor**: Indicated with a left inset brand border: `shadow-[inset_2px_0_0_var(--color-brand)]` with `bg-sunken` when unselected or `bg-brand-selected` when selected in `FolderTable`; `TableViewer` uses `bg-brand-selected` for cursor rows and `bg-warning-tint` for marked rows.
   - **Selected Rows**: Highlighted with `bg-brand-selected` and checked checkbox (plus `bg-brand-tint/50` and `opacity-40` for lineage-traced dimming in `FolderTable`).
   - **Hover**: Subtle row feedback with `hover:bg-sunken`.
5. **Selection Ergonomics**:
   - Single click on the row sets the cursor (and in a workflow folder highlights the producing task); the name is a `RouterLink` that opens the item (⌘/middle-click: new tab), and double-clicking the row or pressing `Enter`/`l`/`→` opens it too.
   - `Shift + Click`, `Shift + Arrow`, or `Shift + J/K` performs continuous range selection.
   - `Space` toggles the active row's checkbox.
   - `⌘A` / `^A` toggles select-all across all visible rows.
6. **Owner Avatars (`UserAvatar`)**: Ownership is a mark, not a name. An 18px disc in a fixed-width column carries the owner's profile picture, or the first letter of their display name on `bg-sunken` when the server has none (and when the picture fails to load). The avatar is the **one round element** in a system of near-square geometry (§4): it stands for a person rather than a control, and roundness is what says so at 18px. It is also **monochrome**: hue in this console means status, and an owner is not a status. The username rides on `v-tooltip`, with the same text in `aria-label`, so the column stays one glyph wide and never pushes the timestamp around.
7. **Columns Earn Their Place**: A column that says the same on every row goes. The top-level list holds only folders, so it drops `size` and `type`; in their place a `case` column shows each folder's case reference (`—` for none) in grey `.tabular` text, lined up for scanning. Inside a case, the path bar keeps the reference in view after the top-level folder's name; a row's menu sets, changes and clears it.
8. **Text Files Are Rows Too (`TextViewer`)**: Plain text is read and drawn in the app, never in a server-styled frame, so it wears the same tokens as every other surface. Rows are 20px (`h-5`) and never wrap; a line longer than 2,000 characters goes on over more rows, whose gutter stays empty. The line numbers are a sticky gutter in `.tabular` `text-ink-muted`. Marked lines (click, `Shift + Click` or drag in the gutter; carried in the URL as `#L12-L40`) are a highlighter, not a row selection: they are what a link points at, so they take the yellow of a marker pen rather than `bg-brand-selected` — `bg-warning-tint` across the row, the gutter's numbers `text-warning` with a 2px `warning` bar on their left edge. A plain click in the text, `Esc`, or clicking the one marked line again unmarks them; selecting text replaces them with a mark of that text (item 9). Search hits share the tint, so each also carries a 1px `outline-warning/60`, which keeps it visible inside marked lines; the current hit is solid `bg-warning` with `text-surface`, the one solid fill in the viewer, as a browser's find marks its current match. The viewer's own scrollbar carries a `bg-warning/70` tick where hits are. Nothing a file holds is rendered as a web page: Markdown is drawn by the app (item 10), and HTML is shown as its source.
9. **Marks Work the Same in Every Viewer (`useMarkedRange`)**: Text marks lines, the table marks rows, hex marks bytes, and all three the same way: click a number in the gutter (a line number, a row number, a row's offset), `Shift + Click` or drag to extend, click the one marked item again to unmark, `Esc` to clear. The URL carries the mark and opens the view it belongs to: `#L12-L40` text, `#R12-R40` table, `#0x1f3-0x2a0` hex (exact bytes; go-to takes a range too). A mark looks the same everywhere: `bg-warning-tint` on what is marked, the gutter `text-warning` with its 2px `warning` bar when whole lines, rows or byte rows are marked (a mark of exact text or bytes tints only those), and a copy-link button in the viewer's bar. A plain click in the content clears it, in every viewer: in text anywhere in the lines, in the table on a row (which also moves the cursor), in hex on a byte (which also moves the cursor). A selection is the mark, as soon as it is let go of (the drag ended, the `Shift + Arrow` released), so the URL always links to what is selected: in text, selected text marks as `#L12C5-L14C20` (1-based caret columns, as editors give them), only that stretch tinted, the line numbers still yellow; in hex, selected bytes mark as their exact offsets. Selecting inside a mark therefore replaces it. The selection keeps its own highlight, so it can still be copied; the yellow shows once it is gone — `Esc` clears the selection first and the mark second. `m` or the copy-link button copies the link and swaps the selection for the yellow. In table view, selecting text in cells does not mark rows. In text, `Shift + Click` extends exact text past one screen.
10. **Markdown Is Read, Never Run (`MarkdownView`)**: Markdown — a file's Rendered tab, a worker's report — is parsed into blocks and drawn from fixed elements; its text only ever reaches the page as text, so raw HTML in it shows as written, and nothing from it becomes an attribute (no `href`, `src`, `style` or `id`). Links and images are shown, not followed or loaded: text with a dashed underline (`decoration-dashed`, `decoration-ink-muted`), an image as an `ImageOff` icon and its alt text, the URL in a hover tooltip and never in an attribute — a file cannot reach out or learn it was opened. A click or `Enter` slides the link menu down under it (one for the app, `LinkMenu`): the host it really goes to, in ASCII so a look-alike shows as `xn--…`, the full URL, then Copy link and — for `http`/`https` only — Open in a new tab (`noopener`, `noreferrer`), with what that costs said under it: "The site will see your IP address." Other schemes and relative links say why they do not open; an image is only copied, as opening it is loading it. Characters that hide or reorder text are written out (`‹U+202E›`). Headings stay within the type scale: in a file, h1 is 14px semibold over a `border-border` rule, h2 14px semibold, h3–h6 body semibold; in a report, a card title or a label. In a file, text keeps to a `90ch` reading column, while tables and code size to their content and may take the pane's width, so a wide table is not boxed in. Code sits in a `well` with its language as a `micro-label`. Tables are rules, not a grid, like every table in the app: a `bg-sunken` header row over a `border-border-strong` rule, a hairline under each row, no cell borders, never stretched to full width; they keep their column alignment, and code in a cell stays on one line (a hash is never broken), the table scrolling sideways instead. Only the first 2 MB is rendered, the rest offered in the source; hovering a block offers its line there (`line 12`, a ghost row button that opens Source on it). Marks are the source's lines, so one link works in both views: selecting in Rendered marks the source lines of the blocks the selection touches (whole blocks, `#L12-L40`) as it is let go of, and a mark from either view tints the blocks over its lines (`bg-warning-tint` with the 2px `warning` bar on the left, the block's text not moving). The URL says which view a link opens in (`?view=rendered`); without it, a line mark opens Source.

---

## §10. Floating Surfaces: Dialogs, Sheets, and Tooltips

### 1. Modal Sheets

Modals represent high-focus workflows (e.g. running a pipeline, editing system settings, sharing assets).

- **Teleported & Centered**: Modal sheets render via `<Teleport to="body">` with a backdrop overlay (`bg-ink/20`; `ConfirmDialog` and `ShareDialog` add `backdrop-blur-[1px]`), `role="dialog"` (`role="alertdialog"` on `ConfirmDialog`), and `aria-modal="true"`. (`UploadQueuePanel` is modeless at bottom-right `z-40` with `aria-modal="false"` and no backdrop; `RunDialog` acts as an anchored popover using `--shadow-popover` without backdrop dim when opened from workflow `+` buttons.)
- **Positioning**: Anchored above optical center (`top-[8vh]`–`top-[18vh]`, widths from `26rem` to `52rem` clamped by `calc(100vw-2rem)`) with `--shadow-float`.
- **Focus Management**:
  - Automatically traps focus (`v-trap-focus`) within the modal container.
  - Automatically places cursor into the primary input on mount (`v-autofocus`).
- **Dismissal**:
  - Clicking the backdrop (`@pointerdown`) dismisses the modal.
  - Pressing `Escape` pops the modal from the global `useModalStore` stack without triggering underlying view actions (`AccountDialog` blocks backdrop/`Escape` dismissal while a one-time API key is displayed).

### 2. Singleton Tooltip Coordinator

To prevent DOM bloat and garbage collection lag, tooltips do not instantiate individual DOM elements per button. A single top-layer `<Tooltip />` element coordinates all tooltip hints application-wide (`useTooltip.ts`, fed by `v-tooltip`, `v-overflow-tooltip` and `v-copy`):

- **Surface**: `bg-tooltip`, `text-tooltip-ink`, `border-tooltip-border`, `--shadow-popover`, `--radius-control`, no arrow. In dark mode it is lifted by lightness, never inverted: an `ink` slab would be the brightest thing on the screen. In light mode it is the inverted dark chip.
- **Size**: 12px regular on a 16px line, `px-2 py-1`, as wide as its text up to `min(60ch, 100vw − 16px)`, then wrapping. Long tokens break with `overflow-wrap: anywhere`, and paths and names break first at `/ \ . _ -` (`utils/breakable.ts` renders `<wbr>`). A tooltip never truncates: it is where the full value lives.
- **Two parts**: `{ text, detail }` puts a quieter second line under the label, for what a click does or what the label leaves out (`{ text: 'Select this group', detail: '⌘-click more groups to merge them' }`). Never join the two with a dash in one string.
- **Placement**: measured, not guessed. The presenter renders invisibly, measures itself, then `utils/placement.ts` puts it on the preferred side (`top` by default), flips it to the opposite side when only that fits, and shifts it to stay 8px inside the viewport on both axes. The offset from the anchor is 6px.
- **Timing**:
  - _Cold hover_: 400ms, so sweeping across a toolbar shows nothing. `v-overflow-tooltip` waits 500ms.
  - _Warm hover (moving between sibling controls)_: instant, within 400ms of the last tooltip hiding.
  - _Keyboard focus_: instant, and only for `:focus-visible`. Focus from a mouse click shows nothing.
  - _Touch_: a tap is not a hover and shows nothing.
- **Hoverable, dismissible, persistent (WCAG 1.4.13)**: leaving the anchor waits 100ms, and the pointer can cross onto the tooltip to read or select it. Escape hides it. A scroll hides it only if it moves the anchor, and a resize always does.
- **Accessibility**: while it shows, the anchor (or the control focused inside it) carries `aria-describedby="app-tooltip"`. It is skipped when the anchor's `aria-label` already says the same thing and there is no detail. Icon buttons still need their own `aria-label`; the tooltip describes, it does not name.
- **Earn its place**: a tooltip must say something the screen does not. It may name an icon-only control, give the target ("Share case-123"), a consequence ("Leave without copying: the key is lost"), an exact value ("12,288 bytes"), or why a control is disabled ("Nothing changed yet"). It never restates the visible label: a `settings` button gets no "Settings" tooltip, and a `Cancel` button gets none. When a tooltip only helps in one state, bind it in that state alone (`dirty ? undefined : 'Nothing changed yet'`).
- **Content**: a tooltip names a control or reveals clipped text, in plain text, in about 80 characters or fewer. No shortcut in parentheses, no keycap. Errors, required information and anything a user must read to proceed do not belong in a tooltip; show them inline. Text that is already on screen gets `v-overflow-tooltip`, not `v-tooltip`.

---

## §11. Keyboard Ergonomics & Interaction Patterns

```
Global Navigation Keys
────────────────────────────────────────────────────────────────────────────────
j / k  or  ↓ / ↑     Move cursor row up / down
l      or  Enter / → Open / Activate highlighted entity (open `..` or path bar to go up)
g      or  ⌘K        Focus path prompt / command palette
/                    Focus search / filter input
Space / ⌘A           Toggle cursor row selection / select all rows
r      or  ⌘⏎        Run worker on selected entities
w                    Launch workflow on selected entities
n                    Create new entity / folder
u / s                Upload files / Share folder
F2     or  e         Rename cursor entity
Del / ⌫ / ⌘⌫         Delete selected entities
⇧R                   Refresh current folder
Escape               Dismiss filter, cancel rename, or close top modal
⌘,                   Open application settings
?                    Open keyboard shortcuts help sheet
```

### Shortcuts Are Not Advertised

Keyboard shortcuts work everywhere, but the interface does not hint at them: no `KeyHint` footers, no keycaps in inputs or buttons, no `(esc)` in tooltips. Hints on every surface are noise for the operator who already knows the keys and clutter for the one who never will. The Help dialog (`?`) is the one place that lists them, and the only user of `KeyHint`.

### The `isTyping()` Guard

Global keyboard shortcuts must never hijack typing when a user is actively editing a form control. All global key listeners evaluate `isTyping(event)` (`src/utils/keyboard.ts`):

- Returns `true` if the event target is a text `<input>`, `<textarea>`, `<select>`, or `contenteditable` element (ignoring checkboxes and radio buttons).
- For the navigation prompt (`[data-prompt]` in `PathBar.vue`), delegates to `!promptPassesThrough(event, target.value)` so `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Enter`/`Space`/`Home`/`End`, `?` when the prompt is empty, and `⌘⏎` pass through to table/view navigation.
- Prompt `<input>` fields in `PathBar.vue` and `Prompt.vue` use `caret-brand-icon [caret-shape:block]` for a console-style cursor.

### Inline Renaming Pattern

Renaming entities in folder listings (`FolderTable.vue`) and the current folder title (`PathBar.vue`) follows one consistent pattern:

1. **Trigger**:
   - In tables: pressing `F2` or `e`, or choosing **Rename** from the row's action menu (`ItemMenu`). There is no press-and-hold trigger.
   - In the path bar: clicking the active folder name (`F2`/`e` renames rows in `FolderTable` only).
2. **Active State**:
   - The row label transforms into an inline input (`h-6 w-full min-w-0 flex-1 rounded-(--radius-check) border border-brand bg-surface px-2 font-mono text-[12px] font-medium text-ink shadow-sm` in `FolderTable`; `h-6 ... px-1.5 font-medium` inside `PathBar`).
   - The input focuses automatically; for files with an extension, it selects only the base name (`setSelectionRange(0, lastDot)`), and for folders it selects the whole name.
3. **Commit & Cancel**:
   - Pressing `Enter` or clicking outside the input commits the new name.
   - Pressing `Escape` cancels the rename and reverts cleanly without side-effects.

### Symmetrical Activation Pattern

Interaction targets adhere to symmetrical behaviors:

- **Files & Folders**: Single-click on the row moves the cursor to it. Clicking the name, double-clicking the row, or pressing `Enter`/`l` opens the item. Rename is `F2` or Rename in the row's menu; there is no press-and-hold.

### Actions Live on Rows

What can be done to rows comes from one list (`useItemActions`) and shows in two places, never in a side panel:

- **The row menu**: a `⋯` button at the row's end (shown on hover and on the cursor row), right-click, or `⇧F10` / the menu key. Its header names the row with what the columns leave out — id and created. Destructive actions sit last, after a separator.
- **The selection bar**: while rows are selected, the toolbar's own buttons make way for `N selected`, the actions that apply to all of them (one primary at most, Delete as `danger`), and a clear button.
  An action the operator's role does not allow is not shown, in either place.

### The Folder Toolbar

Without a selection, the toolbar's buttons come in two groups, set apart by space: what acts on the folder itself (Share), then what adds to it (New folder; Upload, the view's primary in a plain folder and secondary in a workflow folder). The page's primary action keeps the right edge on every page (New folder at the top level, Upload in a plain folder, Download on a file), so the primary never moves under the mouse. An empty listing offers the same add actions in its empty line, as secondary row buttons.

- **Workflow & Container Titles**: Inline click-to-edit allows rapid renaming of container folder titles in `PathBar` and template names in `WorkflowDialog` without opening separate rename dialogs. The update is scoped strictly to the target entity.

---

## §12. Motion, Transitions & Accessibility

### Standard Easing Curve

All transitions (background fills, border colors, opacity reveals, and transform slides) share a single acceleration curve:

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
```

This produces an immediate, responsive pickup with a gentle, smooth settling finish.

### Snappy Durations

- **Standard micro-transitions**: `120ms` (`duration-120 ease-(--ease-standard)`). Used for button hover fills, selection rings, and badge transitions (`Tooltip.vue` uses `duration-100 ease-out` / `duration-75 ease-in`).
- **Panes that open and close**: `200ms` (`duration-200 ease-(--ease-standard)`). See below.
- Consoles never use slow, floaty animations ($> 250\text{ms}$). Sluggish transitions make software feel unresponsive under heavy daily use.

### Opening & Closing Panes

Every collapsible pane the operator shows and hides (such as `FileSidePanel` and `WorkflowPanel`) should go through `<SlidePane :open edge>` (`src/components/base/SlidePane.vue`), rather than a bare `v-if`/`v-show` or hand-rolled transition (`TaskInspector` in `FolderView` currently mounts conditionally with `v-if` when a task is selected):

- It **slides out past the edge it is attached to** (`edge="right"` for a side panel, `"top"` for a section under a bar), and back, in 200 ms on the standard curve.
- The content **keeps its size**: nothing in it reflows, and its neighbours grow into the room as it goes. A rule that belongs to the pane (its bottom border) goes inside it, so it slides too.
- Closed, it **stays mounted**, invisible and inert. A component inside that listens on `window` ignores keys while it is out of sight.
- Only opening and closing animate: a drag-resize or new content does not.

### Reduced Motion Override

For users with vestibular motion sensitivities, animations and transitions are globally neutralized:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

### Accessibility (a11y) Baseline

1. **Contrast Ratios**: Primary ink clears > 10:1 in dark mode; light-mode text accents target OKLCH L 0.449 (`6.99:1`–`8.20:1`, AAA/near-AAA), `--color-ink-muted` clears `4.5:1` (AA), and solid icon tokens (`--color-brand-icon`, `--color-success-icon`, etc.) clear `3:1` in light mode.
2. **Semantic Elements**: Use native `<button>`, `<input>`, and `<table>` primitives (`FolderTable`, `WorkflowTree`), `role="dialog"` / `role="alertdialog"` with `aria-modal="true"` on teleported modal sheets (`aria-modal="false"` on modeless `UploadQueuePanel`), and `role="grid"` on virtualized `TableViewer` and `HexViewer` scrollers.
3. **ARIA States**: Modals declare `role="dialog"` (or `role="alertdialog"` on `ConfirmDialog`) and `aria-modal="true"`; rows declare `aria-selected="true/false"`; switches declare `role="switch"` and `aria-checked="true/false"`.
4. **Accessible Descriptions**: Icon-only buttons declare explicit `aria-label` attributes alongside visual tooltips.

---

## §13. Loading, Pending & Network States

A console is used on hotel Wi-Fi, over VPNs and on congested links, not only on a fast office network. It must feel instant when the network is fast and stay calm and honest when it is slow. Every view shows waiting the same way, so an operator learns it once and trusts it everywhere.

### The Five Rules

1. **Never wait for data already seen.** Cached data renders at once; a refresh happens behind it and never blanks the screen.
2. **One place per kind of waiting.** Data that is not there yet waits _where it will appear_; work on data already on screen is shown _in the status bar_; a pending change is shown _on its row_.
3. **No flashing.** Every indicator appears only after the work has taken **200 ms**, and once visible stays at least **300 ms**. On a fast connection nothing flickers; on a slow one the operator sees at once that something is happening. Use `useDelayedFlag` — never hand-rolled timers.
4. **No spinners, no skeleton shimmer.** Waiting is a muted line of text or a small pulsing dot. Nothing spins, slides or glows. **One exception:** a running task's status mark in the workflow flowchart (`TaskRunningIcon.vue`) is a `brand-icon` dot with a circling ring, because it shows work in progress that may last minutes, not a network wait. Reduced motion stills it.
5. **No layout shift.** Space for a loading line is reserved before its text appears; indicators have fixed widths; placeholders have the height of the row they stand in for.

### The Situations

| Situation                            | What the operator sees                                                                      | Where                                   |
| :----------------------------------- | :------------------------------------------------------------------------------------------ | :-------------------------------------- |
| Data never loaded, request in flight | `Loading {noun}…` (muted), after 200 ms                                                     | In place of the rows, via `<LoadState>` |
| Refreshing data already on screen    | The rows stay; the network indicator shows a pulsing warning dot                            | Status bar                              |
| First load failed                    | `Could not load {noun}: {reason}` (danger) + **Retry**                                      | In place of the rows, via `<LoadState>` |
| Refresh failed, data still shown     | `Could not refresh — showing saved data ({reason})` (warning) + ghost **Retry**             | Under the rows, via `<LoadState>`       |
| Loaded and empty                     | The view's empty message ("Empty folder…")                                                  | In place of the rows, via `<LoadState>` |
| Creating an item                     | A placeholder row with the typed name, then the real row; `creating…` after 200 ms          | The row itself                          |
| Saving or deleting an item           | The new value at once; `saving…` or `deleting…` after 200 ms; the old value back on failure | The row itself                          |
| A change failed                      | `Could not {verb} "{name}": {reason}` (danger)                                              | Under the rows                          |
| Browser offline                      | `offline — showing saved data` (warning)                                                    | Status bar                              |
| Server unreachable                   | `server unreachable — showing saved data · retry` (warning)                                 | Status bar                              |
| Path of a folder not loaded yet      | `…` after the root icon                                                                     | Path bar                                |

"Empty" and "not loaded yet" must never look alike: which message shows is decided by the data's own load state (`idle` / `loading` / `success` / `error`), never by a view-wide flag.

### The Network Indicator

The status bar (`StatusBar.vue`) always shows one network indicator, right-aligned as a `size-1.5 rounded-full` dot with no visible text label so state changes never shift surrounding layout:

| State      | Dot                        | Tooltip                                                     | Meaning                                                     |
| :--------- | :------------------------- | :---------------------------------------------------------- | :---------------------------------------------------------- |
| `idle`     | `bg-success`, still        | `Nothing loading`                                           | Nothing in flight                                           |
| `fetching` | `bg-warning animate-pulse` | `Talking to the server`                                     | Loads or saves the operator is waiting for                  |
| `prefetch` | `bg-warning animate-pulse` | `Loading folders ahead of time, so opening them is instant` | Only background requests loading data ahead of the operator |

`fetching` wins over `prefetch`. The indicator follows the same 200 ms / 300 ms timing, exposes `aria-label="Network: ${network}"` (not an ARIA live region, since announcing every transition would be noise), and explains itself in `v-tooltip`. It is fed by the API client's count of requests in flight, so views never wire it themselves.

### The Pulsing Dot

The one animated waiting mark in the system:

```html
<span class="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" aria-hidden="true" />
```

`bg-brand` next to row text (`creating…`, `saving…`, `deleting…`); `bg-warning` in the network indicator (`fetching` / `prefetch`); `bg-success` and no pulse for `idle`. Reduced motion (§12) stills it.

### Wording

- Lowercase, ending in an ellipsis character: `loading…`, `creating…`, `saving…` — `Loading {noun}…` at the start of a line.
- Errors name the thing and the reason, never the browser's text: "Could not reach the server", not "Failed to fetch".
- Stale data is labelled as such: "showing saved data".
