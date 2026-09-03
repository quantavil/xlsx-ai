import { describe, it, expect, beforeEach } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';


describe('Table Store (Svelte 5 Runes)', () => {
	const initialData: TableData = {
		title: 'Quarterly Revenue',
		columns: [
			{ id: 'c1', name: 'Product', type: 'text' },
			{ id: 'c2', name: 'Units', type: 'number' },
			{ id: 'c3', name: 'Price', type: 'currency' },
			{ id: 'c4', name: 'Margin', type: 'percent' },
			{ id: 'c5', name: 'Status', type: 'dropdown' },
			{ id: 'c6', name: 'Date', type: 'date' }
		],
		rows: [
			{ id: 'r1', c1: 'SaaS Core', c2: 100, c3: 50, c4: 0.8, c5: 'Active', c6: '2025-01-15' },
			{ id: 'r2', c1: 'Enterprise Addon', c2: 20, c3: 200, c4: 0.65, c5: 'Trial', c6: '2025-02-01' },
			{ id: 'r3', c1: 'Consulting', c2: 5, c3: 1500, c4: 0.4, c5: 'Pending', c6: '2025-03-10' }
		]
	};

	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(initialData, { persist: false });
	});

	it('initializes with given title, columns, and rows', () => {
		expect(store.title).toBe('Quarterly Revenue');
		expect(store.columns.length).toBe(6);
		expect(store.rows.length).toBe(3);
		expect(store.rowCount).toBe(3);
		expect(store.filteredCount).toBe(3);
	});

	it('updates cell value and creates history snapshot', () => {
		expect(store.canUndo).toBe(false);
		store.setCell('r1', 'c2', 150);
		expect(store.rows[0].c2).toBe(150);
		expect(store.canUndo).toBe(true);

		store.undo();
		expect(store.rows[0].c2).toBe(100);
		expect(store.canRedo).toBe(true);

		store.redo();
		expect(store.rows[0].c2).toBe(150);
	});

	it('does not record invalid or unchanged cell mutations', () => {
		const before = store.history.length;
		store.setCell('missing-row', 'c1', 'x');
		store.setCell('r1', 'missing-column', 'x');
		store.setCell('r1', 'c1', store.rows[0].c1);
		expect(store.history.length).toBe(before);
		expect(store.canUndo).toBe(false);
	});

	it('applies valid cell patches atomically and undoes them together', () => {
		const applied = store.applyCellPatches([
			{ rowId: 'r1', columnId: 'c1', newValue: 'Changed' },
			{ rowId: 'r2', columnId: 'c2', newValue: '42' },
			{ rowId: 'missing', columnId: 'c1', newValue: 'ignored' },
			{ rowId: 'r1', columnId: 'c1', newValue: 'Changed again' }
		]);

		expect(applied).toBe(2);
		expect(store.rows[0].c1).toBe('Changed again');
		expect(store.rows[1].c2).toBe(42);
		expect(store.history.length).toBe(1);

		store.undo();
		expect(store.rows[0].c1).toBe('SaaS Core');
		expect(store.rows[1].c2).toBe(20);
	});

	it('creates no history entry when every bulk patch is unchanged', () => {
		const applied = store.applyCellPatches([
			{ rowId: 'r1', columnId: 'c1', newValue: 'SaaS Core' },
			{ rowId: 'r2', columnId: 'c1', newValue: 'Enterprise Addon' }
		]);

		expect(applied).toBe(0);
		expect(store.history).toHaveLength(0);
		expect(store.canUndo).toBe(false);
	});

	it('preserves title during undo and redo', () => {
		store.setTitle('Updated Revenue');
		expect(store.title).toBe('Updated Revenue');
		expect(store.canUndo).toBe(true);

		store.undo();
		expect(store.title).toBe('Quarterly Revenue');

		store.redo();
		expect(store.title).toBe('Updated Revenue');
	});

	it('adds, duplicates, and deletes rows', () => {
		store.addRow();
		expect(store.rows.length).toBe(4);
		const newRowId = store.rows[3].id;
		expect(newRowId).toBeTruthy();

		store.duplicateRow('r2');
		expect(store.rows.length).toBe(5);
		expect(store.rows[2].c1).toBe('Enterprise Addon');

		store.deleteRow('r1');
		expect(store.rows.length).toBe(4);
		expect(store.rows.find((r) => r.id === 'r1')).toBeUndefined();
	});

	it('adds, renames, updates type, and deletes columns', () => {
		store.addColumn('Notes', 'text');
		expect(store.columns.length).toBe(7);
		const newCol = store.columns[6];
		expect(newCol.name).toBe('Notes');
		expect(newCol.type).toBe('text');

		store.renameColumn(newCol.id, 'Internal Notes');
		expect(store.columns[6].name).toBe('Internal Notes');

		store.updateColumnType(newCol.id, 'dropdown');
		expect(store.columns[6].type).toBe('dropdown');

		store.deleteColumn(newCol.id);
		expect(store.columns.length).toBe(6);
	});

	it('filters rows with search query across all cells', () => {
		store.setSearchQuery('enterprise');
		expect(store.filteredRows.length).toBe(1);
		expect(store.filteredRows[0].id).toBe('r2');

		store.setSearchQuery('2025-03');
		expect(store.filteredRows.length).toBe(1);
		expect(store.filteredRows[0].id).toBe('r3');

		store.setSearchQuery('non-existent');
		expect(store.filteredRows.length).toBe(0);

		store.setSearchQuery('');
		expect(store.filteredRows.length).toBe(3);
	});

	it('sorts columns ascending and descending placing nulls last', () => {
		store.setCell('r2', 'c2', null);

		// Sort Units (c2) asc
		store.setSort('c2'); // asc
		expect(store.sortConfig).toEqual({ columnId: 'c2', direction: 'asc' });
		expect(store.filteredRows[0].c2).toBe(5);
		expect(store.filteredRows[1].c2).toBe(100);
		expect(store.filteredRows[2].c2).toBeNull(); // null last

		// Sort Units (c2) desc
		store.setSort('c2'); // desc
		expect(store.sortConfig).toEqual({ columnId: 'c2', direction: 'desc' });
		expect(store.filteredRows[0].c2).toBe(100);
		expect(store.filteredRows[1].c2).toBe(5);
		expect(store.filteredRows[2].c2).toBeNull(); // null last
	});

	it('sorts date column chronologically', () => {
		store.setSort('c6'); // asc
		expect(store.filteredRows[0].c6).toBe('2025-01-15');
		expect(store.filteredRows[1].c6).toBe('2025-02-01');
		expect(store.filteredRows[2].c6).toBe('2025-03-10');

		store.setSort('c6'); // desc
		expect(store.filteredRows[0].c6).toBe('2025-03-10');
		expect(store.filteredRows[1].c6).toBe('2025-02-01');
		expect(store.filteredRows[2].c6).toBe('2025-01-15');
	});

	it('calculates column summaries using plain JS reduce math', () => {
		const summaries = store.columnSummaries;

		// Text column c1
		expect(summaries['c1'].count).toBe(3);
		expect(summaries['c1'].countNonEmpty).toBe(3);
		expect(summaries['c1'].sum).toBeUndefined();

		// Number column c2: 100, 20, 5
		expect(summaries['c2'].count).toBe(3);
		expect(summaries['c2'].countNonEmpty).toBe(3);
		expect(summaries['c2'].sum).toBe(125);
		expect(summaries['c2'].avg).toBeCloseTo(41.67, 1);
		expect(summaries['c2'].min).toBe(5);
		expect(summaries['c2'].max).toBe(100);

		// Currency column c3: 50, 200, 1500
		expect(summaries['c3'].sum).toBe(1750);
		expect(summaries['c3'].min).toBe(50);
		expect(summaries['c3'].max).toBe(1500);

		// Percent column c4: 0.8, 0.65, 0.4
		expect(summaries['c4'].sum).toBeCloseTo(1.85, 2);
		expect(summaries['c4'].avg).toBeCloseTo(0.6167, 2);
	});

	it('caps history stack at 30 snapshots', () => {
		for (let i = 0; i < 40; i++) {
			store.setCell('r1', 'c2', i);
		}
		expect(store.history.length).toBeLessThanOrEqual(30);
	});

	it('manages API key and model selection state and provides toggleAi', () => {
		expect(store.apiKey).toBe('');
		store.addApiKey('AIzaSyTestKey12345');
		expect(store.apiKey).toBe('AIzaSyTestKey12345');

		store.removeApiKey(0);
		expect(store.apiKey).toBe('');

		expect(store.aiModel).toBe('gemini-3.5-flash-lite');
		store.setAiModel('gemini-3.6-flash');
		expect(store.aiModel).toBe('gemini-3.6-flash');

		expect(store.isAiOpen).toBe(false);
		store.toggleAi(true);
		expect(store.isAiOpen).toBe(true);
		store.toggleAi();
		expect(store.isAiOpen).toBe(false);
	});

	it('updates column width cleanly with minimum boundary', () => {
		store.updateColumnWidth('c1', 250);
		expect(store.columns[0].width).toBe(250);

		// Clamps to min 60
		store.updateColumnWidth('c1', 20);
		expect(store.columns[0].width).toBe(60);
	});

	it('persists and restores a zero-row table without discarding it', () => {
		const emptyStore = createTableStore(
			{
				title: 'Empty Header Table',
				columns: [
					{ id: 'c1', name: 'Task', type: 'text' },
					{ id: 'c2', name: 'Status', type: 'dropdown' }
				],
				rows: []
			},
			{ persist: false }
		);

		expect(emptyStore.columns.length).toBe(2);
		expect(emptyStore.rows.length).toBe(0);
		expect(emptyStore.rowCount).toBe(0);
	});

	it('reports a failed save instead of dropping edits silently', () => {
		const errors: string[] = [];
		const originalSetItem = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('QuotaExceededError');
		};
		try {
			const persisted = createTableStore(initialData, {
				storageKey: 'test:quota',
				onSaveError: (m) => errors.push(m)
			});
			persisted.setCell('r1', 'c1', 'Too Big');
			persisted.flushSave();
		} finally {
			localStorage.setItem = originalSetItem;
		}
		expect(errors.length).toBe(1);
		expect(errors[0]).toContain('QuotaExceededError');
	});

	it('does not let history snapshots share a column dropdown config with live state', () => {
		const dropdownStore = createTableStore(
			{
				title: 'Dropdowns',
				columns: [
					{
						id: 'c1',
						name: 'State',
						type: 'dropdown',
						dropdown: { options: [{ value: 'RJ' }], allowCustom: false }
					}
				],
				rows: [{ id: 'r1', c1: 'RJ' }]
			},
			{ persist: false }
		);
		dropdownStore.setCell('r1', 'c1', 'GJ');
		// Mutating live config must not reach back into the snapshot undo will restore.
		dropdownStore.columns[0].dropdown!.options.push({ value: 'MH' });
		dropdownStore.undo();
		expect(dropdownStore.columns[0].dropdown!.options.length).toBe(1);
	});

	it('converts column type atomically and supports undo', () => {
		// Convert c2 (Units - numbers: 100, 20, 5) to currency
		store.updateColumnType('c2', 'currency');
		expect(store.columns[1].type).toBe('currency');
		expect(store.canUndo).toBe(true);

		store.undo();
		expect(store.columns[1].type).toBe('number');
	});

	it('does not record history for no-op column operations', () => {
		const before = store.history.length;
		store.renameColumn('c1', 'Product'); // same name
		store.renameColumn('nonexistent', 'Anything'); // missing
		store.updateColumnType('c1', 'text'); // same type
		store.deleteColumn('nonexistent'); // missing
		store.deleteRow('nonexistent'); // missing
		expect(store.history.length).toBe(before);
	});
});


