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
});
