import { describe, it, expect, beforeEach } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import {
	createFindStore,
	compileSearchPattern,
	replaceString
} from '../../src/lib/table/find.svelte';
import type { TableData } from '../../src/lib/types';

describe('Find & Replace Engine', () => {
	describe('compileSearchPattern', () => {
		it('compiles standard case-insensitive regex', () => {
			const pattern = compileSearchPattern('apple', {
				matchCase: false,
				wholeCell: false,
				useRegex: false
			});
			expect(pattern).not.toBeNull();
			expect(pattern?.test('Apple')).toBe(true);
			expect(pattern?.test('crabapple')).toBe(true);
			expect(pattern?.test('banana')).toBe(false);
		});

		it('compiles case-sensitive regex when matchCase is true', () => {
			const pattern = compileSearchPattern('Apple', {
				matchCase: true,
				wholeCell: false,
				useRegex: false
			});
			expect(pattern?.test('Apple')).toBe(true);
			expect(pattern?.test('apple')).toBe(false);
		});

		it('compiles whole-cell anchored regex when wholeCell is true', () => {
			const pattern = compileSearchPattern('100', {
				matchCase: false,
				wholeCell: true,
				useRegex: false
			});
			expect(pattern?.test('100')).toBe(true);
			expect(pattern?.test('1000')).toBe(false);
			expect(pattern?.test('$100')).toBe(false);
		});

		it('compiles custom regex and handles capture patterns', () => {
			const pattern = compileSearchPattern('^c\\d+', {
				matchCase: false,
				wholeCell: false,
				useRegex: true
			});
			expect(pattern?.test('c123')).toBe(true);
			expect(pattern?.test('ac123')).toBe(false);
		});

		it('safely returns null on invalid regular expression syntax', () => {
			const pattern = compileSearchPattern('[unclosed(regex', {
				matchCase: false,
				wholeCell: false,
				useRegex: true
			});
			expect(pattern).toBeNull();
		});

		it('returns null on empty query', () => {
			const pattern = compileSearchPattern('', {
				matchCase: false,
				wholeCell: false,
				useRegex: false
			});
			expect(pattern).toBeNull();
		});
	});

	describe('replaceString', () => {
		it('replaces substring in string', () => {
			const result = replaceString('Hello World', 'World', 'Svelte', {
				matchCase: false,
				wholeCell: false,
				useRegex: false
			});
			expect(result).toBe('Hello Svelte');
		});

		it('treats replacement text literally when useRegex is false, preserving dollar signs', () => {
			const result = replaceString('Price: 100', '100', '$100 ($1)', {
				matchCase: false,
				wholeCell: false,
				useRegex: false
			});
			expect(result).toBe('Price: $100 ($1)');
		});

		it('supports regex capture replacements', () => {
			const result = replaceString('Order #1234', 'Order #(\\d+)', 'INV-$1', {
				matchCase: false,
				wholeCell: false,
				useRegex: true
			});
			expect(result).toBe('INV-1234');
		});
	});

	describe('createFindStore integration with TableStore', () => {
		const testData: TableData = {
			title: 'Test Revenue',
			columns: [
				{ id: 'c1', name: 'Product', type: 'text' },
				{ id: 'c2', name: 'Category', type: 'text' },
				{ id: 'c3', name: 'Units', type: 'number' },
				{ id: 'c4', name: 'Price', type: 'currency' },
				{ id: 'c5', name: 'Notes', type: 'text' }
			],
			rows: [
				{ id: 'r1', c1: 'SaaS Core', c2: 'Software', c3: 100, c4: 50, c5: 'Primary SaaS product' },
				{ id: 'r2', c1: 'SaaS Addon', c2: 'Software', c3: 20, c4: 200, c5: 'Security SaaS plugin' },
				{ id: 'r3', c1: 'Hardware Appliance', c2: 'Hardware', c3: 5, c4: 1500, c5: 'On-premise unit' },
				{ id: 'r4', c1: 'Consulting Retainer', c2: 'Services', c3: 2, c4: 3000, c5: 'SaaS advisory' }
			]
		};

		let tableStore: ReturnType<typeof createTableStore>;
		let findStore: ReturnType<typeof createFindStore>;

		beforeEach(() => {
			tableStore = createTableStore(testData, { persist: false });
			findStore = createFindStore(tableStore);
		});

		it('scans all occurrences across the entire sheet by default', () => {
			findStore.open('SaaS');
			expect(findStore.isOpen).toBe(true);
			expect(findStore.matchCount).toBe(5); // r1.c1, r1.c5, r2.c1, r2.c5, r4.c5

			const first = findStore.activeMatch;
			expect(first).not.toBeNull();
			expect(first?.displayAddress).toBe('A2');
			expect(first?.value).toBe('SaaS Core');
		});

		it('cycles through matches using nextMatch and prevMatch', () => {
			findStore.open('SaaS');
			expect(findStore.activeMatchIndex).toBe(0);

			findStore.nextMatch();
			expect(findStore.activeMatchIndex).toBe(1);

			findStore.prevMatch();
			expect(findStore.activeMatchIndex).toBe(0);

			findStore.prevMatch();
			expect(findStore.activeMatchIndex).toBe(4); // wraps around
		});

		it('scans only within selection when scope is selection', () => {
			findStore.open('SaaS');
			expect(findStore.matchCount).toBe(5);

			// Select row 0 (r1) only
			tableStore.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 }, false);
			tableStore.setSelection({ rowId: 'r1', columnId: 'c5', rowIndex: 0, colIndex: 4 }, true);

			findStore.setScope('selection');
			// Inside r1, matches are in c1 ("SaaS Core") and c5 ("Primary SaaS product")
			expect(findStore.matchCount).toBe(2);
			expect(findStore.matches.every((m) => m.rowId === 'r1')).toBe(true);
		});

		it('replaces a single occurrence and creates an undoable snapshot', () => {
			findStore.open('SaaS');
			findStore.setReplaceText('Cloud');

			const res = findStore.replaceCurrent();
			expect(res.success).toBe(true);
			expect(tableStore.rows[0].c1).toBe('Cloud Core');
			expect(tableStore.canUndo).toBe(true);

			tableStore.undo();
			expect(tableStore.rows[0].c1).toBe('SaaS Core');
		});

		it('replaces all occurrences in a single atomic undoable batch', () => {
			findStore.open('SaaS');
			findStore.setReplaceText('Cloud');

			const initialHistoryLen = tableStore.history.length;
			const res = findStore.replaceAll();

			expect(res.replacedCount).toBe(5);
			expect(tableStore.rows[0].c1).toBe('Cloud Core');
			expect(tableStore.rows[0].c5).toBe('Primary Cloud product');
			expect(tableStore.rows[1].c1).toBe('Cloud Addon');
			expect(tableStore.rows[1].c5).toBe('Security Cloud plugin');
			expect(tableStore.rows[3].c5).toBe('Cloud advisory');

			// Exactly ONE undo entry pushed
			expect(tableStore.history.length).toBe(initialHistoryLen + 1);

			// Undo reverts all 5 replacements in one step!
			tableStore.undo();
			expect(tableStore.rows[0].c1).toBe('SaaS Core');
			expect(tableStore.rows[0].c5).toBe('Primary SaaS product');
			expect(tableStore.rows[1].c1).toBe('SaaS Addon');
			expect(tableStore.rows[1].c5).toBe('Security SaaS plugin');
			expect(tableStore.rows[3].c5).toBe('SaaS advisory');

			// Redo restores all 5 replacements!
			tableStore.redo();
			expect(tableStore.rows[0].c1).toBe('Cloud Core');
			expect(tableStore.rows[3].c5).toBe('Cloud advisory');
		});

		it('replaces all occurrences strictly within selection when scoped to selection', () => {
			// Select r1 only (cells A2..E2)
			tableStore.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 }, false);
			tableStore.setSelection({ rowId: 'r1', columnId: 'c5', rowIndex: 0, colIndex: 4 }, true);

			findStore.open('SaaS');
			findStore.setReplaceText('Platform');
			findStore.setScope('selection');

			expect(findStore.matchCount).toBe(2);

			const res = findStore.replaceAll();
			expect(res.replacedCount).toBe(2);

			// Replaced inside r1
			expect(tableStore.rows[0].c1).toBe('Platform Core');
			expect(tableStore.rows[0].c5).toBe('Primary Platform product');

			// Other rows remain unchanged!
			expect(tableStore.rows[1].c1).toBe('SaaS Addon');
			expect(tableStore.rows[3].c5).toBe('SaaS advisory');
		});

		it('preserves formulas when lookIn is values and protects formula strings from replacement', () => {
			tableStore.setCell('r1', 'c5', '=SUM(B2:B5)');
			findStore.open('SUM');
			findStore.setLookIn('values');

			// In values mode, raw formula '=SUM(B2:B5)' does not match string 'SUM' in evaluated values
			expect(findStore.matches.some((m) => m.rowId === 'r1' && m.columnId === 'c5')).toBe(false);

			findStore.setLookIn('formulas');
			// In formulas mode, '=SUM(B2:B5)' contains 'SUM'
			expect(findStore.matches.some((m) => m.rowId === 'r1' && m.columnId === 'c5')).toBe(true);

			// Test formula protection on replaceCurrent
			tableStore.setCell('r1', 'c4', '=50'); // c4 is a formula evaluating to 50
			findStore.setLookIn('values');
			findStore.setQuery('50'); // matches evaluated value 50
			expect(findStore.activeMatch?.columnId).toBe('c4');

			const replaceRes = findStore.replaceCurrent();
			expect(replaceRes.formulaProtected).toBe(true);
		});

		it('surfaces regexError when useRegex is true and regex is malformed', () => {
			findStore.open('[unclosed(');
			findStore.toggleOption('useRegex');
			expect(findStore.regexError).not.toBeNull();
			expect(findStore.matchCount).toBe(0);
		});

		it('returns 0 matches when scope is selection but no selection range exists', () => {
			tableStore.setSelection(null);
			findStore.open('SaaS');
			findStore.setScope('selection');
			expect(findStore.matchCount).toBe(0);
		});

		it('auto-detects column selection on open and limits search to the selected column', () => {
			// Select entire Product column (c1)
			tableStore.selectColumn('c1');
			expect(tableStore.selectionRect).not.toBeNull();
			expect(tableStore.selectionRect?.c0).toBe(0);
			expect(tableStore.selectionRect?.c1).toBe(0);

			// Calling open() auto-detects that a multi-cell column range is highlighted
			findStore.open('SaaS');
			expect(findStore.options.scope).toBe('selection');

			// Matches should ONLY be from column c1 ('SaaS Core' in r1, 'SaaS Addon' in r2)
			// Matches in c5 ('Primary SaaS product', 'Security SaaS plugin', 'SaaS advisory') must be ignored!
			expect(findStore.matchCount).toBe(2);
			expect(findStore.matches.every((m) => m.columnId === 'c1')).toBe(true);
		});
	});
});