describe('Document replacement is recoverable', () => {
	const doc: TableData = {
		title: 'Working Doc',
		columns: [{ id: 'c1', name: 'Name', type: 'text' }],
		rows: [{ id: 'r1', c1: 'keep me' }]
	};

	it('makes loadTable undoable so a sample/import never silently destroys work', () => {
		const store = createTableStore(doc, { persist: false });
		store.loadTable({ title: 'Other', columns: [{ id: 'x', name: 'X', type: 'text' }], rows: [] });
		expect(store.title).toBe('Other');
		expect(store.canUndo).toBe(true);

		store.undo();
		expect(store.title).toBe('Working Doc');
		expect(store.rows[0].c1).toBe('keep me');
	});

	it('newSheet produces an editable blank grid and is undoable', () => {
		const store = createTableStore(doc, { persist: false });
		store.newSheet();
		expect(store.title).toBe('Untitled Table');
		expect(store.columns.length).toBe(5);
		expect(store.columns[0].name).toBe('A');
		expect(store.rows.length).toBe(20);
		expect(store.rows.every((r) => r.c1 === null)).toBe(true);

		store.undo();
		expect(store.title).toBe('Working Doc');
	});

	it('does not push history when replacing an empty document', () => {
		const store = createTableStore(undefined, { persist: false });
		store.loadTable(doc);
		expect(store.canUndo).toBe(false);
	});
});

