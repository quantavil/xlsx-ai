import { LS_KEY } from '$lib/constants';

export interface DocumentMeta {
	id: string;
	title: string;
	updatedAt: string;
}

export const LS_DOCS_KEY = 'xlsx-ai:docs:v1';

/** Each file's rows live under their own key so switching files never rewrites the others. */
export function docContentKey(id: string): string {
	return `xlsx-ai:doc:${id}`;
}

function newId(): string {
	return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function readIndex(): { docs: DocumentMeta[]; activeId: string } | null {
	try {
		const raw = localStorage.getItem(LS_DOCS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { docs?: unknown; activeId?: unknown };
		if (!Array.isArray(parsed.docs)) return null;
		const docs = parsed.docs.filter(
			(d): d is DocumentMeta =>
				!!d && typeof d === 'object' && typeof (d as DocumentMeta).id === 'string'
		);
		if (docs.length === 0) return null;
		const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : docs[0].id;
		return { docs, activeId: docs.some((d) => d.id === activeId) ? activeId : docs[0].id };
	} catch {
		return null;
	}
}

export function createDocumentStore() {
	let docs = $state<DocumentMeta[]>([]);
	let activeId = $state<string>('');

	function persist() {
		try {
			localStorage.setItem(LS_DOCS_KEY, JSON.stringify({ docs: $state.snapshot(docs), activeId }));
		} catch {
			// Quota/private-mode failures must not break navigation between files.
		}
	}

	/**
	 * Returns the id of the file to open, creating one if the workspace is empty.
	 * The pre-v1 single-document key is adopted as the first file rather than discarded.
	 */
	function hydrate(): string {
		const saved = readIndex();
		if (saved) {
			docs = saved.docs;
			activeId = saved.activeId;
			return activeId;
		}

		const id = newId();
		let title = 'Untitled Table';
		try {
			const legacy = localStorage.getItem(LS_KEY);
			if (legacy) {
				localStorage.setItem(docContentKey(id), legacy);
				localStorage.removeItem(LS_KEY);
				title = (JSON.parse(legacy) as { title?: string }).title || title;
			}
		} catch {
			// A corrupt legacy blob just means we start with a clean blank file.
		}

		docs = [{ id, title, updatedAt: new Date().toISOString() }];
		activeId = id;
		persist();
		return id;
	}

	/** Registers a new file and makes it active. The caller then writes its content. */
	function create(title: string): string {
		const id = newId();
		docs = [{ id, title, updatedAt: new Date().toISOString() }, ...docs];
		activeId = id;
		persist();
		return id;
	}

	function open(id: string) {
		if (!docs.some((d) => d.id === id) || id === activeId) return;
		activeId = id;
		persist();
	}

	function remove(id: string) {
		try {
			localStorage.removeItem(docContentKey(id));
		} catch {
			// Nothing to do — the index entry is the thing that matters.
		}
		docs = docs.filter((d) => d.id !== id);
		if (docs.length === 0) {
			activeId = '';
		} else if (activeId === id) {
			activeId = docs[0].id;
		}
		persist();
	}

	/** Keeps the Files menu label in step with the header's inline title editing. */
	function touch(title: string) {
		const meta = docs.find((d) => d.id === activeId);
		if (!meta) return;
		if (meta.title === title) return;
		meta.title = title;
		meta.updatedAt = new Date().toISOString();
		persist();
	}

	return {
		get documents() {
			return docs;
		},
		get activeId() {
			return activeId;
		},
		get activeMeta() {
			return docs.find((d) => d.id === activeId);
		},
		contentKey: () => docContentKey(activeId),
		hydrate,
		create,
		open,
		remove,
		touch
	};
}
