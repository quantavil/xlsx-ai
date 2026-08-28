<script lang="ts">
	import { onMount } from 'svelte';
	import { createTableStore } from '$lib/table/store.svelte';
	import { sampleTables } from '$lib/data/index';
	import { LS_THEME_KEY } from '$lib/constants';
	import Header from '$lib/components/Header.svelte';
	import DataTable from '$lib/table/DataTable.svelte';
	import AiDrawer from '$lib/components/AiDrawer.svelte';
	import RightRibbon from '$lib/components/RightRibbon.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';

	import ToastHost from '$lib/ui/ToastHost.svelte';
	import { createToastStore, type ToastType } from '$lib/ui/toast.svelte';

	// Create reactive Table store with default SaaS sample
	const store = createTableStore(sampleTables.saas);
	const toastStore = createToastStore();

	let headerRef = $state<{ focusSearch: () => void } | null>(null);
	let theme = $state<'dark' | 'light'>('dark');
	let showSettingsModal = $state<boolean>(false);

	function notify(
		type: ToastType,
		message: string,
		options: { action?: { label: string; onClick: () => void } } = {}
	) {
		toastStore.notify(type, message, options);
	}

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme);
		}
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(LS_THEME_KEY, theme);
		}
	}

	onMount(() => {
		// Hydrate theme
		if (typeof localStorage !== 'undefined') {
			const savedTheme = (localStorage.getItem(LS_THEME_KEY) || localStorage.getItem('table-ai:theme') || document.documentElement.getAttribute('data-theme') || 'dark') as 'dark' | 'light';
			if (savedTheme === 'dark' || savedTheme === 'light') {
				theme = savedTheme;
				document.documentElement.setAttribute('data-theme', theme);
			}
		}

		// Hydrate table state
		const hydrationResult = store.hydrate();

		// Seed SaaS sample only when no persisted document was found
		if (hydrationResult.status === 'missing') {
			store.loadTable(sampleTables.saas);
		}

		// Global keyboard shortcuts
		function handleGlobalKeyDown(e: KeyboardEvent) {
			if (showSettingsModal) {
				// #12 Allow toggle to close even when modal is open
				if ((e.metaKey || e.ctrlKey) && (e.key === ',' || e.key === '<')) {
					e.preventDefault();
					showSettingsModal = false;
					return;
				}
				// Suppress global table shortcuts when modal is active
				return;
			}

			const isCmdOrCtrl = e.metaKey || e.ctrlKey;
			const target = e.target as HTMLElement | null;
			const isInputFocused =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement;

			if (isCmdOrCtrl) {
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
					showSettingsModal = !showSettingsModal;
					return;
				}

				// If user is actively typing inside an input/textarea, do not hijack native undo/redo/new
				if (isInputFocused) return;

				if (e.key === 'n' || e.key === 'N') {
					e.preventDefault();
					store.addRow();
					notify('info', 'Added new row.');
				} else if (e.key === 'z' || e.key === 'Z') {
					if (e.shiftKey) {
						// Redo (Ctrl+Shift+Z)
						e.preventDefault();
						if (store.canRedo) store.redo();
					} else {
						// Undo (Ctrl+Z)
						e.preventDefault();
						if (store.canUndo) store.undo();
					}
				} else if (e.key === 'y' || e.key === 'Y') {
					// Redo (Ctrl+Y)
					e.preventDefault();
					if (store.canRedo) store.redo();
				}
			}
		}

		function handleVisibilityChange() {
			if (document.visibilityState === 'hidden') {
				store.flushSave();
			}
		}

		window.addEventListener('keydown', handleGlobalKeyDown);
		window.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('beforeunload', store.flushSave);

		return () => {
			window.removeEventListener('keydown', handleGlobalKeyDown);
			window.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('beforeunload', store.flushSave);
		};
	});
</script>

<div class="workspace-layout flex flex-col w-screen h-screen bg-[var(--bg)] overflow-hidden relative">
	<!-- Top Navigation Header -->
	<Header
		bind:this={headerRef}
		{store}
		onNotify={notify}
	/>

	<!-- Body layout: Main table area + inline slide-in AI Panel + Right-End Tool Ribbon -->
	<div class="workspace-body flex-1 flex overflow-hidden relative w-full min-h-0 max-sm:pb-[54px]">
		<main class="table-main-area flex-1 min-w-0 flex overflow-hidden relative">
			<DataTable {store} onNotify={notify} />
		</main>

		<!-- Slide-in AI Assistant Panel (no blocking overlay) -->
		<AiDrawer
			{store}
			onOpenSettings={() => (showSettingsModal = true)}
			onNotify={notify}
		/>

		<!-- Right-End Tool Ribbon -->
		<RightRibbon
			{store}
			{theme}
			onToggleTheme={toggleTheme}
			onOpenSettings={() => (showSettingsModal = true)}
			onNotify={notify}
		/>
	</div>

	<!-- Settings Modal -->
	{#if showSettingsModal}
		<SettingsModal
			{store}
			{theme}
			onToggleTheme={toggleTheme}
			onClose={() => (showSettingsModal = false)}
			onNotify={notify}
		/>
	{/if}

	<!-- Toast Notifications -->
	<ToastHost toasts={toastStore.toasts} onDismiss={toastStore.remove} />
</div>