describe('API key ring', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore({ title: 'T', columns: [], rows: [] }, { persist: false });
		store.addApiKey('AIzaSyKeyOne');
		store.addApiKey('AIzaSyKeyTwo');
		store.addApiKey('AIzaSyKeyThree');
	});

	it('makes each newly added key the active one', () => {
		expect(store.apiKeys).toEqual(['AIzaSyKeyOne', 'AIzaSyKeyTwo', 'AIzaSyKeyThree']);
		expect(store.apiKey).toBe('AIzaSyKeyThree');
	});

	it('re-adding a stored key selects it instead of duplicating it', () => {
		store.addApiKey('  AIzaSyKeyOne  ');
		expect(store.apiKeys.length).toBe(3);
		expect(store.apiKey).toBe('AIzaSyKeyOne');
	});

	it('ignores a blank key', () => {
		store.addApiKey('   ');
		expect(store.apiKeys.length).toBe(3);
	});

	it('switches to the key at an index', () => {
		store.useApiKey(0);
		expect(store.apiKey).toBe('AIzaSyKeyOne');
		store.useApiKey(9);
		expect(store.apiKey).toBe('AIzaSyKeyOne');
	});

	it('keeps the active key active when an earlier one is removed', () => {
		store.useApiKey(2);
		store.removeApiKey(0);
		expect(store.apiKey).toBe('AIzaSyKeyThree');
	});

	it('falls back to a neighbour when the active key is the one removed', () => {
		store.useApiKey(2);
		store.removeApiKey(2);
		expect(store.apiKeys).toEqual(['AIzaSyKeyOne', 'AIzaSyKeyTwo']);
		expect(store.apiKey).toBe('AIzaSyKeyTwo');
	});

	it('reports no key once the last one is removed', () => {
		store.removeApiKey(2);
		store.removeApiKey(1);
		store.removeApiKey(0);
		expect(store.apiKeys).toEqual([]);
		expect(store.apiKey).toBe('');
	});
});

