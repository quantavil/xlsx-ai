# xlsx-ai — Fast, Modern AI Spreadsheet Workspace

**xlsx-ai** is a high-performance, Zen-brutalist spreadsheet and data workspace application built with **SvelteKit 2**, **Svelte 5 Runes**, **Bun**, **TypeScript**, **SheetJS CE (`xlsx`)**, and official **Google Gemini** generative models (`gemini-3.7-flash` default, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`).

---

## Key Features

- **Svelte 5 Runes Reactivity**: State management powered by `$state`, `$derived`, and `$props` for low-latency table updates, search filtering, and sorting.
- **Multi-File Workspace**: A **Files** menu in the header holds every file — imported spreadsheets, new blank files, and tables produced by AI modules such as ICEGrid. Each file gets its own storage slot, so switching never overwrites another. Provenance is not tracked: once a file is in the workspace it is just a file.
- **Excel-Grade Active Cell Navigation**: Roving tabindex (`tabindex="0"` on active cell, `-1` on others) with arrow-key hopping (`↑`, `↓`, `←`, `→`), `Tab` column cycling, `Delete` clearing, and direct typing/`F2` inline edit activation.
- **Range Selection & Cell Alignment**: Shift-click or shift-arrow to select a rectangle, then set **left / center / right** alignment from the header control or `Ctrl+Shift+L/E/R`. Defaults follow Excel (numbers right, everything else left); overrides are per-cell, undoable, and saved with the document. `Delete` clears the whole range and `Ctrl+C` copies it as TSV. *(SheetJS CE ignores cell styles, so alignment is not carried into `.xlsx` export.)*
- **Interactive Column Resizing & Auto-Fit**: Draggable right-edge resize handles (`.th-resize-handle`) on every column header with double-click content auto-fit.
- **Accessible Floating Status Dropdowns**: Boundary-colliding, viewport-flipping status combobox with search, custom status creation, and single-click chevron trigger outside scroll overflow.
- **Typed Column System**: First-class support for `text`, `number`, `currency`, `percent`, `dropdown`, and `date` with type-aware inline cell editors and centralized normalization (`src/lib/cells.ts`).
- **Live Summary Calculations**: Pinned footer calculates real-time `SUM`, `AVG`, `MIN`, `MAX`, and `COUNT` metrics using plain JavaScript `reduce` directly on `filteredRows`.
- **SheetJS Client File I/O & Dynamic Chunking**:
  - **Import**: Drag & drop or upload `.xlsx`, `.xls`, `.csv`, and `.tsv` files with automatic column header deduplication, size limits (10 MB / 10k rows / 100 cols), and type inference heuristics.
  - **Export**: One-click export to native Excel Workbooks (`.xlsx`) or CSV files (`.csv`) with automatic formula injection escaping (`=`, `+`, `-`, `@`, `\t`, `\r`) and unique header disambiguation.
- **Google Gemini AI Assistant**:
  - **AI Grounding**: Contextually grounds the LLM on your active table schema, summary metrics, and data rows.
  - **Structured Data Operations (`generateObject`)**:
    - 🪄 **Fill Missing**: Identifies missing/null cells and predicts values based on data patterns.
    - 🧹 **Clean Data**: Normalizes inconsistent formats, trims whitespace, and fixes typos.
    - 🔍 **Interactive Diff Preview**: Review proposed cell mutations before clicking **Apply** or **Discard** with stale patch conflict detection.
  - **Streaming Data Q&A**: Real-time natural language answers, dataset trends, and executive summaries.
- **Zen-Brutalist Design System & Accessibility**:
  - Clean borders, tight radius tokens (0–8px), subtle elevation, and responsive layouts across desktop, tablet, and mobile.
  - Keyboard navigation (`ArrowUp`/`ArrowDown`, `Home`/`End`, `Escape`) and instant actions for column deletion and document replacement with undo (`Ctrl+Z`) — no confirmation modals.
  - Settings is a route (`/settings`) with a three-item section rail — AI & Models, Modules, Shortcuts — not a floating modal.
  - Seamless **Dark** & **Light** themes with FOUC prevention and explicit `color-scheme` support.
  - 30-entry undo/redo history stack (`Ctrl+Z` / `Ctrl+Y`) and robust debounced auto-saving to `localStorage` with unload flush.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `↑` / `↓` / `←` / `→` | Navigate active cell box (Excel-style) |
| `Enter` / `F2` | Start editing cell / commit & move down |
| `Shift` + arrows / `Shift` + click | Extend the selection into a range |
| `Delete` / `Backspace` | Clear the selection |
| `Ctrl + C` / `Cmd + C` | Copy the selection as TSV |
| `Ctrl + Shift + L` / `E` / `R` | Align selection left / center / right |
| `Tab` / `Shift + Tab` | Navigate and edit cells horizontally |
| `Ctrl + K` / `Cmd + K` | Focus instant search bar |
| `Ctrl + N` / `Cmd + N` | Add new row |
| `Ctrl + Z` / `Cmd + Z` | Undo last table edit |
| `Ctrl + Y` / `Cmd + Shift + Z` | Redo table edit |
| `Ctrl + /` / `Cmd + /` | Toggle AI Assistant drawer |
| `Ctrl + ,` / `Cmd + ,` | Open Settings |
| `Escape` | Cancel active cell edit / close panel or menu |

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
Runs 92 unit tests across 11 files, covering the table store, the multi-file document index, cell alignment, SheetJS import/export, the AI endpoint, and the ICEGrid module.

### Run Playwright E2E Tests
```bash
bun run test:e2e
```
Runs 21 end-to-end user workflows in headless Chromium, including:
- Sticky headers and floor-pinned footer summaries on the restored active file.
- Search filtering, column sorting, row addition, and inline cell editing.
- Excel active-cell navigation, column resizing, and double-click column rename.
- Hover-only sort chevrons and the AI drawer's ribbon/Escape toggle (it has no close button).
- The `/settings` route: section rail, API key save, and a guard that opening it never pops a file chooser.
- File creation and import living only in the Files menu, file switching, rename persistence, and deleting the last file.
- Long cell text clipping inside its own column, and range alignment with undo/redo and reload persistence.
- Module ribbon metadata, dropdown clipping in light mode, instant column deletion, and the responsive mobile layout.

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
│   ├── +layout.ts            # SSR disabled for every route (export const ssr = false)
│   ├── +page.svelte          # Workspace assembling Header, DataTable, Ribbon, and AiDrawer
│   ├── settings/+page.svelte # Settings route with AI / Modules / Shortcuts section rail
│   └── api/ai/
│       ├── +server.ts        # Unified Gemini AI endpoint (x-ai-api-key authentication)
│       └── models/+server.ts # Gemini model catalog endpoint
└── lib/
    ├── types.ts              # Strict TypeScript definitions
    ├── constants.ts          # Official Gemini models, column configs, and status palettes
    ├── workspace.svelte.ts   # Shared document/table/module/toast stores, owned above the router
    ├── table/                # Complete Spreadsheet Engine
    │   ├── DataTable.svelte     # Semantic <table> with inline editing, keyboard nav, & sticky footer
    │   ├── DropdownCellEditor.svelte # Viewport-safe floating dropdown editor
    │   ├── store.svelte.ts      # Svelte 5 runes table store (CRUD, search, sort, summaries)
    │   ├── documents.svelte.ts  # Multi-file index: one storage slot per file
    │   ├── cells.ts             # Typed cell parsing and normalization
    │   ├── commands.ts          # Reversible atomic mutations for undo/redo
    │   ├── schema.ts            # Zod V2 schema & table migrations
    │   └── persistence.ts       # Debounced localStorage persistence
    ├── components/           # Application UI Shell
    │   ├── Header.svelte        # Files switcher, file title, search, alignment control, undo/redo
    │   ├── RightRibbon.svelte   # AI, modules, add row, export, theme, settings (no file/import)
    │   ├── AiDrawer.svelte      # AI assistant with structured diff preview & streaming chat
    │   ├── Icons.svelte         # Universal SVG icon component and path catalog
    │   └── settings/            # /settings page sections (Ai, Modules, Shortcuts)
    ├── modules/              # Workspace module system
    │   ├── registry.ts          # Browser module registry (no runtime-downloaded modules)
    │   ├── module-store.svelte.ts # Enablement, run lifecycle, cancellation
    │   └── icegrid/             # ICEGATE 37-column invoice extraction module
    ├── server/               # Server-only code
    │   ├── models.ts            # Allowed Gemini model ids, shared by both API routes
    │   └── modules/             # Server AI handler types + static action registry
    ├── data/                 # SheetJS I/O
    │   ├── import.ts            # SheetJS workbook parser & column type inference
    │   ├── export.ts            # CSV/XLSX export & formula injection mitigation
    ├── ai/                   # Gemini AI Pipeline
    │   ├── client.ts            # Browser-side /api/ai transport
    │   └── patches.ts           # Patch conflict verification
    └── ui/                   # Feedback & Headless UI
        ├── position.ts          # Floating popover positioning engine
        ├── combobox.ts          # Combobox keyboard navigation
        ├── menu.ts              # Dropdown menu focus management
        ├── ToastHost.svelte     # Reactive toast notification container
        └── toast.svelte.ts      # Global toast store
```



---

## License
MIT
