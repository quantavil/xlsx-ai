import { describe, it, expect } from 'bun:test';
import { handleComboboxKeydown, type ComboboxOptions } from '../../src/lib/ui/combobox';
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
import { dedupeAndNormalizePatches } from '../../src/lib/table/commands';
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

describe('handleComboboxKeydown reaches every rendered row', () => {
	const press = (
		key: string,
		highlightIndex: number,
		extra: Partial<ComboboxOptions<string>> = {}
	) => {
		const seen: { landed: number | null; cleared: boolean; created: string | null } = {
			landed: null,
			cleared: false,
			created: null
		};
		handleComboboxKeydown<string>({ key, preventDefault: () => {} } as KeyboardEvent, {
			items: ['a', 'b'],
			query: 'zz',
			highlightIndex,
			getItemLabel: (i: string) => i,
			onHighlight: (idx) => (seen.landed = idx),
			onSelect: () => {},
			onCreate: (q) => (seen.created = q),
			onCancel: () => {},
			onClear: () => (seen.cleared = true),
			...extra
		});
		return seen;
	};

	it('walks up from the first option onto Clear rather than past it', () => {
		expect(press('ArrowUp', 0).landed).toBe(-1);
	});

	it('walks down from the last option onto + Add when it is on screen', () => {
		expect(press('ArrowDown', 1, { hasCreateRow: true }).landed).toBe(2);
		// ...and wraps to Clear when it is not, never landing on a row that is not drawn.
		expect(press('ArrowDown', 1).landed).toBe(-1);
	});

	it('wraps from Clear to the last drawn row in both directions', () => {
		expect(press('ArrowUp', -1, { hasCreateRow: true }).landed).toBe(2);
		expect(press('ArrowDown', -1).landed).toBe(0);
	});

	it('commits Clear on Enter instead of creating a value from the search text', () => {
		const r = press('Enter', -1);
		expect(r.cleared).toBe(true);
		expect(r.created).toBeNull();
	});

	it('leaves a list with no Clear row starting at the first option', () => {
		expect(press('ArrowUp', 0, { onClear: undefined }).landed).toBe(1);
	});
});