describe('model migration on hydrate', () => {
	it('moves a workspace off a model id this app shipped but Google never served', () => {
		localStorage.setItem('xlsx-ai:gemini-model', 'gemini-3.7-flash-lite');
		const store = createTableStore({ title: 'T', columns: [], rows: [] }, { storageKey: 'test:retired' });
		store.hydrate();
		expect(store.aiModel).toBe('gemini-3.5-flash-lite');
	});

	it('keeps a model id that is still real', () => {
		localStorage.setItem('xlsx-ai:gemini-model', 'gemini-3.6-flash');
		const store = createTableStore({ title: 'T', columns: [], rows: [] }, { storageKey: 'test:kept' });
		store.hydrate();
		expect(store.aiModel).toBe('gemini-3.6-flash');
	});
});

describe('favourite models', () => {
	it('toggles a model id in and out of the favourites list', () => {
		const store = createTableStore({ title: 'T', columns: [], rows: [] }, { persist: false });
		expect(store.favoriteModels).toEqual([]);

		store.toggleFavoriteModel('gemini-3.6-flash');
		store.toggleFavoriteModel('gemini-3.1-pro-preview');
		expect(store.favoriteModels).toEqual(['gemini-3.6-flash', 'gemini-3.1-pro-preview']);

		store.toggleFavoriteModel('gemini-3.6-flash');
		expect(store.favoriteModels).toEqual(['gemini-3.1-pro-preview']);
	});
});

