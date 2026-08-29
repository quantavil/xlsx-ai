import type {
	Column,
	Row,
	CellValue,
	TableData,
	SortConfig,
	ColumnSummary,
	ColumnType,
	HistoryEntry,
	CellAlign,
	CellAlignMap
} from '$lib/types';
import {
	MAX_HISTORY,
	LS_KEY,
	LS_API_KEY,
	RETIRED_AI_MODELS,
	LS_API_KEYS,
	LS_FAV_MODELS,
	LS_AI_MODEL,
	DEFAULT_AI_MODEL,
	DEFAULT_TABLE_TITLE,
	COLUMN_TYPE_CONFIG
} from '$lib/constants';
import { normalizeCellValue, numericCellValue, defaultAlignForType, isFormula, isNumericType } from './cells';
import {
	aggregatesOwnColumn,
	insertedAt,
	offsetFormulaRefs,
	remapRowFormulas,
	removedAt,
	resolveFormulaRows,
	sheetRowNumber,
	unchanged
} from './formulas';
import {
	parseAndMigrateTableDocument,
	sanitizeAndNormalizeTableData,
	type HydrationResult
} from './schema';
import { dedupeAndNormalizePatches, convertColumnTypeAtomic, type CellPatch } from './commands';
import { createLocalStorageAdapter, type SaveStatus } from './persistence';


export interface TableStoreOptions {
	persist?: boolean;
	/** Pass a getter when the destination changes at runtime (one key per open file). */
	storageKey?: string | (() => string);
	/** Called when a save fails (quota exceeded, storage unavailable) so the UI can warn. */
	onSaveError?: (message: string) => void;
}

function cloneColumns(cols: Column[]): Column[] {
	return cols.map((c) => (c.dropdown ? { ...c, dropdown: structuredClone($state.snapshot(c.dropdown)) } : { ...c }));
}

function cloneRows(rows: Row[]): Row[] {
	return rows.map((r) => ({ ...r }));
}

function cloneCellAlign(align: CellAlignMap): CellAlignMap {
	return { ...align };
}

export interface CellRef {
	rowId: string;
	columnId: string;
	rowIndex: number;
	colIndex: number;
}

export interface SelectionRect {
	r0: number;
	r1: number;
	c0: number;
	c1: number;
}

