/**
 * IndexedDB storage for original source files (PDFs, spreadsheets) attached to a table document.
 * Storing binary Blobs in IndexedDB keeps localStorage quota free and prevents in-memory RAM bloat.
 */

export interface StoredSourceFile {
	id: string; // `${docId}:${name}`
	docId: string;
	name: string;
	type: string;
	size: number;
	blob: Blob;
	uploadedAt: string;
}

const DB_NAME = 'xlsx-ai-files';
const DB_VERSION = 1;
const STORE_NAME = 'source_files';

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is not supported in this environment'));
			return;
		}

		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('docId', 'docId', { unique: false });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
	});
}

/**
 * Persists one or more files attached to a document.
 */
export async function saveSourceFiles(docId: string, files: File[]): Promise<boolean> {
	if (!docId || files.length === 0) return true;

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);

			transaction.oncomplete = () => {
				db.close();
				resolve(true);
			};
			transaction.onerror = () => {
				db.close();
				resolve(false);
			};

			const now = new Date().toISOString();
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const record: StoredSourceFile = {
					id: `${docId}:${i}:${file.name}`,
					docId,
					name: file.name,
					type: file.type || 'application/octet-stream',
					size: file.size,
					blob: file,
					uploadedAt: now
				};
				store.put(record);
			}
		});
	} catch {
		return false;
	}
}

/**
 * Loads all attached source files for a given document.
 */
export async function loadSourceFiles(docId: string): Promise<StoredSourceFile[]> {
	if (!docId) return [];

	try {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index('docId');
			const request = index.getAll(docId);

			request.onsuccess = () => {
				db.close();
				resolve(request.result || []);
			};
			request.onerror = () => {
				db.close();
				reject(request.error || new Error('Failed to load source files'));
			};
		});
	} catch {
		return [];
	}
}

/**
 * Purges all attached source files when a document is deleted.
 */
export async function deleteSourceFiles(docId: string): Promise<void> {
	if (!docId) return;

	try {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index('docId');
			const request = index.openKeyCursor(IDBKeyRange.only(docId));

			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor) {
					store.delete(cursor.primaryKey);
					cursor.continue();
				}
			};

			transaction.oncomplete = () => {
				db.close();
				resolve();
			};
			transaction.onerror = () => {
				db.close();
				reject(transaction.error || new Error('Failed to delete files'));
			};
		});
	} catch {
		// Ignore deletion errors on missing/private databases
	}
}
