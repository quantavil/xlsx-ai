import { describe, it, expect } from 'bun:test';
import { formatCellValue } from '../../src/lib/constants';

// Mirrors DataTable.svelte `autoFitColumn` width formula exactly:
// header controls (type icon, title, sort chevron, filter + menu buttons,
// padding) floor the width so short/empty columns never clip the header.
function calcAutoFitWidth(colName: string, maxContentLen: number): number {
	const headerMin = Math.round(colName.length * 8.5 + 86);
	const contentMin = Math.round(maxContentLen * 8.5 + 32);
	return Math.max(100, Math.min(450, Math.max(headerMin, contentMin)));
}

function maxContentLenForColumn(colType: string, values: unknown[], resolved?: unknown[]): number {
	let maxLen = 0;
	const source = resolved ?? values;
	for (const v of source) {
		const str = formatCellValue(colType, v as never);
		if (str.length > maxLen) maxLen = str.length;
	}
	return maxLen;
}

describe('Column auto-fit width', () => {
	it('floors short columns at the header minimum so controls stay visible', () => {
		// 4-char header "Name" -> headerMin = 4*8.5+86 = 120; empty content -> 32.
		expect(calcAutoFitWidth('Name', 0)).toBe(120);
		// Single-char header still clears the 100px floor via headerMin (95 -> 100).
		expect(calcAutoFitWidth('N', 0)).toBe(100);
	});

	it('uses formatted display values for numbers', () => {
		// 1234.5 formats to "1,234.5" (7 chars) not "1234.5" (6 chars)
		expect(formatCellValue('number', 1234.5)).toBe('1,234.5');
		const maxLen = maxContentLenForColumn('number', [1234.5, 1]);
		expect(maxLen).toBe('1,234.5'.length);
		expect(calcAutoFitWidth('N', maxLen)).toBe(
			Math.max(100, Math.min(450, Math.max(Math.round(1 * 8.5 + 86), Math.round(7 * 8.5 + 32))))
		);
	});

	it('uses resolved display values (formulas) over raw input', () => {
		// A resolved formula result formats like any other value.
		const raw = '=SUM(A1:A2)';
		const resolved = 1500;
		const rawLen = String(raw).length;
		const resolvedStr = formatCellValue('number', resolved);
		expect(resolvedStr).toBe('1,500');
		expect(resolvedStr.length).toBeLessThan(rawLen);
		const maxLen = maxContentLenForColumn('number', [raw], [resolved]);
		expect(maxLen).toBe(resolvedStr.length);
	});

	it('grows with long headers even when content is short', () => {
		const name = 'A very long column name';
		const width = calcAutoFitWidth(name, 2);
		expect(width).toBe(Math.round(name.length * 8.5 + 86));
	});

	it('respects the 100px minimum boundary for empty columns', () => {
		expect(calcAutoFitWidth('', 0)).toBe(100);
		expect(calcAutoFitWidth('A', 0)).toBe(100);
		expect(calcAutoFitWidth('AB', 0)).toBe(103);
	});

	it('respects the 450px maximum boundary for very long text', () => {
		expect(calcAutoFitWidth('N', 200)).toBe(450);
		expect(calcAutoFitWidth('A very long column name that keeps going', 200)).toBe(450);
		// 47-char content -> 47*8.5+32 = 431.5 -> 432 (just under cap)
		expect(calcAutoFitWidth('N', 47)).toBe(432);
	});
});

describe('DataTable.svelte auto-fit wiring', () => {
	async function source(): Promise<string> {
		return await Bun.file('src/lib/table/DataTable.svelte').text();
	}
	async function cellsSource(): Promise<string> {
		return await Bun.file('src/lib/table/cells.ts').text();
	}
	async function storeSource(): Promise<string> {
		return await Bun.file('src/lib/table/store.svelte.ts').text();
	}

	it('inspects resolvedRows with rows fallback and formats values', async () => {
		const dtSrc = await source();
		const storeSrc = await storeSource();
		const cellsSrc = await cellsSource();
		expect(dtSrc).toContain('autoFitColumn(col.id)');
		expect(storeSrc).toContain('resolvedRows ?? rows');
		expect(cellsSrc).toContain('formatCellValue(col.type');
		expect(storeSrc).toContain('autoFitColumn');
		expect(storeSrc).toContain('autoFitAllColumns');
	});

	it('uses the header-aware pixel formula with a 100px floor', async () => {
		const cellsSrc = await cellsSource();
		expect(cellsSrc).toContain('Math.max(100, Math.min(450,');
		expect(cellsSrc).toContain('col.name.length * 8.5 + 86');
	});

	it('supports double-click auto-fit on both header rows', async () => {
		const src = await source();
		expect(src).toContain('th-letter');
		expect(src).toContain('th-column');
		expect(src).toContain('th-resize-handle');
		expect(src).toContain('autoFitColumn(col.id)');
		expect(src).toContain('ondblclick');
		expect(src).toContain('startResize(e, col.id, col.width || 180)');
	});

	it('widens the resize hit area so borders do not need pixel-hunting', async () => {
		const src = await source();
		expect(src).toContain('w-2.5');
		expect(src).toContain('-right-1');
	});

	it('keeps the three-dot column menu always visible', async () => {
		const src = await source();
		expect(src).toContain('th-menu-trigger');
		expect(src).not.toContain('opacity-0 group-hover/col:opacity-100');
		expect(src).toContain('opacity-60 hover:opacity-100');
	});
});
