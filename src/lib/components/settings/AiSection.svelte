<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { AiModelConfig } from '$lib/constants';

	let {
		store,
		apiKey = $bindable(),
		showApiKey = $bindable(),
		isSaved = $bindable(),
		availableModels = $bindable(),
		isLoadingModels,
		modelsFetchError,
		onFetchModels,
		onSaveKey,
		onClearKey
	}: {
		store: ReturnType<typeof createTableStore>;
		apiKey: string;
		showApiKey: boolean;
		isSaved: boolean;
		availableModels: AiModelConfig[];
		isLoadingModels: boolean;
		modelsFetchError: string;
		onFetchModels: () => void;
		onSaveKey: () => void;
		onClearKey: () => void;
	} = $props();

	let modelSearch = $state('');

	let filteredModels = $derived(
		availableModels.filter((m) => {
			const q = modelSearch.toLowerCase().trim();
			if (!q) return true;
			return (
				m.name.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q) ||
				(m.description && m.description.toLowerCase().includes(q))
			);
		})
	);
</script>

<div class="settings-section ai-section flex flex-col gap-4">
	<div class="section-header">
		<h2 class="text-sm font-bold text-[var(--text-1)] m-0">Google Gemini AI Configuration</h2>
	</div>

	<!-- API Key Card -->
	<div class="card-setting bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3">
		<div class="flex items-center justify-between gap-2">
			<label for="gemini-api-key" class="text-[13px] font-semibold text-[var(--text-1)]">API Key</label>
			{#if store.apiKey}
				<span class="status-pill status-active inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
					<Icon name="check" size={11} />
					<span>Configured</span>
				</span>
			{:else}
				<span class="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--text-3)]">Not set</span>
			{/if}
		</div>

		<div class="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
			<div class="relative flex-1 flex items-center">
				<input
					id="gemini-api-key"
					type={showApiKey ? 'text' : 'password'}
					bind:value={apiKey}
					placeholder="AIzaSy..."
					class="api-key-input w-full bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-3 py-1.5 pr-8 font-mono text-[12.5px] text-[var(--text-1)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-colors"
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					type="button"
					class="absolute right-2 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer p-0.5"
					onclick={() => (showApiKey = !showApiKey)}
					aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
					title={showApiKey ? 'Hide API key' : 'Show API key'}
				>
					<Icon name={showApiKey ? 'eye-off' : 'eye'} size={14} />
				</button>
			</div>

			<div class="flex items-center gap-1.5 shrink-0">
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white cursor-pointer transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={onSaveKey}
					disabled={!apiKey.trim()}
				>
					<Icon name="save" size={13} />
					<span>{isSaved ? 'Saved!' : 'Save API Key'}</span>
				</button>

				{#if store.apiKey}
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[12.5px] font-medium rounded-lg bg-[var(--surface-3)] text-[var(--text-2)] hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
						onclick={onClearKey}
						title="Remove stored API key"
					>
						<Icon name="trash" size={13} />
						<span>Remove</span>
					</button>
				{/if}
			</div>
		</div>

		<div class="flex items-center gap-1 text-[11.5px] text-[var(--text-3)]">
			<span>Need an API key?</span>
			<a
				href="https://aistudio.google.com/app/apikey"
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-0.5 text-[var(--accent-primary)] hover:underline font-medium"
			>
				<span>Google AI Studio</span>
				<Icon name="external-link" size={11} />
			</a>
		</div>
	</div>

	<!-- Model Selection Card -->
	<div class="card-setting bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<span class="text-[13px] font-semibold text-[var(--text-1)]">Models</span>
				<span class="text-[11px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-3)] text-[var(--text-3)]">{availableModels.length}</span>
			</div>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-lg bg-[var(--surface-1)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				onclick={onFetchModels}
				disabled={isLoadingModels || !apiKey.trim()}
				title="Fetch live models from Google API"
			>
				<Icon name={isLoadingModels ? 'loader' : 'sparkles'} size={12} class={isLoadingModels ? 'animate-spin text-[var(--accent-primary)]' : ''} />
				<span>{isLoadingModels ? 'Fetching...' : 'Fetch live models'}</span>
			</button>
		</div>

		{#if modelsFetchError}
			<div class="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[12px]">
				<Icon name="x" size={13} />
				<span>{modelsFetchError}</span>
			</div>
		{/if}

		<!-- Model Search Filter -->
		<div class="flex items-center gap-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 focus-within:border-[var(--accent-primary)] focus-within:ring-1 focus-within:ring-[var(--accent-primary)] transition-colors">
			<Icon name="search" size={13} class="opacity-50 text-[var(--text-3)] shrink-0" />
			<input
				id="model-search"
				type="text"
				bind:value={modelSearch}
				placeholder="Search models..."
				aria-label="Search models"
				class="bg-transparent border-none outline-none text-[12px] text-[var(--text-1)] w-full placeholder:text-[var(--text-3)]"
			/>
			{#if modelSearch}
				<button
					type="button"
					class="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
					onclick={() => (modelSearch = '')}
					aria-label="Clear search"
				>✕</button>
			{/if}
		</div>

		<!-- Scrollable Model Container -->
		<div class="model-scroll-container max-h-[300px] overflow-y-auto pr-1">
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Available Google Gemini Models">
				{#each filteredModels as model (model.id)}
					{@const isSelected = store.aiModel === model.id}
					<button
						type="button"
						class="text-left p-2.5 rounded-lg bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] flex flex-col gap-1 cursor-pointer transition-all {isSelected ? '!border-[var(--accent-primary)] !bg-emerald-500/5 ring-1 ring-emerald-500/25' : ''}"
						onclick={() => store.setAiModel(model.id)}
						role="radio"
						aria-checked={isSelected}
					>
						<div class="flex items-center justify-between gap-1">
							<span class="font-semibold text-[12.5px] text-[var(--text-1)] truncate">{model.name}</span>
							<div class="flex items-center gap-1 shrink-0">
								{#if model.badge}
									<span class="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400">{model.badge}</span>
								{/if}
								{#if isSelected}
									<span class="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[var(--accent-primary)] text-white">Active</span>
								{/if}
							</div>
						</div>
						{#if model.description}
							<p class="text-[11px] text-[var(--text-3)] m-0 line-clamp-2 leading-relaxed">{model.description}</p>
						{/if}
						<div class="flex items-center justify-between text-[10px] font-mono text-[var(--text-3)] mt-0.5">
							<span class="truncate max-w-[140px]">{model.id}</span>
							<span class="shrink-0">{model.contextWindow}</span>
						</div>
					</button>
				{/each}
			</div>

			{#if filteredModels.length === 0}
				<div class="py-6 text-center text-[12px] text-[var(--text-3)]">
					No models matching "{modelSearch}"
				</div>
			{/if}
		</div>
	</div>
</div>
