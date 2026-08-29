import { createTableStore } from '$lib/table/store.svelte';
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
export const moduleStore = createModuleStore();
export const toastStore = createToastStore();

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
export function createFile(data: TableData) {
	store.flushSave();
	documents.create(data.title || DEFAULT_TABLE_TITLE);
	store.loadTable(data, { undoable: false });
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