describe('coupled dropdown fills', () => {
	// A serial the schedule offers under two headings, each with its own rate: the
	// shape that makes a flat lookup by value pick an arbitrary row's payload.
	const serialCol: Column = {
		id: 'drawback_schno',
		name: 'drawback_schno',
		type: 'dropdown',
		dropdown: {
			options: [
				{
					value: '9403B',
					label: 'Other furniture and parts thereof',
					parentValue: '94032090',
					fills: { dbk_rate: 0, dbk_desc: 'Other furniture and parts thereof' }
				},
				{
					value: '940301B',
					label: 'Predominantly of marble',
					parentValue: '94032090',
					fills: { dbk_rate: 2.2, dbk_desc: 'Predominantly of marble', dbk_unit: 'PCS' }
				},
				{
					value: '9403B',
					label: 'Seats',
					parentValue: '94011000',
					fills: { dbk_rate: 9.9, dbk_desc: 'Seats' }
				}
			],
			allowCustom: true,
			dependsOnColumnId: 'RITCCode'
		}
	};
	const ritcCol: Column = { id: 'RITCCode', name: 'RITCCode', type: 'text' };
	const rateCol: Column = { id: 'dbk_rate', name: 'dbk_rate', type: 'number' };
	const descCol: Column = { id: 'dbk_desc', name: 'dbk_desc', type: 'text' };
	const columns = [ritcCol, serialCol, rateCol, descCol];
	const rows = (): Row[] => [
		{ id: 'r1', RITCCode: '94032090', drawback_schno: '9403B', dbk_rate: 0, dbk_desc: 'Other furniture and parts thereof' },
		{ id: 'r2', RITCCode: '94011000', drawback_schno: null, dbk_rate: null, dbk_desc: null }
	];
	const patchMap = (patches: ReturnType<typeof dedupeAndNormalizePatches>) =>
		Object.fromEntries(patches.map((p) => [`${p.row.id}.${p.columnId}`, p.newValue]));

	it('moves rate and description with the serial', () => {
		const out = patchMap(
			dedupeAndNormalizePatches(
				[{ rowId: 'r1', columnId: 'drawback_schno', newValue: '940301B' }],
				rows(),
				columns
			)
		);
		expect(out['r1.drawback_schno']).toBe('940301B');
		expect(out['r1.dbk_rate']).toBe(2.2);
		expect(out['r1.dbk_desc']).toBe('Predominantly of marble');
	});

	it('resolves the payload against the row, not the flat option list', () => {
		// Same serial, second row: only the RITC tells the two entries apart.
		const out = patchMap(
			dedupeAndNormalizePatches(
				[{ rowId: 'r2', columnId: 'drawback_schno', newValue: '9403B' }],
				rows(),
				columns
			)
		);
		expect(out['r2.dbk_rate']).toBe(9.9);
		expect(out['r2.dbk_desc']).toBe('Seats');
	});

	it('lets an explicit edit in the same batch outrank its own fill', () => {
		const out = patchMap(
			dedupeAndNormalizePatches(
				[
					{ rowId: 'r1', columnId: 'drawback_schno', newValue: '940301B' },
					{ rowId: 'r1', columnId: 'dbk_rate', newValue: 3.5 }
				],
				rows(),
				columns
			)
		);
		expect(out['r1.dbk_rate']).toBe(3.5);
		expect(out['r1.dbk_desc']).toBe('Predominantly of marble');
	});

	it('couples a pasted serial, not just one picked in the editor', () => {
		const out = patchMap(
			dedupeAndNormalizePatches(
				[
					{ rowId: 'r1', columnId: 'drawback_schno', newValue: '940301B' },
					{ rowId: 'r2', columnId: 'drawback_schno', newValue: '9403B' }
				],
				rows(),
				columns
			)
		);
		expect(out['r1.dbk_rate']).toBe(2.2);
		expect(out['r2.dbk_rate']).toBe(9.9);
	});

	it('writes an unknown serial without touching its siblings', () => {
		const out = patchMap(
			dedupeAndNormalizePatches(
				[{ rowId: 'r1', columnId: 'drawback_schno', newValue: '999999Z' }],
				rows(),
				columns
			)
		);
		expect(out['r1.drawback_schno']).toBe('999999Z');
		expect(out).not.toHaveProperty('r1.dbk_rate');
	});

	it('does not cascade: a filled cell fills nothing further', () => {
		// `dbk_desc` is itself a dropdown carrying a payload. Writing it as a fill must
		// not expand that payload, or two coupled columns could bounce forever.
		const descDropdown: Column = {
			...descCol,
			type: 'dropdown',
			dropdown: {
				options: [
					{ value: 'Predominantly of marble', fills: { dbk_rate: 77 } }
				],
				allowCustom: true
			}
		};
		const out = patchMap(
			dedupeAndNormalizePatches(
				[{ rowId: 'r1', columnId: 'drawback_schno', newValue: '940301B' }],
				rows(),
				[ritcCol, serialCol, rateCol, descDropdown]
			)
		);
		expect(out['r1.dbk_rate']).toBe(2.2);
	});

	it('survives a storage round-trip', () => {
		const restored = sanitizeAndNormalizeTableData('t', columns, rows());
		const parsed = PersistedTableDocumentV2Schema.safeParse({
			version: 2,
			title: restored.title,
			columns: restored.columns,
			rows: restored.rows
		});
		expect(parsed.success).toBe(true);
		const serial = restored.columns.find((c) => c.id === 'drawback_schno');
		expect(serial?.dropdown?.options[1].fills).toEqual({
			dbk_rate: 2.2,
			dbk_desc: 'Predominantly of marble',
			dbk_unit: 'PCS'
		});
	});

	it('drops a malformed payload instead of the option that carries it', () => {
		const config = sanitizeDropdownConfig(
			{
				options: [{ value: 'X', fills: { ok: 1, '': 2, bad: { nested: true } } }],
				allowCustom: true
			},
			{ id: 'c', type: 'dropdown' }
		);
		expect(config?.options[0].value).toBe('X');
		expect(config?.options[0].fills).toEqual({ ok: 1 });
	});
});

