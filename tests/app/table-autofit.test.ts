import { describe, it, expect } from 'bun:test';
import { formatCellValue } from '../../src/lib/constants';

// Mirrors DataTable.svelte `autoFitColumn` width formula exactly.
function calcAutoFitWidth(maxLen: number): number {
	return Math.max(70, Math.min(450, Math.round(maxLen * 8.5 + 42)));
}

function maxLenForColumn(
	colName: string,
	colType: string,
	values: unknown[],
	resolved?: unknown[]
): number {
	let maxLen = colName.length;
	const source = resolved ?? values;
	for (const v of source) {
		const str = formatCellValue(colType, v as never);
		if (str.length > maxLen) maxLen = str.length;
	}
	return maxLen;
}

describe('Column auto-fit width', () => {
	it('calculates width accurately for typical text', () => {
		// 10 chars -> 10 * 8.5 + 42 = 127
		expect(calcAutoFitWidth(10)).toBe(127);
		// 4-char header "Name" -> 4 * 8.5 + 42 = 76
		expect(calcAutoFitWidth(4)).toBe(76);
	});

	it('uses formatted display values for numbers', () => {
		// 1234.5 formats to "1,234.5" (7 chars) not "1234.5" (6 chars)
		expect(formatCellValue('number', 1234.5)).toBe('1,234.5');
		const maxLen = maxLenForColumn('N', 'number', [1234.5, 1]);
		expect(maxLen).toBe('1,234.5'.length);
		expect(calcAutoFitWidth(maxLen)).toBe(Math.round(7 * 8.5 + 42));
	});

	it('uses resolved display values (formulas) over raw input', () => {
		// A resolved formula result formats like any other value.
		const raw = '=SUM(A1:A2)';
		const resolved = 1500;
		const rawLen = String(raw).length;
		const resolvedStr = formatCellValue('number', resolved);
		expect(resolvedStr).toBe('1,500');
		expect(resolvedStr.length).toBeLessThan(rawLen);
		const maxLen = maxLenForColumn('Total', 'number', [raw], [resolved]);
		expect(maxLen).toBe(Math.max('Total'.length, resolvedStr.length));
	});

	it('accounts for the column header length', () => {
		const maxLen = maxLenForColumn('A very long column name', 'text', ['a', 'bb']);
		expect(maxLen).toBe('A very long column name'.length);
	});

	it('respects the 70px minimum boundary', () => {
		expect(calcAutoFitWidth(0)).toBe(70);
		expect(calcAutoFitWidth(1)).toBe(70);
		expect(calcAutoFitWidth(3)).toBe(70);
	});

	it('respects the 450px maximum boundary for very long text', () => {
		expect(calcAutoFitWidth(200)).toBe(450);
		expect(calcAutoFitWidth(48)).toBe(450);
		// 47 chars -> 47*8.5+42 = 441.5 -> 442 (just under cap)
		expect(calcAutoFitWidth(47)).toBe(442);
	});
});

describe('DataTable.svelte auto-fit wiring', () => {
	async function source(): Promise<string> {
		return await Bun.file('src/lib/table/DataTable.svelte').text();
	}

	it('inspects resolvedRows with rows fallback and formats values', async () => {
		const src = await source();
		expect(src).toContain('store.resolvedRows');
		expect(src).toContain('store.rows');
		expect(src).toContain('formatCellValue(col.type');
		expect(src).toContain('store.updateColumnWidth(colId, fitWidth)');
	});

	it('uses the specified pixel formula', async () => {
		const src = await source();
		expect(src).toContain('Math.max(70, Math.min(450, Math.round(maxLen * 8.5 + 42)))');
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
});
