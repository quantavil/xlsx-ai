<script lang="ts">
	import Icon from '$lib/components/Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import { AI_MODELS, type AiModelConfig } from '$lib/constants';

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

	let activeModelConfig = $derived(
		availableModels.find((m) => m.id === store.aiModel) ||
			AI_MODELS.find((m) => m.id === store.aiModel) || {
				id: store.aiModel,
				name: store.aiModel,
				description: 'Google Gemini Generative Model',
				speed: 'Fast' as const,
				contextWindow: '1M tokens'
			}
	);
</script>

<div class="settings-section ai-section flex flex-col gap-5">
	<div class="section-header">
		<h3 class="text-base font-bold text-[var(--text-1)] m-0 mb-1">Google Gemini AI Configuration</h3>
		<p class="section-subtitle text-[13px] text-[var(--text-3)] m-0">
			Configure your Google Gemini API key and choose from available multimodal generative models.
		</p>
	</div>

	<!-- API Key Configuration Card -->
	<div class="card-setting bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3.5">
		<div class="card-setting-header flex items-start justify-between gap-2">
			<div class="setting-title-group flex flex-col gap-0.5">
				<label for="gemini-api-key" class="setting-label text-[14px] font-semibold text-[var(--text-1)]">Gemini API Key</label>
				<span class="setting-hint text-[12px] text-[var(--text-3)]">Stored exclusively in your local browser storage</span>
			</div>
			{#if store.apiKey}
				<span class="badge badge-success status-pill status-active inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
					<Icon name="check" size={11} />
					<span>Configured</span>
				</span>
			{:else}
				<span class="badge badge-muted inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--text-3)]">Not Set</span>
			{/if}
		</div>

		<div class="input-with-actions flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
			<div class="input-container relative flex-1 flex items-center">
				<input
					id="gemini-api-key"
					type={showApiKey ? 'text' : 'password'}
					bind:value={apiKey}
					placeholder="AIzaSy..."
					class="input-mono api-key-input w-full bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-3 py-2 pr-9 font-mono text-[13px] text-[var(--text-1)] outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-emerald-500/20"
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					type="button"
					class="btn-icon input-inner-btn absolute right-2 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
					onclick={() => (showApiKey = !showApiKey)}
					aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
					title={showApiKey ? 'Hide API key' : 'Show API key'}
				>
					<Icon name={showApiKey ? 'eye-off' : 'eye'} size={15} />
				</button>
			</div>

			<div class="key-actions flex items-center gap-2 shrink-0">
				<button
					type="button"
					class="btn-tactile btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white cursor-pointer transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
					onclick={onSaveKey}
					disabled={!apiKey.trim()}
				>
					<Icon name="save" size={14} />
					<span>{isSaved ? 'Saved!' : 'Save API Key'}</span>
				</button>

				{#if store.apiKey}
					<button
						type="button"
						class="btn-tactile btn-ghost btn-danger-hover inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg bg-[var(--surface-3)] text-[var(--text-2)] hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
						onclick={onClearKey}
						title="Remove stored API key"
					>
						<Icon name="trash" size={14} />
						<span>Remove</span>
					</button>
				{/if}
			</div>
		</div>

		<div class="key-help-footer flex items-center gap-1.5 text-[12px] text-[var(--text-3)] mt-0.5">
			<span>Need an API key?</span>
			<a
				href="https://aistudio.google.com/app/apikey"
				target="_blank"
				rel="noreferrer"
				class="link-external inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline"
			>
				<span>Get one from Google AI Studio</span>
				<Icon name="external-link" size={12} />
			</a>
		</div>
	</div>

	<!-- Model Selection Card -->
	<div class="card-setting bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3.5">
		<div class="card-setting-header flex items-start justify-between gap-2">
			<div class="setting-title-group flex flex-col gap-0.5">
				<span class="setting-label text-[14px] font-semibold text-[var(--text-1)]">Active Generative Model</span>
				<span class="setting-hint text-[12px] text-[var(--text-3)]">Select the Gemini model for formula generation, data cleanup, and chat</span>
			</div>
			<button
				type="button"
				class="btn-tactile btn-ghost btn-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[var(--surface-1)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text-1)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				onclick={onFetchModels}
				disabled={isLoadingModels || !apiKey.trim()}
				title="Fetch live models from Google API"
			>
				<Icon name={isLoadingModels ? 'loader' : 'sparkles'} size={13} />
				<span>{isLoadingModels ? 'Fetching...' : 'Fetch Live Models'}</span>
			</button>
		</div>

		{#if modelsFetchError}
			<div class="alert-box alert-error flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[12.5px]">
				<Icon name="x" size={14} />
				<span>{modelsFetchError}</span>
			</div>
		{/if}

		<!-- Active Model Hero Card -->
		<div class="active-model-hero bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-xl p-3.5 flex flex-col sm:flex-row justify-between gap-3 shadow-sm">
			<div class="model-hero-left flex flex-col gap-1">
				<div class="model-hero-title-row flex items-center gap-2">
					<span class="model-hero-name font-bold text-[14px] text-[var(--text-1)]">{activeModelConfig.name}</span>
					{#if 'isDefault' in activeModelConfig && activeModelConfig.isDefault}
						<span class="badge badge-accent inline-flex text-[10.5px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Recommended</span>
					{/if}
					<span class="badge badge-neutral inline-flex text-[10.5px] font-semibold px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-2)]">{activeModelConfig.speed || 'Standard'}</span>
				</div>
				<p class="model-hero-desc text-[12.5px] text-[var(--text-3)] m-0">{activeModelConfig.description}</p>
			</div>
			<div class="model-hero-meta flex sm:flex-col justify-between sm:justify-center items-start sm:items-end gap-1 shrink-0 text-[11.5px]">
				<div class="meta-item flex gap-1.5">
					<span class="meta-label text-[var(--text-3)]">Context Window:</span>
					<span class="meta-val font-medium text-[var(--text-1)]">{activeModelConfig.contextWindow || '1M tokens'}</span>
				</div>
				<div class="meta-item flex gap-1.5">
					<span class="meta-label text-[var(--text-3)]">Model ID:</span>
					<span class="meta-val-mono font-mono text-[var(--text-2)]">{store.aiModel}</span>
				</div>
			</div>
		</div>

		<!-- Model Dropdown Switcher -->
		<div class="model-picker-container flex flex-col gap-2">
			<div class="picker-label-row flex items-center justify-between">
				<label for="model-search" class="picker-label text-[13px] font-semibold text-[var(--text-1)]">Available Models ({availableModels.length})</label>
				<span class="picker-sub text-[11.5px] text-[var(--text-3)]">Click any model below to activate</span>
			</div>

			<div class="model-search-wrap flex items-center gap-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-3 py-1.5 focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-emerald-500/20">
				<Icon name="search" size={14} class="opacity-50 text-[var(--text-3)] shrink-0" />
				<input
					id="model-search"
					type="text"
					bind:value={modelSearch}
					placeholder="Filter models by name or capability..."
					class="model-search-input bg-transparent border-none outline-none text-[12.5px] text-[var(--text-1)] w-full placeholder:text-[var(--text-3)]"
				/>
			</div>

			<div class="model-grid grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto p-0.5" role="radiogroup" aria-label="Available Google Gemini Models">
				{#each filteredModels as model (model.id)}
					{@const isSelected = store.aiModel === model.id}
					<button
						type="button"
						class="model-card text-left p-3 rounded-xl bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] flex flex-col gap-1.5 cursor-pointer transition-all {isSelected ? 'selected !border-[var(--accent-primary)] !bg-emerald-500/5 ring-1 ring-emerald-500/30' : ''}"
						onclick={() => store.setAiModel(model.id)}
						role="radio"
						aria-checked={isSelected}
					>
						<div class="model-card-top flex items-center justify-between gap-1">
							<span class="model-card-name font-semibold text-[13px] text-[var(--text-1)]">{model.name}</span>
							<div class="model-card-badges flex items-center gap-1">
								{#if 'isDefault' in model && model.isDefault}
									<span class="badge badge-accent-subtle text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Default</span>
								{/if}
								{#if isSelected}
									<span class="badge badge-active text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-primary)] text-white">Active</span>
								{/if}
							</div>
						</div>
						<p class="model-card-desc text-[11.5px] text-[var(--text-3)] m-0 leading-relaxed line-clamp-2">{model.description}</p>
						<div class="model-card-bottom flex items-center justify-between text-[10.5px] font-mono text-[var(--text-3)] mt-0.5">
							<span class="model-card-id truncate max-w-[140px]">{model.id}</span>
							<span class="model-card-context">{model.contextWindow}</span>
						</div>
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>