describe('dependent dropdowns do not borrow other rows values', () => {
	// Two headings in one sheet, the shape of a real ICEGrid import.
	const serialCol: Column = {
		id: 'drawback_schno',
		name: 'drawback_schno',
		type: 'dropdown',
		dropdown: {
			options: [
				{ value: '680201B', label: 'Granite/Marble Monuments', parentValue: '68022110' },
				{ value: '680299B', label: 'Others', parentValue: '68022110' },
				{ value: '761699B', label: 'Others', parentValue: '76169990' }
			],
			allowCustom: true,
			dependsOnColumnId: 'RITCCode'
		}
	};
	const columns: Column[] = [
		{ id: 'RITCCode', name: 'RITCCode', type: 'text' },
		serialCol
	];
	const rows: Row[] = [
		{ id: 'r1', RITCCode: '68022110', drawback_schno: '680299B' },
		{ id: 'r2', RITCCode: '76169990', drawback_schno: '761699B' }
	];

	it('offers only the serials its own tariff code carries', () => {
		const values = resolveDropdownOptions(serialCol, rows[0], rows).map((o) => o.value);
		expect(values).toEqual(['680201B', '680299B']);
		expect(values).not.toContain('761699B');
	});

	it('still offers a typed serial the catalog does not list', () => {
		const custom: Row[] = [{ id: 'r1', RITCCode: '68022110', drawback_schno: '999999Z' }];
		const values = resolveDropdownOptions(serialCol, custom[0], custom).map((o) => o.value);
		expect(values).toContain('999999Z');
	});

	it('leaves an independent custom column harvesting the whole grid', () => {
		const free: Column = {
			id: 'Notes',
			name: 'Notes',
			type: 'dropdown',
			dropdown: { options: [], allowCustom: true }
		};
		const noteRows: Row[] = [{ id: 'r1', Notes: 'alpha' }, { id: 'r2', Notes: 'beta' }];
		const values = resolveDropdownOptions(free, noteRows[0], noteRows).map((o) => o.value);
		expect(values).toEqual(['alpha', 'beta']);
	});
});

describe('a fill that references another column', () => {
	const unitCol: Column = { id: 'dbk_unit', name: 'dbk_unit', type: 'text' };
	const qtyUnitCol: Column = { id: 'QuantityUnit', name: 'QuantityUnit', type: 'text' };
	const serialCol: Column = {
		id: 'drawback_schno',
		name: 'drawback_schno',
		type: 'dropdown',
		dropdown: {
			options: [
				{ value: '680205B', fills: { dbk_unit: 'PCS' } },
				{ value: '680299B', fills: { dbk_unit: { from: 'QuantityUnit' } } }
			],
			allowCustom: true
		}
	};
	const columns = [qtyUnitCol, serialCol, unitCol];
	const rows = (): Row[] => [
		{ id: 'r1', QuantityUnit: 'KGS', drawback_schno: '680205B', dbk_unit: 'PCS' }
	];
	const unitAfter = (serial: string, start: Row[] = rows()) =>
		dedupeAndNormalizePatches(
			[{ rowId: 'r1', columnId: 'drawback_schno', newValue: serial }],
			start,
			columns
		).find((p) => p.columnId === 'dbk_unit')?.newValue;

	it('falls back to the invoiced unit rather than the previous serials', () => {
		expect(unitAfter('680299B')).toBe('KGS');
	});

	it('still takes a literal when the schedule prescribes one', () => {
		const start: Row[] = [{ id: 'r1', QuantityUnit: 'KGS', drawback_schno: '680299B', dbk_unit: 'KGS' }];
		expect(unitAfter('680205B', start)).toBe('PCS');
	});

	it('writes null when the referenced cell is empty', () => {
		const start: Row[] = [{ id: 'r1', QuantityUnit: null, drawback_schno: '680205B', dbk_unit: 'PCS' }];
		expect(unitAfter('680299B', start)).toBeNull();
	});

	it('survives a storage round-trip as a reference, not a literal', () => {
		const restored = sanitizeAndNormalizeTableData('t', columns, rows());
		const opts = restored.columns.find((c) => c.id === 'drawback_schno')?.dropdown?.options;
		expect(opts?.[1].fills?.dbk_unit).toEqual({ from: 'QuantityUnit' });
	});

	it('rejects a malformed reference instead of writing an object into a cell', () => {
		const config = sanitizeDropdownConfig(
			{ options: [{ value: 'X', fills: { a: { from: '' }, b: { from: 'Q', extra: 1 } } }], allowCustom: true },
			{ id: 'c', type: 'dropdown' }
		);
		expect(config?.options[0].fills).toBeUndefined();
	});
});

