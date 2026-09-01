<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, preloadData } from '$app/navigation';
	import Icon from '$lib/components/Icons.svelte';
	import { AI_MODELS, maskApiKey, type AiModelConfig } from '$lib/constants';
	import { store, moduleStore, notify } from '$lib/workspace.svelte';

	import AiSection from '$lib/components/settings/AiSection.svelte';
	import ModulesSection from '$lib/components/settings/ModulesSection.svelte';
	import ShortcutsSection from '$lib/components/settings/ShortcutsSection.svelte';
	import type { IconName } from '$lib/types';
	import { providerLabel, type AiProvider } from '$lib/ai/providers';

	const SECTIONS: Array<{ id: string; label: string; icon: IconName; blurb: string }> = [
		{ id: 'ai', label: 'AI & Models', icon: 'sparkles', blurb: 'Connect an AI provider and pick the model behind every AI action.' },
		{ id: 'modules', label: 'Modules', icon: 'layers', blurb: 'Turn document pipelines on or off for this workspace.' },
		{ id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard', blurb: 'Every keyboard command available in the grid.' }
	];

	let activeSection = $state<string>('ai');
	const currentSection = $derived(SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]);

	let apiKey = $state<string>('');
	let showApiKey = $state<boolean>(false);
	let isSaved = $state<boolean>(false);
	let availableModels = $state<AiModelConfig[]>(AI_MODELS);
	let isLoadingModels = $state<boolean>(false);
	let modelsFetchError = $state<string>('');

	let fetchRequestId = 0;
	let activeFetchController: AbortController | null = null;

	function fallbackModels(provider: AiProvider): AiModelConfig[] {
		return provider === 'gemini' ? AI_MODELS : [];
	}

	async function fetchModels(keyToUse?: string) {
		const provider = store.aiProvider;
		const key = keyToUse ?? (apiKey.trim() || store.apiKey?.trim());
		activeFetchController?.abort();
		activeFetchController = null;

		if (!key || key.length < 15) {
			availableModels = fallbackModels(provider);
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
				headers: { 'x-ai-provider': provider, 'x-ai-api-key': key },
				signal: controller.signal
			});
			const data = await res.json();
			if (currentRequestId !== fetchRequestId || provider !== store.aiProvider) return;

			if (res.ok && data.models && data.models.length > 0) {
				availableModels = data.models;
				modelsFetchError = '';
				notify('success', `Retrieved ${data.models.length} live models from ${providerLabel(provider)}.`);
			} else {
				availableModels = [];
				modelsFetchError = data.error || `No compatible models returned by ${providerLabel(provider)}.`;
			}
		} catch (err: unknown) {
			if (currentRequestId !== fetchRequestId) return;
			if (err instanceof Error && err.name === 'AbortError') return;
			modelsFetchError =
				err instanceof Error ? err.message : `Network error connecting to ${providerLabel(provider)}.`;
		} finally {
			if (currentRequestId === fetchRequestId) {
				isLoadingModels = false;
				activeFetchController = null;
			}
		}
	}

	function saveApiKey() {
		const clean = apiKey.trim();
		if (!clean) return;
		store.addApiKey(clean);
		apiKey = '';
		isSaved = true;
		notify('success', 'API key saved.');
		fetchModels(clean);
	}

	/** Drops one saved key. Whatever key is active afterwards decides the model list. */
	function removeApiKey(index: number) {
		activeFetchController?.abort();
		activeFetchController = null;
		fetchRequestId++;
		store.removeApiKey(index);
		isSaved = false;
		isLoadingModels = false;
		if (store.apiKey) {
			fetchModels(store.apiKey);
		} else {
			availableModels = fallbackModels(store.aiProvider);
			modelsFetchError = '';
		}
		notify('info', 'API key removed.');
	}

	function switchApiKey(index: number) {
		store.useApiKey(index);
		modelsFetchError = '';
		if (store.apiKey) fetchModels(store.apiKey);
		notify('info', `Switched to key ${maskApiKey(store.apiKey)}.`);
	}

	function selectProvider(provider: AiProvider) {
		if (provider === store.aiProvider) return;
		activeFetchController?.abort();
		activeFetchController = null;
		fetchRequestId++;
		store.setAiProvider(provider);
		apiKey = '';
		showApiKey = false;
		isSaved = Boolean(store.apiKey);
		isLoadingModels = false;
		modelsFetchError = '';
		availableModels = fallbackModels(provider);
		if (store.apiKey) fetchModels(store.apiKey);
	}

	onMount(() => {
		if (store.apiKey) {
			isSaved = true;
			fetchModels(store.apiKey);
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

<svelte:head><title>Settings · xlsx-ai</title></svelte:head>

<div class="settings-page flex w-screen h-screen bg-[var(--bg)] overflow-hidden">
	<!-- Left Sidebar Column -->
	<aside
		class="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--surface-1)] flex flex-col overflow-hidden max-sm:w-14"
	>
		<!-- Left Topbar (Brand/Title) -->
		<div
			class="flex items-center h-16 px-4 border-b border-[var(--border)] gap-2.5 shrink-0 max-sm:justify-center max-sm:px-0"
		>
			<div
				class="brand-icon flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-primary)] text-[var(--text-inverse)] shrink-0 shadow-xs"
				aria-hidden="true"
			>
				<Icon name="settings" size={17} strokeWidth={2.2} />
			</div>
			<span class="text-[15px] font-bold text-[var(--text-1)] tracking-tight max-sm:hidden">Settings</span>
		</div>

		<!-- Nav items -->
		<nav class="settings-sidebar flex-1 p-2.5 flex flex-col gap-1 overflow-y-auto" aria-label="Settings sections">
			{#each SECTIONS as section (section.id)}
				<button
					class="settings-nav-item flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] font-medium text-left cursor-pointer border transition-all max-sm:justify-center max-sm:px-0 {activeSection ===
					section.id
						? 'bg-[var(--surface-3)] border-[var(--border-strong)] text-[var(--text-1)] shadow-2xs font-semibold'
						: 'bg-transparent border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'}"
					aria-current={activeSection === section.id ? 'page' : undefined}
					onclick={() => (activeSection = section.id)}
				>
					<Icon name={section.icon} size={15} class={activeSection === section.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-3)]'} aria-hidden="true" />
					<span class="max-sm:hidden flex-1">{section.label}</span>
					{#if activeSection === section.id}
						<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] shrink-0 max-sm:hidden"></span>
					{/if}
				</button>
			{/each}
		</nav>
	</aside>

	<!-- Right Main Pane -->
	<div class="flex-1 flex flex-col min-w-0 bg-[var(--bg)] overflow-hidden">
		<!-- Right Header -->
		<header
			class="settings-topbar flex items-center justify-between gap-4 h-16 px-7 border-b border-[var(--border)] bg-[var(--surface-1)] shrink-0"
		>
			<div class="flex flex-col gap-0.5 min-w-0">
				<h1 class="text-[15px] font-bold text-[var(--text-1)] tracking-tight m-0 leading-tight">
					{currentSection.label}
				</h1>
				<p class="text-[12px] text-[var(--text-3)] m-0 leading-snug truncate">{currentSection.blurb}</p>
			</div>

			<a
				href="/"
				data-sveltekit-preload-data="hover"
				class="settings-close-btn inline-flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-3)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-bg)] hover:border-[var(--accent-rose-border)] active:bg-[var(--accent-rose-bg)] transition-colors duration-75 shadow-2xs cursor-pointer"
				aria-label="Close settings (Escape)"
				title="Close (Esc)"
				onmouseenter={() => preloadData('/')}
				onclick={(e) => {
					e.preventDefault();
					goto('/');
				}}
			>
				<Icon name="x" size={14} aria-hidden="true" />
			</a>
		</header>

		<!-- Content -->
		<main class="settings-content flex-1 overflow-y-auto px-8 py-8 min-h-0">
			<div class="settings-content-inner max-w-4xl mx-auto">
				{#if activeSection === 'ai'}
					<AiSection
						{store}
						bind:apiKey
						bind:showApiKey
						bind:isSaved
						bind:availableModels
						{isLoadingModels}
						{modelsFetchError}
						onFetchModels={() => fetchModels()}
						onSelectProvider={selectProvider}
						onSaveKey={saveApiKey}
						onRemoveKey={removeApiKey}
						onSwitchKey={switchApiKey}
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
