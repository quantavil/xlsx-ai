<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from '$lib/components/Icons.svelte';
	import { documents, isSourceOpen, closeDrawers } from '$lib/workspace.svelte';
	import type { NotifyFn } from '$lib/ui/toast.svelte';
	import { loadSourceFiles, type StoredSourceFile } from '$lib/table/source-files';

	let {
		onNotify,
		onClose = closeDrawers
	}: {
		onNotify?: NotifyFn;
		onClose?: () => void;
	} = $props();

	let files = $state<StoredSourceFile[]>([]);
	let selectedIndex = $state(0);
	let isLoading = $state(false);
	let activeBlobUrl = $state<string | null>(null);

	const activeDocId = $derived(documents.activeId);
	const activeFile = $derived(files[selectedIndex] ?? null);
	const isOpen = $derived(isSourceOpen());

	// Whenever the drawer opens or active document changes, fetch files from IndexedDB
	$effect(() => {
		if (isOpen && activeDocId) {
			loadFiles(activeDocId);
		} else if (!isOpen) {
			cleanupBlobUrl();
		}
	});

	// Whenever selected file changes, create an object URL for preview
	$effect(() => {
		cleanupBlobUrl();
		if (activeFile && activeFile.blob) {
			activeBlobUrl = URL.createObjectURL(activeFile.blob);
		}
	});

	onDestroy(() => {
		cleanupBlobUrl();
	});

	function cleanupBlobUrl() {
		if (activeBlobUrl) {
			URL.revokeObjectURL(activeBlobUrl);
			activeBlobUrl = null;
		}
	}

	let loadToken = 0;

	async function loadFiles(docId: string) {
		const token = ++loadToken;
		isLoading = true;
		try {
			const loaded = await loadSourceFiles(docId);
			if (token !== loadToken || docId !== documents.activeId) return;
			files = loaded;
			if (selectedIndex >= loaded.length) {
				selectedIndex = 0;
			}
		} catch {
			if (token !== loadToken || docId !== documents.activeId) return;
			files = [];
		} finally {
			if (token === loadToken) {
				isLoading = false;
			}
		}
	}

	function handleDrawerKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isOpen) {
			e.stopPropagation();
			onClose();
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}

	function handleDownloadActiveFile() {
		if (!activeFile || !activeBlobUrl) return;
		const a = document.createElement('a');
		a.href = activeBlobUrl;
		a.download = activeFile.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		onNotify?.('info', `Downloading "${activeFile.name}"...`);
	}
</script>

<svelte:window onkeydown={handleDrawerKeydown} />

<aside
	class="source-viewer-drawer relative h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] z-10 flex flex-col shrink-0 overflow-hidden transition-all duration-200 ease-out {isOpen
		? 'open w-[480px] max-w-[560px] opacity-100 visible'
		: 'closed w-0 border-l-transparent opacity-0 pointer-events-none invisible'}"
	aria-label="Source Document Viewer"