describe('a fill that only writes into a blank cell', () => {
	// The unit dropdown ICEGrid builds: every unit implies the two columns that copy
	// it, and nothing else. `fills` on the same option proves the two records are
	// applied independently.
	const unitCol: Column = {
		id: 'QuantityUnit',
		name: 'QuantityUnit',
		type: 'dropdown',
		dropdown: {
			options: [
				{ value: 'NOS', fills: { PerUnitNote: 'nos' }, fillsIfBlank: { PerUnit: 'NOS', dbk_unit: 'NOS' } },
				{ value: 'KGS', fillsIfBlank: { PerUnit: 'KGS', dbk_unit: 'KGS' } }
			],
			allowCustom: true
		}
	};
	const columns: Column[] = [
		unitCol,
		{ id: 'PerUnit', name: 'PerUnit', type: 'text' },
		{ id: 'dbk_unit', name: 'dbk_unit', type: 'text' },
		{ id: 'PerUnitNote', name: 'PerUnitNote', type: 'text' }
	];
	const apply = (rows: Row[], value: string) =>
		Object.fromEntries(
			dedupeAndNormalizePatches(
				[{ rowId: 'r1', columnId: 'QuantityUnit', newValue: value }],
				rows,
				columns
			).map((p) => [p.columnId, p.newValue])
		);

	it('fills dependents that import left empty', () => {
		const out = apply([{ id: 'r1', QuantityUnit: null, PerUnit: null, dbk_unit: null }], 'NOS');
		expect(out.PerUnit).toBe('NOS');
		expect(out.dbk_unit).toBe('NOS');
	});

	it('leaves a unit the document or the schedule already stated', () => {
		const out = apply([{ id: 'r1', QuantityUnit: null, PerUnit: null, dbk_unit: 'PCS' }], 'NOS');
		expect(out.PerUnit).toBe('NOS');
		expect(out).not.toHaveProperty('dbk_unit');
	});

	it('treats an empty string as blank, the way import does', () => {
		const out = apply([{ id: 'r1', QuantityUnit: null, PerUnit: '', dbk_unit: 'PCS' }], 'KGS');
		expect(out.PerUnit).toBe('KGS');
	});

	it('does not resurrect a dependent the user deliberately cleared, on re-picking the same unit', () => {
		// Changing the unit is the only trigger; a no-op re-pick is dropped upstream by
		// the identical-value check, so a blank stays blank until the unit itself moves.
		const out = apply([{ id: 'r1', QuantityUnit: 'NOS', PerUnit: null, dbk_unit: null }], 'NOS');
		expect(out).toEqual({ PerUnit: 'NOS', dbk_unit: 'NOS', PerUnitNote: 'nos' });
	});

	it('applies fills unconditionally alongside it', () => {
		const out = apply([{ id: 'r1', QuantityUnit: null, PerUnitNote: 'stale', dbk_unit: 'PCS' }], 'NOS');
		expect(out.PerUnitNote).toBe('nos');
	});

	it('survives a storage round-trip', () => {
		const restored = sanitizeAndNormalizeTableData('t', columns, [
			{ id: 'r1', QuantityUnit: null, PerUnit: null, dbk_unit: null }
		]);
		const opts = restored.columns.find((c) => c.id === 'QuantityUnit')?.dropdown?.options;
		expect(opts?.[0].fillsIfBlank).toEqual({ PerUnit: 'NOS', dbk_unit: 'NOS' });
		expect(opts?.[0].fills).toEqual({ PerUnitNote: 'nos' });
	});
});
