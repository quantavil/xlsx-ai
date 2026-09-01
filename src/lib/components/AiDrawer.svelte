<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { CellValue } from '$lib/types';
	import { createAiApi } from '$lib/ai/client';
	import { validatePatchProposals } from '$lib/ai/patches';
	import { isNumericType } from '$lib/table/cells';
	import { documents } from '$lib/workspace.svelte';

	let {
		store,
		onNotify,
		onOpenSettings
	}: {
		store: ReturnType<typeof createTableStore>;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
		onOpenSettings?: () => void;
	} = $props();

	// Favourites only, plus whichever model is actually in use so the control never
	// displays a value it does not list. Ids verbatim, never display names: a model
	// starred from the live catalog has no name stored here, and half a list of
	// "Gemini 3.7 Flash" next to half a list of "gemini-3.5-flash-lite" reads as a bug.
	let switchableModels = $derived(
		!store.aiModel
			? store.favoriteModels
			: store.favoriteModels.includes(store.aiModel)
			? store.favoriteModels
			: [store.aiModel, ...store.favoriteModels]
	);

	// Grow the composer with its content instead of scrolling one fixed row. `field-sizing`
	// would do this in CSS but Firefox and Safari do not ship it yet.
	let promptEl = $state<HTMLTextAreaElement | null>(null);
	$effect(() => {
		const el = promptEl;
		if (!el) return;
		el.style.height = 'auto';
		// Reading promptInput is what re-runs this on each keystroke; clearing it hands
		// the height back to the `rows` attribute rather than pinning an empty box open.
		el.style.height = promptInput ? `${Math.min(el.scrollHeight, 180)}px` : '';
	});

	// Derived from the live table instead of hardcoded to one sample dataset.
	let examplePrompts = $derived.by(() => {
		const firstNumeric = store.columns.find(
			(c) => isNumericType(c.type)
		);
		const firstCategorical = store.columns.find((c) => c.type === 'dropdown' || c.type === 'text');
		const chips = [
			{
				label: 'Summarize dataset',
				prompt: 'Summarize this dataset, highlighting key metrics and anomalies.'
			}
		];
		if (firstNumeric) {
			chips.push({
				label: `Top 5 by ${firstNumeric.name}`,
				prompt: `List the top 5 rows by ${firstNumeric.name} and explain what they have in common.`
			});
		}
		if (firstCategorical) {
			chips.push({
				label: `Break down by ${firstCategorical.name}`,
				prompt: `Break the table down by ${firstCategorical.name} and describe the distribution.`
			});
		}
		return chips;
	});

	// AI States
	let promptInput = $state<string>('');
	let isGenerating = $state<boolean>(false);
	let activeRequest: AbortController | null = null;

	// Chat message interface
	interface ChatMessage {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		isStreaming?: boolean;
	}

	let messages = $state<ChatMessage[]>([]);

	// Structured Diff Preview Interface
	interface DiffPatch {
		rowId: string;
		columnId: string;
		oldValue?: string | number | boolean | null;
		newValue: string | number | boolean | null;
	}

	interface DiffPreview {
		explanation: string;
		patches: DiffPatch[];
		kind: 'fill_missing' | 'clean' | 'chat';
	}

	let activeDiffPreview = $state<DiffPreview | null>(null);

	function beginRequest() {
		activeRequest?.abort();
		activeRequest = new AbortController();
		isGenerating = true;
		return activeRequest;
	}

	function cancelRequest() {
		activeRequest?.abort();
		activeRequest = null;
		isGenerating = false;
	}

	function isCellValue(value: unknown): value is CellValue {
		return value === null || ['string', 'number', 'boolean'].includes(typeof value);
	}

	function isDiffPatch(value: unknown): value is DiffPatch {
		if (!value || typeof value !== 'object') return false;
		const patch = value as Record<string, unknown>;
		return (
			typeof patch.rowId === 'string' &&
			typeof patch.columnId === 'string' &&
			isCellValue(patch.newValue)
		);
	}

	/**
	 * The rows the model gets to see.
	 *
	 * This used to be 40, which meant "fill every blank" quietly stopped at row 40 and
	 * an edit request over a longer table came back covering a fraction of it with no
	 * indication why. 2 000 is the server's schema cap, so this now only truncates where
	 * the request would be rejected outright.
	 */
	function rowsForPrompt() {
		return store.rows.slice(0, 2_000);
	}

	/** Drop patches that no longer address a live cell, and stamp the current value for the diff. */
	function hydratePatches(raw: unknown[]): DiffPatch[] {
		return raw
			.filter(isDiffPatch)
			.filter(
				(patch) =>
					store.rows.some((row) => row.id === patch.rowId) &&
					store.columns.some((column) => column.id === patch.columnId)
			)
			.map((patch) => {
				const row = store.rows.find((candidate) => candidate.id === patch.rowId);
				return { ...patch, oldValue: row?.[patch.columnId] ?? null };
			});
	}

	// Trigger structured transformation (fill missing or clean)
	async function runStructuredOperation(kind: 'fill_missing' | 'clean') {
		const key = store.apiKey?.trim();
		if (!key || !store.aiModel) {
			onNotify('warning', 'Please configure an AI provider, API key, and model in Settings.');
			onOpenSettings?.();
			return;
		}

		const capturedDocId = documents.activeId;
		const controller = beginRequest();
		activeDiffPreview = null;

		try {
			const truncatedRows = rowsForPrompt();
			const ai = createAiApi({
				provider: store.aiProvider,
				apiKey: key,
				modelId: store.aiModel,
				signal: controller.signal
			});
			const data: unknown = await ai.request({
					tableContext: {
						title: store.title,
						columns: store.columns,
						rows: truncatedRows
					},
					operation: {
						kind
					}
			});
			if (controller !== activeRequest || documents.activeId !== capturedDocId) {
				controller.abort();
				return;
			}
			const result = data as { data?: { explanation?: unknown; patches?: unknown[] } };
			if (Array.isArray(result.data?.patches) && result.data.patches.length > 0) {
				const patches = hydratePatches(result.data.patches);
				if (patches.length === 0) {
					onNotify('warning', 'AI returned no valid changes for the current table.');
					return;
				}

				activeDiffPreview = {
					explanation:
						typeof result.data.explanation === 'string'
							? result.data.explanation
							: `Suggested ${kind === 'fill_missing' ? 'value fills' : 'data cleaning'}.`,
					patches,
					kind
				};
				onNotify('info', `Found ${patches.length} suggested modifications. Review below.`);
			} else {
				onNotify('info', 'No cell changes were suggested by the model.');
			}
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			const msg = err instanceof Error ? err.message : 'AI Operation Failed.';
			onNotify('error', msg);
		} finally {
			if (activeRequest === controller) {
				activeRequest = null;
				isGenerating = false;
			}
		}
	}

	function applyDiffPreview() {
		if (!activeDiffPreview) return;
		const { validPatches, conflicts } = validatePatchProposals(
			{
				title: store.title,
				columns: store.columns,
				rows: store.rows
			},
			activeDiffPreview.patches
		);

		if (validPatches.length === 0) {
			onNotify('error', 'None of the proposed changes are applicable to current table structure.');
			activeDiffPreview = null;
			return;
		}

		store.applyCellPatches(validPatches);
		const count = validPatches.length;
		activeDiffPreview = null;
		if (conflicts.length > 0) {
			onNotify('warning', `Applied ${count} changes (${conflicts.length} outdated proposals skipped).`);
		} else {
			onNotify('success', `Successfully applied ${count} AI modifications.`);
		}
	}

	function discardDiffPreview() {
		activeDiffPreview = null;
		onNotify('info', 'Discarded AI proposals.');
	}

	// Send generic conversational chat message
	async function sendChatMessage(customPrompt?: string) {
		const text = customPrompt ?? promptInput.trim();
		if (!text) return;

		const key = store.apiKey?.trim();
		if (!key || !store.aiModel) {
			onNotify('warning', 'Please configure an AI provider, API key, and model in Settings.');
			onOpenSettings?.();
			return;
		}

		const userMsgId = 'msg-' + Date.now();
		const assistantMsgId = 'msg-ai-' + Date.now();

		messages = [
			...messages,
			{ id: userMsgId, role: 'user', content: text },
			{ id: assistantMsgId, role: 'assistant', content: '', isStreaming: true }
		];

		if (!customPrompt) promptInput = '';
		const capturedDocId = documents.activeId;
		const controller = beginRequest();

		try {
			const truncatedRows = rowsForPrompt();
			const recentMessages = messages
				.filter((m) => !m.isStreaming)
				.slice(-10)
				.map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
			const ai = createAiApi({
				provider: store.aiProvider,
				apiKey: key,
				modelId: store.aiModel,
				signal: controller.signal
			});
			const data: unknown = await ai.request({
					tableContext: {
						title: store.title,
						columns: store.columns,
						rows: truncatedRows
					},
					messages: recentMessages
			});
			if (controller !== activeRequest || documents.activeId !== capturedDocId) {
				controller.abort();
				return;
			}

			const result = data as { data?: { reply?: unknown; patches?: unknown[] } };
			const reply =
				typeof result.data?.reply === 'string' && result.data.reply.trim()
					? result.data.reply
					: 'No answer was returned.';
			messages = messages.map((m) =>
				m.id === assistantMsgId ? { ...m, content: reply, isStreaming: false } : m
			);

			// An edit asked for in chat lands in the same review card the quick actions use,
			// so nothing reaches the sheet without the user pressing Apply.
			const patches = Array.isArray(result.data?.patches)
				? hydratePatches(result.data.patches)
				: [];
			if (patches.length > 0) {
				activeDiffPreview = { explanation: reply, patches, kind: 'chat' };
				onNotify('info', `${patches.length} cell change(s) proposed. Review above.`);
			}
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				messages = messages.filter((m) => m.id !== assistantMsgId);
				return;
			}
			const msg = err instanceof Error ? err.message : 'Chat query failed.';
			messages = messages.map((m) =>
				m.id === assistantMsgId
					? { ...m, content: `Error: ${msg}`, isStreaming: false }
					: m
			);
		} finally {
			if (activeRequest === controller) {
				activeRequest = null;
				isGenerating = false;
			}
		}
	}

	// The ribbon button toggles this panel, so a dedicated X was redundant chrome. Esc
	// keeps the keyboard path intact now that the button is gone.
	function handleDrawerKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && store.isAiOpen) {
			e.preventDefault();
			store.toggleAi(false);
		}
	}

	function clearChat() {
		cancelRequest();
		messages = [];
		activeDiffPreview = null;
		onNotify('info', 'Chat history cleared.');
	}