>
	<div class="drawer-inner w-[480px] min-w-[480px] h-full flex flex-col overflow-hidden bg-[var(--surface-1)]">
		<!-- Header -->
		<div class="drawer-header flex items-center justify-between p-3.5 border-b border-[var(--border)] shrink-0 gap-3">
			<div class="header-left flex items-center gap-2.5 min-w-0">
				<div class="badge-icon flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface-2)] text-[var(--accent-primary)] border border-[var(--border)] shrink-0 shadow-sm" aria-hidden="true">
					<Icon name="file-text" size={15} />
				</div>
				<div class="header-titles min-w-0">
					<h3 class="text-[13.5px] font-bold tracking-tight text-[var(--text-1)] m-0 leading-none">
						Source Documents
					</h3>
					<span class="text-[11.5px] text-[var(--text-3)] truncate block mt-0.5">
						{#if files.length > 0}
							{files.length} attached file{files.length > 1 ? 's' : ''}
						{:else}
							Original audit attachments
						{/if}
					</span>
				</div>
			</div>

			<div class="header-actions flex items-center gap-1 shrink-0">
				{#if activeFile && activeBlobUrl}
					<button
						class="action-btn w-7 h-7 rounded-md text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] flex items-center justify-center cursor-pointer transition-colors"
						onclick={handleDownloadActiveFile}
						title="Download original file"
						aria-label="Download original file"
					>
						<Icon name="download" size={14} />
					</button>
				{/if}
				<button
					class="action-btn w-7 h-7 rounded-md text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] flex items-center justify-center cursor-pointer transition-colors"
					onclick={onClose}
					title="Close (Esc)"
					aria-label="Close source documents drawer"
				>
					<Icon name="x" size={15} />
				</button>
			</div>
		</div>

		<!-- File Tabs (when multiple files exist) -->
		{#if files.length > 1}
			<div class="file-tabs flex items-center gap-1.5 p-2 px-3 bg-[var(--surface-2)] border-b border-[var(--border)] overflow-x-auto shrink-0">
				{#each files as file, idx}
					<button
						class="tab-btn px-2.5 py-1 text-[11.5px] rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer shrink-0 {selectedIndex === idx
							? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-xs border border-[var(--border)]'
							: 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)]'}"
						onclick={() => (selectedIndex = idx)}
						title={file.name}
					>
						<Icon name="file-text" size={12} />
						<span class="truncate max-w-[140px]">{file.name}</span>
						<span class="text-[10px] text-[var(--text-3)] font-mono opacity-80">({formatBytes(file.size)})</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Body Viewport -->
		<div class="viewer-body flex-1 overflow-hidden relative bg-[var(--surface-2)] flex flex-col">
			{#if isLoading}
				<div class="loading-state flex flex-col items-center justify-center h-full gap-2 text-[var(--text-3)]">
					<Icon name="loader" size={24} class="animate-spin text-[var(--accent-primary)]" />
					<span class="text-[12px]">Loading document from local storage...</span>
				</div>
			{:else if files.length === 0}
				<div class="empty-state flex flex-col items-center justify-center h-full p-6 text-center gap-3 text-[var(--text-3)]">
					<div class="w-12 h-12 rounded-xl bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)]">
						<Icon name="file-text" size={24} />
					</div>
					<div class="empty-text">
						<h4 class="text-[13.5px] font-semibold text-[var(--text-1)] m-0 mb-1">No source files attached</h4>
						<p class="text-[12px] text-[var(--text-3)] max-w-[280px] m-0 leading-relaxed">
							When you import shipping documents via ICEGrid or upload spreadsheets, original files are attached here for instant auditing.
						</p>
					</div>
				</div>
			{:else if activeFile}
				{#if activeFile.type === 'application/pdf' || activeFile.name.toLowerCase().endsWith('.pdf')}
					{#if activeBlobUrl}
						<object
							data={activeBlobUrl}
							type="application/pdf"
							class="w-full h-full border-0 bg-[var(--surface-1)]"
							title={activeFile.name}
						>
							<div class="fallback-preview p-6 flex flex-col items-center justify-center h-full text-center gap-3">
								<p class="text-[13px] text-[var(--text-2)] m-0">
									Browser preview is not supported for this document format.
								</p>
								<button
									class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent-primary)] text-[var(--text-inverse)] text-[12px] font-medium cursor-pointer shadow-xs hover:opacity-90"
									onclick={handleDownloadActiveFile}
								>
									<Icon name="download" size={13} />
									<span>Download {activeFile.name}</span>
								</button>
							</div>
						</object>
					{/if}
				{:else}
					<!-- Tabular/Generic File Card Preview -->
					<div class="generic-file-preview p-6 flex flex-col items-center justify-center h-full text-center gap-4">
						<div class="w-16 h-16 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)] shadow-sm">
							<Icon name="file-spreadsheet" size={32} />
						</div>
						<div class="file-details">
							<h4 class="text-[14px] font-bold text-[var(--text-1)] m-0 mb-1">{activeFile.name}</h4>
							<span class="text-[12px] text-[var(--text-3)] font-mono">
								{formatBytes(activeFile.size)} • {activeFile.type || 'Spreadsheet'}
							</span>
						</div>
						<button
							class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--surface-3)] text-[12.5px] font-medium cursor-pointer transition-colors shadow-xs"
							onclick={handleDownloadActiveFile}
						>
							<Icon name="download" size={14} />
							<span>Download Original File</span>
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</aside>

<style>
	.source-viewer-drawer {
		will-change: width, opacity;
	}
</style>
