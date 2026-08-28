<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import DataTable from '$lib/table/DataTable.svelte';
	import AiDrawer from '$lib/components/AiDrawer.svelte';
	import RightRibbon from '$lib/components/RightRibbon.svelte';
	import { importFileToTable } from '$lib/data/index';
	import {
		store,
		documents,
		moduleStore,
		notify,
		getTheme,
		toggleTheme,
		createFile,
		newBlankFile,
		openFile,
		deleteFile
	} from '$lib/workspace.svelte';

	let headerRef = $state<{ focusSearch: () => void } | null>(null);
	let importInputRef = $state<HTMLInputElement | null>(null);

	// Inline title editing is the rename UI, so the Files list has to follow it.
	$effect(() => {
		documents.touch(store.title);
	});

	async function handleImportFile(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		try {
			const imported = await importFileToTable(file);
			createFile(imported);
			notify(
				'success',
				`Imported "${file.name}" (${imported.rows.length} rows, ${imported.columns.length} columns).`
			);
		} catch (err: unknown) {
			notify('error', err instanceof Error ? err.message : 'Failed to import file.');
		} finally {
			target.value = '';
		}
	}

	function openSettings() {
		goto('/settings');
	}

	onMount(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			const isCmdOrCtrl = e.metaKey || e.ctrlKey;
			if (!isCmdOrCtrl) return;

			const target = e.target as HTMLElement | null;
			const isInputFocused =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement;

			if (e.key === 'k' || e.key === 'K') {
				e.preventDefault();
				headerRef?.focusSearch();
				return;
			}
			if (e.key === '/' || e.key === '?') {
				e.preventDefault();
				store.toggleAi();
				return;
			}
			if (e.key === ',' || e.key === '<') {
				e.preventDefault();
				openSettings();
				return;
			}
			// Never hijack native undo/redo/new while the user is typing in a field.
			if (isInputFocused) return;

			// Excel's alignment shortcuts, applied to whatever the grid has selected.
			if (e.shiftKey && store.activeCell) {
				const align = { l: 'left', e: 'center', r: 'right' }[e.key.toLowerCase()];
				if (align) {
					e.preventDefault();
					store.alignSelection(align as 'left' | 'center' | 'right');
					return;
				}
			}


			if (e.key === 'n' || e.key === 'N') {
				e.preventDefault();
				store.addRow();
			} else if (e.key === 'z' || e.key === 'Z') {
				e.preventDefault();
				if (e.shiftKey) {
					if (store.canRedo) store.redo();
				} else if (store.canUndo) {
					store.undo();
				}
			} else if (e.key === 'y' || e.key === 'Y') {
				e.preventDefault();
				if (store.canRedo) store.redo();
			}
		}

		window.addEventListener('keydown', handleGlobalKeyDown);
		return () => window.removeEventListener('keydown', handleGlobalKeyDown);
	});
</script>

<div class="workspace-layout flex flex-col w-screen h-screen bg-[var(--bg)] overflow-hidden relative">
	<input
		type="file"
		bind:this={importInputRef}
		accept=".xlsx, .xls, .csv, .tsv"
		style="display: none;"
		onchange={handleImportFile}
	/>

	<Header
		bind:this={headerRef}
		{store}
		{documents}
		onOpenFile={openFile}
		onNewFile={newBlankFile}
		onImportFile={() => importInputRef?.click()}
		onDeleteFile={deleteFile}
	/>

	<div class="workspace-body flex-1 flex overflow-hidden relative w-full min-h-0 max-sm:pb-[54px]">
		<main class="table-main-area flex-1 min-w-0 flex overflow-hidden relative">
			<DataTable {store} onNotify={notify} />
		</main>

		<AiDrawer {store} onOpenSettings={openSettings} onNotify={notify} />

		<RightRibbon
			{store}
			{moduleStore}
			theme={getTheme()}
			onToggleTheme={toggleTheme}
			onOpenSettings={openSettings}
			onNotify={notify}
			onCreateFile={createFile}
		/>
	</div>
</div>
