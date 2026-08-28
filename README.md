# xlsx-ai — Fast, Modern AI Spreadsheet Workspace

**xlsx-ai** is a high-performance, Zen-brutalist spreadsheet and data workspace application built with **SvelteKit 2**, **Svelte 5 Runes**, **Bun**, **TypeScript**, **SheetJS CE (`xlsx`)**, and official **Google Gemini** generative models (`gemini-3.5-flash-lite` default, `gemini-3.7-flash`, `gemini-3.1-pro`).

---

## Key Features

- **Svelte 5 Runes Reactivity**: State management powered by `$state`, `$derived`, and `$props` for low-latency table updates, search filtering, and sorting.
- **Excel-Grade Active Cell Navigation**: Roving tabindex (`tabindex="0"` on active cell, `-1` on others) with arrow-key hopping (`↑`, `↓`, `←`, `→`), `Tab` column cycling, `Delete` clearing, and direct typing/`F2` inline edit activation.
- **Interactive Column Resizing & Auto-Fit**: Draggable right-edge resize handles (`.th-resize-handle`) on every column header with double-click content auto-fit.
- **Accessible Floating Status Dropdowns**: Boundary-colliding, viewport-flipping status combobox with search, custom status creation, and single-click chevron trigger outside scroll overflow.
- **Typed Column System**: First-class support for `text`, `number`, `currency`, `percent`, `dropdown`, and `date` with type-aware inline cell editors and centralized normalization (`src/lib/cells.ts`).
- **Live Summary Calculations**: Pinned footer calculates real-time `SUM`, `AVG`, `MIN`, `MAX`, and `COUNT` metrics using plain JavaScript `reduce` directly on `filteredRows`.
- **SheetJS Client File I/O & Dynamic Chunking**:
  - **Import**: Drag & drop or upload `.xlsx`, `.xls`, `.csv`, and `.tsv` files with automatic column header deduplication, size limits (10 MB / 10k rows / 100 cols), and type inference heuristics.
  - **Export**: One-click export to native Excel Workbooks (`.xlsx`) or CSV files (`.csv`) with automatic formula injection escaping (`=`, `+`, `-`, `@`, `\t`, `\r`) and unique header disambiguation.
  - **Sample Datasets**: Built-in 25-row datasets for **SaaS Revenue & Retention**, **B2B Sales Pipeline**, and **Hardware Inventory**.
- **Google Gemini AI Assistant**:
  - **AI Grounding**: Contextually grounds the LLM on your active table schema, summary metrics, and data rows.
  - **Structured Data Operations (`generateObject`)**:
    - 🪄 **Fill Missing**: Identifies missing/null cells and predicts values based on data patterns.
    - 🧹 **Clean Data**: Normalizes inconsistent formats, trims whitespace, and fixes typos.
    - 🔍 **Interactive Diff Preview**: Review proposed cell mutations before clicking **Apply** or **Discard** with stale patch conflict detection.
  - **Streaming Data Q&A**: Real-time natural language answers, dataset trends, and executive summaries.
- **Zen-Brutalist Design System & Accessibility**:
  - Clean borders, tight radius tokens (0–8px), subtle elevation, and responsive layouts across desktop, tablet, and mobile.
  - Accessible focus management (`src/lib/focus.ts` `trapFocus` action), keyboard navigation (`ArrowUp`/`ArrowDown`, `Home`/`End`, `Escape`), and instant actions for column deletion and sample replacement with undo (`Ctrl+Z`) — no confirmation modals.
  - Seamless **Dark** & **Light** themes with FOUC prevention and explicit `color-scheme` support.
  - 30-entry undo/redo history stack (`Ctrl+Z` / `Ctrl+Y`) and robust debounced auto-saving to `localStorage` with unload flush.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `↑` / `↓` / `←` / `→` | Navigate active cell box (Excel-style) |
| `Enter` / `F2` | Start editing cell / commit & move down |
| `Delete` / `Backspace` | Clear active cell value |
| `Tab` / `Shift + Tab` | Navigate and edit cells horizontally |
| `Ctrl + K` / `Cmd + K` | Focus instant search bar |
| `Ctrl + N` / `Cmd + N` | Add new row |
| `Ctrl + Z` / `Cmd + Z` | Undo last table edit |
| `Ctrl + Y` / `Cmd + Shift + Z` | Redo table edit |
| `Ctrl + /` / `Cmd + /` | Toggle AI Assistant drawer |
| `Ctrl + ,` / `Cmd + ,` | Open Settings |
| `Escape` | Cancel active cell edit / close modal |

