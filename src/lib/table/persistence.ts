import type { TableData } from '$lib/types';
import type { PersistedTableDocumentV2 } from './schema';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PersistenceAdapter {
	save(data: TableData): Promise<void>;
	load(): string | null;
	flush(): void;
	getStatus(): SaveStatus;
	getErrorMessage(): string | null;
}

export function createLocalStorageAdapter(
	key: string,
	options: {
		debounceMs?: number;
		onStatusChange?: (status: SaveStatus, error?: string | null) => void;
	} = {}
) {
	const debounceMs = options.debounceMs ?? 300;
	let status: SaveStatus = 'idle';
	let errorMessage: string | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let pendingDoc: PersistedTableDocumentV2 | null = null;

	function setStatus(next: SaveStatus, err: string | null = null) {
		status = next;
		errorMessage = err;
		options.onStatusChange?.(next, err);
	}

	function writeSync(doc: PersistedTableDocumentV2): boolean {
		if (typeof window === 'undefined' || !window.localStorage) return false;
		try {
			const serialized = JSON.stringify(doc);
			localStorage.setItem(key, serialized);
			setStatus('saved', null);
			pendingDoc = null;
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Storage quota exceeded or storage unavailable';
			setStatus('error', msg);
			return false;
		}
	}

	function scheduleSave(data: TableData) {
		const doc: PersistedTableDocumentV2 = {
			version: 2,
			title: data.title,
			columns: data.columns.map((c) => ({
				id: c.id,
				name: c.name,
				type: c.type,
				width: c.width
			})),
			rows: data.rows,
			updatedAt: new Date().toISOString()
		};

		pendingDoc = doc;
		setStatus('saving', null);

		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			timeoutId = null;
			if (pendingDoc) {
				writeSync(pendingDoc);
			}
		}, debounceMs);
	}

	function flush() {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		if (pendingDoc) {
			writeSync(pendingDoc);
		}
	}

	function load(): string | null {
		if (typeof window === 'undefined' || !window.localStorage) return null;
		try {
			return localStorage.getItem(key) || (key === 'xlsx-ai:v1' ? localStorage.getItem('table-ai:v1') : null);
		} catch {
			return null;
		}
	}

	return {
		scheduleSave,
		flush,
		load,
		getStatus: () => status,
		getErrorMessage: () => errorMessage
	};
}