</script>

<svelte:window onkeydown={handleDrawerKeydown} />

<aside
	class="ai-drawer relative h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] z-10 flex flex-col shrink-0 overflow-hidden transition-all duration-200 ease-out {store.isAiOpen ? 'open w-[380px] max-w-[420px] opacity-100 visible' : 'closed w-0 border-l-transparent opacity-0 pointer-events-none invisible'}"
	aria-label="AI Assistant"
>
	<div class="ai-drawer-inner w-[380px] min-w-[380px] h-full flex flex-col overflow-hidden bg-[var(--surface-1)]">
		<!-- Header -->
		<div class="drawer-header flex items-center justify-between p-4 border-b border-[var(--border)] shrink-0 gap-3">
			<div class="drawer-title-group flex items-center gap-2.5 min-w-0">
				<div class="ai-badge-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-primary)] text-[var(--text-inverse)] shrink-0 shadow-sm" aria-hidden="true">
					<Icon name="sparkles" size={15} />
				</div>
				<div class="drawer-headings min-w-0">
					<h3 class="text-[13.5px] font-bold tracking-tight text-[var(--text-1)] m-0 leading-none">AI Assistant</h3>
				</div>
			</div>

			<div class="drawer-header-actions flex items-center gap-1 shrink-0">
				{#if messages.length > 0}
					<button
						class="header-trash w-7 h-7 rounded-md text-[var(--text-3)] hover:text-[var(--accent-rose)] hover:bg-[var(--accent-rose-bg)] flex items-center justify-center cursor-pointer transition-colors"
						onclick={clearChat}
						title="Clear Chat History"
						aria-label="Clear chat history"
					>
						<Icon name="trash" size={14} />
					</button>
				{/if}
			</div>
		</div>

		<!-- API Key Prompt Banner (shown when key not configured) -->
		{#if !store.apiKey || !store.aiModel}
			<div class="api-key-banner m-3 p-3 bg-[var(--accent-amber-bg)] border border-[var(--accent-amber-border)] rounded-xl flex flex-col gap-1.5">
				<div class="banner-top flex items-center gap-2 text-[var(--accent-amber)] font-semibold text-[12.5px]">
					<div class="banner-badge-icon w-5 h-5 rounded flex items-center justify-center bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]" aria-hidden="true">
						<Icon name="key" size={13} />
					</div>
					<div class="banner-title font-semibold">AI Configuration Required</div>
				</div>
				<p class="banner-desc text-[12px] text-[var(--text-2)] leading-relaxed m-0">
					Choose a provider, API key, and model in Settings to unlock AI cell filling, data cleaning, and dataset queries.
				</p>
				{#if onOpenSettings}
					<button class="banner-cta-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-3)] cursor-pointer w-fit mt-1 transition-colors" onclick={onOpenSettings} aria-label="Configure API key in settings">
						<Icon name="settings" size={13} aria-hidden="true" />
						<span>Configure in Settings</span>
					</button>
				{/if}
			</div>
		{/if}

		<!-- Quick Action Buttons -->
		<div class="quick-actions-section p-3 border-b border-[var(--border)] flex flex-col gap-2 shrink-0">
			<div class="section-heading text-[11px] font-bold uppercase tracking-wider text-[var(--text-3)]">Table Automations</div>
			<div class="quick-actions-grid grid grid-cols-2 gap-2">
				<button
					class="btn-tactile quick-btn inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)] active:scale-95 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={isGenerating}
					onclick={() => runStructuredOperation('fill_missing')}
					aria-label="Fill missing values"
				>
					<Icon name="wand" size={13} class="icon-accent-purple text-[var(--accent-purple)]" aria-hidden="true" />
					<span>Fill Missing</span>
				</button>

				<button
					class="btn-tactile quick-btn inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)] active:scale-95 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={isGenerating}
					onclick={() => runStructuredOperation('clean')}
					aria-label="Clean table data"
				>
					<Icon name="sparkle" size={13} class="icon-accent-emerald text-[var(--accent-primary)]" aria-hidden="true" />
					<span>Clean Data</span>
				</button>

				<button
					class="btn-tactile quick-btn full-width col-span-2 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)] active:scale-95 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={isGenerating}
					onclick={() => sendChatMessage('Summarize this dataset, highlighting key metrics, top distributions, and anomalies.')}
					aria-label="Summarize dataset"
				>
					<Icon name="bar-chart" size={13} class="icon-accent-sky text-[var(--accent-sky)]" aria-hidden="true" />
					<span>Summarize Dataset</span>
				</button>
			</div>
		</div>

		<!-- Structured Diff Preview Card -->
		{#if activeDiffPreview}
			<div class="diff-preview-card bezel-card m-3 p-3 bg-[var(--surface-2)] border border-[var(--accent-primary-border)] rounded-xl flex flex-col gap-2 shadow-lg">
				<div class="diff-header flex items-center justify-between">
					<span class="diff-title text-[12.5px] font-bold text-[var(--text-1)]">Proposed Changes ({activeDiffPreview.patches.length})</span>
					<span class="diff-kind-tag text-[10.5px] font-semibold px-2 py-0.5 rounded bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] uppercase tracking-wide">{activeDiffPreview.kind === 'fill_missing' ? 'Imputation' : activeDiffPreview.kind === 'clean' ? 'Cleanup' : 'Chat Edit'}</span>
				</div>
				<p class="diff-explanation text-[12px] text-[var(--text-2)] leading-tight m-0">{activeDiffPreview.explanation}</p>

				<div class="diff-patches-list flex flex-col gap-1 max-h-36 overflow-y-auto p-1.5 bg-[var(--surface-1)] rounded-lg border border-[var(--border)]">
					{#each activeDiffPreview.patches.slice(0, 8) as patch}
						{@const col = store.columns.find((c) => c.id === patch.columnId)}
						<div class="diff-patch-row flex items-center gap-1.5 text-[11px] font-mono py-0.5 px-1.5 rounded hover:bg-[var(--surface-2)]">
							<span class="patch-col-name text-[var(--text-3)] font-sans font-medium truncate max-w-[90px]">{col?.name || patch.columnId}</span>
							<span class="patch-old text-[var(--accent-rose)] line-through truncate max-w-[70px]">{patch.oldValue !== null && patch.oldValue !== undefined ? String(patch.oldValue) : 'null'}</span>
							<span class="patch-arrow text-[var(--text-3)]" aria-hidden="true">→</span>
							<span class="patch-new text-[var(--accent-primary)] font-semibold truncate max-w-[70px]">{String(patch.newValue)}</span>
						</div>
					{/each}
					{#if activeDiffPreview.patches.length > 8}
						<div class="diff-more-count text-[11px] text-[var(--text-3)] text-center py-0.5">+ {activeDiffPreview.patches.length - 8} more changes</div>
					{/if}
				</div>

				<div class="diff-actions flex justify-end gap-2 mt-1">
					<button class="btn-tactile btn-discard inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-md bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--border-strong)] cursor-pointer transition-colors" onclick={discardDiffPreview} aria-label="Discard AI changes">
						<Icon name="rotate-ccw" size={12} aria-hidden="true" />
						<span>Discard</span>
					</button>
					<button class="btn-tactile btn-apply inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-md bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-[var(--text-inverse)] cursor-pointer shadow-sm transition-colors" onclick={applyDiffPreview} aria-label="Apply AI changes">
						<Icon name="check" size={12} aria-hidden="true" />
						<span>Apply to Table</span>
					</button>
				</div>
			</div>
		{/if}

		<!-- Chat History List -->
		<div class="chat-history-container flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0" role="log" aria-live="polite" aria-label="Chat messages">
			{#if messages.length === 0}
				<div class="chat-empty-state flex flex-col items-center justify-center text-center p-4 my-auto gap-2 text-[var(--text-3)]">
					<div class="empty-bot-wrap w-10 h-10 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)] mb-1"><Icon name="bot" size={22} aria-hidden="true" /></div>
					<p class="empty-title font-semibold text-[13px] text-[var(--text-1)] m-0">Ask anything about this table</p>
					<p class="empty-desc text-[12px] text-[var(--text-3)] max-w-[240px] m-0">Summarize trends, fill blanks, or clean formats. Try a prompt:</p>
					<div class="example-chips flex flex-col gap-1.5 mt-2 w-full max-w-[260px]">
						{#each examplePrompts as chip (chip.label)}
							<button
								class="chip action-chip w-full text-left text-[11.5px] px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer truncate"
								onclick={() => sendChatMessage(chip.prompt)}>{chip.label}</button
							>
						{/each}
					</div>
				</div>
			{:else}
				{#each messages as msg (msg.id)}
					<div class="chat-message flex gap-2.5 text-[12.5px] leading-relaxed max-w-[95%] {msg.role === 'user' ? 'message-user self-end flex-row-reverse' : 'message-assistant'}">
						<div class="msg-avatar w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs bg-[var(--surface-3)] text-[var(--text-2)]" aria-hidden="true">
							{#if msg.role === 'user'}
								<Icon name="user" size={12} />
							{:else}
								<Icon name="bot" size={12} />
							{/if}
						</div>
						<div class="msg-body px-3 py-2 rounded-2xl shadow-sm {msg.role === 'user' ? 'bg-[var(--accent-primary)] text-[var(--text-inverse)] rounded-tr-sm' : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] rounded-tl-sm'}">
							<div class="msg-content whitespace-pre-wrap">{msg.content}</div>
							{#if msg.isStreaming}
								<span class="streaming-cursor animate-pulse inline-block text-[var(--accent-primary)]" aria-hidden="true">▋</span>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Chat Input Box -->
		<div class="drawer-footer p-3 border-t border-[var(--border)] bg-[var(--surface-1)] shrink-0 flex flex-col gap-1.5">
			<div class="model-switcher flex items-center gap-1.5 px-0.5">
				<Icon name="sparkles" size={11} class="text-[var(--text-3)] shrink-0" aria-hidden="true" />
				<select
					class="model-switcher-select bg-transparent border-none outline-none text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer max-w-full truncate focus-visible:text-[var(--text-1)]"
					aria-label="Model"
					value={store.aiModel}
					onchange={(e) => store.setAiModel(e.currentTarget.value)}
				>
					{#each switchableModels as modelId (modelId)}
						<option value={modelId}>{modelId}</option>
					{/each}
				</select>
			</div>
			<div class="chat-input-wrapper relative flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-2 focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-[var(--accent-primary-border)] transition-all">
				<textarea
					rows="1"
					bind:this={promptEl}
					placeholder="Ask AI about this table..."
					aria-label="Message for AI Assistant"
					class="bg-transparent border-none outline-none text-[12.5px] text-[var(--text-1)] w-full resize-none overflow-y-auto placeholder:text-[var(--text-3)] font-normal leading-relaxed"
					bind:value={promptInput}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendChatMessage();
						}
					}}
				></textarea>
				<button
					class="btn-tactile send-btn w-7 h-7 rounded-lg bg-[var(--accent-primary)] text-[var(--text-inverse)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer shrink-0 transition-colors shadow-sm ml-2"
					disabled={isGenerating || !promptInput.trim()}
					onclick={() => sendChatMessage()}
					title="Send Message"
					aria-label="Send Message"
				>
					<Icon name="send" size={13} aria-hidden="true" />
				</button>
			</div>
		</div>
	</div>
</aside>