---

## Quick Start

### 1. Install Dependencies
```bash
bun install
```

### 2. Start Development Server
```bash
bun run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Testing & Verification

### Run Unit Tests (Bun Test)
```bash
bun test
```
Runs 42 unit tests across `tests/table.test.ts`, `tests/data.test.ts`, and `tests/ai.test.ts`.

### Run Playwright E2E Tests
```bash
bun run test:e2e
```
Runs 12 end-to-end user workflows in headless Chromium:
1. SaaS dataset rendering with sticky headers and footer summaries.
2. Sample dataset switching (SaaS, Sales, Inventory).
3. Search filtering across all cells and filter clearing.
4. Ascending/descending column sorting with nulls placed last.
5. Row addition and inline cell editing with dynamic aggregate updates.
6. Excel active cell box navigation with arrow keys and in-place editing.
7. Interactive column width resizing with drag handles.
8. AI Assistant Drawer toggle and Gemini API key management.
9. Settings modal, API key management, and appearance theme switching.
10. Dark and light mode toggling via right ribbon.
11. Status dropdown opening without clipping and viewport flipping.
12. Instant column deletion and sample switching with undo (no confirmation modal) + responsive mobile workspace.

### Type Check & Build
```bash
bun run check     # svelte-check strict verification (0 errors, 0 warnings)
bun run build     # Production build with async chunk verification
bun audit         # Dependency security audit (0 high vulnerabilities)
```


---

## Architecture Overview

```
src/
├── app.html                  # HTML template with Google Fonts preconnect & theme script
├── app.css                   # Zen-brutalist design tokens, radius scales, accessibility
├── routes/
│   ├── +layout.svelte        # Root layout with Toast notifications
│   ├── +page.ts              # SSR disabled (export const ssr = false)
│   ├── +page.svelte          # Workspace assembling Header, DataTable, Ribbon, and AiDrawer
│   └── api/ai/
│       ├── +server.ts        # Unified Gemini AI endpoint (x-ai-api-key authentication)
│       └── models/+server.ts # Gemini model catalog endpoint
└── lib/
    ├── types.ts              # Strict TypeScript definitions
    ├── constants.ts          # Official Gemini models, column configs, and status palettes
    ├── table/                # Complete Spreadsheet Engine
    │   ├── DataTable.svelte     # Semantic <table> with inline editing, keyboard nav, & sticky footer
    │   ├── DropdownCellEditor.svelte # Viewport-safe floating dropdown editor
    │   ├── store.svelte.ts      # Svelte 5 runes table store (CRUD, search, sort, summaries)
    │   ├── cells.ts             # Typed cell parsing and normalization
    │   ├── commands.ts          # Reversible atomic mutations for undo/redo
    │   ├── schema.ts            # Zod V2 schema & table migrations
    │   └── persistence.ts       # Debounced localStorage persistence
    ├── components/           # Application UI Shell
    │   ├── Header.svelte        # Navigation bar with search, samples, and metrics
    │   ├── RightRibbon.svelte   # Quick tools rail and mobile bottom command bar
    │   ├── SettingsModal.svelte # Full-screen settings modal
    │   ├── AiDrawer.svelte      # AI assistant with structured diff preview & streaming chat
    │   ├── Icons.svelte         # Universal SVG icon component and path catalog
    │   └── settings/            # Settings modal sub-panels (Ai, Theme, Datasets, Shortcuts, About)
    ├── data/                 # SheetJS I/O & Datasets
    │   ├── import.ts            # SheetJS workbook parser & column type inference
    │   ├── export.ts            # CSV/XLSX export & formula injection mitigation
    │   └── samples.ts           # 3 curated sample datasets (25 rows each)
    ├── ai/                   # Gemini AI Pipeline
    │   └── patches.ts           # Patch conflict verification
    └── ui/                   # Feedback & Headless UI
        ├── position.ts          # Floating popover positioning engine
        ├── combobox.ts          # Combobox keyboard navigation
        ├── menu.ts              # Dropdown menu focus management
        ├── focus.ts             # Focus trap action
        ├── ToastHost.svelte     # Reactive toast notification container
        └── toast.svelte.ts      # Global toast store
```



---

## License
MIT
