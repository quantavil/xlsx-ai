<script lang="ts">
	import Icon from "$lib/components/Icons.svelte";
	import DropdownCellEditor from "./DropdownCellEditor.svelte";
	import type { createTableStore } from "./store.svelte";
	import { parseClipboardTable } from "./store.svelte";
	import type { FindStore } from "./find.svelte";
	import type {
		CellAlign,
		Column,
		ColumnType,
		CellValue,
		Row,
	} from "$lib/types";
	import {
		COLUMN_TYPE_CONFIG,
		formatCellValue,
		getDropdownStyle,
	} from "$lib/constants";
	import { computeFloatingPosition } from "$lib/ui/position";
	import {
		isFormula,
		isNumericType,
		resolveDropdownOptionsForRows,
	} from "./cells";
	import { resolveEditTargets, type EditTarget } from "./range-edit";
	import {
		columnLetter,
		ERROR_VALUE,
		offsetFormulaRefs,
		referencedCells,
	} from "./formulas";
	import {
		applyFunction,
		applyReference,
		expectsReference,
		matchFunctions,
		type FormulaFunction,
	} from "./formula-hints";
	import FormulaHintPopup from "./FormulaHintPopup.svelte";
	import {
		distinctValuesForColumn,
		conditionOpsForType,
		stringifyCellValue,
		type ColumnFilter,
		type ConditionFilter,
	} from "./filters";

	let {
		store,
		findStore,
		onNotify,
	}: {
		store: ReturnType<typeof createTableStore>;
		findStore?: FindStore;
		onNotify: (
			type: "info" | "success" | "warning" | "error",
			msg: string,
		) => void;
	} = $props();

	// Selection lives in the store so the header's alignment control acts on the same range.
	let activeCell = $derived(store.activeCell);

	// #2 Clamp the selection when filteredRows shrinks (search/sort) to avoid OOB TypeError
	$effect(() => {
		const rows = store.filteredRows;
		const cols = store.columns;
		const cell = store.activeCell;
		if (!cell) return;
		if (rows.length === 0 || cols.length === 0) {
			store.setSelection(null);
			return;
		}
		let next = cell;
		if (
			next.rowIndex >= rows.length ||
			!rows.some((r) => r.id === next.rowId)
		) {
			const clampRow = Math.min(next.rowIndex, rows.length - 1);
			next = { ...next, rowId: rows[clampRow].id, rowIndex: clampRow };
		}
		if (next.colIndex >= cols.length) {
			next = {
				...next,
				colIndex: cols.length - 1,
				columnId: cols[cols.length - 1].id,
			};
		}
		if (!cols.some((c) => c.id === next.columnId)) {
			next = { ...next, columnId: cols[next.colIndex]?.id ?? cols[0].id };
		}
		if (next !== cell) store.setSelection(next);
	});
	let editingCell = $state<{ rowId: string; columnId: string } | null>(null);
	let editTargets = $state<EditTarget[]>([]);
	let dropdownSearchSeed = $state<string>("");
	let cellNodes = new Map<string, HTMLElement>();
	let contextMenu = $state<{
		x: number;
		y: number;
		rowId: string;
		colId: string;
		rowIndex: number;
		colIndex: number;
	} | null>(null);

	let editValue = $state<string>("");
	let activeColMenu = $state<string | null>(null);
	let renamingColId = $state<string | null>(null);
	let renamingColValue = $state<string>("");
	// #17 column menu fixed positioning to escape scroll clipping
	let colMenuTriggerEls = new Map<string, HTMLElement>();
	let colMenuStyle = $state<string>("");
	function syncColMenuPos() {
		if (!activeColMenu) {
			colMenuStyle = "";
			return;
		}
		const trigger = colMenuTriggerEls.get(activeColMenu);
		if (!trigger) return;
		const tr = trigger.getBoundingClientRect();
		const layer = { width: 192, height: 280 };
		const viewport = {
			width: window.innerWidth,
			height: window.innerHeight,
		};
		const pos = computeFloatingPosition(
			{
				top: tr.top,
				bottom: tr.bottom,
				left: tr.left,
				right: tr.right,
				width: tr.width,
				height: tr.height,
			},
			layer,
			viewport,
			{ offset: 6, margin: 8, preferPlacement: "bottom", align: "end" },
		);
		colMenuStyle = `top:${pos.top}px; left:${pos.left}px;`;
	}
	$effect(() => {
		// track active menu change + viewport resize
		if (activeColMenu) {
			// next tick ensures DOM exists
			requestAnimationFrame(syncColMenuPos);
		}
	});

	// Per-column filter popup state
	let activeFilterColId = $state<string | null>(null);
	let filterMenuTriggerEls = new Map<string, HTMLElement>();
	let filterMenuStyle = $state<string>("");
	let filterTab = $state<'values' | 'condition'>('values');
	let valueSearchQuery = $state<string>("");
	let draftValues = $state<Set<string>>(new Set<string>());
	let draftConditionOp = $state<ConditionFilter['op']>('contains');
	let draftConditionValue = $state<string>("");
	let draftConditionValue2 = $state<string>("");
	function syncFilterPos() {
		if (!activeFilterColId) {
			filterMenuStyle = "";
			return;
		}
		const trigger = filterMenuTriggerEls.get(activeFilterColId);
		if (!trigger) return;
		const tr = trigger.getBoundingClientRect();
		const layer = { width: 320, height: 380 };
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		const pos = computeFloatingPosition(
			{ top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right, width: tr.width, height: tr.height },
			layer,
			viewport,
			{ offset: 6, margin: 8, preferPlacement: 'bottom', align: 'start' }
		);
		filterMenuStyle = `top:${pos.top}px; left:${pos.left}px;`;
	}
	$effect(() => {
		if (activeFilterColId) requestAnimationFrame(syncFilterPos);
	});

	function openFilter(colId: string, colType: ColumnType) {
		const existing = store.columnFilters[colId] as ColumnFilter | undefined;
		const ops = conditionOpsForType(colType);
		valueSearchQuery = '';

		if (existing?.kind === 'condition') {
			filterTab = 'condition';
			// A column retyped since the filter was set can leave an operator its new
			// type does not offer, so fall back to the first one it does.
			const valid = ops.some((o) => o.op === existing.op);
			draftConditionOp = valid ? existing.op : ops[0].op;
			draftConditionValue = valid ? (existing.value ?? '') : '';
			draftConditionValue2 = valid ? (existing.value2 ?? '') : '';
		} else {
			filterTab = 'values';
			// No filter yet means every value is checked, so the list opens showing
			// what is currently visible rather than an empty set.
			draftValues = new Set(
				existing?.kind === 'values'
					? existing.values
					: distinctValuesForColumn(store.resolvedRows, colId)
			);
			draftConditionOp = ops[0].op;
			draftConditionValue = '';
			draftConditionValue2 = '';
		}

		activeFilterColId = colId;
		activeColMenu = null;
		requestAnimationFrame(syncFilterPos);
	}

	function applyValueFilter(colId: string) {
		if (draftValues.size === 0) {
			// no values selected -> filter to none
			store.setColumnFilter(colId, { kind: 'values', values: [] });
		} else {
			const vals = distinctValuesForColumn(store.resolvedRows, colId);
			// if all values selected, treat as no filter (clear)
			if (draftValues.size === vals.length && vals.every((v) => draftValues.has(v))) {
				store.clearColumnFilter(colId);
			} else {
				store.setColumnFilter(colId, { kind: 'values', values: Array.from(draftValues) });
			}
		}
		activeFilterColId = null;
	}

	function applyConditionFilter(colId: string) {
		const op = draftConditionOp;
		if (op === 'isEmpty' || op === 'isNotEmpty') {
			store.setColumnFilter(colId, { kind: 'condition', op });
		} else if (op === 'between') {
			if (!draftConditionValue.trim() || !draftConditionValue2.trim()) return;
			store.setColumnFilter(colId, {
				kind: 'condition',
				op,
				value: draftConditionValue.trim(),
				value2: draftConditionValue2.trim()
			});
		} else {
			// `contains ''` matches every row, which is what having no filter means.
			if (!draftConditionValue.trim()) {
				if (op !== 'contains' && op !== 'notContains') return;
				store.clearColumnFilter(colId);
				activeFilterColId = null;
				return;
			}
			store.setColumnFilter(colId, { kind: 'condition', op, value: draftConditionValue.trim() });
		}
		activeFilterColId = null;
	}

	function clearFilterForActive() {
		if (!activeFilterColId) return;
		store.clearColumnFilter(activeFilterColId);
		activeFilterColId = null;
	}

	// Column Resizing state
	let resizingColId = $state<string | null>(null);
	let resizeStartX = $state<number>(0);
	let resizeStartWidth = $state<number>(0);
	let isResizing = $state<boolean>(false);

	// Index column (w-10) + add-column header (w-20) + the declared column widths, each
	// floored at the `min-width: 70px` the cells carry.
	let gridW = $derived(
		40 +
			80 +
			store.columns.reduce(
				(sum, c) => sum + Math.max(70, c.width || 180),
				0,
			),
	);

	// #9 Row virtualization — cap DOM at ~60 rows even for 10k import
	const ROW_H = 36;
	let tableScrollEl = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let viewportH = $state(600);
	function onTableScroll(e: Event) {
		scrollTop = (e.target as HTMLElement).scrollTop;
		if (contextMenu) contextMenu = null;
	}
	let visibleStart = $derived(
		Math.max(
			0,
			Math.min(
				store.filteredRows.length - 1,
				Math.floor(scrollTop / ROW_H),
			),
		),
	);
	let viewportCount = $derived(Math.ceil(viewportH / ROW_H) + 14);
	let renderedRows = $derived.by(() => {
		const rows = store.filteredRows;
		if (rows.length <= 80) return rows.map((r, i) => ({ row: r, idx: i }));
		const end = Math.min(rows.length, visibleStart + viewportCount);
		const slice: Array<{ row: (typeof rows)[number]; idx: number }> = [];
		for (let i = visibleStart; i < end; i++)
			slice.push({ row: rows[i], idx: i });
		return slice;
	});
	let topPadH = $derived(
		store.filteredRows.length <= 80 ? 0 : visibleStart * ROW_H,
	);
	let bottomPadH = $derived.by(() => {
		if (store.filteredRows.length <= 80) return 0;
		const remaining =
			store.filteredRows.length - (visibleStart + viewportCount);
		return remaining > 0 ? remaining * ROW_H : 0;
	});
	$effect(() => {
		if (!tableScrollEl) return;
		viewportH = tableScrollEl.clientHeight || 600;
		const ro = new ResizeObserver(() => {
			if (tableScrollEl) viewportH = tableScrollEl.clientHeight;
		});
		ro.observe(tableScrollEl);
		return () => ro.disconnect();
	});
	function scrollToRow(idx: number) {
		if (!tableScrollEl || store.filteredRows.length <= 80 || idx < 0)
			return;
		if (idx < visibleStart) tableScrollEl.scrollTop = idx * ROW_H;
		else if (idx >= visibleStart + viewportCount - 4)
			tableScrollEl.scrollTop = (idx - viewportCount + 6) * ROW_H;
	}

	// Keep active cell visible inside virtual window
	$effect(() => {
		if (activeCell) scrollToRow(activeCell.rowIndex);
	});

	// Keep active find match visible inside virtual window
	$effect(() => {
		const match = findStore?.activeMatch;
		if (!match) return;
		const idx = store.filteredRows.findIndex((r) => r.id === match.rowId);
		if (idx !== -1) scrollToRow(idx);
	});

	/**
	 * Where in the cell's text the click landed, so cursor mode can open the editor with
	 * the caret under the pointer instead of selecting the whole value - Word, not Excel.
	 *
	 * Only ever set for text columns. Every other type renders a formatted value
	 * (`1,234.56`, a date) while the editor loads the raw one (`1234.56`, `=SUM(A1:A2)`),
	 * so an offset measured against the display string would land somewhere arbitrary.
	 * Null means "put the caret at the end", which is the honest answer in those cases.
	 */
	let initialCaretOffset: number | null = null;

	function caretOffsetAt(e: MouseEvent): number | null {
		if (typeof document === "undefined") return null;
		try {
			const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
			if (range)
				return textOffset(range.startContainer, range.startOffset);
			const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
			if (pos) return textOffset(pos.offsetNode, pos.offset);
		} catch {
			// Both APIs are non-standard in one engine or the other; end-of-value is fine.
		}
		return null;
	}

	/**
	 * A caret offset only means a character index when it was measured inside a text
	 * node. Clicking the cell's padding resolves to the element instead, where the same
	 * number is a child index - 0 or 1 - and would silently park the caret at the start.
	 */
	function textOffset(node: Node | null, offset: number): number | null {
		return node?.nodeType === Node.TEXT_NODE ? offset : null;
	}

	// Svelte Action for autofocus
	function autoFocus(node: HTMLElement) {
		node.focus();
		if (node instanceof HTMLInputElement) {
			if (store.cursorMode && !renamingColId) {
				// Placing a caret, not selecting: the next keystroke has to insert, not replace.
				const offset = Math.min(
					initialCaretOffset ?? node.value.length,
					node.value.length,
				);
				node.setSelectionRange(offset, offset);
			} else {
				node.select();
			}
			initialCaretOffset = null;
		}
	}

	function registerCellNode(node: HTMLElement, key: string) {
		cellNodes.set(key, node);
		return {
			destroy() {
				cellNodes.delete(key);
			},
		};
	}

	function startResize(e: MouseEvent, colId: string, currentWidth: number) {
		e.stopPropagation();
		e.preventDefault();
		resizingColId = colId;
		resizeStartX = e.clientX;
		resizeStartWidth = currentWidth;
		isResizing = true;
		let pendingWidth = currentWidth;
		let rafId: number | null = null;

		function onMouseMove(moveEvent: MouseEvent) {
			if (!resizingColId) return;
			const delta = moveEvent.clientX - resizeStartX;
			pendingWidth = Math.max(60, resizeStartWidth + delta);
			// #15 throttle per frame — store clone + save each pixel is thrash
			if (rafId !== null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (resizingColId)
					store.updateColumnWidth(resizingColId, pendingWidth);
			});
		}

		function onMouseUp() {
			if (rafId !== null) cancelAnimationFrame(rafId);
			if (resizingColId)
				store.updateColumnWidth(resizingColId, pendingWidth);
			isResizing = false;
			resizingColId = null;
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		}

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	}

	function autoFitColumn(colId: string) {
		const col = store.columns.find((c) => c.id === colId);
		if (!col) return;
		let maxLen = col.name.length;
		for (const row of store.rows) {
			const str = String(row[colId] ?? "");
			if (str.length > maxLen) maxLen = str.length;
		}
		const fitWidth = Math.max(
			80,
			Math.min(380, Math.round(maxLen * 8.8 + 48)),
		);
		store.updateColumnWidth(colId, fitWidth);
	}

	function selectCell(
		rowId: string,
		columnId: string,
		rowIndex: number,
		colIndex: number,
		extend = false,
	) {
		if (
			editingCell &&
			(editingCell.rowId !== rowId || editingCell.columnId !== columnId)
		) {
			commitEdit();
		}
		store.setSelection({ rowId, columnId, rowIndex, colIndex }, extend);
		const key = `${rowId}-${columnId}`;
		const el = cellNodes.get(key);
		if (el && document.activeElement !== el && !editingCell) {
			el.focus();
		}
	}

	function handleCellContextMenu(
		e: MouseEvent,
		rowId: string,
		colId: string,
		rowIndex: number,
		colIndex: number,
	) {
		e.preventDefault();
		if (!store.selectionKeys.has(`${rowId}::${colId}`)) {
			selectCell(rowId, colId, rowIndex, colIndex);
		}
		const x =
			typeof window !== "undefined"
				? Math.max(8, Math.min(e.clientX, window.innerWidth - 220))
				: e.clientX;
		const y =
			typeof window !== "undefined"
				? Math.max(8, Math.min(e.clientY, window.innerHeight - 300))
				: e.clientY;
		contextMenu = { x, y, rowId, colId, rowIndex, colIndex };
	}

	function selectedRowIdsForMenu(fallbackRowId: string): string[] {
		const rect = store.selectionRect;
		if (!rect) return [fallbackRowId];
		const ids: string[] = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = store.filteredRows[r];
			if (row) ids.push(row.id);
		}
		if (ids.length === 0) return [fallbackRowId];
		if (ids.includes(fallbackRowId)) return ids;
		return [fallbackRowId];
	}

	async function handleMenuCopy() {
		const tsv = selectionAsTsv();
		try {
			await navigator.clipboard?.writeText(tsv);
		} catch {
			// Clipboard may be unavailable (permissions); still close + toast.
		}
		contextMenu = null;
		onNotify("info", "Copied to clipboard");
	}

	async function handleMenuCut() {
		const tsv = selectionAsTsv();
		try {
			await navigator.clipboard?.writeText(tsv);
		} catch {
			// ignore clipboard errors
		}
		store.applyCellPatches(
			selectedCells().map(({ row, col }) => ({
				rowId: row.id,
				columnId: col.id,
				newValue: null,
			})),
		);
		contextMenu = null;
		onNotify("info", "Cut selection");
	}

	let lastPasteTimestamp = 0;
	function applyPastedText(text: string) {
		const now = Date.now();
		if (now - lastPasteTimestamp < 150) return;
		lastPasteTimestamp = now;
		const matrix = parseClipboardTable(text);
		if (matrix.length === 0) return;
		const count = store.pasteMatrix(matrix);
		onNotify("info", `Pasted ${count} cell(s).`);
	}

	async function handleMenuPaste() {
		contextMenu = null;
		try {
			const text = await navigator.clipboard?.readText();
			if (text) applyPastedText(text);
		} catch {
			// clipboard read denied; menu already closed
		}
	}

	function handleMenuClear() {
		store.applyCellPatches(
			selectedCells().map(({ row, col }) => ({
				rowId: row.id,
				columnId: col.id,
				newValue: null,
			})),
		);
		contextMenu = null;
	}

	let editTargetRows = $derived.by<Row[]>(() => {
		if (editTargets.length === 0) return [];
		const rowMap = new Map(store.rows.map((row) => [row.id, row]));
		return editTargets.flatMap((target) => {
			const row = rowMap.get(target.rowId);
			return row ? [row] : [];
		});
	});

	function getCellDropdownOptions(col: Column, rowId: string) {
		const activeRow = store.rows.find((row) => row.id === rowId);
		return resolveDropdownOptionsForRows(
			col,
			activeRow,
			editTargetRows,
			store.rows,
		);
	}

	/** What a range's dropdown shows: the shared value, or nothing when the rows disagree. */
	function dropdownEditorState(columnId: string): {
		value: string;
		mixed: boolean;
	} {
		if (editTargetRows.length <= 1)
			return { value: editValue, mixed: false };
		const first = editTargetRows[0]?.[columnId] ?? null;
		const agrees = editTargetRows.every((row) =>
			Object.is(row[columnId] ?? null, first),
		);
		return { value: agrees ? String(first ?? "") : "", mixed: !agrees };
	}

	// ── Formula editing ────────────────────────────────────────────────────────────
	// The text editor is a plain <input>, so the caret is the only thing that says
	// what the user is typing *at* — both the name to complete and whether a clicked
	// cell should become a reference. It is read back on every input and key event.
	let editorInput = $state<HTMLInputElement | null>(null);
	let editorCaret = $state(0);
	let hintIndex = $state(0);
	/** Escape closes the list without cancelling the edit; typing brings it back. */
	let hintDismissed = $state(false);
	/** Set while a drag is writing a range, holding the address the drag began on. */
	let pointAnchor = $state<string | null>(null);

	const hintMatches = $derived(
		editingCell && !hintDismissed
			? matchFunctions(editValue, editorCaret)
			: [],
	);

	/** Cells the formula being edited reads, so the grid can outline them. */
	const highlightedRefs = $derived(
		editingCell && editValue[0] === "="
			? referencedCells(
					editValue,
					store.columns.length,
					store.filteredRows.length,
				)
			: new Set<string>(),
	);

	const HINT_SIZE = { width: 260, height: 224 };

	const hintAnchor = $derived.by(() => {
		if (
			!editingCell ||
			hintMatches.length === 0 ||
			typeof window === "undefined"
		)
			return null;
		const node = cellNodes.get(
			`${editingCell.rowId}-${editingCell.columnId}`,
		);
		if (!node) return null;
		// Same clamping every other floating layer here uses, so editing the last column
		// does not push the list off the right edge, or a bottom row off the floor.
		const placed = computeFloatingPosition(
			node.getBoundingClientRect(),
			HINT_SIZE,
			{ width: window.innerWidth, height: window.innerHeight },
			{ offset: 2 },
		);
		return {
			left: placed.left,
			bottom: placed.top,
			maxHeight: placed.maxHeight,
		};
	});

	function syncCaret() {
		editorCaret = editorInput?.selectionStart ?? editValue.length;
		hintIndex = 0;
		hintDismissed = false;
	}

	function writeEditor(next: { text: string; caret: number }) {
		editValue = next.text;
		editorCaret = next.caret;
		// The DOM caret only moves after Svelte has written the new value back.
		queueMicrotask(() => {
			editorInput?.focus();
			editorInput?.setSelectionRange(next.caret, next.caret);
		});
	}

	function pickHint(fn: FormulaFunction) {
		writeEditor(applyFunction(editValue, editorCaret, fn));
		hintIndex = 0;
	}

	/**
	 * Point mode: a click on another cell writes its address into the formula.
	 *
	 * Only when the caret sits where a reference belongs — otherwise a click is an
	 * ordinary "move on, commit this cell". Returns whether it consumed the click.
	 */
	function pointAtCell(
		colIndex: number,
		rowId: string,
		extendFrom: string | null,
	): boolean {
		if (!editingCell || !expectsReference(editValue, editorCaret))
			return false;
		const address = `${columnLetter(colIndex)}${store.sheetRowFor(rowId)}`;
		writeEditor(
			applyReference(
				editValue,
				editorCaret,
				extendFrom ? `${extendFrom}:${address}` : address,
			),
		);
		return true;
	}

	// ── Fill handle ────────────────────────────────────────────────────────────────
	/** The cell a fill drag started from, held for as long as the button is down. */
	let fillFrom = $state<{ rowIndex: number; colIndex: number } | null>(null);
	/** Where the drag has reached, so the grid can outline what is about to be filled. */
	let fillTo = $state<{ rowIndex: number; colIndex: number } | null>(null);

	/**
	 * The rectangle a fill covers: one axis only, whichever the drag went further in.
	 * Excel fills a line, not a block, and a diagonal drag has to resolve to one.
	 */
	const fillRect = $derived.by(() => {
		if (!fillFrom || !fillTo) return null;
		const dRow = fillTo.rowIndex - fillFrom.rowIndex;
		const dCol = fillTo.colIndex - fillFrom.colIndex;
		if (dRow === 0 && dCol === 0) return null;
		const vertical = Math.abs(dRow) >= Math.abs(dCol);
		const to = vertical
			? { rowIndex: fillTo.rowIndex, colIndex: fillFrom.colIndex }
			: { rowIndex: fillFrom.rowIndex, colIndex: fillTo.colIndex };
		return {
			r0: Math.min(fillFrom.rowIndex, to.rowIndex),
			r1: Math.max(fillFrom.rowIndex, to.rowIndex),
			c0: Math.min(fillFrom.colIndex, to.colIndex),
			c1: Math.max(fillFrom.colIndex, to.colIndex),
		};
	});

	function isInFill(rowIndex: number, colIndex: number): boolean {
		const r = fillRect;
		return (
			!!r &&
			rowIndex >= r.r0 &&
			rowIndex <= r.r1 &&
			colIndex >= r.c0 &&
			colIndex <= r.c1
		);
	}

	/**
	 * Copies the source cell across the dragged line, stepping every relative
	 * reference by how far each target sits from the source — Excel's fill. A plain
	 * value is copied as it stands; only formulas are rewritten.
	 */
	function commitFill() {
		const rect = fillRect;
		const from = fillFrom;
		fillFrom = null;
		fillTo = null;
		if (!rect || !from) return;

		const sourceRow = store.filteredRows[from.rowIndex];
		const sourceCol = store.columns[from.colIndex];
		if (!sourceRow || !sourceCol) return;
		const source = store.rawCell(sourceRow.id, sourceCol.id);

		// A formula addresses the sheet, and the sheet is the unfiltered table. Under a
		// search or a sort the visible row two below is rarely the sheet row two below,
		// so the step has to be measured where the references actually point.
		const sheetIndex = new Map(store.rows.map((row, i) => [row.id, i]));
		const sourceSheetRow = sheetIndex.get(sourceRow.id) ?? from.rowIndex;

		const patches = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			for (let c = rect.c0; c <= rect.c1; c++) {
				if (r === from.rowIndex && c === from.colIndex) continue;
				const row = store.filteredRows[r];
				const col = store.columns[c];
				if (!row || !col) continue;
				patches.push({
					rowId: row.id,
					columnId: col.id,
					newValue: isFormula(source)
						? offsetFormulaRefs(
								source,
								(sheetIndex.get(row.id) ?? r) - sourceSheetRow,
								c - from.colIndex,
								store.columns.length,
								store.rows.length,
							)
						: source,
				});
			}
		}
		if (patches.length > 0) store.applyCellPatches(patches);
	}

	function startEditing(
		rowId: string,
		columnId: string,
		initialVal: unknown,
		typedChar = "",
	) {
		const requestedCell = {
			rowId,
			columnId,
			rowIndex: store.filteredRows.findIndex((row) => row.id === rowId),
			colIndex: store.columns.findIndex(
				(column) => column.id === columnId,
			),
		};
		const targets = resolveEditTargets(
			store.selectionRect,
			store.activeCell,
			requestedCell,
			store.filteredRows,
			store.columns,
		);
		if (targets.length === 1)
			store.setSelection(requestedCell);
		editTargets = targets;
		editingCell = { rowId, columnId };
		editValue =
			typedChar ||
			(initialVal !== null && initialVal !== undefined
				? String(initialVal)
				: "");
		// A dropdown ignores editValue, so the character that opened it has to reach the
		// editor's search box separately or the keystroke is simply swallowed.
		dropdownSearchSeed = typedChar;
		editorCaret = editValue.length;
		hintIndex = 0;
		hintDismissed = false;
		pointAnchor = null;
	}

	function commitEdit(): boolean {
		if (!editingCell) return false;
		const wasBulk = editTargets.length > 1;
		store.applyCellPatches(
			editTargets.map((target) => ({
				rowId: target.rowId,
				columnId: target.columnId,
				newValue: editValue,
			})),
		);
		const { rowId, columnId } = editingCell;
		editingCell = null;
		editTargets = [];
		pointAnchor = null;
		cellNodes.get(`${rowId}-${columnId}`)?.focus();
		return wasBulk;
	}

	function cancelEdit() {
		editingCell = null;
		editTargets = [];
		pointAnchor = null;
		if (activeCell)
			cellNodes
				.get(`${activeCell.rowId}-${activeCell.columnId}`)
				?.focus();
	}

	// A filled dropdown cell paints its own colour inline, which outranks the range
	// class every other column uses - so a dropdown never looked selected. Layering the
	// same tint as a flat gradient keeps both the selection and the value's colour.
	const RANGE_TINT =
		"linear-gradient(color-mix(in oklab, var(--accent-primary) 10%, transparent), color-mix(in oklab, var(--accent-primary) 10%, transparent))";

	const ALIGN_CLASS: Record<CellAlign, string> = {
		left: "text-left",
		center: "text-center",
		right: "text-right",
	};

	// focus fires between mousedown and click, so without this the focus handler would
	// reset the anchor and a shift-click would collapse the range to a single cell.
	let pointerExtend = false;

	function isInSelection(rowId: string, columnId: string): boolean {
		return store.selectionKeys.has(`${rowId}::${columnId}`);
	}

	/**
	 * The selection's outline, Excel-style.
	 *
	 * A range reads as one region because a single border runs around its perimeter, not
	 * because every cell in it is tinted. Each cell contributes only the edges that sit
	 * on that perimeter, so the interior grid lines stay untouched. Returned as inset
	 * shadows because a real border would resize the cell.
	 *
	 * While the editor is open the input draws its own focus ring, so the cell underneath
	 * drops its own rather than doubling it.
	 */
	function cellShadow(
		isActive: boolean,
		isEditing: boolean,
		rowIndex: number,
		colIndex: number,
	): string {
		const parts: string[] = [];
		if (isActive && !isEditing) {
			parts.push("inset 0 0 0 2px var(--border-focus)");
		}

		const rect = store.selectionRect;
		if (rect && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1)) {
			if (
				rowIndex >= rect.r0 &&
				rowIndex <= rect.r1 &&
				colIndex >= rect.c0 &&
				colIndex <= rect.c1
			) {
				if (rowIndex === rect.r0)
					parts.push("inset 0 2px 0 0 var(--border-focus)");
				if (rowIndex === rect.r1)
					parts.push("inset 0 -2px 0 0 var(--border-focus)");
				if (colIndex === rect.c0)
					parts.push("inset 2px 0 0 0 var(--border-focus)");
				if (colIndex === rect.c1)
					parts.push("inset -2px 0 0 0 var(--border-focus)");
			}
		}

		return parts.join(", ");
	}

	/** Every (row, column) pair inside the current selection rectangle, in reading order. */
	function selectedCells(): Array<{ row: Row; col: Column }> {
		const rect = store.selectionRect;
		if (!rect) return [];
		const out: Array<{ row: Row; col: Column }> = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = store.filteredRows[r];
			if (!row) continue;
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = store.columns[c];
				if (col) out.push({ row, col });
			}
		}
		return out;
	}

	/**
	 * The selection as TSV, so it pastes back into Excel as a range.
	 *
	 * Only the primary rectangle: TSV is a grid, and disjoint cursors have no grid shape.
	 * Stacking them would hand back a block the user never selected, which is worse than
	 * copying the one region they can point at. Excel refuses the same case outright.
	 */
	function selectionAsTsv(): string {
		const rect = store.selectionRect;
		if (!rect) return "";
		const lines: string[] = [];
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = store.filteredRows[r];
			if (!row) continue;
			const cells: string[] = [];
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = store.columns[c];
				if (col) cells.push(formatCellValue(col.type, row[col.id]));
			}
			lines.push(cells.join("\t"));
		}
		return lines.join("\n");
	}

	async function handleTableKeyDown(e: KeyboardEvent) {
		if (editingCell) return;
		if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
			e.preventDefault();
			store.selectAll();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
			e.preventDefault();
			try {
				const text = await navigator.clipboard?.readText();
				if (text) applyPastedText(text);
			} catch {
				// clipboard read denied — no-op
			}
			return;
		}
		if (contextMenu && e.key === "Escape") {
			e.preventDefault();
			contextMenu = null;
			return;
		}
		if (
			!activeCell &&
			store.filteredRows.length > 0 &&
			store.columns.length > 0
		) {
			if (
				[
					"ArrowUp",
					"ArrowDown",
					"ArrowLeft",
					"ArrowRight",
					"Enter",
					"Tab",
				].includes(e.key)
			) {
				e.preventDefault();
				selectCell(store.filteredRows[0].id, store.columns[0].id, 0, 0);
				return;
			}
		}

		if (!activeCell) return;
		let { rowIndex, colIndex } = activeCell;
		const totalRows = store.filteredRows.length;
		const totalCols = store.columns.length;
		// #2 Guard stale indexes after filter/sort shrinks the list
		if (totalRows === 0 || totalCols === 0) return;
		if (
			rowIndex >= totalRows ||
			colIndex >= totalCols ||
			rowIndex < 0 ||
			colIndex < 0
		)
			return;
		const currentRow = store.filteredRows[rowIndex];
		if (!currentRow) return;

		if (e.key === "ArrowRight") {
			e.preventDefault();
			if (colIndex < totalCols - 1) {
				const nextCol = store.columns[colIndex + 1];
				selectCell(
					currentRow.id,
					nextCol.id,
					rowIndex,
					colIndex + 1,
					e.shiftKey,
				);
			}
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			if (colIndex > 0) {
				const prevCol = store.columns[colIndex - 1];
				selectCell(
					currentRow.id,
					prevCol.id,
					rowIndex,
					colIndex - 1,
					e.shiftKey,
				);
			}
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const step = e.key === "ArrowDown" ? 1 : -1;
			const nextRow = store.filteredRows[rowIndex + step];
			if (nextRow) {
				selectCell(
					nextRow.id,
					store.columns[colIndex].id,
					rowIndex + step,
					colIndex,
					e.shiftKey,
				);
			}
		} else if (e.key === "Escape") {
			// An Escape that collapsed nothing belongs to whatever panel is open above.
			if (store.collapseSelection()) e.preventDefault();
		} else if (e.key === "Tab") {
			e.preventDefault();
			if (e.shiftKey) {
				if (colIndex > 0) {
					const prevCol = store.columns[colIndex - 1];
					selectCell(
						currentRow.id,
						prevCol.id,
						rowIndex,
						colIndex - 1,
					);
				} else if (rowIndex > 0) {
					const prevRow = store.filteredRows[rowIndex - 1];
					if (prevRow) {
						const lastCol = store.columns[totalCols - 1];
						selectCell(
							prevRow.id,
							lastCol.id,
							rowIndex - 1,
							totalCols - 1,
						);
					}
				}
			} else {
				if (colIndex < totalCols - 1) {
					const nextCol = store.columns[colIndex + 1];
					selectCell(
						currentRow.id,
						nextCol.id,
						rowIndex,
						colIndex + 1,
					);
				} else if (rowIndex < totalRows - 1) {
					const nextRow = store.filteredRows[rowIndex + 1];
					if (nextRow) {
						const firstCol = store.columns[0];
						selectCell(nextRow.id, firstCol.id, rowIndex + 1, 0);
					}
				}
			}
		} else if (e.key === "Enter" || e.key === "F2") {
			e.preventDefault();
			const col = store.columns[colIndex];
			if (col)
				startEditing(
					currentRow.id,
					col.id,
					store.rawCell(currentRow.id, col.id),
				);
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			store.applyCellPatches(
				selectedCells().map(({ row, col }) => ({
					rowId: row.id,
					columnId: col.id,
					newValue: null,
				})),
			);
		} else if (
			(e.ctrlKey || e.metaKey) &&
			(e.key === "c" || e.key === "C")
		) {
			// The grid is select-none, so without this there is no way to get values out
			// short of exporting the whole file. TSV so it pastes back into Excel as a range.
			e.preventDefault();
			navigator.clipboard?.writeText(selectionAsTsv());
		} else if (
			e.key.length === 1 &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			const col = store.columns[colIndex];
			if (col) startEditing(currentRow.id, col.id, "", e.key);
		}
	}

	function handleGridPaste(e: ClipboardEvent) {
		if (editingCell) return;
		const active = document.activeElement as HTMLElement | null;
		if (
			active &&
			(active.tagName === "INPUT" ||
				active.tagName === "TEXTAREA" ||
				active.tagName === "SELECT")
		) {
			return;
		}
		const text = e.clipboardData?.getData("text");
		if (!text) return;
		e.preventDefault();
		applyPastedText(text);
	}

	function handleEditorKeyDown(
		e: KeyboardEvent,
		rowIndex: number,
		colIndex: number,
	) {
		e.stopPropagation();

		// The suggestion list owns these keys while it is open: Enter would otherwise
		// commit `=SU` and Escape would throw the whole edit away.
		if (hintMatches.length > 0) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : hintMatches.length - 1;
				hintIndex = (hintIndex + step) % hintMatches.length;
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				pickHint(hintMatches[hintIndex]);
				return;
			}
			if (e.key === "Escape") {
				// Dismiss the list, keep the edit. A second Escape cancels the cell.
				e.preventDefault();
				hintDismissed = true;
				hintIndex = 0;
				return;
			}
		}

		if (e.key === "Enter") {
			e.preventDefault();
			const wasBulk = commitEdit();
			if (!wasBulk && rowIndex < store.filteredRows.length - 1) {
				const nextRow = store.filteredRows[rowIndex + 1];
				selectCell(
					nextRow.id,
					store.columns[colIndex].id,
					rowIndex + 1,
					colIndex,
				);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancelEdit();
		} else if (e.key === "Tab") {
			e.preventDefault();
			const wasBulk = commitEdit();
			if (wasBulk) return;
			if (e.shiftKey) {
				if (colIndex > 0) {
					selectCell(
						store.filteredRows[rowIndex].id,
						store.columns[colIndex - 1].id,
						rowIndex,
						colIndex - 1,
					);
				}
			} else if (colIndex < store.columns.length - 1) {
				selectCell(
					store.filteredRows[rowIndex].id,
					store.columns[colIndex + 1].id,
					rowIndex,
					colIndex + 1,
				);
			}
		} else {
			// Arrow keys and typing move the caret after the event, not during it.
			queueMicrotask(syncCaret);
		}
	}

	function handleAddColumn() {
		// Pony: default to text, no popup. User can change type via column menu afterwards.
		const existing = new Set(store.columns.map((c) => c.name));
		let n = store.columns.length + 1;
		let name = `Column ${n}`;
		while (existing.has(name)) {
			n += 1;
			name = `Column ${n}`;
		}
		store.addColumn(name, "text");
		activeColMenu = null;
		onNotify(
			"success",
			`Added column "${name}" (Text). Change type via ··· menu.`,
		);
		// auto-focus rename for power users? start rename next tick
		requestAnimationFrame(() => {
			const newCol = store.columns[store.columns.length - 1];
			if (newCol) {
				renamingColId = newCol.id;
				renamingColValue = newCol.name;
			}
		});
	}

	function startRenameColumn(colId: string, currentName: string) {
		activeColMenu = null;
		renamingColId = colId;
		renamingColValue = currentName;
	}

	function commitRenameColumn() {
		if (renamingColId && renamingColValue.trim()) {
			store.renameColumn(renamingColId, renamingColValue.trim());
		}
		renamingColId = null;
	}

	function handleUpdateColumnType(colId: string, newType: ColumnType) {
		activeColMenu = null;
		const { invalidCount } = store.updateColumnType(colId, newType);
		if (invalidCount > 0) {
			onNotify(
				"warning",
				`Changed to ${COLUMN_TYPE_CONFIG[newType]?.label || newType} — ${invalidCount} value(s) cleared as invalid. Undo with Ctrl+Z.`,
			);
		} else {
			onNotify(
				"info",
				`Changed column type to ${COLUMN_TYPE_CONFIG[newType]?.label || newType}.`,
			);
		}
	}

	function requestDeleteColumn(colId: string, colName: string) {
		activeColMenu = null;
		if (store.columns.length <= 1) {
			onNotify("warning", "Table must have at least one column.");
			return;
		}
		store.deleteColumn(colId);
		onNotify("info", `Deleted column "${colName}" — Undo with Ctrl+Z.`);
	}

	function handleDocumentClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (
			!target?.closest(".column-menu-wrapper") &&
			!target?.closest(".column-popover")
		) {
			activeColMenu = null;
		}
		if (
			!target?.closest(".filter-trigger-wrapper") &&
			!target?.closest(".filter-popover")
		) {
			activeFilterColId = null;
		}
		if (contextMenu && !target?.closest(".context-menu")) {
			contextMenu = null;
		}
	}