export function createTableStore(initialData?: TableData, options: TableStoreOptions = {}) {
	const persist = options.persist ?? true;
	const storageKey = options.storageKey ?? LS_KEY;

	const sanitizedInitial = initialData
		? sanitizeAndNormalizeTableData(
				initialData.title || DEFAULT_TABLE_TITLE,
				initialData.columns || [],
				initialData.rows || []
			)
		: { title: DEFAULT_TABLE_TITLE, columns: [], rows: [] };

	let title = $state<string>(sanitizedInitial.title);
	let columns = $state<Column[]>(cloneColumns(sanitizedInitial.columns));
	let rows = $state<Row[]>(cloneRows(sanitizedInitial.rows));
	let searchQuery = $state<string>('');
	let sortConfig = $state<SortConfig | null>(null);
	let cellAlign = $state<CellAlignMap>(cloneCellAlign(initialData?.cellAlign ?? {}));
	// Anchor is where the selection started, focus is the cell the keyboard drives.
	// Equal anchor and focus means a single-cell selection, exactly like Excel.
	let selectionAnchor = $state<CellRef | null>(null);
	let selectionFocus = $state<CellRef | null>(null);
	let isAiOpen = $state<boolean>(false);
	// Several keys, one active. Free Gemini keys hit their daily quota mid-job, and the
	// fix at that moment is to switch, not to re-paste a key from a password manager.
	let apiKeys = $state<string[]>([]);
	let activeKeyIndex = $state<number>(0);
	const apiKey = $derived(apiKeys[activeKeyIndex] ?? '');
	let aiModel = $state<string>(DEFAULT_AI_MODEL);
	let favoriteModels = $state<string[]>([]);
	let history = $state<HistoryEntry[]>([]);
	let future = $state<HistoryEntry[]>([]);
	let hydrated = $state<boolean>(false);

	let saveStatus = $state<SaveStatus>('idle');

	const storageAdapter = createLocalStorageAdapter(storageKey, {
		debounceMs: 300,
		onStatusChange: (status, error) => {
			saveStatus = status;
			if (status === 'error') options.onSaveError?.(error ?? 'Could not save this file.');
		}
	});

	function triggerSave() {
		if (!persist) return;
		storageAdapter.scheduleSave({
			title,
			columns: cloneColumns(columns),
			rows: cloneRows(rows),
			cellAlign: cloneCellAlign(cellAlign)
		});
	}

	function flushSave() {
		if (!persist) return;
		storageAdapter.flush();
	}

	function pushHistory() {
		const snapshot: HistoryEntry = {
			title,
			columns: cloneColumns(columns),
			rows: cloneRows(rows),
			cellAlign: cloneCellAlign(cellAlign)
		};

		const nextHistory = [...history, snapshot];
		if (nextHistory.length > MAX_HISTORY) {
			nextHistory.shift();
		}
		history = nextHistory;
		future = [];
	}

	/**
	 * `rows` with formula cells swapped for their computed values.
	 *
	 * Everything downstream - the grid, search, sort, summaries, export - reads this,
	 * so a formula behaves like the number it produces. Editing still reads `rows`
	 * through `rawCell()`, which is what puts `=SUM(A1:B1)` back in the editor.
	 * Identical to `rows` when the table holds no formulas.
	 */
	const resolvedRows = $derived(resolveFormulaRows(columns || [], rows || []));

	/**
	 * Row id to the spreadsheet row number a formula addresses it by.
	 *
	 * Storage order, never the rendered position: sorting and search are views here,
	 * so a gutter counting rendered rows would label a row `4` while `A4` in a formula
	 * still meant a different one. Numbers skip over filtered-out rows, which is what
	 * Excel's own filtered view does.
	 */
	const sheetRowById = $derived(new Map((rows || []).map((r, i) => [r.id, sheetRowNumber(i)])));

	// Derived: Filtered & Sorted Rows
	const filteredRows = $derived.by(() => {
		let result = resolvedRows;

		// 1. Search Query Filter across all cell values
		const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
		if (query) {
			result = result.filter((row) => {
				if (!row) return false;
				return (columns || []).some((col) => {
					if (!col || !col.id) return false;
					const val = row[col.id];
					if (val === null || val === undefined) return false;
					return String(val).toLowerCase().includes(query);
				});
			});
		}

		// 2. Sort Config
		if (sortConfig) {
			const { columnId, direction } = sortConfig;
			const col = (columns || []).find((c) => c && c.id === columnId);
			if (!col) return result;

			const colType = col.type || 'text';
			const isNumeric = isNumericType(colType);
			const isDate = colType === 'date';

			result = [...result].sort((a, b) => {
				const valA = a ? a[columnId] : null;
				const valB = b ? b[columnId] : null;

				const aEmpty = valA === null || valA === undefined || valA === '';
				const bEmpty = valB === null || valB === undefined || valB === '';

				if (aEmpty && bEmpty) return 0;
				if (aEmpty) return 1;
				if (bEmpty) return -1;

				let comparison = 0;
				if (isNumeric) {
					const numA = numericCellValue(colType, valA);
					const numB = numericCellValue(colType, valB);
					if (numA === null && numB === null) comparison = 0;
					else if (numA === null) comparison = 1;
					else if (numB === null) comparison = -1;
					else comparison = numA - numB;
				} else if (isDate) {
					// #16 Parse to epoch; supports MM/DD/YYYY, DD-MM-YYYY, ISO — fallback to string compare
					const tA = Date.parse(String(valA));
					const tB = Date.parse(String(valB));
					if (!isNaN(tA) && !isNaN(tB)) comparison = tA - tB;
					else if (!isNaN(tA)) comparison = -1;
					else if (!isNaN(tB)) comparison = 1;
					else comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
				} else {
					comparison = String(valA).localeCompare(String(valB), undefined, {
						numeric: true,
						sensitivity: 'base'
					});
				}

				return direction === 'asc' ? comparison : -comparison;
			});
		}

		return result;
	});

	// Derived: Column Math Summaries
	const columnSummaries = $derived.by(() => {
		const summaries: Record<string, ColumnSummary> = {};

		for (const [colIndex, col] of (columns || []).entries()) {
			if (!col || !col.id) continue;
			const colType = col.type || 'text';
			const colConfig = COLUMN_TYPE_CONFIG[colType] || COLUMN_TYPE_CONFIG.text;
			const isSummable = colConfig.summarizable;

			let totalCount = 0;
			let nonEmptyCount = 0;
			/** How many values actually went into `sum` - the divisor `avg` needs. */
			let summedCount = 0;
			let sum = 0;
			let min: number | undefined = undefined;
			let max: number | undefined = undefined;

			for (const [rowIndex, row] of resolvedRows.entries()) {
				if (!row) continue;
				totalCount++;
				const val = row[col.id];
				if (val !== null && val !== undefined && val !== '') {
					nonEmptyCount++;
					// A totals row written as `=SUM(D2:D4)` is this column's own values
					// already added up - counting it again reports double the truth.
					const raw = rows[rowIndex]?.[col.id];
					const isOwnTotal =
						isFormula(raw) &&
						aggregatesOwnColumn(raw, colIndex, (columns || []).length, rows.length);
					if (isSummable && !isOwnTotal) {
						const num = numericCellValue(colType, val);
						if (num !== null) {
							sum += num;
							summedCount++;
							if (min === undefined || num < min) min = num;
							if (max === undefined || num > max) max = num;
						}
					}
				}
			}

			const summary: ColumnSummary = {
				count: totalCount,
				countNonEmpty: nonEmptyCount
			};

			if (isSummable && summedCount > 0) {
				summary.sum = sum;
				// Divides by what was summed, not by what was non-empty: an excluded
				// totals row, or text sitting in a numeric column, is not an addend.
				summary.avg = sum / summedCount;
				summary.min = min;
				summary.max = max;
			}

			summaries[col.id] = summary;
		}

		return summaries;
	});

	const rowCount = $derived(rows.length);
	const filteredCount = $derived(filteredRows.length);
	const canUndo = $derived(history.length > 0);
	const canRedo = $derived(future.length > 0);

	function setTitle(newTitle: string) {
		const clean = newTitle.trim();
		if (clean === title) return;
		pushHistory();
		title = clean || DEFAULT_TABLE_TITLE;
		triggerSave();
	}

	function setCell(rowId: string, columnId: string, value: CellValue) {
		const targetRow = rows.find((r) => r.id === rowId);
		const targetCol = columns.find((c) => c.id === columnId);
		if (!targetRow || !targetCol) return;

		const normalized = normalizeCellValue(targetCol.type, value);
		const current = targetRow[columnId] ?? null;
		if (Object.is(current, normalized)) return;

		pushHistory();
		targetRow[columnId] = normalized;
		rows = [...rows];
		triggerSave();
	}

	function applyCellPatches(patches: CellPatch[]): number {
		const validPatches = dedupeAndNormalizePatches(patches, rows, columns);
		if (validPatches.length === 0) return 0;

		pushHistory();
		for (const patch of validPatches) {
			patch.row[patch.columnId] = patch.newValue;
		}
		rows = [...rows];
		triggerSave();
		return validPatches.length;
	}

	function addRow(initialValues?: Partial<Row>) {
		pushHistory();
		const newId = `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
		const newRow: Row = { id: newId };
		for (const col of columns) {
			const provided = initialValues ? initialValues[col.id] : null;
			newRow[col.id] = normalizeCellValue(col.type, provided as CellValue);
		}
		rows = [...rows, newRow];
		triggerSave();
		return newId;
	}

	function duplicateRow(rowId: string) {
		const index = rows.findIndex((r) => r.id === rowId);
		if (index === -1) return;
		pushHistory();
		const original = rows[index];
		const newId = `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
		const clone: Row = { ...original, id: newId };
		const nextCount = rows.length + 1;

		// Everything from the insertion point down moves one row, so every formula that
		// pointed there has to follow it — otherwise the row below keeps summing the
		// range it used to occupy.
		const shifted = remapRowFormulas(
			rows,
			columns,
			insertedAt(index + 1),
			unchanged,
			columns.length,
			nextCount
		);
		// The clone is a copy placed one row lower, so its own references step with it.
		for (const col of columns) {
			const raw = clone[col.id];
			if (isFormula(raw)) {
				clone[col.id] = `=${offsetFormulaRefs(raw.slice(1), 1, 0, columns.length, nextCount)}`;
			}
		}
		rows = [...shifted.slice(0, index + 1), clone, ...shifted.slice(index + 1)];
		triggerSave();
	}

	function deleteRow(rowId: string) {
		const index = rows.findIndex((r) => r.id === rowId);
		if (index === -1) return;
		pushHistory();
		// A reference to the deleted row has nothing left to name and becomes #REF!;
		// references below it close up. Leaving them alone would silently change which
		// cells a formula reads, which is the one failure a spreadsheet must not have.
		rows = remapRowFormulas(
			rows.filter((r) => r.id !== rowId),
			columns,
			removedAt(index),
			unchanged,
			columns.length,
			rows.length - 1
		);
		triggerSave();
	}

	function addColumn(name: string, type: ColumnType = 'text', width = 160) {
		const cleanName = name.trim();
		if (!cleanName) return;
		pushHistory();
		const newId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
		const newCol: Column = {
			id: newId,
			name: cleanName,
			type,
			width: Math.max(60, Math.min(800, width))
		};
		columns = [...columns, newCol];
		for (const row of rows) {
			row[newId] = null;
		}
		rows = [...rows];
		triggerSave();
	}

	function renameColumn(columnId: string, newName: string) {
		const col = columns.find((c) => c.id === columnId);
		const cleanName = newName.trim();
		if (!col || !cleanName || col.name === cleanName) return;

		pushHistory();
		col.name = cleanName;
		columns = [...columns];
		triggerSave();
	}

	function updateColumnType(columnId: string, newType: ColumnType): { changedCount: number; invalidCount: number } {
		const col = columns.find((c) => c.id === columnId);
		if (!col || col.type === newType) return { changedCount: 0, invalidCount: 0 };

		pushHistory();
		col.type = newType;
		columns = [...columns];

		const { updatedRows, changedCount, invalidCount } = convertColumnTypeAtomic(rows, columnId, newType);
		rows = updatedRows;
		triggerSave();
		return { changedCount, invalidCount };
	}

	function deleteColumn(columnId: string) {
		const colIndex = columns.findIndex((c) => c.id === columnId);
		if (colIndex === -1) return;

		pushHistory();
		columns = columns.filter((c) => c.id !== columnId);
		for (const row of rows) {
			delete row[columnId];
		}
		rows = remapRowFormulas(rows, columns, unchanged, removedAt(colIndex), columns.length, rows.length);
		if (sortConfig?.columnId === columnId) {
			sortConfig = null;
		}
		triggerSave();
	}

	function updateColumnWidth(columnId: string, width: number) {
		const col = columns.find((c) => c.id === columnId);
		if (!col) return;
		col.width = Math.max(60, Math.min(800, Math.round(width)));
		columns = [...columns];
		triggerSave();
	}

	function setSort(columnId: string) {
		if (!sortConfig || sortConfig.columnId !== columnId) {
			sortConfig = { columnId, direction: 'asc' };
		} else if (sortConfig.direction === 'asc') {
			sortConfig = { columnId, direction: 'desc' };
		} else {
			sortConfig = null;
		}
	}

	function setSearchQuery(query: string) {
		searchQuery = query;
	}

	/**
	 * Moves the selection. `extend` keeps the existing anchor (shift-click, shift-arrow),
	 * so a range is just the rectangle between anchor and focus.
	 */
	function setSelection(cell: CellRef | null, extend = false) {
		selectionFocus = cell;
		if (!extend || !selectionAnchor || !cell) selectionAnchor = cell;
	}

	const selectionRect = $derived.by<SelectionRect | null>(() => {
		if (!selectionFocus) return null;
		const a = selectionAnchor ?? selectionFocus;
		return {
			r0: Math.min(a.rowIndex, selectionFocus.rowIndex),
			r1: Math.max(a.rowIndex, selectionFocus.rowIndex),
			c0: Math.min(a.colIndex, selectionFocus.colIndex),
			c1: Math.max(a.colIndex, selectionFocus.colIndex)
		};
	});

	/** Resolved alignment for one cell: explicit override, else the column type's default. */
	function alignFor(rowId: string, columnId: string, type: ColumnType): CellAlign {
		return cellAlign[`${rowId}::${columnId}`] ?? defaultAlignForType(type);
	}

	/** Applies (or with `null`, clears) alignment across every cell in the current selection. */
	function alignSelection(align: CellAlign | null) {
		const rect = selectionRect;
		if (!rect) return;
		const next: CellAlignMap = { ...cellAlign };
		let changed = false;
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = filteredRows[r];
			if (!row) continue;
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = columns[c];
				if (!col) continue;
				const key = `${row.id}::${col.id}`;
				if (align) {
					if (next[key] === align) continue;
					next[key] = align;
				} else {
					if (!(key in next)) continue;
					delete next[key];
				}
				changed = true;
			}
		}
		if (!changed) return;
		pushHistory();
		cellAlign = next;
		triggerSave();
	}

	function toggleAi(open?: boolean) {
		isAiOpen = open !== undefined ? open : !isAiOpen;
	}

	/**
	 * Replace the whole document. Undoable by default — importing a file or starting a new
	 * sheet must not silently destroy unsaved work.
	 */
	function loadTable(data: TableData, options: { undoable?: boolean } = {}) {
		const undoable = options.undoable ?? true;
		if (undoable && columns.length > 0) {
			pushHistory();
		} else {
			history = [];
			future = [];
		}

		const sanitized = sanitizeAndNormalizeTableData(
			data.title || DEFAULT_TABLE_TITLE,
			data.columns || [],
			data.rows || []
		);
		title = sanitized.title;
		columns = cloneColumns(sanitized.columns);
		rows = cloneRows(sanitized.rows);
		cellAlign = cloneCellAlign(sanitized.cellAlign ?? {});
		searchQuery = '';
		sortConfig = null;
		setSelection(null);
		triggerSave();
	}

	const NEW_SHEET_COLUMNS = 5;
	const NEW_SHEET_ROWS = 20;

	/** Blank spreadsheet: lettered columns and empty rows, ready to type into. */
	function newSheet(options: { undoable?: boolean } = {}) {
		const blankColumns: Column[] = Array.from({ length: NEW_SHEET_COLUMNS }, (_, i) => ({
			id: `c${i + 1}`,
			name: String.fromCharCode(65 + i),
			type: 'text' as ColumnType,
			width: 160
		}));
		const blankRows: Row[] = Array.from({ length: NEW_SHEET_ROWS }, (_, r) => {
			const row: Row = { id: `r${r + 1}` };
			for (const col of blankColumns) row[col.id] = null;
			return row;
		});
		loadTable({ title: DEFAULT_TABLE_TITLE, columns: blankColumns, rows: blankRows }, options);
	}

	function undo() {
		if (history.length === 0) return;
		const previous = history[history.length - 1];
		history = history.slice(0, -1);

		future = [
			{
				title,
				columns: cloneColumns(columns),
				rows: cloneRows(rows),
				cellAlign: cloneCellAlign(cellAlign)
			},
			...future
		];

		title = previous.title;
		columns = cloneColumns(previous.columns);
		rows = cloneRows(previous.rows);
		cellAlign = cloneCellAlign(previous.cellAlign ?? {});
		triggerSave();
	}

	function redo() {
		if (future.length === 0) return;
		const next = future[0];
		future = future.slice(1);

		const nextHistory = [
			...history,
			{
				title,
				columns: cloneColumns(columns),
				rows: cloneRows(rows),
				cellAlign: cloneCellAlign(cellAlign)
			}
		];
		if (nextHistory.length > MAX_HISTORY) {
			nextHistory.shift();
		}
		history = nextHistory;

		title = next.title;
		columns = cloneColumns(next.columns);
		rows = cloneRows(next.rows);
		cellAlign = cloneCellAlign(next.cellAlign ?? {});
		triggerSave();
	}

	function hydrate(): HydrationResult {
		if (!persist || typeof localStorage === 'undefined') {
			hydrated = true;
			return { status: 'missing' };
		}

		let result: HydrationResult = { status: 'missing' };

		try {
			const saved = storageAdapter.load();
			if (saved) {
				result = parseAndMigrateTableDocument(saved);
				if (result.status === 'restored' && result.document) {
					title = result.document.title;
					columns = cloneColumns(result.document.columns);
					rows = cloneRows(result.document.rows);
					cellAlign = cloneCellAlign(result.document.cellAlign ?? {});
				}
			}

			hydrateApiKeys();

			const savedFavorites = localStorage.getItem(LS_FAV_MODELS);
			if (savedFavorites) {
				const parsed: unknown = JSON.parse(savedFavorites);
				if (Array.isArray(parsed)) favoriteModels = parsed.filter((id) => typeof id === 'string');
			}

			// Hydrate AI Model from localStorage (migrate obsolete/shut-down models)
			const savedModel = localStorage.getItem(LS_AI_MODEL);
			const retired =
				!savedModel ||
				savedModel.includes('gemini-2.0') ||
				savedModel.includes('undefined') ||
				RETIRED_AI_MODELS.includes(savedModel);
			aiModel = retired ? DEFAULT_AI_MODEL : savedModel;
		} catch (e) {
			console.error('Failed to hydrate from localStorage', e);
			result = { status: 'invalid' };
		} finally {
			hydrated = true;
		}

		return result;
	}

	/** Reads the key list, folding in the single key older builds stored. */
	function hydrateApiKeys() {
		const saved = localStorage.getItem(LS_API_KEYS);
		if (saved) {
			const parsed: unknown = JSON.parse(saved);
			if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys)) {
				const { keys, active } = parsed as { keys: unknown[]; active?: unknown };
				apiKeys = keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
				activeKeyIndex = typeof active === 'number' ? clampKeyIndex(active) : 0;
			}
		}

		const legacy = localStorage.getItem(LS_API_KEY);
		if (legacy && !apiKeys.includes(legacy)) {
			apiKeys = [legacy, ...apiKeys];
			activeKeyIndex = 0;
			persistApiKeys();
		}
		localStorage.removeItem(LS_API_KEY);
	}

	function clampKeyIndex(index: number): number {
		return apiKeys.length === 0 ? 0 : Math.min(Math.max(0, Math.trunc(index)), apiKeys.length - 1);
	}

	function persistApiKeys() {
		if (typeof localStorage === 'undefined') return;
		if (apiKeys.length === 0) {
			localStorage.removeItem(LS_API_KEYS);
			return;
		}
		localStorage.setItem(LS_API_KEYS, JSON.stringify({ keys: apiKeys, active: activeKeyIndex }));
	}

	/** Adds a key and makes it active; re-adding a stored key just selects it. */
	function addApiKey(newKey: string) {
		const clean = newKey.trim();
		if (!clean) return;
		const existing = apiKeys.indexOf(clean);
		if (existing >= 0) {
			activeKeyIndex = existing;
		} else {
			apiKeys = [...apiKeys, clean];
			activeKeyIndex = apiKeys.length - 1;
		}
		persistApiKeys();
	}

	function removeApiKey(index: number) {
		if (index < 0 || index >= apiKeys.length) return;
		apiKeys = apiKeys.filter((_, i) => i !== index);
		// Keep whichever key was active still active, unless it was the one removed.
		activeKeyIndex = clampKeyIndex(index < activeKeyIndex ? activeKeyIndex - 1 : activeKeyIndex);
		persistApiKeys();
	}

	function useApiKey(index: number) {
		if (index < 0 || index >= apiKeys.length) return;
		activeKeyIndex = index;
		persistApiKeys();
	}

	function toggleFavoriteModel(modelId: string) {
		favoriteModels = favoriteModels.includes(modelId)
			? favoriteModels.filter((id) => id !== modelId)
			: [...favoriteModels, modelId];
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(LS_FAV_MODELS, JSON.stringify(favoriteModels));
		}
	}

	function setAiModel(newModel: string) {
		aiModel = newModel.trim();
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(LS_AI_MODEL, aiModel);
		}
	}

	return {
		get title() {
			return title;
		},
		get columns() {
			return columns;
		},
		get rows() {
			return rows;
		},
		get searchQuery() {
			return searchQuery;
		},
		get sortConfig() {
			return sortConfig;
		},
		get activeCell() {
			return selectionFocus;
		},
		get selectionRect() {
			return selectionRect;
		},
		get cellAlign() {
			return cellAlign;
		},
		get isAiOpen() {
			return isAiOpen;
		},
		get apiKey() {
			return apiKey;
		},
		get apiKeys() {
			return apiKeys;
		},
		get activeKeyIndex() {
			return activeKeyIndex;
		},
		get favoriteModels() {
			return favoriteModels;
		},
		get aiModel() {
			return aiModel;
		},
		get history() {
			return history;
		},
		get future() {
			return future;
		},
		get hydrated() {
			return hydrated;
		},
		get filteredRows() {
			return filteredRows;
		},
		get resolvedRows() {
			return resolvedRows;
		},
		/** The row number shown in the gutter and used by formula references. */
		sheetRowFor(rowId: string): number {
			return sheetRowById.get(rowId) ?? 0;
		},
		/** The stored cell - a formula string, not its result. What the editor opens on. */
		rawCell(rowId: string, columnId: string): CellValue {
			return rows.find((r) => r.id === rowId)?.[columnId] ?? null;
		},
		get columnSummaries() {
			return columnSummaries;
		},
		get rowCount() {
			return rowCount;
		},
		get filteredCount() {
			return filteredCount;
		},
		get canUndo() {
			return canUndo;
		},
		get canRedo() {
			return canRedo;
		},
		get saveStatus() {
			return saveStatus;
		},
		setTitle,
		setCell,
		applyCellPatches,
		addRow,
		deleteRow,
		duplicateRow,
		addColumn,
		deleteColumn,
		renameColumn,
		updateColumnType,
		updateColumnWidth,
		setSort,
		setSearchQuery,
		setSelection,
		alignFor,
		alignSelection,
		toggleAi,
		addApiKey,
		removeApiKey,
		useApiKey,
		toggleFavoriteModel,
		setAiModel,
		loadTable,
		newSheet,
		undo,
		redo,
		hydrate,
		flushSave
	};
}
