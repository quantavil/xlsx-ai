<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icons.svelte';
	import { LS_API_KEY, AI_MODELS, type AiModelConfig } from '$lib/constants';
	import { store, moduleStore, notify } from '$lib/workspace.svelte';

	import AiSection from '$lib/components/settings/AiSection.svelte';
	import ModulesSection from '$lib/components/settings/ModulesSection.svelte';
	import ShortcutsSection from '$lib/components/settings/ShortcutsSection.svelte';
	import type { IconName } from '$lib/components/Icons.svelte';

	const SECTIONS: Array<{ id: string; label: string; icon: IconName }> = [
		{ id: 'ai', label: 'AI & Models', icon: 'sparkles' },
		{ id: 'modules', label: 'Modules', icon: 'layers' },
		{ id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' }
	];

	let activeSection = $state<string>('ai');

	let apiKey = $state<string>('');
	let showApiKey = $state<boolean>(false);
	let isSaved = $state<boolean>(false);
	let availableModels = $state<AiModelConfig[]>(AI_MODELS);
	let isLoadingModels = $state<boolean>(false);
	let modelsFetchError = $state<string>('');

	let fetchRequestId = 0;
	let activeFetchController: AbortController | null = null;

	async function fetchModelsFromGoogle(keyToUse?: string) {
		const key = keyToUse ?? (apiKey.trim() || store.apiKey?.trim());
		activeFetchController?.abort();
		activeFetchController = null;

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
				notify('success', `Retrieved ${data.models.length} live models from Google AI.`);
			} else {
				modelsFetchError = data.error || 'Failed to retrieve models from Google API.';
			}
		} catch (err: unknown) {
			if (currentRequestId !== fetchRequestId) return;
			if (err instanceof Error && err.name === 'AbortError') return;
			modelsFetchError =
				err instanceof Error ? err.message : 'Network error connecting to Google AI endpoint.';
		} finally {
			if (currentRequestId === fetchRequestId) {
				isLoadingModels = false;
				activeFetchController = null;
			}
		}
	}

	function saveApiKey() {
		const clean = apiKey.trim();
		if (!clean) {
			clearApiKey();
			return;
		}
		store.setApiKey(clean);
		isSaved = true;
		notify('success', 'API key saved.');
		fetchModelsFromGoogle(clean);
	}

	function clearApiKey() {
		activeFetchController?.abort();
		activeFetchController = null;
		fetchRequestId++;
		apiKey = '';
		isSaved = false;
		store.setApiKey('');
		availableModels = AI_MODELS;
		modelsFetchError = '';
		isLoadingModels = false;
		notify('info', 'API key removed.');
	}

	onMount(() => {
		const saved = store.apiKey || localStorage.getItem(LS_API_KEY) || '';
		if (saved) {
			apiKey = saved;
			isSaved = true;
			if (!store.apiKey) store.setApiKey(saved);
			fetchModelsFromGoogle(saved);
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				goto('/');
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			activeFetchController?.abort();
			window.removeEventListener('keydown', handleKeyDown);
		};
	});
</script>

<svelte:head><title>Settings — xlsx-ai</title></svelte:head>

<div class="settings-page flex flex-col w-screen h-screen bg-[var(--bg)] overflow-hidden">
	<header
		class="settings-topbar flex items-center h-12 px-3 border-b border-[var(--border)] bg-[var(--surface-1)] shrink-0 gap-2"
	>
		<div
			class="brand-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-primary)] text-white shrink-0 shadow-sm"
			aria-hidden="true"
		>
			<Icon name="settings" size={15} strokeWidth={2.2} />
		</div>
		<h1 class="text-[14px] font-bold m-0 text-[var(--text-1)]">Settings</h1>

		<a
			href="/"
			class="settings-close-btn ml-auto inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
			aria-label="Close settings (Escape)"
		>
			<Icon name="x" size={16} aria-hidden="true" />
		</a>
	</header>

	<div class="settings-body flex flex-1 min-h-0 overflow-hidden">
		<!-- Section rail: three sections are easier to scan as a list than as one long scroll. -->
		<nav
			class="settings-sidebar w-48 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] p-2 flex flex-col gap-0.5 overflow-y-auto max-sm:w-12 max-sm:p-1.5"
			aria-label="Settings sections"
		>
			{#each SECTIONS as section (section.id)}
				<button
					class="settings-nav-item flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] font-medium text-left cursor-pointer border transition-colors max-sm:justify-center max-sm:px-0 {activeSection ===
					section.id
						? 'bg-[var(--surface-3)] border-[var(--border-strong)] text-[var(--text-1)]'
						: 'bg-transparent border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'}"
					aria-current={activeSection === section.id ? 'page' : undefined}
					onclick={() => (activeSection = section.id)}
				>
					<Icon name={section.icon} size={15} aria-hidden="true" />
					<span class="max-sm:hidden">{section.label}</span>
				</button>
			{/each}
		</nav>

		<main class="settings-content flex-1 overflow-y-auto px-6 py-7 min-h-0">
			<div class="settings-content-inner max-w-2xl mx-auto">
				{#if activeSection === 'ai'}
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
				{:else if activeSection === 'modules'}
					<ModulesSection {moduleStore} />
				{:else}
					<ShortcutsSection />
				{/if}
			</div>
		</main>
	</div>
</div>
