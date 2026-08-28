import type {
	Column,
	Row,
	CellValue,
	TableData,
	SortConfig,
	ColumnSummary,
	ColumnType,
	HistoryEntry
} from '$lib/types';
import {
	MAX_HISTORY,
	LS_KEY,
	LS_API_KEY,
	LS_AI_MODEL,
	DEFAULT_AI_MODEL,
	DEFAULT_TABLE_TITLE,
	COLUMN_TYPE_CONFIG
} from '$lib/constants';
import { normalizeCellValue, numericCellValue } from './cells';
import {
	parseAndMigrateTableDocument,
	sanitizeAndNormalizeTableData,
	type HydrationResult
} from './schema';
import { dedupeAndNormalizePatches, convertColumnTypeAtomic, type CellPatch } from './commands';
import { createLocalStorageAdapter, type SaveStatus } from './persistence';


export interface TableStoreOptions {
	persist?: boolean;
	storageKey?: string;
}

function cloneState<T>(data: T): T {
	return structuredClone($state.snapshot(data) as T);
}

function computeDocumentHash(title: string, columns: Column[], rows: Row[]): string {
	return JSON.stringify({
		t: title,
		c: columns.map((c) => ({ id: c.id, n: c.name, t: c.type, w: c.width })),
		r: rows
	});
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
	let columns = $state<Column[]>(cloneState(sanitizedInitial.columns));
	let rows = $state<Row[]>(cloneState(sanitizedInitial.rows));
	let searchQuery = $state<string>('');
	let sortConfig = $state<SortConfig | null>(null);
	let activeCell = $state<{ rowId: string; columnId: string } | null>(null);
	let isAiOpen = $state<boolean>(false);
	let apiKey = $state<string>('');
	let aiModel = $state<string>(DEFAULT_AI_MODEL);
	let history = $state<HistoryEntry[]>([]);
	let future = $state<HistoryEntry[]>([]);
	let hydrated = $state<boolean>(false);

	let savedBaselineHash = $state<string>(
		computeDocumentHash(sanitizedInitial.title, sanitizedInitial.columns, sanitizedInitial.rows)
	);
	let saveStatus = $state<SaveStatus>('idle');

	const storageAdapter = createLocalStorageAdapter(storageKey, {
		debounceMs: 300,
		onStatusChange: (status) => {
			saveStatus = status;
		}
	});

	let isDirty = $derived.by(() => {
		const currentHash = computeDocumentHash(title, columns, rows);
		return currentHash !== savedBaselineHash;
	});

	function triggerSave() {
		if (!persist) return;
		storageAdapter.scheduleSave({
			title,
			columns: cloneState(columns),
			rows: cloneState(rows)
		});
	}

	function flushSave() {
		if (!persist) return;
		storageAdapter.flush();
	}

	function pushHistory() {
		const snapshot: HistoryEntry = {
			title,
			columns: cloneState(columns),
			rows: cloneState(rows)
		};

		const nextHistory = [...history, snapshot];
		if (nextHistory.length > MAX_HISTORY) {
			nextHistory.shift();
		}
		history = nextHistory;
		future = [];
	}

	// Derived: Filtered & Sorted Rows
	const filteredRows = $derived.by(() => {
		let result = rows || [];

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
			const isNumeric = colType === 'number' || colType === 'currency' || colType === 'percent';
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
					const dateA = new Date(valA as string | number).getTime();
					const dateB = new Date(valB as string | number).getTime();
					const invalidA = isNaN(dateA);
					const invalidB = isNaN(dateB);
					if (invalidA && invalidB) comparison = 0;
					else if (invalidA) comparison = 1;
					else if (invalidB) comparison = -1;
					else comparison = dateA - dateB;
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

		for (const col of columns || []) {
			if (!col || !col.id) continue;
			const colType = col.type || 'text';
			const colConfig = COLUMN_TYPE_CONFIG[colType] || COLUMN_TYPE_CONFIG.text;
			const isSummable = colConfig.summarizable;

			let totalCount = 0;
			let nonEmptyCount = 0;
			let sum = 0;
			let min: number | undefined = undefined;
			let max: number | undefined = undefined;

			for (const row of rows || []) {
				if (!row) continue;
				totalCount++;
				const val = row[col.id];
				if (val !== null && val !== undefined && val !== '') {
					nonEmptyCount++;
					if (isSummable) {
						const num = numericCellValue(colType, val);
						if (num !== null) {
							sum += num;
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

			if (isSummable && nonEmptyCount > 0) {
				summary.sum = sum;
				summary.avg = sum / nonEmptyCount;
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
		const clone: Row = { ...cloneState(original), id: newId };
		rows = [...rows.slice(0, index + 1), clone, ...rows.slice(index + 1)];
		triggerSave();
	}

	function deleteRow(rowId: string) {
		const index = rows.findIndex((r) => r.id === rowId);
		if (index === -1) return;
		pushHistory();
		rows = rows.filter((r) => r.id !== rowId);
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

	function updateColumnType(columnId: string, newType: ColumnType) {
		const col = columns.find((c) => c.id === columnId);
		if (!col || col.type === newType) return;

		pushHistory();
		col.type = newType;
		columns = [...columns];

		const { updatedRows } = convertColumnTypeAtomic(rows, columnId, newType);
		rows = updatedRows;
		triggerSave();
	}

	function deleteColumn(columnId: string) {
		const colIndex = columns.findIndex((c) => c.id === columnId);
		if (colIndex === -1) return;

		pushHistory();
		columns = columns.filter((c) => c.id !== columnId);
		for (const row of rows) {
			delete row[columnId];
		}
		rows = [...rows];
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

	function setActiveCell(cell: { rowId: string; columnId: string } | null) {
		activeCell = cell;
	}

	function toggleAi(open?: boolean) {
		isAiOpen = open !== undefined ? open : !isAiOpen;
	}

	function loadTable(data: TableData) {
		const sanitized = sanitizeAndNormalizeTableData(
			data.title || DEFAULT_TABLE_TITLE,
			data.columns || [],
			data.rows || []
		);
		title = sanitized.title;
		columns = cloneState(sanitized.columns);
		rows = cloneState(sanitized.rows);
		history = [];
		future = [];
		searchQuery = '';
		sortConfig = null;
		activeCell = null;
		savedBaselineHash = computeDocumentHash(title, columns, rows);
		triggerSave();
	}

	function resetTable() {
		loadTable({
			title: DEFAULT_TABLE_TITLE,
			columns: [],
			rows: []
		});
	}

	function undo() {
		if (history.length === 0) return;
		const previous = history[history.length - 1];
		history = history.slice(0, -1);

		future = [
			{
				title,
				columns: cloneState(columns),
				rows: cloneState(rows)
			},
			...future
		];

		title = previous.title;
		columns = cloneState(previous.columns);
		rows = cloneState(previous.rows);
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
				columns: cloneState(columns),
				rows: cloneState(rows)
			}
		];
		if (nextHistory.length > MAX_HISTORY) {
			nextHistory.shift();
		}
		history = nextHistory;

		title = next.title;
		columns = cloneState(next.columns);
		rows = cloneState(next.rows);
		triggerSave();
	}

	function hydrate(): HydrationResult {
		if (!persist || typeof window === 'undefined' || !window.localStorage) {
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
					columns = cloneState(result.document.columns);
					rows = cloneState(result.document.rows);
					savedBaselineHash = computeDocumentHash(title, columns, rows);
				}
			}

			// Hydrate API Key from localStorage
			const savedApiKey = localStorage.getItem(LS_API_KEY);
			if (savedApiKey) {
				apiKey = savedApiKey;
			}

			// Hydrate AI Model from localStorage (migrate obsolete/shut-down models)
			const savedModel = localStorage.getItem(LS_AI_MODEL);
			if (savedModel && !savedModel.includes('gemini-2.0') && !savedModel.includes('undefined')) {
				aiModel = savedModel;
			} else {
				aiModel = DEFAULT_AI_MODEL;
			}
		} catch (e) {
			console.error('Failed to hydrate from localStorage', e);
			result = { status: 'invalid' };
		} finally {
			hydrated = true;
		}

		return result;
	}

	function setApiKey(newKey: string) {
		apiKey = newKey.trim();
		if (typeof localStorage !== 'undefined') {
			if (apiKey) {
				localStorage.setItem(LS_API_KEY, apiKey);
			} else {
				localStorage.removeItem(LS_API_KEY);
			}
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
			return activeCell;
		},
		get isAiOpen() {
			return isAiOpen;
		},
		get apiKey() {
			return apiKey;
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
		get isDirty() {
			return isDirty;
		},
		get saveStatus() {
			return saveStatus;
		},

		markClean() {
			savedBaselineHash = computeDocumentHash(title, columns, rows);
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
		setActiveCell,
		toggleAi,
		setApiKey,
		setAiModel,
		loadTable,
		resetTable,
		undo,
		redo,
		hydrate,
		flushSave
	};
}
