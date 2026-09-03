import { createTableStore } from '$lib/table/store.svelte';
import { createFindStore } from '$lib/table/find.svelte';
import { createDocumentStore } from '$lib/table/documents.svelte';
import { createModuleStore } from '$lib/modules/module-store.svelte';
import { createToastStore, type NotifyFn } from '$lib/ui/toast.svelte';
import { LS_THEME_KEY, DEFAULT_TABLE_TITLE } from '$lib/constants';
import type { TableData } from '$lib/types';

// One workspace shared by every route. The table lives above the router so navigating to
// /settings (and back) never rebuilds or drops the open file.
export const documents = createDocumentStore();
export const store = createTableStore(undefined, {
	storageKey: () => documents.contentKey(),
	// A failed write means edits are only in memory — the user has to hear about it.
	onSaveError: (message) => notify('error', `Could not save: ${message}`, { durationMs: 8000 })
});
export const findStore = createFindStore(store);
export const moduleStore = createModuleStore();
export const toastStore = createToastStore();

import { saveSourceFiles } from '$lib/table/source-files';

export type ActiveDrawer = 'ai' | 'find' | 'source' | null;

let isSourceViewerOpen = $state(false);

export function getActiveDrawer(): ActiveDrawer {
	if (store.isAiOpen) return 'ai';
	if (findStore.isOpen) return 'find';
	if (isSourceViewerOpen) return 'source';
	return null;
}

export function isSourceOpen(): boolean {
	return isSourceViewerOpen;
}

export function openAiDrawer() {
	findStore.close();
	isSourceViewerOpen = false;
	store.toggleAi(true);
}

export function openFindDrawer(initialQuery?: string) {
	store.toggleAi(false);
	isSourceViewerOpen = false;
	findStore.open(initialQuery);
}

export function openSourceDrawer() {
	store.toggleAi(false);
	findStore.close();
	isSourceViewerOpen = true;
}

export function closeDrawers() {
	store.toggleAi(false);
	findStore.close();
	isSourceViewerOpen = false;
}

export function toggleDrawer(drawer: 'ai' | 'find' | 'source') {
	if (drawer === 'ai') {
		if (store.isAiOpen) {
			store.toggleAi(false);
		} else {
			openAiDrawer();
		}
	} else if (drawer === 'find') {
		if (findStore.isOpen) {
			findStore.close();
		} else {
			openFindDrawer();
		}
	} else if (drawer === 'source') {
		if (isSourceViewerOpen) {
			isSourceViewerOpen = false;
		} else {
			openSourceDrawer();
		}
	}
}

export const notify: NotifyFn = (type, message, options = {}) => {
	toastStore.notify(type, message, options);
};

let theme = $state<'dark' | 'light'>('dark');
let bootstrapped = false;

export function getTheme(): 'dark' | 'light' {
	return theme;
}

function applyTheme(next: 'dark' | 'light') {
	theme = next;
	document.documentElement.setAttribute('data-theme', next);
	try {
		localStorage.setItem(LS_THEME_KEY, next);
	} catch {
		// Private-mode storage failures must not break the toggle.
	}
}

export function toggleTheme() {
	applyTheme(theme === 'dark' ? 'light' : 'dark');
}

/** Creates a file, makes it active, and writes `data` into it. */
export function createFile(data: TableData, files?: File[]) {
	store.flushSave();
	const docId = documents.create(data.title || DEFAULT_TABLE_TITLE);
	store.loadTable(data, { undoable: false });
	if (files && files.length > 0) {
		saveSourceFiles(docId, files).then((saved) => {
			if (saved) {
				documents.attachSourceFiles(docId, files.map((f) => f.name));
			}
		});
	}
}

export function newBlankFile() {
	store.flushSave();
	documents.create(DEFAULT_TABLE_TITLE);
	store.newSheet({ undoable: false });
}

export function openFile(id: string) {
	if (id === documents.activeId) return;
	store.flushSave();
	documents.open(id);
	if (store.hydrate().status !== 'restored') {
		store.loadTable({ title: DEFAULT_TABLE_TITLE, columns: [], rows: [] }, { undoable: false });
	}
}

export function deleteFile(id: string) {
	store.flushSave();
	const wasActive = id === documents.activeId;
	documents.remove(id);
	if (!wasActive) return;

	// Never leave the workspace with nothing open.
	if (documents.activeId) {
		if (store.hydrate().status !== 'restored') {
			store.loadTable({ title: DEFAULT_TABLE_TITLE, columns: [], rows: [] }, { undoable: false });
		}
	} else {
		documents.create(DEFAULT_TABLE_TITLE);
		store.newSheet({ undoable: false });
	}
}

/** Idempotent first-load hydration; safe to call from every route's onMount. */
export function bootstrapWorkspace() {
	if (bootstrapped) return;
	bootstrapped = true;

	const saved = localStorage.getItem(LS_THEME_KEY);
	theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
	document.documentElement.setAttribute('data-theme', theme);

	documents.hydrate();
	if (store.hydrate().status !== 'restored') {
		store.newSheet({ undoable: false });
	}
}
