import type { Column, Row } from '$lib/types';
import type { createTableStore } from './store.svelte';
import { isFormula } from './cells';
import { columnLetter, sheetRowNumber } from './formulas';
import type { CellPatch } from './commands';

export type FindScope = 'sheet' | 'selection';
export type FindLookIn = 'values' | 'formulas';

export interface FindOptions {
	matchCase: boolean;
	wholeCell: boolean;
	useRegex: boolean;
	scope: FindScope;
	lookIn: FindLookIn;
}

export interface CellMatch {
	rowId: string;
	columnId: string;
	rowIndex: number;
	colIndex: number;
	colLetter: string;
	colName: string;
	displayAddress: string;
	value: string;
}

/**
 * Escapes special regex characters in a query string for safe literal matching.
 */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Safely compiles a search query into a stateless RegExp based on options.
 * Returns null if the query is empty or if a custom regex has a syntax error.
 */
export function compileSearchPattern(
	query: string,
	options: Pick<FindOptions, 'matchCase' | 'wholeCell' | 'useRegex'>
): RegExp | null {
	const q = query.trim();
	if (!q) return null;
	try {
		if (options.useRegex) {
			return new RegExp(query, options.matchCase ? '' : 'i');
		}
		const escaped = escapeRegExp(query);
		if (options.wholeCell) {
			return new RegExp(`^${escaped}$`, options.matchCase ? '' : 'i');
		}
		return new RegExp(escaped, options.matchCase ? '' : 'i');
	} catch {
		return null;
	}
}

/**
 * Performs string replacement using compiled search pattern.
 * Respects whole cell, substring, and regex capture groups ($1, $2, etc.).
 * When useRegex is false, replaceText is treated strictly as literal text.
 */
export function replaceString(
	original: string,
	query: string,
	replaceText: string,
	options: Pick<FindOptions, 'matchCase' | 'wholeCell' | 'useRegex'>
): string {
	if (!query) return original;
	try {
		if (options.useRegex) {
			const pattern = new RegExp(query, options.matchCase ? 'g' : 'gi');
			return original.replace(pattern, replaceText);
		} else if (options.wholeCell) {
			const escaped = escapeRegExp(query);
			const pattern = new RegExp(`^${escaped}$`, options.matchCase ? 'g' : 'gi');
			return original.replace(pattern, () => replaceText);
		} else {
			const escaped = escapeRegExp(query);
			const pattern = new RegExp(escaped, options.matchCase ? 'g' : 'gi');
			return original.replace(pattern, () => replaceText);
		}
	} catch {
		return original;
	}
}

/**
 * Core scanning implementation that searches cells and returns structured matches.
 */
export function executeScan(
	rows: Row[],
	columns: Column[],
	resolvedRows: Row[],
	query: string,
	options: FindOptions,
	selectionKeys: ReadonlySet<string>,
	filteredRows: Row[]
): CellMatch[] {
	if (!query.trim() || !rows.length || !columns.length || !filteredRows.length) return [];

	const pattern = compileSearchPattern(query, options);
	if (!pattern) return [];

	// The selection is a flat set of cells, not a bounding box: several cursors scattered
	// across the sheet scope the search to exactly those cells, never to the rectangle
	// that happens to enclose them.
	const scoped = options.scope === 'selection';
	if (scoped && selectionKeys.size === 0) return [];

	const targetRows = filteredRows;
	const rowToStorageIdx = new Map(rows.map((r, idx) => [r.id, idx]));
	const matches: CellMatch[] = [];

	for (let r = 0; r < targetRows.length; r++) {
		const row = targetRows[r];
		if (!row) continue;

		const storageIdx = rowToStorageIdx.get(row.id) ?? r;
		const storageRow = rows[storageIdx] ?? row;
		const resolvedRow = resolvedRows[storageIdx] ?? row;

		for (let c = 0; c < columns.length; c++) {
			const col = columns[c];
			if (!col || !col.id) continue;
			if (scoped && !selectionKeys.has(`${row.id}::${col.id}`)) continue;

			let cellContent: string;
			if (options.lookIn === 'formulas') {
				const raw = storageRow[col.id];
				cellContent = raw !== null && raw !== undefined ? String(raw) : '';
			} else {
				const val = resolvedRow[col.id];
				cellContent = val !== null && val !== undefined ? String(val) : '';
			}

			if (!cellContent) continue;

			pattern.lastIndex = 0;
			if (pattern.test(cellContent)) {
				const cLetter = columnLetter(c);
				const rowNum = sheetRowNumber(storageIdx);
				matches.push({
					rowId: row.id,
					columnId: col.id,
					rowIndex: r,
					colIndex: c,
					colLetter: cLetter,
					colName: col.name,
					displayAddress: `${cLetter}${rowNum}`,
					value: cellContent
				});
			}
		}
	}

	return matches;
}

