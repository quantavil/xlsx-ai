<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import { sampleTables } from '$lib/data/index';
	import { LS_API_KEY, AI_MODELS, type AiModelConfig } from '$lib/constants';
	import { onMount } from 'svelte';
	import { trapFocus } from '$lib/ui/focus';

	import AiSection from './settings/AiSection.svelte';
	import AppearanceSection from './settings/AppearanceSection.svelte';
	import DatasetsSection from './settings/DatasetsSection.svelte';
	import ShortcutsSection from './settings/ShortcutsSection.svelte';
	import AboutSection from './settings/AboutSection.svelte';

	let {
		store,
		theme,
		onToggleTheme,
		onClose,
		onNotify
	}: {
		store: ReturnType<typeof createTableStore>;
		theme: 'dark' | 'light';
		onToggleTheme: () => void;
		onClose: () => void;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
	} = $props();

	let apiKey = $state<string>('');
	let showApiKey = $state<boolean>(false);
	let isSaved = $state<boolean>(false);
	let activeTab = $state<'ai' | 'appearance' | 'datasets' | 'shortcuts' | 'about'>('ai');
	let availableModels = $state<AiModelConfig[]>(AI_MODELS);
	let isLoadingModels = $state<boolean>(false);
	let modelsFetchError = $state<string>('');
	let pendingSampleKey = $state<'saas' | 'sales' | 'inventory' | null>(null);

	let fetchRequestId = 0;
	let activeFetchController: AbortController | null = null;

	async function fetchModelsFromGoogle(keyToUse?: string) {
		const key = keyToUse ?? (apiKey.trim() || store.apiKey?.trim());
		if (activeFetchController) {
			activeFetchController.abort();
			activeFetchController = null;
		}

		if (!key || key.length < 15) {
			availableModels = AI_MODELS;
			modelsFetchError = '';
			return;
		}

		const currentRequestId = ++fetchRequestId;
		const controller = new AbortController();
		activeFetchController = controller;

		isLoadingModels = true;
		modelsFetchError = '';
		try {
			const res = await fetch('/api/ai/models', {
				headers: { 'x-ai-api-key': key },
				signal: controller.signal
			});
			const data = await res.json();
			if (currentRequestId !== fetchRequestId) return;

			if (res.ok && data.models && data.models.length > 0) {
				availableModels = data.models;
				modelsFetchError = '';
				onNotify('success', `Retrieved ${data.models.length} live models from Google AI.`);
			} else {
				modelsFetchError = data.error || 'Failed to retrieve models from Google API.';
			}
		} catch (err: unknown) {
			if (currentRequestId !== fetchRequestId) return;
			if (err instanceof Error && err.name === 'AbortError') return;
			const msg = err instanceof Error ? err.message : 'Network error connecting to Google AI endpoint.';
			modelsFetchError = msg;
		} finally {
			if (currentRequestId === fetchRequestId) {
				isLoadingModels = false;
				activeFetchController = null;
			}
		}
	}

	onMount(() => {
		if (store.apiKey) {
			apiKey = store.apiKey;
			isSaved = true;
			fetchModelsFromGoogle(store.apiKey);
		} else if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem(LS_API_KEY);
			if (saved) {
				apiKey = saved;
				isSaved = true;
				store.setApiKey(saved);
				fetchModelsFromGoogle(saved);
			}
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				if (pendingSampleKey) {
					pendingSampleKey = null;
					e.stopPropagation();
				} else {
					e.preventDefault();
					onClose();
				}
			}
		}

		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	function saveApiKey() {
		const clean = apiKey.trim();
		if (clean) {
			store.setApiKey(clean);
			isSaved = true;
			onNotify('success', 'API key saved.');
			fetchModelsFromGoogle(clean);
		} else {
			clearApiKey();
		}
	}

	function clearApiKey() {
		if (activeFetchController) {
			activeFetchController.abort();
			activeFetchController = null;
		}
		fetchRequestId++;
		apiKey = '';
		isSaved = false;
		store.setApiKey('');
		availableModels = AI_MODELS;
		modelsFetchError = '';
		isLoadingModels = false;
		onNotify('info', 'API key removed.');
	}

	function handleLoadSample(key: 'saas' | 'sales' | 'inventory') {
		if (store.isDirty) {
			pendingSampleKey = key;
		} else {
			executeLoadSample(key);
		}
	}

	function executeLoadSample(key: 'saas' | 'sales' | 'inventory') {
		store.loadTable(sampleTables[key]);
		pendingSampleKey = null;
		onNotify('success', `Loaded ${sampleTables[key].title}.`);
		onClose();
	}
</script>