</script>

<svelte:window
	onclick={handleDocumentClick}
	onmouseup={() => fillFrom && commitFill()}
	onscroll={() => {
		if (contextMenu) contextMenu = null;
	}}
	onblur={() => {
		if (contextMenu) contextMenu = null;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && activeFilterColId) {
			e.stopPropagation();
			activeFilterColId = null;
		}
		if (e.key === 'Escape' && contextMenu) {
			e.stopPropagation();
			contextMenu = null;
		}
	}}
/>

<!-- Main DataTable Container -->
<div
	class="data-table-container flex-1 flex flex-col h-full bg-[var(--bg)] overflow-hidden relative select-none"
	role="region"
	aria-label="Interactive Spreadsheet"
>
	{#if store.columns.length === 0}
		<!-- Zero Column Empty State -->
		<div
			class="empty-state-wrap flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--text-3)] gap-3"
		>
			<div
				class="empty-icon-box w-12 h-12 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)] shadow-sm"
			>
				<Icon name="table" size={24} />
			</div>
			<h3
				class="empty-title text-base font-bold text-[var(--text-1)] m-0"
			>
				Spreadsheet is empty
			</h3>
			<p
				class="empty-subtitle text-[13px] text-[var(--text-3)] max-w-sm m-0"
			>
				Start a blank sheet, import a file, or load a sample dataset.
			</p>
			<div class="empty-actions flex items-center gap-2 mt-2">
				<button
					class="btn-tactile btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] cursor-pointer shadow-sm"
					onclick={() => store.newSheet()}
				>
					<Icon name="file-spreadsheet" size={14} />
					<span>New Blank Sheet</span>
				</button>
				<button
					class="btn-tactile inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer"
					onclick={() => store.addColumn("Column 1", "text")}
				>
					<Icon name="plus" size={14} />
					<span>Add One Column</span>
				</button>
			</div>
		</div>
	{:else}
		{#if store.hasActiveFilters}
			<div class="filter-status-bar flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-primary-bg)] border-b border-[var(--accent-primary-border)] text-[12px] text-[var(--text-1)]" role="status" aria-live="polite">
				<Icon name="filter" size={13} class="text-[var(--accent-primary)]" aria-hidden="true" />
				<span>{Object.keys(store.columnFilters).length} column{Object.keys(store.columnFilters).length === 1 ? '' : 's'} filtered · {store.filteredCount} of {store.rowCount} rows shown</span>
				<button class="ml-auto px-2.5 py-1 rounded-md bg-[var(--surface-1)] border border-[var(--border)] text-[11.5px] font-semibold text-[var(--text-1)] hover:bg-[var(--surface-2)] cursor-pointer" onclick={() => store.clearAllFilters()} aria-label="Clear all column filters">Clear all filters</button>
			</div>
		{/if}
		<!-- Scrollable Grid Table -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={tableScrollEl}
			class="table-scroll-wrap flex-1 overflow-auto outline-none relative [scrollbar-gutter:stable] isolate bg-[var(--surface-1)]"
			tabindex="0"
			role="grid"
			aria-label="Spreadsheet grid"
			aria-rowcount={store.filteredRows.length}
			aria-colcount={store.columns.length}
			onscroll={onTableScroll}
			onkeydown={handleTableKeyDown}
			onpaste={handleGridPaste}
		>
			<!-- Explicit px width, not `min-w-max`: Firefox blows up `max-content` on a
			     fixed-layout table (17.9M px), while `min-width:100%` still fills a wide viewport. -->
			<table
				class="grid-table border-separate border-spacing-0 h-full text-[13.5px] table-fixed"
				style="width: {gridW}px; min-width: 100%"
			>
				<!-- Column Header Row -->
				<thead>
					<!-- Spreadsheet column letters. They are what a formula addresses a column
					     by, so they sit above the names rather than beside them, and the active
					     cell's letter lights up the way the row gutter does. Explicit height for
					     the same Firefox reason as the row below. -->
					<tr class="h-5">
						<th
							class="th-corner gutter-corner sticky top-0 z-20 w-10 min-w-10 bg-[var(--surface-2)] border-b border-[var(--border)] border-r border-[var(--border)] p-0 select-none cursor-pointer"
							scope="col"
							title="Select all (⌘A)"
							aria-label="Select all cells"
							onclick={() => store.selectAll()}
						></th>
						{#each store.columns as col, colIndex (col.id)}
							{@const isActiveCol =
								activeCell?.colIndex === colIndex}
							<th
								class="th-letter sticky top-0 z-20 border-b border-[var(--border)] border-r border-[var(--table-grid-line)] p-0 text-center select-none font-mono text-[10.5px] font-semibold tracking-wider {isActiveCol
									? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
									: 'bg-[var(--surface-2)] text-[var(--text-3)]'}"
								style="width: {col.width
									? col.width + 'px'
									: '180px'}; min-width: 70px;"
								scope="col"
							>
								{columnLetter(colIndex)}
							</th>
						{/each}
						<th
							class="th-letter-blank sticky top-0 z-20 w-20 min-w-20 bg-[var(--surface-2)] border-b border-[var(--border)] p-0"
							scope="col"
						></th>
					</tr>

					<!-- Explicit height: the filler row must be the only unconstrained one, or
					     Firefox dumps the table's leftover height into this header instead. -->
					<tr class="h-8">
						<!-- Index / Row number column -->
						<th
							class="th-index sticky top-5 z-10 w-10 min-w-10 text-center bg-[var(--surface-2)] border-b border-[var(--border-strong)] border-r border-[var(--border)] p-0 select-none"
							scope="col"
						>
							<span
								class="index-hdr-label font-mono text-[10.5px] font-bold text-[var(--text-3)] tracking-wider"
								>#</span
							>
						</th>

						<!-- Dynamic Columns -->
						{#each store.columns as col, colIndex (col.id)}
							{@const colConfig =
								COLUMN_TYPE_CONFIG[col.type || "text"]}
							{@const isSorted =
								store.sortConfig?.columnId === col.id}
							{@const sortDir = isSorted
								? store.sortConfig?.direction
								: null}

							<th
								class="th-column sticky top-5 z-10 bg-[var(--surface-1)] border-b border-[var(--border-strong)] border-r border-[var(--table-grid-line)] p-0 select-none text-[var(--text-1)] group/col"
								style="width: {col.width
									? col.width + 'px'
									: '180px'}; min-width: 70px;"
								scope="col"
								role="columnheader"
								aria-sort={sortDir === "asc"
									? "ascending"
									: sortDir === "desc"
										? "descending"
										: "none"}
							>
								<div
									class="th-content flex items-center px-2 h-8 gap-1.5"
								>
									<!-- Type glyph: unboxed, muted. It labels the column, it isn't a control. -->
									<span
										class="th-type-icon flex text-[var(--text-3)] shrink-0"
										aria-hidden="true"
									>
										<Icon
											name={colConfig?.icon || "type"}
											size={12}
										/>
									</span>

									<!-- Click sorts, double-click renames in place. -->
									{#if renamingColId === col.id}
										<input
											type="text"
											class="th-rename-input bg-[var(--surface-2)] border border-[var(--border-focus)] rounded px-1.5 py-0.5 text-[12.5px] font-semibold text-[var(--text-1)] outline-none w-full min-w-0"
											aria-label="Column name"
											bind:value={renamingColValue}
											use:autoFocus
											onblur={commitRenameColumn}
											onkeydown={(e) => {
												e.stopPropagation();
												if (e.key === "Enter")
													commitRenameColumn();
												if (e.key === "Escape")
													renamingColId = null;
											}}
										/>
									{:else}
										<button
											class="th-title-btn flex items-center justify-between flex-1 bg-transparent border-none cursor-pointer text-[var(--text-1)] font-semibold text-[12.5px] tracking-tight p-0 hover:text-[var(--accent-primary)] transition-colors min-w-0"
											onclick={() =>
												store.setSort(col.id)}
											ondblclick={(e) => {
												e.stopPropagation();
												startRenameColumn(
													col.id,
													col.name,
												);
											}}
											aria-label="Sort by {col.name} (double-click to rename)"
										>
											<span class="th-title-text truncate"
												>{col.name}</span
											>
											<!-- Only shown when it means something, or on hover. Six idle
											     chevrons per screen is noise, not affordance. -->
											<span
												class="th-sort-icon flex shrink-0 ml-1 transition-opacity {isSorted
													? 'active opacity-100 text-[var(--accent-primary)]'
													: 'opacity-0 group-hover/col:opacity-40'}"
												aria-hidden="true"
											>
												{#if sortDir === "desc"}
													<Icon
														name="chevron-down"
														size={12}
													/>
												{:else if sortDir === "asc"}
													<Icon
														name="chevron-up"
														size={12}
													/>
												{:else}
													<Icon
														name="chevrons-up-down"
														size={11}
													/>
												{/if}
											</span>
										</button>
									{/if}

									<!-- Column Filter Trigger -->
									<div class="filter-trigger-wrapper relative flex items-center">
										<button
											class="filter-trigger-btn flex items-center justify-center w-5 h-5 rounded border-none cursor-pointer transition-colors focus-visible:opacity-100 {store.isColumnFiltered(col.id)
												? 'opacity-100 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
												: 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] opacity-60 group-hover/col:opacity-100'}"
											onclick={(e) => {
												e.stopPropagation();
												const el = e.currentTarget as HTMLElement;
												filterMenuTriggerEls.set(col.id, el);
												if (activeFilterColId === col.id) activeFilterColId = null;
												else openFilter(col.id, col.type);
											}}
											aria-label="Filter column {col.name}"
											aria-haspopup="dialog"
											aria-expanded={activeFilterColId === col.id}
										>
											<Icon name="filter" size={12} aria-hidden="true" />
										</button>
										{#if activeFilterColId === col.id}
											{@const colDistinct = distinctValuesForColumn(store.resolvedRows, col.id)}
											{@const filteredDistinct = valueSearchQuery
												? colDistinct.filter((v) => v.toLowerCase().includes(valueSearchQuery.toLowerCase()))
												: colDistinct}
											{@const ops = conditionOpsForType(col.type)}
											<div
												class="filter-popover bezel-card fixed z-50 w-80 p-0 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-left animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)] flex flex-col max-h-[min(70vh,420px)] overflow-hidden"
												style={filterMenuStyle}
												role="dialog"
												tabindex="-1"
												aria-label="Filter {col.name}"
											>
												<div class="filter-popover-header flex items-center justify-between px-3 pt-3 pb-2 border-b border-[var(--border)]">
													<span class="text-[12.5px] font-bold text-[var(--text-1)] truncate">Filter {col.name}</span>
													<button class="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer" onclick={() => (activeFilterColId = null)} aria-label="Close filter"><Icon name="x" size={12} aria-hidden="true" /></button>
												</div>
												<div class="filter-tabs flex gap-1 px-2 pt-2">
													<button class="flex-1 py-1.5 text-[11.5px] font-semibold rounded-lg border cursor-pointer transition-colors {filterTab === 'values' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary-border)]' : 'bg-transparent text-[var(--text-3)] border-transparent hover:bg-[var(--surface-2)]'}" onclick={() => (filterTab = 'values')}>Values</button>
													<button class="flex-1 py-1.5 text-[11.5px] font-semibold rounded-lg border cursor-pointer transition-colors {filterTab === 'condition' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary-border)]' : 'bg-transparent text-[var(--text-3)] border-transparent hover:bg-[var(--surface-2)]'}" onclick={() => (filterTab = 'condition')}>Condition</button>
												</div>
												{#if filterTab === 'values'}
													<div class="filter-values-pane flex flex-col flex-1 min-h-0 p-3 gap-2">
														{#if colDistinct.length > 8}
															<input type="text" placeholder="Search values…" class="filter-value-search w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]" bind:value={valueSearchQuery} aria-label="Search filter values" />
														{/if}
														<div class="flex items-center gap-1.5">
															<button class="text-[11px] font-medium px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer" onclick={() => { draftValues = new Set(colDistinct); }}>Select all</button>
															<button class="text-[11px] font-medium px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer" onclick={() => { draftValues = new Set(); }}>Clear</button>
															<span class="ml-auto text-[11px] text-[var(--text-3)]">{draftValues.size}/{colDistinct.length} selected</span>
														</div>
														<div class="filter-values-list flex-1 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--surface-2)] max-h-[180px] p-1 flex flex-col gap-0.5">
															{#each filteredDistinct as v (v)}
																{@const label = v === '' ? '(Empty)' : v}
																{@const id = `filter-${col.id}-${v === '' ? '__empty__' : v}`}
																<label for={id} class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-1)] cursor-pointer text-[12px] text-[var(--text-1)]">
																	<input id={id} type="checkbox" class="w-3.5 h-3.5 rounded border-[var(--border)] accent-[var(--accent-primary)]" checked={draftValues.has(v)} onchange={(e) => { const c = e.currentTarget as HTMLInputElement; const next = new Set(draftValues); if (c.checked) next.add(v); else next.delete(v); draftValues = next; }} />
																	<span class="truncate">{label}</span>
																</label>
															{/each}
															{#if filteredDistinct.length === 0}
																<span class="text-[11px] text-[var(--text-3)] px-2 py-2">No values match.</span>
															{/if}
														</div>
														<div class="flex items-center gap-2 pt-1">
															<button class="flex-1 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] text-[12px] font-semibold cursor-pointer" onclick={() => applyValueFilter(col.id)}>Apply</button>
															<button class="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] text-[12px] font-medium hover:text-[var(--text-1)] cursor-pointer" onclick={clearFilterForActive}>Clear filter</button>
														</div>
													</div>
												{:else}
													<div class="filter-condition-pane flex flex-col gap-2 p-3">
														<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-op-{col.id}">Condition</label>
														<select id="filter-op-{col.id}" class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--border-focus)]" bind:value={draftConditionOp}>
															{#each ops as o (o.op)}
																<option value={o.op}>{o.label}</option>
															{/each}
														</select>
														{#if draftConditionOp !== 'isEmpty' && draftConditionOp !== 'isNotEmpty'}
															<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-val-{col.id}">{draftConditionOp === 'between' ? 'From' : 'Value'}</label>
															<input id="filter-val-{col.id}" type="text" placeholder={col.type === 'date' ? 'YYYY-MM-DD' : col.type === 'number' || col.type === 'currency' || col.type === 'percent' ? 'Number' : 'Text'} class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]" bind:value={draftConditionValue} />
															{#if draftConditionOp === 'between'}
																<label class="text-[11px] font-semibold text-[var(--text-2)]" for="filter-val2-{col.id}">To</label>
																<input id="filter-val2-{col.id}" type="text" placeholder={col.type === 'date' ? 'YYYY-MM-DD' : 'Number'} class="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[12px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--border-focus)]" bind:value={draftConditionValue2} />
															{/if}
														{/if}
														<div class="flex items-center gap-2 pt-2">
															<button class="flex-1 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] text-[12px] font-semibold cursor-pointer" onclick={() => applyConditionFilter(col.id)}>Apply</button>
															<button class="px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] text-[12px] font-medium hover:text-[var(--text-1)] cursor-pointer" onclick={clearFilterForActive}>Clear filter</button>
														</div>
													</div>
												{/if}
												{#if store.hasActiveFilters}
													<div class="filter-global-actions px-3 pb-3 pt-1 border-t border-[var(--border)] flex justify-between items-center">
														<span class="text-[11px] text-[var(--text-3)]">{Object.keys(store.columnFilters).length} filtered</span>
														<button class="text-[11px] font-semibold text-[var(--accent-rose)] hover:underline cursor-pointer bg-transparent border-none p-0" onclick={() => { store.clearAllFilters(); activeFilterColId = null; }}>Clear all filters</button>
													</div>
												{/if}
											</div>
										{/if}
									</div>
									<!-- Column Options Menu Trigger -->
									<div
										class="column-menu-wrapper relative flex items-center"
									>
										<button
											class="th-menu-trigger flex items-center justify-center w-5 h-5 rounded bg-transparent hover:bg-[var(--surface-2)] border-none text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer transition-opacity focus-visible:opacity-100 {activeColMenu ===
											col.id
												? 'opacity-100'
												: 'opacity-0 group-hover/col:opacity-100'}"
											onclick={(e) => {
												e.stopPropagation();
												const el =
													e.currentTarget as HTMLElement;
												colMenuTriggerEls.set(
													col.id,
													el,
												);
												activeColMenu =
													activeColMenu === col.id
														? null
														: col.id;
												if (activeColMenu)
													requestAnimationFrame(
														syncColMenuPos,
													);
											}}
											aria-label="Column options for {col.name}"
											aria-haspopup="menu"
											aria-expanded={activeColMenu ===
												col.id}
										>
											<Icon
												name="more-horizontal"
												size={13}
												aria-hidden="true"
											/>
										</button>

										{#if activeColMenu === col.id}
											<div
												class="column-popover bezel-card fixed z-50 w-48 p-1.5 bg-[var(--surface-1)]/95 backdrop-blur-xl border border-[var(--border-strong)] rounded-xl shadow-2xl origin-top-right animate-[menuPop_120ms_cubic-bezier(0.16,1,0.3,1)]"
												style={colMenuStyle}
												role="menu"
											>
												<button
													class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() => {
														activeColMenu = null;
														autoFitColumn(col.id);
													}}
												>
													<Icon
														name="chevrons-up-down"
														size={13}
														class="rotate-90"
														aria-hidden="true"
													/>
													<span>Fit to content</span>
												</button>

												<button
													class="popover-item flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() => {
														activeColMenu = null;
														store.selectColumn(
															col.id,
														);
													}}
												>
													<Icon
														name="check"
														size={13}
														aria-hidden="true"
													/>
													<span>Select column</span>
												</button>

												<div
													class="popover-divider h-px bg-[var(--border)] my-1"
												></div>
												<div
													class="popover-section-label px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-3)]"
												>
													Column type
												</div>

												{#each Object.entries(COLUMN_TYPE_CONFIG) as [typeKey, typeCfg]}
													{@const isActiveType =
														col.type === typeKey}
													<button
														class="popover-item flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors {isActiveType
															? 'active !text-[var(--accent-primary)] !bg-[var(--accent-primary-bg)] font-semibold'
															: ''}"
														role="menuitem"
														onclick={() =>
															handleUpdateColumnType(
																col.id,
																typeKey as ColumnType,
															)}
													>
														<div
															class="flex items-center gap-2"
														>
															<Icon
																name={typeCfg.icon}
																size={13}
																aria-hidden="true"
															/>
															<span
																>{typeCfg.label}</span
															>
														</div>
														{#if isActiveType}
															<span
																class="check-icon text-[var(--accent-primary)] font-bold text-[12px]"
																><Icon
																	name="check"
																	size={12}
																	aria-hidden="true"
																/></span
															>
														{/if}
													</button>
												{/each}

												<div
													class="popover-divider h-px bg-[var(--border)] my-1"
												></div>
												<button
													class="popover-item popover-delete flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--accent-rose)] hover:!text-[var(--accent-rose)] hover:!bg-[var(--accent-rose-bg)] cursor-pointer text-left transition-colors"
													role="menuitem"
													onclick={() =>
														requestDeleteColumn(
															col.id,
															col.name,
														)}
												>
													<Icon
														name="trash"
														size={13}
														aria-hidden="true"
													/>
													<span>Delete Column</span>
												</button>
											</div>
										{/if}
									</div>
								</div>

								<!-- Interactive Column Resize Handle -->
								<button
									type="button"
									class="th-resize-handle absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--accent-primary-hover)] active:bg-[var(--accent-primary)] transition-colors z-10 bg-transparent border-none"
									tabindex="-1"
									onmousedown={(e) =>
										startResize(
											e,
											col.id,
											col.width || 180,
										)}
									ondblclick={(e) => {
										e.stopPropagation();
										autoFitColumn(col.id);
									}}
									aria-label="Resize column {col.name}"
								></button>
							</th>
						{/each}

						<!-- Add New Column Header Button — pony: one-click, default Text, no modal -->
						<th
							class="th-add-col sticky top-5 z-10 w-20 min-w-20 bg-[var(--surface-1)] border-b border-[var(--border-strong)] p-0"
							scope="col"
						>
							<button
								class="add-col-btn flex items-center justify-center gap-1.5 w-full h-8 bg-transparent border-none text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] text-[12px] font-medium cursor-pointer transition-colors"
								onclick={handleAddColumn}
								aria-label="Add column"
							>
								<Icon
									name="plus"
									size={13}
									aria-hidden="true"
								/>
								<span>Add</span>
							</button>
						</th>
					</tr>
				</thead>

				<!-- Table Rows (#9 virtualized) -->
				<tbody>
					{#if store.filteredRows.length === 0}
						<tr>
							<td
								colspan={store.columns.length + 2}
								class="td-no-results text-center py-8 text-[var(--text-3)] text-[13px]"
								role="gridcell"
							>
								{#if store.hasActiveFilters && store.searchQuery}
									<span>No matching rows for "{store.searchQuery}" with active filters.</span>
								{:else if store.hasActiveFilters}
									<span>No rows match the active filters.</span>
								{:else if store.searchQuery}
									<span>No matching rows found for "{store.searchQuery}".</span>
								{:else}
									<span>No rows to display.</span>
								{/if}
							</td>
						</tr>
					{:else}
						{#if topPadH > 0}
							<tr class="virtual-spacer" aria-hidden="true"
								><td
									colspan={store.columns.length + 2}
									style="height: {topPadH}px; padding:0; border:none"
								></td></tr
							>
						{/if}
						{#each renderedRows as { row, idx: rowIndex } (row.id)}
							<tr
								class="data-row table-data-row h-9 border-b border-[var(--table-grid-line)] hover:bg-[var(--table-row-hover)] transition-colors group/row odd:bg-transparent even:bg-[var(--table-row-even)]"
								aria-rowindex={store.sheetRowFor(row.id)}
							>
								<!-- Row Index & Hover Actions -->
								<td
									class="td-index w-10 min-w-10 text-center bg-[var(--surface-2)] border-r border-[var(--border)] relative font-mono text-[10.5px] text-[var(--text-3)] select-none p-0"
									role="gridcell"
									oncontextmenu={(e) => {
										e.preventDefault();
										if (store.columns.length > 0) {
											handleCellContextMenu(
												e,
												row.id,
												store.columns[0].id,
												rowIndex,
												0,
											);
										}
									}}
								>
									<!-- Row 1 is the header, so data starts at 2 - the number a formula references. -->
									<button
										type="button"
										class="row-num block group-hover/row:hidden w-full h-full text-center bg-transparent border-none font-mono text-[10.5px] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer p-0 m-0"
										onclick={() => store.selectRow(row.id)}
										title="Select row {store.sheetRowFor(
											row.id,
										)}"
										aria-label="Select row {store.sheetRowFor(
											row.id,
										)}"
									>
										{store.sheetRowFor(row.id)}
									</button>
									<div
										class="row-actions-hover hidden group-hover/row:flex items-center justify-center gap-0.5 absolute inset-0 bg-[var(--surface-2)]"
									>
										<button
											type="button"
											class="row-action-btn w-5 h-5 rounded flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer transition-colors"
											onclick={() =>
												store.duplicateRow(row.id)}
											title="Duplicate row"
											aria-label="Duplicate row {store.sheetRowFor(
												row.id,
											)}"
										>
											<Icon
												name="copy"
												size={11}
												aria-hidden="true"
											/>
										</button>
										<button
											type="button"
											class="row-action-btn delete w-5 h-5 rounded flex items-center justify-center text-[var(--text-3)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-bg)] cursor-pointer transition-colors"
											onclick={() =>
												store.deleteRow(row.id)}
											title="Delete row"
											aria-label="Delete row {store.sheetRowFor(
												row.id,
											)}"
										>
											<Icon
												name="trash"
												size={11}
												aria-hidden="true"
											/>
										</button>
									</div>
								</td>

								<!-- Cells -->
								{#each store.columns as col, colIndex (col.id)}
									{@const colType = col.type || "text"}
									{@const isDropdown = colType === "dropdown"}
									{@const cellVal = row ? row[col.id] : null}
									{@const isEditing =
										editingCell?.rowId === row?.id &&
										editingCell?.columnId === col.id}
									{@const isMirroredEdit =
										!isEditing &&
										editingCell !== null &&
										editTargets.some(
											(t) =>
												t.rowId === row?.id &&
												t.columnId === col.id,
										)}
									{@const isActive =
										activeCell?.rowId === row?.id &&
										activeCell?.columnId === col.id}
									{@const isNumeric = isNumericType(colType)}
									{@const hasVal =
										cellVal !== null &&
										cellVal !== undefined &&
										cellVal !== ""}
									{@const dropdownStyle =
										isDropdown && hasVal
											? getDropdownStyle(String(cellVal))
											: null}

									{@const isRovingActive =
										isActive ||
										(!activeCell &&
											rowIndex === 0 &&
											colIndex === 0)}
									{@const inRange =
										!isActive &&
										isInSelection(row.id, col.id)}
									{@const isRef = highlightedRefs.has(
										`${rowIndex}::${colIndex}`,
									)}
									{@const isError = cellVal === ERROR_VALUE}
									{@const inFill = isInFill(
										rowIndex,
										colIndex,
									)}
									{@const isFindMatch =
										findStore?.matchKeys.has(
											`${row.id}::${col.id}`,
										) ?? false}
									{@const isFindMatchActive =
										findStore?.activeMatchKey ===
											`${row.id}::${col.id}`}
									{@const align = store.alignFor(
										row.id,
										col.id,
										colType,
									)}
									{@const shadow = cellShadow(
										isActive,
										isEditing,
										rowIndex,
										colIndex,
									)}
								<td
									class="td-cell grid-cell px-2.5 border-r border-[var(--table-grid-line)] relative outline-none {store.cursorMode
											? 'cursor-text'
											: 'cursor-default'} text-[13px] text-[var(--text-1)] select-none overflow-hidden {ALIGN_CLASS[
											align
										]} {isNumeric
											? 'numeric-cell font-mono tabular-nums'
											: ''} {isActive
											? 'active-cell z-[2]'
											: ''} {inRange
											? 'in-range bg-[var(--accent-primary)]/10'
											: ''} {isRef
											? 'formula-ref outline outline-1 -outline-offset-1 outline-[var(--accent-sky)] bg-[var(--accent-sky-bg)]'
											: ''} {isFindMatch
											? 'find-match outline outline-1 -outline-offset-1 outline-[var(--accent-amber)]/50 bg-[var(--accent-amber-bg)]/20'
											: ''} {isFindMatchActive
											? 'find-match-active !outline-2 -outline-offset-1 !outline-[var(--accent-amber)] ring-2 ring-[var(--accent-amber)]/30 z-[4]'
											: ''} {isError
											? 'formula-error !text-[var(--accent-rose)] bg-[var(--accent-rose-bg)]'
											: ''} {inFill
											? 'in-fill outline outline-1 -outline-offset-1 outline-dashed outline-[var(--border-focus)]'
											: ''} {isEditing
											? 'editing'
											: ''} {isMirroredEdit
											? 'mirrored-editing bg-[var(--accent-primary-bg)]/40'
											: ''} {isDropdown
											? 'status-cell dropdown-cell'
											: ''} {isDropdown && hasVal
											? 'dropdown-filled-cell'
											: ''}"
										style="width: {col.width
											? col.width + 'px'
											: '180px'}; min-width: 70px; {shadow
											? `box-shadow: ${shadow};`
											: ''} {isDropdown && hasVal
											? `background: ${inRange ? `${RANGE_TINT}, ` : ''}${dropdownStyle!.bg};`
											: ''}"
										role="gridcell"
										aria-selected={isActive || inRange}
										tabindex={isRovingActive ? 0 : -1}
									use:registerCellNode={`${row.id}-${col.id}`}
									oncontextmenu={(e) => {
										e.preventDefault();
										handleCellContextMenu(
											e,
											row.id,
											col.id,
											rowIndex,
											colIndex,
										);
									}}
									onmousedown={(e) => {
											// Measured here, not on click: by then the editor may already have
											// replaced the text node the pointer was over.
											initialCaretOffset =
												store.cursorMode &&
												colType === "text"
													? caretOffsetAt(e)
													: null;
											// preventDefault keeps focus in the editor - without it the
											// input blurs and commitEdit fires before the click lands.
											if (
												pointAtCell(
													colIndex,
													row.id,
													e.shiftKey
														? pointAnchor
														: null,
												)
											) {
												e.preventDefault();
												if (!e.shiftKey)
													pointAnchor = `${columnLetter(colIndex)}${store.sheetRowFor(row.id)}`;
												return;
											}
											pointerExtend = e.shiftKey;
										}}
										onmouseenter={(e) => {
											if (fillFrom && e.buttons === 1) {
												fillTo = { rowIndex, colIndex };
												return;
											}
											// Held button plus an open editor means the drag is drawing a
											// range; `buttons` is the only way to know mid-move.
											if (e.buttons === 1 && pointAnchor)
												pointAtCell(
													colIndex,
													row.id,
													pointAnchor,
												);
										}}
										onfocus={() => {
											if (editingCell) return;
											if (!isActive) {
												selectCell(
													row.id,
													col.id,
													rowIndex,
													colIndex,
													pointerExtend,
												);
											}
										}}
										onclick={(e) => {
											if (pointAnchor) return;
											// Cursor mode: one click puts the caret in the text, like a document.
											if (
												store.cursorMode &&
												!e.shiftKey
											) {
												selectCell(
													row.id,
													col.id,
													rowIndex,
													colIndex,
													false,
												);
												startEditing(
													row.id,
													col.id,
													store.rawCell(
														row.id,
														col.id,
													),
												);
												pointerExtend = false;
												return;
											}
											// A double-click fires this first, so re-selecting the cell the range
											// already focuses would collapse that range before startEditing reads
											// it - the mouse path to a bulk replace. Matches the caret button and
											// the focus handler, both of which already no-op on the active cell.
											if (!isActive) {
												selectCell(
													row.id,
													col.id,
													rowIndex,
													colIndex,
													e.shiftKey,
												);
											}
											pointerExtend = false;
											// Same rule on touch: a shift-click selects, it does not open an editor.
											if (
												!e.shiftKey &&
												isDropdown &&
												typeof window !== "undefined" &&
												window.matchMedia(
													"(pointer: coarse)",
												).matches
											) {
												startEditing(
													row.id,
													col.id,
													cellVal,
												);
											}
										}}
										ondblclick={() =>
											startEditing(
												row.id,
												col.id,
												store.rawCell(row.id, col.id),
											)}
									>
										{#if isDropdown}
											<div
												class="status-cell-wrap flex items-center justify-between w-full h-full gap-1"
											>
												{#if isMirroredEdit}
													<span
														class="status-cell-text status-val font-medium text-[12.5px] truncate text-[var(--accent-primary)]"
													>
														<span class="truncate"
															>{editValue}</span
														>
													</span>
												{:else if hasVal && dropdownStyle}
													<span
														class="status-cell-text status-val font-medium text-[12.5px] truncate"
														style="color: {dropdownStyle.text};"
													>
														<span class="truncate"
															>{cellVal}</span
														>
													</span>
												{:else}
													<span
														class="status-cell-text"
														aria-hidden="true"
													></span>
												{/if}
												{#if isEditing}
													<span
														class="dropdown-cell-arrow text-[10px] shrink-0"
														style="color: {hasVal &&
														dropdownStyle
															? dropdownStyle.text
															: 'var(--text-3)'}; opacity: 0.6;"
														aria-hidden="true"
														>▾</span
													>
												{:else}
													<button
														type="button"
														class="dropdown-cell-arrow text-[10px] cursor-pointer px-1 bg-transparent border-none shrink-0 opacity-0 group-hover/row:opacity-60 hover:!opacity-100 focus-visible:opacity-100 transition-opacity"
														style="color: {hasVal &&
														dropdownStyle
															? dropdownStyle.text
															: 'var(--text-3)'};"
														aria-label="Open dropdown options"
														onclick={(e) => {
															e.stopPropagation();
															// A shift-click is a selection gesture wherever it lands. This
															// caret covers the right edge of every dropdown cell, so
															// treating one as "open the editor" collapsed the range any
															// time a shift-click strayed a few pixels - the reason
															// selecting across dropdown columns worked only sometimes.
															if (e.shiftKey) {
																selectCell(
																	row.id,
																	col.id,
																	rowIndex,
																	colIndex,
																	true,
																);
																return;
															}
															if (!isActive)
																selectCell(
																	row.id,
																	col.id,
																	rowIndex,
																	colIndex,
																);
															startEditing(
																row.id,
																col.id,
																store.rawCell(
																	row.id,
																	col.id,
																),
															);
														}}>▾</button
													>
												{/if}
											</div>
											{#if isEditing}
												{@const cellKey = `${row.id}-${col.id}`}
												{@const editorState =
													dropdownEditorState(col.id)}
												<DropdownCellEditor
													value={editorState.value}
													mixed={editorState.mixed}
													initialSearch={dropdownSearchSeed}
													options={getCellDropdownOptions(
														col,
														row.id,
													)}
													emptyMessage={editTargets.length >
													1
														? "No options are valid for all selected cells."
														: "No matching options."}
													allowCustom={col.dropdown
														?.allowCustom ?? true}
													triggerEl={cellNodes.get(
														cellKey,
													)}
													onCommit={(newVal) => {
														editValue = newVal;
														commitEdit();
													}}
													onCancel={cancelEdit}
												/>
											{/if}
										{:else if isEditing}
											{#if colType === "date"}
												<input
													type="text"
													class="cell-input cell-input-editor w-full h-full bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] font-inherit p-0 placeholder:text-[var(--text-3)]"
													aria-label="Edit Date Value"
													placeholder="e.g. 2025-03-01 or 03/15/2025"
													bind:value={editValue}
													bind:this={editorInput}
													onclick={(e) => {
														e.stopPropagation();
														syncCaret();
													}}
													oninput={syncCaret}
													onselect={syncCaret}
													use:autoFocus
													onblur={commitEdit}
													onkeydown={(e) =>
														handleEditorKeyDown(
															e,
															rowIndex,
															colIndex,
														)}
												/>
											{:else}
												<input
													type="text"
													class="cell-input cell-input-editor w-full h-full bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] font-inherit p-0 {editValue[0] ===
													'='
														? 'text-left'
														: ALIGN_CLASS[
																align
															]} {isNumeric ||
													editValue[0] === '='
														? 'numeric-input font-mono tabular-nums'
														: ''}"
													aria-label="Edit Cell Value"
													bind:value={editValue}
													bind:this={editorInput}
													onclick={(e) => {
														e.stopPropagation();
														syncCaret();
													}}
													oninput={syncCaret}
													onselect={syncCaret}
													use:autoFocus
													onblur={commitEdit}
													onkeydown={(e) =>
														handleEditorKeyDown(
															e,
															rowIndex,
															colIndex,
														)}
												/>
											{/if}
										{:else if isMirroredEdit}
											<!-- What this cell will hold once the edit commits. -->
											<span
												class="cell-text-display block w-full truncate text-[var(--accent-primary)] font-medium"
											>
												{editValue}
											</span>
										{:else}
											<span
												class="cell-text-display block w-full truncate"
											>
												{formatCellValue(
													colType,
													cellVal,
												)}
											</span>
										{/if}

										{#if isActive && !isEditing}
											<!-- Excel's fill handle: drag it to copy this cell along a row or
											     column, stepping every relative reference as it goes. -->
											<span
												class="active-cell-handle absolute right-[-3px] bottom-[-3px] w-2 h-2 bg-[var(--border-focus)] cursor-crosshair"
												role="button"
												tabindex="-1"
												aria-label="Fill from this cell"
												onmousedown={(e) => {
													e.preventDefault();
													e.stopPropagation();
													fillFrom = {
														rowIndex,
														colIndex,
													};
													fillTo = {
														rowIndex,
														colIndex,
													};
												}}
											></span>
										{/if}
									</td>
								{/each}

								<!-- Trailing blank cell -->
								<td
									class="td-blank bg-transparent"
									role="gridcell"
								></td>
							</tr>
						{/each}
						{#if bottomPadH > 0}
							<tr class="virtual-spacer" aria-hidden="true"
								><td
									colspan={store.columns.length + 2}
									style="height: {bottomPadH}px; padding:0; border:none"
								></td></tr
							>
						{/if}
					{/if}
					<!-- Absorbs leftover height so the summary row sits on the floor, not mid-page. -->
					<tr class="grid-filler" aria-hidden="true">
						<td
							colspan={store.columns.length + 2}
							style="padding:0; border:none"
						></td>
					</tr>
				</tbody>

				<!-- Sticky Footer Summary — pony: slightly grey, visually separate -->
				<tfoot>
					<tr
						class="summary-row tfoot-summary-row sticky bottom-0 z-10 bg-[var(--surface-3)] border-t border-[var(--border-strong)] h-11 shadow-[0_-2px_8px_rgba(0,0,0,0.12)]"
					>
						<td
							class="tf-index w-10 min-w-10 text-center border-r border-[var(--border)] font-mono text-[9.5px] font-bold text-[var(--text-3)] uppercase tracking-wider p-0 align-middle"
							role="gridcell"
						>
							<span
								class="tf-label flex items-center justify-center h-full"
								>Σ</span
							>
						</td>

						{#each store.columns as col (col.id)}
							{@const colType = col.type || "text"}
							{@const summary = store.columnSummaries
								? store.columnSummaries[col.id]
								: undefined}
							{@const isNumericSummable =
								colType === "number" || colType === "currency"}
							{@const isPercent = colType === "percent"}

							<td
								class="tf-cell px-2.5 border-r border-[var(--table-grid-line)] text-[12px] align-middle {isNumericSummable ||
								isPercent
									? 'numeric-cell text-right font-mono tabular-nums'
									: ''}"
								style="width: {col.width
									? col.width + 'px'
									: '180px'}; min-width: 70px;"
								role="gridcell"
							>
								<div
									class="summary-metric-group flex flex-col justify-center leading-tight"
								>
									{#if isNumericSummable && summary?.sum !== undefined}
										<div
											class="summary-line primary-sum flex items-center gap-1.5"
											title="Sum: {formatCellValue(
												colType,
												summary.sum,
											)} | Avg: {formatCellValue(
												colType,
												summary.avg,
											)} | Min: {formatCellValue(
												colType,
												summary.min,
											)} | Max: {formatCellValue(
												colType,
												summary.max,
											)}"
										>
											<span
												class="sum-tag text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
												>SUM</span
											>
											<span
												class="sum-val font-mono font-bold text-[var(--text-1)] text-[12px]"
												>{formatCellValue(
													colType,
													summary.sum,
												)}</span
											>
										</div>
										<div
											class="summary-line secondary-stats text-[10.5px] text-[var(--text-3)] font-mono mt-0.5"
										>
											<span
												>avg {formatCellValue(
													colType,
													summary.avg,
												)}</span
											>
										</div>
									{:else if isPercent && summary?.avg !== undefined}
										<div
											class="summary-line primary-sum flex items-center gap-1.5"
											title="Avg: {formatCellValue(
												colType,
												summary.avg,
											)} | Min: {formatCellValue(
												colType,
												summary.min,
											)} | Max: {formatCellValue(
												colType,
												summary.max,
											)} | {summary
												? summary.countNonEmpty
												: 0} rows"
										>
											<span
												class="sum-tag tag-avg text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--accent-sky-bg)] text-[var(--accent-sky)]"
												>AVG</span
											>
											<span
												class="sum-val font-mono font-bold text-[var(--text-1)] text-[12px]"
												>{formatCellValue(
													colType,
													summary.avg,
												)}</span
											>
										</div>
										<div
											class="summary-line secondary-stats text-[10.5px] text-[var(--text-3)] font-mono mt-0.5"
										>
											<span
												>min {formatCellValue(
													colType,
													summary.min,
												)} · max {formatCellValue(
													colType,
													summary.max,
												)}</span
											>
										</div>
									{:else}
										<div
											class="summary-line count-stat flex items-center gap-1.5"
										>
											<span
												class="count-tag text-[9.5px] font-mono font-bold px-1 rounded bg-[var(--surface-3)] text-[var(--text-3)]"
												>COUNT</span
											>
											<span
												class="count-val font-mono font-bold text-[var(--text-1)] text-[12px]"
												>{summary
													? summary.countNonEmpty
													: 0}</span
											>
										</div>
									{/if}
								</div>
							</td>
						{/each}

						<td class="tf-blank bg-transparent" role="gridcell"
						></td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
