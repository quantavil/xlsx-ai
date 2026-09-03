import { describe, it, expect, beforeEach } from 'bun:test';
import { createTableStore, parseClipboardTable } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';

const baseData: TableData = {
	title: 'Paste Sheet',
	columns: [
		{ id: 'c1', name: 'Name', type: 'text' },
		{ id: 'c2', name: 'Units', type: 'number' },
		{ id: 'c3', name: 'Notes', type: 'text' }
	],
	rows: [
		{ id: 'r1', c1: 'a1', c2: 1, c3: 'n1' },
		{ id: 'r2', c1: 'a2', c2: 2, c3: 'n2' },
		{ id: 'r3', c1: 'a3', c2: 3, c3: 'n3' }
	]
};

describe('parseClipboardTable', () => {
	it('parses TSV tab-delimited text', () => {
		expect(parseClipboardTable('a\tb\nc\td')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('parses CSV comma-delimited text', () => {
		expect(parseClipboardTable('a,b\nc,d')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('handles basic CSV quotes', () => {
		expect(parseClipboardTable('"a,b",c')).toEqual([['a,b', 'c']]);
	});

	it('handles CRLF and LF newlines', () => {
		expect(parseClipboardTable('a\tb\r\nc\td')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
		expect(parseClipboardTable('a,b\r\nc,d')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('strips trailing empty lines', () => {
		expect(parseClipboardTable('a\tb\nc\td\n')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
		expect(parseClipboardTable('a,b\nc,d\r\n')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
		expect(parseClipboardTable('a\n\n')).toEqual([['a']]);
	});
});

describe('pasteMatrix', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(structuredClone(baseData), { persist: false });
	});

	it('pastes 1x1 value into a single cell', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		const count = store.pasteMatrix([['hello']]);
		expect(count).toBe(1);
		expect(store.rows[0].c1).toBe('hello');
	});

	it('pastes 2x2 matrix into existing rows/cols', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		const count = store.pasteMatrix([
			['x1', '10'],
			['x2', '20']
		]);
		expect(count).toBe(4);
		expect(store.rows[0].c1).toBe('x1');
		expect(store.rows[0].c2).toBe(10);
		expect(store.rows[1].c1).toBe('x2');
		expect(store.rows[1].c2).toBe(20);
	});

	it('pastes 1x1 value into a multi-cell selection filling the whole selection', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		store.setSelection({ rowId: 'r2', columnId: 'c1', rowIndex: 1, colIndex: 0 }, true);
		expect(store.selectionKeys.size).toBe(2);
		const count = store.pasteMatrix([['FILL']]);
		expect(count).toBe(2);
		expect(store.rows[0].c1).toBe('FILL');
		expect(store.rows[1].c1).toBe('FILL');
	});

	it('auto-adds rows when matrix extends beyond row count', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		const before = store.rows.length;
		const count = store.pasteMatrix([['a'], ['b'], ['c'], ['d'], ['e']]);
		expect(count).toBe(5);
		expect(store.rows.length).toBe(Math.max(before, 5));
		expect(store.rows.length).toBe(5);
		expect(store.rows[3].c1).toBe('d');
		expect(store.rows[4].c1).toBe('e');
	});

	it('normalizes types during paste (numeric string into number column)', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c2', rowIndex: 0, colIndex: 1 });
		store.pasteMatrix([['42']]);
		expect(store.rows[0].c2).toBe(42);
	});

	it('undo reverts the entire paste in a single step', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		const historyBefore = store.history.length;
		store.pasteMatrix([
			['z1', '99'],
			['z2', '98']
		]);
		expect(store.history.length).toBe(historyBefore + 1);
		expect(store.rows[0].c1).toBe('z1');
		store.undo();
		expect(store.rows[0].c1).toBe('a1');
		expect(store.rows[0].c2).toBe(1);
		expect(store.rows[1].c1).toBe('a2');
		expect(store.rows[1].c2).toBe(2);
	});

	it('returns 0 for empty matrix', () => {
		expect(store.pasteMatrix([])).toBe(0);
	});
});
