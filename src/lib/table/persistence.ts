import type { TableData } from '$lib/types';
import type { PersistedTableDocumentV2 } from './schema';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function createLocalStorageAdapter(
	// A getter, so the active file can change without rebuilding the adapter.
	key: string | (() => string),
	options: {
		debounceMs?: number;
		onStatusChange?: (status: SaveStatus, error?: string | null) => void;
	} = {}
) {
	const debounceMs = options.debounceMs ?? 300;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let pendingDoc: PersistedTableDocumentV2 | null = null;

	function setStatus(next: SaveStatus, err: string | null = null) {
		options.onStatusChange?.(next, err);
	}

	const resolveKey = () => (typeof key === 'function' ? key() : key);

	function writeSync(doc: PersistedTableDocumentV2): boolean {
		if (typeof localStorage === 'undefined') return false;
		try {
			const serialized = JSON.stringify(doc);
			localStorage.setItem(resolveKey(), serialized);
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
				width: c.width,
				...(c.dropdown ? { dropdown: c.dropdown } : {})
			})),
			rows: data.rows,
			cellAlign: data.cellAlign,
			updatedAt: new Date().toISOString(),
			...(data.sourceText ? { sourceText: data.sourceText } : {})
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
		if (typeof localStorage === 'undefined') return null;
		try {
			return localStorage.getItem(resolveKey());
		} catch {
			return null;
		}
	}

	return { scheduleSave, flush, load };
}
