import { describe, it, expect } from 'bun:test';
import {
	sanitizeDropdownConfig,
	sanitizeAndNormalizeTableData,
	parseAndMigrateTableDocument,
	PersistedTableDocumentV2Schema
} from '../../src/lib/table/schema';
import {
	resolveDropdownOptions,
	resolveDropdownOptionsForRows,
	dropdownOptionLabel
} from '../../src/lib/table/cells';
import type { Column, Row } from '../../src/lib/types';

const stateCol: Column = {
	id: 'StateOrigin',
	name: 'StateOrigin',
	type: 'dropdown',
	dropdown: {
		options: [
			{ value: '08', label: 'RAJASTHAN' },
			{ value: '09', label: 'UTTAR PRADESH' }
		],
		allowCustom: false
	}
};

const districtCol: Column = {
	id: 'DistrictOrigin',
	name: 'DistrictOrigin',
	type: 'dropdown',
	dropdown: {
		options: [
			{ value: '102', label: 'JAIPUR', parentValue: '8' },
			{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
		],
		allowCustom: false,
		dependsOnColumnId: 'StateOrigin'
	}
};

describe('sanitizeDropdownConfig', () => {
	it('trims values, labels and parents', () => {
		const cfg = sanitizeDropdownConfig(
			{ options: [{ value: '  08 ', label: ' RAJASTHAN ', parentValue: ' 8 ' }], allowCustom: true },
			{ id: 'c', type: 'dropdown' }
		);
		expect(cfg?.options).toEqual([{ value: '08', label: 'RAJASTHAN', parentValue: '8' }]);
	});

	it('drops blank values but keeps the column usable', () => {
		const cfg = sanitizeDropdownConfig(
			{ options: [{ value: '   ' }, { value: 'PCS' }, null, 42], allowCustom: true },
			{ id: 'c', type: 'dropdown' }
		);
		expect(cfg?.options).toEqual([{ value: 'PCS' }]);
	});

	it('deduplicates case-insensitively on (value, parentValue) keeping first order', () => {
		const cfg = sanitizeDropdownConfig(
			{
				options: [
					{ value: 'PCS', label: 'first' },
					{ value: 'pcs', label: 'second' },
					{ value: '102', parentValue: '8' },
					{ value: '102', parentValue: '9' }
				],
				allowCustom: true
			},
			{ id: 'c', type: 'dropdown' }
		);
		expect(cfg?.options).toEqual([
			{ value: 'PCS', label: 'first' },
			{ value: '102', parentValue: '8' },
			{ value: '102', parentValue: '9' }
		]);
	});

	it('removes dropdown config from non-dropdown columns', () => {
		expect(
			sanitizeDropdownConfig({ options: [{ value: 'x' }], allowCustom: true }, { id: 'c', type: 'text' })
		).toBeUndefined();
	});

	it('drops a self-referencing dependency', () => {
		const cfg = sanitizeDropdownConfig(
			{ options: [{ value: 'x' }], allowCustom: true, dependsOnColumnId: 'c' },
			{ id: 'c', type: 'dropdown' }
		);
		expect(cfg?.dependsOnColumnId).toBeUndefined();
	});

	it('returns undefined for malformed input instead of throwing', () => {
		for (const bad of [null, undefined, 'nope', 42, {}, { options: 'x' }]) {
			expect(sanitizeDropdownConfig(bad, { id: 'c', type: 'dropdown' })).toBeUndefined();
		}
	});
});

describe('dropdown persistence', () => {
	it('preserves dropdown options through sanitizeAndNormalizeTableData', () => {
		const table = sanitizeAndNormalizeTableData('T', [stateCol, districtCol], [
			{ id: 'r1', StateOrigin: '08', DistrictOrigin: '102' }
		] as Row[]);

		expect(table.columns[0].dropdown?.options).toHaveLength(2);
		expect(table.columns[1].dropdown?.dependsOnColumnId).toBe('StateOrigin');
		expect(table.columns[1].dropdown?.allowCustom).toBe(false);
	});

	it('round-trips through V2 serialization and hydration', () => {
		const table = sanitizeAndNormalizeTableData('T', [stateCol, districtCol], [
			{ id: 'r1', StateOrigin: '08', DistrictOrigin: '102' }
		] as Row[]);

		const doc = {
			version: 2 as const,
			title: table.title,
			columns: table.columns.map((c) => ({
				id: c.id,
				name: c.name,
				type: c.type,
				width: c.width,
				...(c.dropdown ? { dropdown: c.dropdown } : {})
			})),
			rows: table.rows,
			updatedAt: new Date().toISOString()
		};

		expect(PersistedTableDocumentV2Schema.safeParse(doc).success).toBe(true);

		const restored = parseAndMigrateTableDocument(JSON.stringify(doc));
		expect(restored.status).toBe('restored');
		expect(restored.document?.columns[1].dropdown?.options[0]).toEqual({
			value: '102',
			label: 'JAIPUR',
			parentValue: '8'
		});
	});

	it('still loads existing V2 documents that carry no dropdown field', () => {
		const legacy = {
			version: 2,
			title: 'Old',
			columns: [{ id: 'a', name: 'A', type: 'dropdown', width: 120 }],
			rows: [{ id: 'r1', a: 'x' }]
		};
		const restored = parseAndMigrateTableDocument(JSON.stringify(legacy));
		expect(restored.status).toBe('restored');
		expect(restored.document?.columns[0].dropdown).toBeUndefined();
	});
});

describe('resolveDropdownOptions', () => {
	const rows: Row[] = [
		{ id: 'r1', StateOrigin: '08', DistrictOrigin: '102' },
		{ id: 'r2', StateOrigin: '09', DistrictOrigin: '171' }
	];

	it('returns configured built-ins first', () => {
		const opts = resolveDropdownOptions(stateCol, rows[0], rows);
		expect(opts.slice(0, 2).map((o) => o.value)).toEqual(['08', '09']);
	});

	it('filters a dependent column by the row parent, normalizing 08 against 8', () => {
		expect(resolveDropdownOptions(districtCol, rows[0], rows).map((o) => o.value)).toEqual(['102']);
		expect(resolveDropdownOptions(districtCol, rows[1], rows).map((o) => o.value)).toEqual(['171']);
	});

	it('keeps the row own value visible when the parent is cleared, offering nothing else', () => {
		const orphan: Row = { id: 'r3', StateOrigin: '', DistrictOrigin: '102' };
		expect(resolveDropdownOptions(districtCol, orphan, [orphan]).map((o) => o.value)).toEqual(['102']);
	});

	it('merges values already in the table for an unconfigured dropdown column', () => {
		const plain: Column = { id: 'Status', name: 'Status', type: 'dropdown' };
		const statusRows: Row[] = [
			{ id: 'r1', Status: 'Open' },
			{ id: 'r2', Status: 'Done' },
			{ id: 'r3', Status: 'Open' }
		];
		expect(resolveDropdownOptions(plain, statusRows[0], statusRows).map((o) => o.value)).toEqual([
			'Open',
			'Done'
		]);
	});

	it('does not leak arbitrary table values into a closed catalog', () => {
		const dirty: Row[] = [{ id: 'r1', StateOrigin: '08' }, { id: 'r2', StateOrigin: 'MADE UP' }];
		expect(resolveDropdownOptions(stateCol, dirty[0], dirty).map((o) => o.value)).toEqual(['08', '09']);
	});
});

describe('resolveDropdownOptionsForRows', () => {
	const sharedDistrictCol: Column = {
		id: 'DistrictOrigin',
		name: 'DistrictOrigin',
		type: 'dropdown',
		dropdown: {
			options: [
				{ value: 'ANY', label: 'ALL DISTRICTS', parentValue: '8' },
				{ value: '102', label: 'JAIPUR', parentValue: '8' },
				{ value: 'ANY', label: 'ALL DISTRICTS', parentValue: '9' },
				{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
			],
			allowCustom: false,
			dependsOnColumnId: 'StateOrigin'
		}
	};

	const rows: Row[] = [
		{ id: 'r1', StateOrigin: '08', DistrictOrigin: '102' },
		{ id: 'r2', StateOrigin: '09', DistrictOrigin: '171' }
	];

	it('keeps only configured values valid for every selected parent', () => {
		expect(
			resolveDropdownOptionsForRows(sharedDistrictCol, rows[0], rows, rows).map((o) => o.value)
		).toEqual(['ANY']);
	});

	it('returns no options when closed dependent rows share no valid value', () => {
		expect(resolveDropdownOptionsForRows(districtCol, rows[0], rows, rows)).toEqual([]);
	});

	it('does not treat the same stale current value as a valid shared option', () => {
		const staleRows: Row[] = [
			{ id: 'r1', StateOrigin: '08', DistrictOrigin: 'STALE' },
			{ id: 'r2', StateOrigin: '09', DistrictOrigin: 'STALE' }
		];
		expect(resolveDropdownOptionsForRows(districtCol, staleRows[0], staleRows, staleRows)).toEqual([]);
	});

	it('keeps ordinary dropdown behavior when the catalog is not closed and dependent', () => {
		expect(
			resolveDropdownOptionsForRows(stateCol, rows[0], rows, rows).map((o) => o.value)
		).toEqual(['08', '09']);
	});
});

describe('dropdownOptionLabel', () => {
	it('renders "value — label" when labeled and the bare value otherwise', () => {
		expect(dropdownOptionLabel({ value: '08', label: 'RAJASTHAN' })).toBe('08 — RAJASTHAN');
		expect(dropdownOptionLabel({ value: 'PCS' })).toBe('PCS');
	});
});
