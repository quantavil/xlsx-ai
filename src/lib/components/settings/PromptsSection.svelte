<script module lang="ts">
	export interface CustomPrompt {
		id: string;
		shortcut: string;
		prompt: string;
		label: string;
	}

	export const CUSTOM_PROMPTS_KEY = 'xlsx-ai:custom-prompts:v1';

	export const DEFAULT_CUSTOM_PROMPTS: CustomPrompt[] = [
		{
			id: 'default-summarize',
			shortcut: '/summarize',
			label: 'Summarize dataset',
			prompt: 'Summarize key patterns and anomalies in this dataset.'
		},
		{
			id: 'default-format',
			shortcut: '/format',
			label: 'Check formatting',
			prompt: 'Check data consistency, typos, and formatting across all columns.'
		}
	];

	export function normalizeShortcut(value: string): string {
		const trimmed = value.trim().toLowerCase();
		if (!trimmed) return '';
		return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	}

	export function hydrateCustomPrompts(raw: string | null): CustomPrompt[] {
		try {
			if (!raw) return [...DEFAULT_CUSTOM_PROMPTS];
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [...DEFAULT_CUSTOM_PROMPTS];
			const items = (parsed as Array<Record<string, unknown>>)
				.filter(
					(p) =>
						!!p &&
						typeof p === 'object' &&
						typeof p.id === 'string' &&
						typeof p.shortcut === 'string' &&
						typeof p.prompt === 'string'
				)
				.map((p) => ({
					id: p.id as string,
					shortcut: normalizeShortcut(p.shortcut as string),
					prompt: p.prompt as string,
					label:
						typeof p.label === 'string' && (p.label as string).trim()
							? (p.label as string)
							: (p.prompt as string).slice(0, 28)
				}))
				.filter((p) => p.shortcut && p.prompt.trim());
			return items.length > 0 ? items : [...DEFAULT_CUSTOM_PROMPTS];
		} catch {
			return [...DEFAULT_CUSTOM_PROMPTS];
		}
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icons.svelte';

	let prompts = $state<CustomPrompt[]>([...DEFAULT_CUSTOM_PROMPTS]);
	let shortcutInput = $state('');
	let labelInput = $state('');
	let promptInput = $state('');
	let editingId = $state<string | null>(null);
	let formError = $state('');

	function persist(items: CustomPrompt[]) {
		prompts = items;
		try {
			localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(items));
		} catch {
			// Storage may be unavailable (private mode); in-memory state still applies.
		}
	}

	function resetForm() {
		shortcutInput = '';
		labelInput = '';
		promptInput = '';
		editingId = null;
		formError = '';
	}

	function savePrompt() {
		const shortcut = normalizeShortcut(shortcutInput);
		if (!shortcut || shortcut === '/') {
			formError = 'Shortcut is required (e.g. /audit).';
			return;
		}
		if (!/^[a-z0-9-_]+$/.test(shortcut.slice(1))) {
			formError = 'Shortcut may only contain letters, numbers, dashes, and underscores.';
			return;
		}
		if (!promptInput.trim()) {
			formError = 'Prompt text is required.';
			return;
		}
		const duplicate = prompts.find(
			(p) => p.shortcut.toLowerCase() === shortcut.toLowerCase() && p.id !== editingId
		);
		if (duplicate) {
			formError = `Shortcut ${shortcut} is already in use.`;
			return;
		}
		const label = labelInput.trim() || promptInput.trim().slice(0, 28);
		if (editingId) {
			persist(
				prompts.map((p) =>
					p.id === editingId ? { ...p, shortcut, label, prompt: promptInput.trim() } : p
				)
			);
		} else {
			const item: CustomPrompt = {
				id: `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
				shortcut,
				label,
				prompt: promptInput.trim()
			};
			persist([...prompts, item]);
		}
		resetForm();
	}

	function startEdit(item: CustomPrompt) {
		editingId = item.id;
		shortcutInput = item.shortcut;
		labelInput = item.label;
		promptInput = item.prompt;
		formError = '';
	}

	function deletePrompt(id: string) {
		persist(prompts.filter((p) => p.id !== id));
		if (editingId === id) resetForm();
	}

	onMount(() => {
		try {
			if (typeof localStorage === 'undefined') return;
			prompts = hydrateCustomPrompts(localStorage.getItem(CUSTOM_PROMPTS_KEY));
		} catch {
			prompts = [...DEFAULT_CUSTOM_PROMPTS];
		}
	});
</script>

<div class="settings-section prompts-section flex flex-col gap-4">
	<div class="section-header">
		<h2 class="text-sm font-bold text-[var(--text-1)] m-0">Custom Prompts</h2>
		<p class="text-[12px] text-[var(--text-3)] m-0 mt-1 leading-relaxed">
			Save reusable prompt templates with slash shortcuts. Type <span class="font-mono font-semibold text-[var(--text-2)]">/shortcut</span> in the AI drawer to expand them.
		</p>
	</div>

	<div class="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3">
		<h3 class="text-[12px] font-bold text-[var(--text-1)] m-0">
			{editingId ? 'Edit prompt' : 'New prompt'}
		</h3>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
			<label class="flex flex-col gap-1 text-[11.5px] font-semibold text-[var(--text-2)]">
				<span>Shortcut</span>
				<div class="flex items-center gap-0 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-2.5 focus-within:border-[var(--accent-primary)] transition-colors">
					<span class="font-mono text-[12px] text-[var(--text-3)]" aria-hidden="true">/</span>
					<input
						type="text"
						bind:value={shortcutInput}
						placeholder="audit"
						aria-label="Prompt shortcut (without leading slash)"
						class="bg-transparent border-none outline-none text-[12.5px] text-[var(--text-1)] w-full py-1.5 font-mono placeholder:text-[var(--text-3)]"
					/>
				</div>
			</label>
			<label class="flex flex-col gap-1 text-[11.5px] font-semibold text-[var(--text-2)]">
				<span>Title</span>
				<input
					type="text"
					bind:value={labelInput}
					placeholder="Customs Compliance Audit"
					aria-label="Prompt title"
					class="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--text-1)] outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-3)] transition-colors"
				/>
			</label>
		</div>
		<label class="flex flex-col gap-1 text-[11.5px] font-semibold text-[var(--text-2)]">
			<span>Prompt text</span>
			<textarea
				rows="3"
				bind:value={promptInput}
				placeholder="Audit this dataset for compliance issues..."
				aria-label="Prompt text"
				class="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[var(--text-1)] outline-none focus:border-[var(--accent-primary)] placeholder:text-[var(--text-3)] resize-y transition-colors"
			></textarea>
		</label>
		{#if formError}
			<p class="text-[12px] text-[var(--accent-rose)] m-0" role="alert">{formError}</p>
		{/if}
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] cursor-pointer transition-colors"
				onclick={savePrompt}
			>
				<Icon name="save" size={13} aria-hidden="true" />
				<span>{editingId ? 'Update Prompt' : 'Save Prompt'}</span>
			</button>
			{#if editingId}
				<button
					type="button"
					class="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer transition-colors"
					onclick={resetForm}
				>Cancel</button>
			{/if}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<h3 class="text-[12px] font-bold text-[var(--text-1)] m-0">Saved prompts ({prompts.length})</h3>
		{#if prompts.length === 0}
			<p class="text-[12px] text-[var(--text-3)] m-0">No custom prompts yet. Save one above to reuse it with a slash shortcut.</p>
		{:else}
			<ul class="m-0 p-0 list-none flex flex-col gap-2">
				{#each prompts as item (item.id)}
					<li class="flex items-start gap-2.5 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
						<span class="font-mono font-bold text-[11.5px] px-1.5 py-0.5 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)] shrink-0">{item.shortcut}</span>
						<div class="flex flex-col gap-0.5 min-w-0 flex-1">
							<span class="text-[12.5px] font-semibold text-[var(--text-1)] truncate">{item.label}</span>
							<span class="text-[12px] text-[var(--text-3)] line-clamp-2 leading-relaxed">{item.prompt}</span>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button
								type="button"
								class="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
								onclick={() => startEdit(item)}
								aria-label="Edit {item.shortcut}"
								title="Edit"
							>
								<Icon name="edit" size={13} aria-hidden="true" />
							</button>
							<button
								type="button"
								class="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-bg)] cursor-pointer transition-colors"
								onclick={() => deletePrompt(item.id)}
								aria-label="Delete {item.shortcut}"
								title="Delete"
							>
								<Icon name="trash" size={13} aria-hidden="true" />
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