export function createFindStore(tableStore: ReturnType<typeof createTableStore>) {
	let isOpen = $state<boolean>(false);
	let query = $state<string>('');
	let replaceText = $state<string>('');
	let options = $state<FindOptions>({
		matchCase: false,
		wholeCell: false,
		useRegex: false,
		scope: 'sheet',
		lookIn: 'values'
	});
	let activeMatchIndex = $state<number>(0);

	const regexError = $derived.by<string | null>(() => {
		if (!options.useRegex || !query) return null;
		try {
			new RegExp(query);
			return null;
		} catch (err: unknown) {
			return err instanceof Error ? err.message : 'Invalid regular expression';
		}
	});

	const matches = $derived.by<CellMatch[]>(() => {
		if (!isOpen || !query.trim() || regexError) return [];
		return executeScan(
			tableStore.rows,
			tableStore.columns,
			tableStore.resolvedRows,
			query,
			options,
			tableStore.selectionKeys,
			tableStore.filteredRows
		);
	});

	const matchCount = $derived(matches.length);

	const activeMatch = $derived.by<CellMatch | null>(() => {
		if (matches.length === 0) return null;
		const safeIndex = Math.min(Math.max(0, activeMatchIndex), matches.length - 1);
		return matches[safeIndex] ?? null;
	});

	const matchKeys = $derived.by<Set<string>>(() => {
		const set = new Set<string>();
		for (const m of matches) {
			set.add(`${m.rowId}::${m.columnId}`);
		}
		return set;
	});

	const activeMatchKey = $derived.by<string | null>(() => {
		return activeMatch ? `${activeMatch.rowId}::${activeMatch.columnId}` : null;
	});

	function open(initialQuery?: string, initialScope?: FindScope) {
		isOpen = true;
		if (initialQuery !== undefined) {
			query = initialQuery;
		}
		if (initialScope) {
			options.scope = initialScope;
		} else if (tableStore.selectionKeys.size > 1) {
			options.scope = 'selection';
		}
		activeMatchIndex = 0;
	}

	function close() {
		isOpen = false;
	}

	function toggle() {
		isOpen = !isOpen;
	}

	function setQuery(newQuery: string) {
		query = newQuery;
		activeMatchIndex = 0;
	}

	function setReplaceText(newReplace: string) {
		replaceText = newReplace;
	}

	function toggleOption(key: keyof Pick<FindOptions, 'matchCase' | 'wholeCell' | 'useRegex'>) {
		options = { ...options, [key]: !options[key] };
		activeMatchIndex = 0;
	}

	function setScope(newScope: FindScope) {
		options = { ...options, scope: newScope };
		activeMatchIndex = 0;
	}

	function setLookIn(newLookIn: FindLookIn) {
		options = { ...options, lookIn: newLookIn };
		activeMatchIndex = 0;
	}

	function nextMatch() {
		if (matches.length === 0) return;
		activeMatchIndex = (activeMatchIndex + 1) % matches.length;
	}

	function prevMatch() {
		if (matches.length === 0) return;
		activeMatchIndex = (activeMatchIndex - 1 + matches.length) % matches.length;
	}

	function selectMatch(index: number) {
		if (index >= 0 && index < matches.length) {
			activeMatchIndex = index;
		}
	}

	function replaceCurrent(): { success: boolean; match?: CellMatch; formulaProtected?: boolean } {
		const current = activeMatch;
		if (!current || !query) return { success: false };

		const row = tableStore.rows.find((r) => r.id === current.rowId);
		if (!row) return { success: false };

		const rawCurrentVal = row[current.columnId];
		const currentValStr = rawCurrentVal !== null && rawCurrentVal !== undefined ? String(rawCurrentVal) : '';

		// If looking in values but cell is a formula, protect formula unless lookIn is formulas
		if (options.lookIn === 'values' && isFormula(currentValStr)) {
			return { success: false, formulaProtected: true };
		}

		const newValStr = replaceString(currentValStr, query, replaceText, options);
		if (newValStr === currentValStr) return { success: false };

		const patch: CellPatch = {
			rowId: current.rowId,
			columnId: current.columnId,
			newValue: newValStr
		};

		const applied = tableStore.applyCellPatches([patch]);
		if (applied > 0) {
			// Keep activeMatchIndex in bounds
			if (activeMatchIndex >= matches.length - 1) {
				activeMatchIndex = 0;
			}
			return { success: true, match: current };
		}
		return { success: false };
	}

	function replaceAll(): { replacedCount: number; totalMatches: number; formulaProtectedCount: number } {
		if (matches.length === 0 || !query) return { replacedCount: 0, totalMatches: 0, formulaProtectedCount: 0 };

		const currentMatches = [...matches];
		const patches: CellPatch[] = [];
		let formulaProtectedCount = 0;

		const rowMap = new Map(tableStore.rows.map((r) => [r.id, r]));

		for (const m of currentMatches) {
			const row = rowMap.get(m.rowId);
			if (!row) continue;

			const rawVal = row[m.columnId];
			const valStr = rawVal !== null && rawVal !== undefined ? String(rawVal) : '';

			if (options.lookIn === 'values' && isFormula(valStr)) {
				formulaProtectedCount++;
				continue;
			}

			const newValStr = replaceString(valStr, query, replaceText, options);
			if (newValStr !== valStr) {
				patches.push({
					rowId: m.rowId,
					columnId: m.columnId,
					newValue: newValStr
				});
			}
		}

		if (patches.length === 0) {
			return { replacedCount: 0, totalMatches: currentMatches.length, formulaProtectedCount };
		}

		const replacedCount = tableStore.applyCellPatches(patches);
		activeMatchIndex = 0;
		return { replacedCount, totalMatches: currentMatches.length, formulaProtectedCount };
	}

	return {
		get isOpen() {
			return isOpen;
		},
		get query() {
			return query;
		},
		get replaceText() {
			return replaceText;
		},
		get options() {
			return options;
		},
		get activeMatchIndex() {
			return activeMatchIndex;
		},
		get matches() {
			return matches;
		},
		get matchCount() {
			return matchCount;
		},
		get regexError() {
			return regexError;
		},
		get activeMatch() {
			return activeMatch;
		},
		get matchKeys() {
			return matchKeys;
		},
		get activeMatchKey() {
			return activeMatchKey;
		},
		open,
		close,
		toggle,
		setQuery,
		setReplaceText,
		toggleOption,
		setScope,
		setLookIn,
		nextMatch,
		prevMatch,
		selectMatch,
		replaceCurrent,
		replaceAll
	};
}

export type FindStore = ReturnType<typeof createFindStore>;
