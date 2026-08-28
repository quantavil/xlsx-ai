<script lang="ts">
	import Icon from './Icons.svelte';
	import type { createTableStore } from '$lib/table/store.svelte';
	import type { CellValue } from '$lib/types';
	import { AI_MODELS } from '$lib/constants';
	import { createAiApi } from '$lib/ai/client';
	import { validatePatchProposals } from '$lib/ai/patches';

	let {
		store,
		onNotify,
		onOpenSettings
	}: {
		store: ReturnType<typeof createTableStore>;
		onNotify: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void;
		onOpenSettings?: () => void;
	} = $props();

	let activeModelName = $derived(
		AI_MODELS.find((m) => m.id === store.aiModel)?.name || store.aiModel
	);

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
		kind: 'fill_missing' | 'clean';
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

	// Trigger structured transformation (fill missing or clean)
	async function runStructuredOperation(kind: 'fill_missing' | 'clean') {
		const key = store.apiKey?.trim();
		if (!key) {
			onNotify('warning', 'Please configure your Google Gemini API key in Settings.');
			onOpenSettings?.();
			return;
		}

		const controller = beginRequest();
		activeDiffPreview = null;

		try {
			// #1 Slice to 40 rows to stay under 1MiB / 2000-row cap; server truncates anyway
			const truncatedRows = store.rows.slice(0, 40);
			const ai = createAiApi({ apiKey: key, modelId: store.aiModel, signal: controller.signal });
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
			if (controller !== activeRequest) return;
			const result = data as { data?: { explanation?: unknown; patches?: unknown[] } };
			if (Array.isArray(result.data?.patches) && result.data.patches.length > 0) {
				// Augment patches with current live values
				const patches: DiffPatch[] = result.data.patches
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
				if (patches.length === 0) {
					onNotify('warning', 'Gemini returned no valid changes for the current table.');
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
		if (!key) {
			onNotify('warning', 'Please configure your Google Gemini API key in Settings.');
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
		const controller = beginRequest();

		try {
			// #1 + #5 Keep payload under 1MiB/2000 cap and honor server max(50)/8000 limits
			const truncatedRows = store.rows.slice(0, 40);
			const recentMessages = messages
				.filter((m) => !m.isStreaming)
				.slice(-10)
				.map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
			const ai = createAiApi({ apiKey: key, modelId: store.aiModel, signal: controller.signal });
			const res = await ai.requestStream({
					tableContext: {
						title: store.title,
						columns: store.columns,
						rows: truncatedRows
					},
					messages: recentMessages
			});

			// Read streaming response text
			const reader = res.body?.getReader();
			if (!reader) throw new Error('Response body is unavailable.');

			const decoder = new TextDecoder();
			let accumulated = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				accumulated += chunk;

				messages = messages.map((m) =>
					m.id === assistantMsgId
						? { ...m, content: accumulated, isStreaming: true }
						: m
				);
			}

			messages = messages.map((m) =>
				m.id === assistantMsgId ? { ...m, isStreaming: false } : m
			);
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

	function clearChat() {
		cancelRequest();
		messages = [];
		activeDiffPreview = null;
		onNotify('info', 'Chat history cleared.');
	}
</script>

<aside
	class="ai-drawer relative h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] z-10 flex flex-col shrink-0 overflow-hidden transition-all duration-200 ease-out {store.isAiOpen ? 'open w-[380px] max-w-[420px] opacity-100 visible' : 'closed w-0 border-l-transparent opacity-0 pointer-events-none invisible'}"
	aria-label="AI Assistant"
>
	<div class="ai-drawer-inner w-[380px] min-w-[380px] h-full flex flex-col overflow-hidden bg-[var(--surface-1)]">
		<!-- Header -->
		<div class="drawer-header flex items-center justify-between p-4 border-b border-[var(--border)] shrink-0 gap-3">
			<div class="drawer-title-group flex items-center gap-2.5 min-w-0">
				<div class="ai-badge-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent-primary)] text-white shrink-0 shadow-sm" aria-hidden="true">
					<Icon name="sparkles" size={15} />
				</div>
				<div class="drawer-headings min-w-0">
					<h3 class="text-[13.5px] font-bold tracking-tight text-[var(--text-1)] m-0 leading-none">Gemini Assistant</h3>
					<span class="model-tag text-[11px] font-medium text-[var(--text-2)] tracking-tight mt-1 block truncate" title={activeModelName}>
						{activeModelName}
					</span>
				</div>
			</div>

			<div class="drawer-header-actions flex items-center gap-1 shrink-0">
				{#if messages.length > 0}
					<button
						class="header-trash w-7 h-7 rounded-md text-[var(--text-3)] hover:text-rose-500 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer transition-colors"
						onclick={clearChat}
						title="Clear Chat History"
						aria-label="Clear chat history"
					>
						<Icon name="trash" size={14} />
					</button>
				{/if}
				<button
					class="drawer-close-btn w-7 h-7 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)] flex items-center justify-center cursor-pointer transition-colors"
					onclick={() => store.toggleAi()}
					title="Close drawer"
					aria-label="Close AI drawer"
				>
					<Icon name="x" size={14} />
				</button>
			</div>
		</div>

		<!-- API Key Prompt Banner (shown when key not configured) -->
		{#if !store.apiKey}
			<div class="api-key-banner m-3 p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl flex flex-col gap-1.5">
				<div class="banner-top flex items-center gap-2 text-amber-500 font-semibold text-[12.5px]">
					<div class="banner-badge-icon w-5 h-5 rounded flex items-center justify-center bg-amber-500/20 text-amber-500" aria-hidden="true">
						<Icon name="key" size={13} />
					</div>
					<div class="banner-title font-semibold">Gemini API Key Required</div>
				</div>
				<p class="banner-desc text-[12px] text-[var(--text-2)] leading-relaxed m-0">
					Configure your Google Gemini API key in Settings to unlock AI cell filling, data cleaning, and dataset queries.
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
					<Icon name="wand" size={13} class="icon-accent-purple text-purple-400" aria-hidden="true" />
					<span>Fill Missing</span>
				</button>

				<button
					class="btn-tactile quick-btn inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)] active:scale-95 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={isGenerating}
					onclick={() => runStructuredOperation('clean')}
					aria-label="Clean table data"
				>
					<Icon name="sparkle" size={13} class="icon-accent-emerald text-emerald-400" aria-hidden="true" />
					<span>Clean Data</span>
				</button>

				<button
					class="btn-tactile quick-btn full-width col-span-2 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[12px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)] active:scale-95 transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
					disabled={isGenerating}
					onclick={() => sendChatMessage('Summarize this dataset, highlighting key metrics, top distributions, and anomalies.')}
					aria-label="Summarize dataset"
				>
					<Icon name="bar-chart" size={13} class="icon-accent-sky text-sky-400" aria-hidden="true" />
					<span>Summarize Dataset</span>
				</button>
			</div>
		</div>

		<!-- Structured Diff Preview Card -->
		{#if activeDiffPreview}
			<div class="diff-preview-card bezel-card m-3 p-3 bg-[var(--surface-2)] border border-emerald-500/30 rounded-xl flex flex-col gap-2 shadow-lg">
				<div class="diff-header flex items-center justify-between">
					<span class="diff-title text-[12.5px] font-bold text-[var(--text-1)]">Proposed Changes ({activeDiffPreview.patches.length})</span>
					<span class="diff-kind-tag text-[10.5px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase tracking-wide">{activeDiffPreview.kind === 'fill_missing' ? 'Imputation' : 'Cleanup'}</span>
				</div>
				<p class="diff-explanation text-[12px] text-[var(--text-2)] leading-tight m-0">{activeDiffPreview.explanation}</p>

				<div class="diff-patches-list flex flex-col gap-1 max-h-36 overflow-y-auto p-1.5 bg-[var(--surface-1)] rounded-lg border border-[var(--border)]">
					{#each activeDiffPreview.patches.slice(0, 8) as patch}
						{@const col = store.columns.find((c) => c.id === patch.columnId)}
						<div class="diff-patch-row flex items-center gap-1.5 text-[11px] font-mono py-0.5 px-1.5 rounded hover:bg-[var(--surface-2)]">
							<span class="patch-col-name text-[var(--text-3)] font-sans font-medium truncate max-w-[90px]">{col?.name || patch.columnId}</span>
							<span class="patch-old text-rose-400 line-through truncate max-w-[70px]">{patch.oldValue !== null && patch.oldValue !== undefined ? String(patch.oldValue) : 'null'}</span>
							<span class="patch-arrow text-[var(--text-3)]" aria-hidden="true">→</span>
							<span class="patch-new text-emerald-400 font-semibold truncate max-w-[70px]">{String(patch.newValue)}</span>
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
					<button class="btn-tactile btn-apply inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-sm transition-colors" onclick={applyDiffPreview} aria-label="Apply AI changes">
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
						<button class="chip action-chip w-full text-left text-[11.5px] px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer truncate" onclick={() => sendChatMessage('Summarize this dataset, highlighting key metrics and anomalies.')}>Summarize dataset</button>
						<button class="chip action-chip w-full text-left text-[11.5px] px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer truncate" onclick={() => sendChatMessage('What are the top 3 highest stockout risks?')}>Top stockout risks?</button>
						<button class="chip action-chip w-full text-left text-[11.5px] px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer truncate" onclick={() => sendChatMessage('Explain the distribution of inventory status.')}>Status breakdown</button>
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
						<div class="msg-body px-3 py-2 rounded-2xl shadow-sm {msg.role === 'user' ? 'bg-[var(--accent-primary)] text-white rounded-tr-sm' : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] rounded-tl-sm'}">
							<div class="msg-content whitespace-pre-wrap">{msg.content}</div>
							{#if msg.isStreaming}
								<span class="streaming-cursor animate-pulse inline-block text-emerald-400" aria-hidden="true">▋</span>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Chat Input Box -->
		<div class="drawer-footer p-3 border-t border-[var(--border)] bg-[var(--surface-1)] shrink-0">
			<div class="chat-input-wrapper relative flex items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-2 focus-within:border-[var(--accent-primary)] focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
				<textarea
					rows="2"
					placeholder="Ask Gemini about this table..."
					aria-label="Message for AI Assistant"
					class="bg-transparent border-none outline-none text-[12.5px] text-[var(--text-1)] w-full resize-none placeholder:text-[var(--text-3)] font-normal"
					bind:value={promptInput}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendChatMessage();
						}
					}}
				></textarea>
				<button
					class="btn-tactile send-btn w-7 h-7 rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer shrink-0 transition-colors shadow-sm ml-2"
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
