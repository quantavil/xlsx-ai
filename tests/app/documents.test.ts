import { describe, it, expect, beforeEach } from 'bun:test';
import { createDocumentStore, docContentKey, LS_DOCS_KEY } from '../../src/lib/table/documents.svelte';
import { createTableStore } from '../../src/lib/table/store.svelte';
import { LS_KEY } from '../../src/lib/constants';

describe('Workspace file index', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('creates a first file when the workspace is empty', () => {
		const docs = createDocumentStore();
		const id = docs.hydrate();
		expect(docs.documents.length).toBe(1);
		expect(docs.activeId).toBe(id);
		expect(docs.contentKey()).toBe(docContentKey(id));
	});

	it('adopts a pre-index single document as the first file instead of dropping it', () => {
		localStorage.setItem(
			LS_KEY,
			JSON.stringify({ version: 2, title: 'Old Work', columns: [], rows: [] })
		);
		const docs = createDocumentStore();
		const id = docs.hydrate();

		expect(docs.documents[0].title).toBe('Old Work');
		expect(localStorage.getItem(docContentKey(id))).toBeTruthy();
		expect(localStorage.getItem(LS_KEY)).toBeNull();
	});

	it('keeps each file in its own slot so switching never overwrites the other', () => {
		const docs = createDocumentStore();
		docs.hydrate();
		const store = createTableStore(undefined, { storageKey: () => docs.contentKey() });

		const first = docs.activeId;
		store.loadTable(
			{ title: 'Invoices', columns: [{ id: 'c1', name: 'A', type: 'text' }], rows: [{ id: 'r1', c1: 'one' }] },
			{ undoable: false }
		);
		store.flushSave();

		const second = docs.create('Second');
		store.loadTable(
			{ title: 'Second', columns: [{ id: 'c1', name: 'B', type: 'text' }], rows: [{ id: 'r1', c1: 'two' }] },
			{ undoable: false }
		);
		store.flushSave();

		docs.open(first);
		expect(store.hydrate().status).toBe('restored');
		expect(store.title).toBe('Invoices');
		expect(store.rows[0].c1).toBe('one');

		docs.open(second);
		expect(store.hydrate().status).toBe('restored');
		expect(store.rows[0].c1).toBe('two');
	});

	it('does not carry one file\'s undo history into another', () => {
		const docs = createDocumentStore();
		docs.hydrate();
		const store = createTableStore(undefined, { storageKey: () => docs.contentKey() });

		const first = docs.activeId!;
		store.loadTable(
			{ title: 'Invoices', columns: [{ id: 'c1', name: 'A', type: 'text' }], rows: [{ id: 'r1', c1: 'one' }] },
			{ undoable: false }
		);
		store.flushSave();

		const second = docs.create('Second');
		store.loadTable(
			{ title: 'Second', columns: [{ id: 'c1', name: 'B', type: 'text' }], rows: [{ id: 'r1', c1: 'two' }] },
			{ undoable: false }
		);
		store.flushSave();

		// Back to the first file and edit it, so it has something to undo. This is the
		// path `openFile` takes: a restored document never goes through `loadTable`.
		docs.open(first);
		expect(store.hydrate().status).toBe('restored');
		store.setCell('r1', 'c1', 'edited');
		store.flushSave();
		expect(store.canUndo).toBe(true);

		docs.open(second);
		expect(store.hydrate().status).toBe('restored');

		// Ctrl+Z here used to restore the *first* file's contents and autosave them over
		// this one, because hydrate left the previous file's history in place.
		expect(store.canUndo).toBe(false);
		store.undo();
		store.flushSave();
		expect(store.title).toBe('Second');
		expect(store.rows[0].c1).toBe('two');

		docs.open(first);
		store.hydrate();
		expect(store.rows[0].c1).toBe('edited');
	});

	it('deleting a file drops its stored rows and re-points the active file', () => {
		const docs = createDocumentStore();
		const first = docs.hydrate();
		const second = docs.create('Second');
		localStorage.setItem(docContentKey(second), '{"version":2,"title":"Second","columns":[],"rows":[]}');

		docs.remove(second);
		expect(localStorage.getItem(docContentKey(second))).toBeNull();
		expect(docs.documents.length).toBe(1);
		expect(docs.activeId).toBe(first);
	});

	it('restores the file list and active file across a reload', () => {
		const docs = createDocumentStore();
		docs.hydrate();
		const second = docs.create('Report');
		docs.touch('Report Q3');

		const reloaded = createDocumentStore();
		reloaded.hydrate();
		expect(reloaded.activeId).toBe(second);
		expect(reloaded.documents.find((d) => d.id === second)?.title).toBe('Report Q3');
		expect(JSON.parse(localStorage.getItem(LS_DOCS_KEY)!).docs.length).toBe(2);
	});

	it('leaves survivor stored body unchanged after debounced edit and deleteFile', async () => {
		const docs = createDocumentStore();
		const first = docs.hydrate();
		const store = createTableStore(undefined, { storageKey: () => docs.contentKey() });

		store.loadTable(
			{ title: 'Survivor', columns: [{ id: 'c1', name: 'A', type: 'text' }], rows: [{ id: 'r1', c1: 'survivor-data' }] },
			{ undoable: false }
		);
		store.flushSave();

		const second = docs.create('Victim');
		store.loadTable(
			{ title: 'Victim', columns: [{ id: 'c1', name: 'A', type: 'text' }], rows: [{ id: 'r1', c1: 'victim-data' }] },
			{ undoable: false }
		);
		store.flushSave();

		// Make a debounced edit on the second file
		store.setCell('r1', 'c1', 'victim-modified');
		// deleteFile pattern: flushSave then remove
		store.flushSave();
		docs.remove(second);

		// Survivor should still have its original content in localStorage
		const survivorRaw = localStorage.getItem(docContentKey(first));
		expect(survivorRaw).toBeTruthy();
		const parsed = JSON.parse(survivorRaw!);
		expect(parsed.title).toBe('Survivor');
		expect(parsed.rows[0].c1).toBe('survivor-data');
	});
});