describe('AI provider profiles', () => {
	it('keeps credentials, models, and favourites isolated by provider', () => {
		const store = createTableStore({ title: 'T', columns: [], rows: [] }, { persist: false });
		store.addApiKey('AIzaSyGeminiKey1234567890');
		store.setAiModel('gemini-3.6-flash');
		store.toggleFavoriteModel('gemini-3.6-flash');

		store.setAiProvider('openrouter');
		expect(store.aiProvider).toBe('openrouter');
		expect(store.apiKey).toBe('');
		expect(store.aiModel).toBe('');
		expect(store.favoriteModels).toEqual([]);

		store.addApiKey('sk-or-v1-openrouter-test-key');
		store.setAiModel('anthropic/claude-sonnet-4');
		store.toggleFavoriteModel('anthropic/claude-sonnet-4');
		store.setAiProvider('gemini');

		expect(store.apiKey).toBe('AIzaSyGeminiKey1234567890');
		expect(store.aiModel).toBe('gemini-3.6-flash');
		expect(store.favoriteModels).toEqual(['gemini-3.6-flash']);
	});

	it('migrates legacy Gemini settings into the Gemini profile', () => {
		localStorage.removeItem('xlsx-ai:ai-settings:v1');
		localStorage.setItem(
			'xlsx-ai:gemini-keys',
			JSON.stringify({ keys: ['AIzaSyLegacyKey'], active: 0 })
		);
		localStorage.setItem('xlsx-ai:gemini-model', 'gemini-3.6-flash');
		localStorage.setItem('xlsx-ai:gemini-favorites', JSON.stringify(['gemini-3.6-flash']));

		const store = createTableStore(
			{ title: 'T', columns: [], rows: [] },
			{ storageKey: 'test:provider-migration' }
		);
		store.hydrate();

		expect(store.aiProvider).toBe('gemini');
		expect(store.apiKeys).toEqual(['AIzaSyLegacyKey']);
		expect(store.aiModel).toBe('gemini-3.6-flash');
		expect(store.favoriteModels).toEqual(['gemini-3.6-flash']);
	});

	it('does not let a migrated legacy model override a later selection', () => {
		localStorage.removeItem('xlsx-ai:ai-settings:v1');
		localStorage.setItem('xlsx-ai:gemini-model', 'gemini-3.6-flash');
		const first = createTableStore(
			{ title: 'T', columns: [], rows: [] },
			{ storageKey: 'test:provider-remigration' }
		);
		first.hydrate();
		first.setAiModel('gemini-3.1-pro-preview');

		const reloaded = createTableStore(
			{ title: 'T', columns: [], rows: [] },
			{ storageKey: 'test:provider-remigration' }
		);
		reloaded.hydrate();

		expect(reloaded.aiModel).toBe('gemini-3.1-pro-preview');
	});

	it('initializes, persists, and hydrates sourceText on the table store', () => {
		const storeWithSource = createTableStore(
			{
				title: 'Invoice Grid',
				columns: [{ id: 'c1', name: 'Item', type: 'text' }],
				rows: [{ id: 'r1', c1: 'Book' }],
				sourceText: '=== FILE: invoice.pdf ===\nShipper: Example Corp\nContainer: CONT-123'
			},
			{ storageKey: 'test:source-text' }
		);

		expect(storeWithSource.sourceText).toBe(
			'=== FILE: invoice.pdf ===\nShipper: Example Corp\nContainer: CONT-123'
		);

		storeWithSource.setCell('r1', 'c1', 'Updated Book');
		storeWithSource.flushSave();

		const restoredStore = createTableStore(
			{ title: 'T', columns: [], rows: [] },
			{ storageKey: 'test:source-text' }
		);
		restoredStore.hydrate();

		expect(restoredStore.sourceText).toBe(
			'=== FILE: invoice.pdf ===\nShipper: Example Corp\nContainer: CONT-123'
		);
	});
});
