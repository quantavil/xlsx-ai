import { describe, it, expect } from 'bun:test';
import 'fake-indexeddb/auto';
import { saveSourceFiles, loadSourceFiles, deleteSourceFiles } from '../../src/lib/table/source-files';

describe('source-files IndexedDB storage', () => {
	it('safely handles empty arguments', async () => {
		expect(await saveSourceFiles('', [])).toBe(true);
		expect(await loadSourceFiles('')).toEqual([]);
		await expect(deleteSourceFiles('')).resolves.toBeUndefined();
	});

	it('persists and retrieves source files for a document', async () => {
		const docId = 'doc-1';
		const fileA = new File(['invoice content A'], 'invoice.pdf', { type: 'application/pdf' });
		const fileB = new File(['packing list B'], 'packing.pdf', { type: 'application/pdf' });

		const saved = await saveSourceFiles(docId, [fileA, fileB]);
		expect(saved).toBe(true);

		const loaded = await loadSourceFiles(docId);
		expect(loaded.length).toBe(2);
		expect(loaded[0].name).toBe('invoice.pdf');
		expect(loaded[1].name).toBe('packing.pdf');
		expect(await loaded[0].blob.text()).toBe('invoice content A');
		expect(await loaded[1].blob.text()).toBe('packing list B');
	});

	it('prevents collision when multiple attached files share the same filename', async () => {
		const docId = 'doc-collision';
		const file1 = new File(['first version'], 'attachment.pdf', { type: 'application/pdf' });
		const file2 = new File(['second version'], 'attachment.pdf', { type: 'application/pdf' });

		const saved = await saveSourceFiles(docId, [file1, file2]);
		expect(saved).toBe(true);

		const loaded = await loadSourceFiles(docId);
		expect(loaded.length).toBe(2);
		expect(await loaded[0].blob.text()).toBe('first version');
		expect(await loaded[1].blob.text()).toBe('second version');
	});

	it('isolates files across different documents and purges correctly on delete', async () => {
		const docA = 'doc-a';
		const docB = 'doc-b';

		const fileA = new File(['doc a content'], 'doc_a.pdf', { type: 'application/pdf' });
		const fileB = new File(['doc b content'], 'doc_b.pdf', { type: 'application/pdf' });

		await saveSourceFiles(docA, [fileA]);
		await saveSourceFiles(docB, [fileB]);

		expect((await loadSourceFiles(docA)).length).toBe(1);
		expect((await loadSourceFiles(docB)).length).toBe(1);

		// Delete docA
		await deleteSourceFiles(docA);
		expect(await loadSourceFiles(docA)).toEqual([]);

		// docB should remain completely unaffected
		const bFiles = await loadSourceFiles(docB);
		expect(bFiles.length).toBe(1);
		expect(bFiles[0].name).toBe('doc_b.pdf');
	});
});