<div class="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 animate-[confirmFadeIn_120ms_cubic-bezier(0.4,0,0.2,1)]" role="presentation">
	<div
		class="settings-page-wrapper settings-dialog w-[90vw] max-w-[860px] h-[82vh] max-h-[640px] bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-[modalZoomIn_150ms_cubic-bezier(0.16,1,0.3,1)]"
		role="dialog"
		aria-modal="true"
		aria-label="Settings"
		use:trapFocus
	>
		<!-- Modal Header -->
		<header class="settings-topbar flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
			<div class="topbar-left flex items-center">
				<div class="topbar-title-group flex items-center gap-2.5 text-[var(--text-1)]">
					<Icon name="settings" size={16} aria-hidden="true" />
					<h1 class="topbar-title text-[15px] font-bold m-0">Settings</h1>
				</div>
			</div>

			<div class="topbar-right">
				<button
					class="settings-close-btn bg-transparent border-none text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer p-1.5 rounded-md flex items-center justify-center transition-colors"
					onclick={onClose}
					aria-label="Close Settings"
					title="Close Settings (Esc)"
				>
					<Icon name="x" size={16} aria-hidden="true" />
				</button>
			</div>
		</header>

		<!-- Modal Main Content Area -->
		<div class="settings-layout flex flex-1 overflow-hidden min-h-0">
			<!-- Sidebar Navigation -->
			<nav class="settings-sidebar w-52 border-r border-[var(--border)] bg-[var(--surface-2)] p-2.5 flex flex-col gap-1 shrink-0 select-none overflow-y-auto" aria-label="Settings categories">
				<button
					type="button"
					class="sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg bg-transparent border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[13px] font-medium text-left cursor-pointer transition-colors {activeTab === 'ai' ? 'active !bg-[var(--surface-1)] !text-[var(--accent-primary)] font-semibold shadow-sm' : ''}"
					onclick={() => (activeTab = 'ai')}
				>
					<Icon name="sparkles" size={15} />
					<span>AI & Models</span>
				</button>

				<button
					type="button"
					class="sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg bg-transparent border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[13px] font-medium text-left cursor-pointer transition-colors {activeTab === 'appearance' ? 'active !bg-[var(--surface-1)] !text-[var(--accent-primary)] font-semibold shadow-sm' : ''}"
					onclick={() => (activeTab = 'appearance')}
				>
					<Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
					<span>Appearance</span>
				</button>

				<button
					type="button"
					class="sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg bg-transparent border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[13px] font-medium text-left cursor-pointer transition-colors {activeTab === 'datasets' ? 'active !bg-[var(--surface-1)] !text-[var(--accent-primary)] font-semibold shadow-sm' : ''}"
					onclick={() => (activeTab = 'datasets')}
				>
					<Icon name="database" size={15} />
					<span>Sample Datasets</span>
				</button>

				<button
					type="button"
					class="sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg bg-transparent border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[13px] font-medium text-left cursor-pointer transition-colors {activeTab === 'shortcuts' ? 'active !bg-[var(--surface-1)] !text-[var(--accent-primary)] font-semibold shadow-sm' : ''}"
					onclick={() => (activeTab = 'shortcuts')}
				>
					<Icon name="table" size={15} />
					<span>Shortcuts</span>
				</button>

				<button
					type="button"
					class="sidebar-nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg bg-transparent border-none text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[13px] font-medium text-left cursor-pointer transition-colors {activeTab === 'about' ? 'active !bg-[var(--surface-1)] !text-[var(--accent-primary)] font-semibold shadow-sm' : ''}"
					onclick={() => (activeTab = 'about')}
				>
					<Icon name="file-spreadsheet" size={15} />
					<span>About</span>
				</button>
			</nav>

			<!-- Content View -->
			<main class="settings-content flex-1 overflow-y-auto p-6 bg-[var(--surface-1)]">
				{#if activeTab === 'ai'}
					<AiSection
						{store}
						bind:apiKey
						bind:showApiKey
						bind:isSaved
						bind:availableModels
						{isLoadingModels}
						{modelsFetchError}
						onFetchModels={() => fetchModelsFromGoogle()}
						onSaveKey={saveApiKey}
						onClearKey={clearApiKey}
					/>
				{:else if activeTab === 'appearance'}
					<AppearanceSection {theme} {onToggleTheme} />
				{:else if activeTab === 'datasets'}
					<DatasetsSection {store} onLoadSample={handleLoadSample} />
				{:else if activeTab === 'shortcuts'}
					<ShortcutsSection />
				{:else if activeTab === 'about'}
					<AboutSection />
				{/if}
			</main>
		</div>
	</div>
</div>

<!-- Dirty State Replacement Confirmation Modal -->
{#if pendingSampleKey}
	<div class="confirm-dialog-overlay fixed inset-0 bg-black/65 backdrop-blur-sm z-[150] flex items-center justify-center p-4" role="presentation">
		<div class="confirm-dialog bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl p-5 max-w-[420px] w-full flex flex-col gap-3 shadow-2xl animate-[confirmPop_140ms_cubic-bezier(0.16,1,0.3,1)]" role="alertdialog" aria-labelledby="confirm-replace-title">
			<div class="confirm-header flex items-center gap-2 text-[var(--text-1)] text-amber-400 font-bold text-[15px]">
				<Icon name="sparkles" size={18} />
				<h3 id="confirm-replace-title">Replace Current Table?</h3>
			</div>
			<p class="confirm-body text-[13px] text-[var(--text-2)] leading-relaxed m-0">
				You have unsaved changes in your table. Loading
				<strong>"{sampleTables[pendingSampleKey].title}"</strong>
				will replace your current workspace.
			</p>
			<div class="confirm-actions flex justify-end gap-2 mt-1">
				<button
					type="button"
					class="btn-tactile btn-ghost inline-flex items-center justify-center px-3.5 py-1.5 text-[13px] font-medium rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text-1)] cursor-pointer transition-colors"
					onclick={() => (pendingSampleKey = null)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn-tactile btn-danger inline-flex items-center justify-center px-3.5 py-1.5 text-[13px] font-medium rounded-md bg-rose-600 hover:bg-rose-500 text-white cursor-pointer transition-colors shadow-sm"
					onclick={() => pendingSampleKey && executeLoadSample(pendingSampleKey)}
				>
					Replace Table
				</button>
			</div>
		</div>
	</div>
{/if}