</div>

{#if contextMenu !== null}
	<div
		class="context-menu fixed z-50 w-52 p-1.5 bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl shadow-2xl"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
		role="menu"
		aria-label="Cell actions"
	>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={handleMenuCopy}
		>
			<Icon name="copy" size={13} aria-hidden="true" />
			<span class="flex-1">Copy</span>
			<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘C</kbd>
		</button>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={handleMenuCut}
		>
			<Icon name="edit" size={13} aria-hidden="true" />
			<span class="flex-1">Cut</span>
			<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘X</kbd>
		</button>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={handleMenuPaste}
		>
			<Icon name="file-text" size={13} aria-hidden="true" />
			<span class="flex-1">Paste</span>
			<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">⌘V</kbd>
		</button>
		<div class="h-px bg-[var(--border)] my-1"></div>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={() => {
				if (!contextMenu) return;
				store.insertRow(contextMenu.rowIndex);
				contextMenu = null;
			}}
		>
			<Icon name="plus" size={13} aria-hidden="true" />
			<span>Insert Row Above</span>
		</button>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={() => {
				if (!contextMenu) return;
				store.insertRow(contextMenu.rowIndex + 1);
				contextMenu = null;
			}}
		>
			<Icon name="plus" size={13} aria-hidden="true" />
			<span>Insert Row Below</span>
		</button>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--accent-rose)] hover:!bg-[var(--accent-rose-bg)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={() => {
				if (!contextMenu) return;
				store.deleteRows(selectedRowIdsForMenu(contextMenu.rowId));
				contextMenu = null;
			}}
		>
			<Icon name="trash" size={13} aria-hidden="true" />
			<span>Delete Row(s)</span>
		</button>
		<button
			class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg bg-transparent border-none text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer text-left transition-colors"
			role="menuitem"
			onclick={handleMenuClear}
		>
			<Icon name="x" size={13} aria-hidden="true" />
			<span class="flex-1">Clear Contents</span>
			<kbd class="text-[10.5px] text-[var(--text-3)] font-mono">Del</kbd>
		</button>
		<div class="h-px bg-[var(--border)] my-1"></div>
		<div class="flex items-center gap-1 px-2.5 py-1" role="group" aria-label="Cell alignment">
			<button
				class="flex-1 flex items-center justify-center p-1.5 rounded-md bg-transparent border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
				aria-label="Align left"
				onclick={() => {
					store.alignSelection("left");
					contextMenu = null;
				}}
			>
				<Icon name="align-left" size={13} aria-hidden="true" />
			</button>
			<button
				class="flex-1 flex items-center justify-center p-1.5 rounded-md bg-transparent border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
				aria-label="Align center"
				onclick={() => {
					store.alignSelection("center");
					contextMenu = null;
				}}
			>
				<Icon name="align-center" size={13} aria-hidden="true" />
			</button>
			<button
				class="flex-1 flex items-center justify-center p-1.5 rounded-md bg-transparent border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
				aria-label="Align right"
				onclick={() => {
					store.alignSelection("right");
					contextMenu = null;
				}}
			>
				<Icon name="align-right" size={13} aria-hidden="true" />
			</button>
		</div>
	</div>
{/if}

<FormulaHintPopup
	matches={hintMatches}
	highlight={hintIndex}
	anchor={hintAnchor}
	onpick={pickHint}
/>
